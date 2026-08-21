/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Provision node: create the Vector DB serverless project.
 *
 * Region is defaulted and displayed, never asked (it is irreversible for the
 * project, so it is shown; the project itself is disposable). The project is
 * tagged via `--metadata` — that tagging is the entire measurement plan.
 * `--save-as` does the credential/endpoint/context work; nothing is
 * reimplemented here.
 *
 * A `403 projects.create_project.forbidden` is a known branch: fresh trial
 * orgs may not be entitled to Vector DB projects at launch, so the user is
 * offered a Search project optimized for vectors instead.
 */

import { readRawConfig, resolveConfigPath } from '../../config/writer.ts'
import { DEFAULT_PROJECT_NAME, METADATA_TAGS, REGION_PREFERENCE } from '../constants.ts'
import { QuickstartHalt, type QuickstartDeps } from '../types.ts'

export interface ProvisionResult {
  projectType: 'vectordb' | 'elasticsearch'
  projectId: string
  projectName: string
  regionId: string
  /** Context written by --save-as; later nodes run against it. */
  projectContextName: string
  endpoints: { elasticsearch?: string, kibana?: string }
}

interface Region {
  id: string
  name?: string
  project_creation_enabled?: boolean
}

/** Picks the default region: preference list first, then first creatable. */
export function pickDefaultRegion (regions: Region[]): Region | undefined {
  const creatable = regions.filter((r) => r.project_creation_enabled !== false)
  for (const preferred of REGION_PREFERENCE) {
    const hit = creatable.find((r) => r.id === preferred)
    if (hit != null) return hit
  }
  return creatable[0]
}

/** First name in quickstart, quickstart-2, ... not present in `taken`. */
export function firstFreeName (taken: Set<string>, base: string = DEFAULT_PROJECT_NAME): string {
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`
    if (!taken.has(candidate)) return candidate
  }
}

export async function runProvisionNode (
  deps: QuickstartDeps,
  cloudContextName: string,
): Promise<ProvisionResult> {
  const { prompter, runCli } = deps

  // Region: fetch, default, display.
  const regionsResult = await runCli(
    ['cloud', 'serverless', 'regions', 'list-regions', '--use-context', cloudContextName],
  )
  const regions = Array.isArray(regionsResult.data) ? regionsResult.data as unknown as Region[] : []
  const region = pickDefaultRegion(regions)
  if (region == null) {
    throw new QuickstartHalt(
      'no_region',
      'Could not find a serverless region that allows project creation.',
      ['Check connectivity: elastic status', 'List regions: elastic cloud serverless regions list-regions'],
    )
  }
  prompter.info(`Region: ${region.name ?? region.id} (${region.id}) — chosen for you. A project's region cannot be changed later.`)

  // Name: default, suffixed past existing projects and contexts. The context
  // written by --save-as shares the project name, so both namespaces count.
  const taken = new Set<string>()
  const listResult = await runCli(
    ['cloud', 'serverless', 'projects', 'vector', 'list', '--use-context', cloudContextName],
  )
  const items = (listResult.data as { items?: Array<{ name?: string }> } | undefined)?.items
  for (const item of items ?? []) {
    if (typeof item.name === 'string') taken.add(item.name)
  }
  const rawConfig = await readRawConfig(resolveConfigPath())
  for (const ctxName of Object.keys(rawConfig.contexts)) taken.add(ctxName)
  const name = firstFreeName(taken)

  const spin = prompter.spinner(`Creating Vector DB project "${name}"…`)
  const started = Date.now()
  const phase = (line: string): void => {
    const elapsed = Math.round((Date.now() - started) / 1000)
    spin.message(`Creating Vector DB project "${name}"… ${line.replace(/^Waiting for project\.\.\.\s*/, '')} (${elapsed}s)`)
  }

  const createArgv = [
    'cloud', 'serverless', 'projects', 'vector', 'create',
    '--name', name,
    '--region-id', region.id,
    '--metadata', JSON.stringify({ tags: METADATA_TAGS }),
    '--wait',
    '--save-as', name,
    '--use-context', cloudContextName,
  ]
  let created = await runCli(createArgv, { onStderrLine: phase })
  let projectType: ProvisionResult['projectType'] = 'vectordb'

  if (!created.ok && isEntitlementError(created.error?.message)) {
    spin.fail('This organization cannot create Vector DB projects yet.')
    prompter.warn('Your trial may not be entitled to the Vector DB project type at this time.')
    const fallback = await prompter.confirm('Create a Search project optimized for vectors instead?')
    if (!fallback) {
      throw new QuickstartHalt(
        'vectordb_forbidden',
        'Vector DB project creation is not enabled for this organization.',
        ['Ask your Elastic contact about Vector DB availability', 'Re-run: elastic quickstart'],
      )
    }
    const spin2 = prompter.spinner(`Creating Search project "${name}" (optimized for vectors)…`)
    created = await runCli([
      'cloud', 'serverless', 'projects', 'search', 'create',
      '--name', name,
      '--region-id', region.id,
      '--optimized-for', 'vector',
      '--wait',
      '--save-as', name,
      '--use-context', cloudContextName,
    ], { onStderrLine: (line) => spin2.message(line) })
    projectType = 'elasticsearch'
    if (!created.ok) spin2.fail('Project creation failed.')
    else spin2.stop(`Search project "${name}" is ready.`)
  } else if (!created.ok) {
    spin.fail('Project creation failed.')
  } else {
    spin.stop(`Vector DB project "${name}" is ready.`)
  }

  if (!created.ok) {
    // The project may exist even though saving the context failed (e.g. the
    // OS keychain refused the write). Don't let a re-run create a duplicate.
    if (created.error?.code === 'credential_policy_error') {
      throw new QuickstartHalt(
        'context_save_failed',
        `The project was created, but saving its credentials failed: ${created.error.message}`,
        [
          `Find its id: elastic cloud serverless projects vector list --use-context ${cloudContextName}`,
          `Save credentials to a context: elastic cloud serverless projects vector reset-credentials --id <id> --save-as ${name} --use-context ${cloudContextName}`,
        ],
      )
    }
    throw new QuickstartHalt(
      'provision_failed',
      created.error?.message ?? `project creation exited with code ${created.exitCode}`,
      [
        'Retry manually: elastic ' + createArgv.join(' '),
        'Check your organization in the Cloud console',
      ],
    )
  }

  const body = (created.data ?? {}) as Record<string, unknown>
  const endpoints = (body.endpoints ?? {}) as { elasticsearch?: string, kibana?: string }
  const savedAs = typeof body.savedAs === 'string' ? body.savedAs : name

  prompter.success(`Connection saved as context "${savedAs}" (credentials in your OS keychain)`)

  return {
    projectType,
    projectId: typeof body.id === 'string' ? body.id : '',
    projectName: name,
    regionId: region.id,
    projectContextName: savedAs,
    endpoints,
  }
}

function isEntitlementError (message: string | undefined): boolean {
  if (message == null) return false
  return message.includes('create_project.forbidden') ||
    (message.includes('403') && message.toLowerCase().includes('forbidden'))
}
