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

import {
  readRawConfig,
  writeConfig,
  upsertContext,
  hasInlineSecrets,
  type RawContext,
} from '../../config/writer.ts'
import { resolveConfigPathForWrite } from '../../config/loader.ts'
import { getSecretStore } from '../../config/secret-store.ts'
import { DEFAULT_PROJECT_NAME, METADATA_TAGS, REGION_PREFERENCE } from '../constants.ts'
import { QuickstartHalt, projectCommandGroup, type ProjectType, type QuickstartDeps } from '../types.ts'
import type { CliResult } from '../executor.ts'

const KEYCHAIN_SERVICE = 'elastic-cli'

export interface ProvisionResult {
  projectType: ProjectType
  projectId: string
  projectName: string
  regionId: string
  /** Context written by --save-as; later nodes run against it. */
  projectContextName: string
  endpoints: { elasticsearch?: string, kibana?: string }
  /** False when the context kept the admin basic-auth pair instead. */
  esApiKeyMinted: boolean
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
  if (!regionsResult.ok) {
    const detail = regionsResult.error?.message ??
      (regionsResult.stderr.trim() || `exit code ${regionsResult.exitCode}`)
    throw new QuickstartHalt(
      'regions_failed',
      `Could not list serverless regions: ${detail}`,
      [
        'Check connectivity and credentials: elastic status',
        `Re-list: elastic cloud serverless regions list-regions --use-context ${cloudContextName}`,
      ],
    )
  }
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
  const rawConfig = await readRawConfig(await resolveConfigPathForWrite())
  for (const ctxName of Object.keys(rawConfig.contexts)) taken.add(ctxName)
  const name = firstFreeName(taken)

  // One create journey for both types: same metadata funnel tags, same
  // spinner/phase treatment, same --wait/--save-as. The entitlement fallback
  // is this exact journey re-run with the Search type, not a hand-copied argv.
  const buildCreateArgv = (type: ProjectType): string[] => [
    'cloud', 'serverless', 'projects', projectCommandGroup(type), 'create',
    '--name', name,
    '--region-id', region.id,
    ...(type === 'elasticsearch' ? ['--optimized-for', 'vector'] : []),
    '--metadata', JSON.stringify({ tags: METADATA_TAGS }),
    '--wait',
    '--save-as', name,
    '--use-context', cloudContextName,
  ]

  const createProject = async (type: ProjectType): Promise<CliResult> => {
    const label = type === 'vectordb' ? 'Vector DB' : 'Search (optimized for vectors)'
    const spin = prompter.spinner(`Creating ${label} project "${name}"…`)
    const started = Date.now()
    const result = await runCli(buildCreateArgv(type), {
      onStderrLine: (line) => {
        const elapsed = Math.round((Date.now() - started) / 1000)
        spin.message(`Creating ${label} project "${name}"… ${line.replace(/^Waiting for project\.\.\.\s*/, '')} (${elapsed}s)`)
      },
    })
    if (result.ok) {
      spin.stop(`${label} project "${name}" is ready.`)
    } else if (type === 'vectordb' && isEntitlementError(result.error?.message)) {
      spin.fail('This organization cannot create Vector DB projects yet.')
    } else {
      spin.fail('Project creation failed.')
    }
    return result
  }

  let projectType: ProjectType = 'vectordb'
  let created = await createProject(projectType)

  if (!created.ok && isEntitlementError(created.error?.message)) {
    prompter.warn('Your trial may not be entitled to the Vector DB project type at this time.')
    const fallback = await prompter.confirm('Create a Search project optimized for vectors instead?')
    if (!fallback) {
      throw new QuickstartHalt(
        'vectordb_forbidden',
        'Vector DB project creation is not enabled for this organization.',
        ['Ask your Elastic contact about Vector DB availability', 'Re-run: elastic quickstart'],
      )
    }
    projectType = 'elasticsearch'
    created = await createProject(projectType)
  }

  const group = projectCommandGroup(projectType)
  if (!created.ok) {
    // The project may exist even though saving the context failed (e.g. the
    // OS keychain refused the write). Don't let a re-run create a duplicate.
    if (created.error?.code === 'credential_policy_error') {
      throw new QuickstartHalt(
        'context_save_failed',
        `The project was created, but saving its credentials failed: ${created.error.message}`,
        [
          `Find its id: elastic cloud serverless projects ${group} list --use-context ${cloudContextName}`,
          `Save credentials to a context: elastic cloud serverless projects ${group} reset-credentials --id <id> --save-as ${name} --use-context ${cloudContextName}`,
        ],
      )
    }
    throw new QuickstartHalt(
      'provision_failed',
      created.error?.message ?? `project creation exited with code ${created.exitCode}`,
      [
        'Retry manually: elastic ' + buildCreateArgv(projectType).join(' '),
        'Check your organization in the Cloud console',
      ],
    )
  }

  const body = (created.data ?? {}) as Record<string, unknown>
  const endpoints = (body.endpoints ?? {}) as { elasticsearch?: string, kibana?: string }
  const savedAs = typeof body.savedAs === 'string' ? body.savedAs : name

  prompter.success(`Connection saved as context "${savedAs}" (credentials in your OS keychain)`)

  // Everything downstream of the handoff (client code, apps, agents) wants an
  // API key, not the admin basic-auth pair --save-as stores. Mint one and make
  // it the context's Elasticsearch credential; agents then reference it by
  // running commands with --use-context, never by handling the raw value.
  const esApiKeyMinted = await mintContextApiKey(deps, savedAs)

  return {
    projectType,
    projectId: typeof body.id === 'string' ? body.id : '',
    projectName: name,
    regionId: region.id,
    projectContextName: savedAs,
    endpoints,
    esApiKeyMinted,
  }
}

const MINT_MAX_ATTEMPTS = 6
const MINT_RETRY_DELAY_MS = 10_000

/**
 * Mints an ES API key against the new context (subprocess; the key travels
 * over the child's stdout pipe, never argv) and rewrites the context's
 * elasticsearch auth to use it via the in-process writer + secret store.
 *
 * A fresh project can briefly refuse connections after --wait reports it
 * initialized, so the mint holds under a spinner and retries retryable
 * failures until success or the attempt budget runs out. Returns false on
 * terminal failure — basic auth remains and the run continues.
 */
async function mintContextApiKey (deps: QuickstartDeps, contextName: string): Promise<boolean> {
  const { prompter, runCli, sleep } = deps
  const spin = prompter.spinner('Minting an Elasticsearch API key…')

  for (let attempt = 1; attempt <= MINT_MAX_ATTEMPTS; attempt++) {
    const result = await runCli([
      'es', 'security', 'create-api-key',
      '--name', `${contextName}-quickstart`,
      '--use-context', contextName,
    ])
    const keyBody = (result.data ?? {}) as { encoded?: string, api_key?: string }
    const encoded = keyBody.encoded ?? keyBody.api_key
    if (result.ok && encoded != null) {
      if (await storeMintedKey(contextName, encoded)) {
        spin.stop(`Minted an Elasticsearch API key and stored it in context "${contextName}"`)
        return true
      }
      break
    }
    if (result.ok || !isRetryableMintFailure(result) || attempt === MINT_MAX_ATTEMPTS) break
    spin.message(`Minting an Elasticsearch API key… project not accepting requests yet (retry ${attempt}/${MINT_MAX_ATTEMPTS - 1})`)
    await sleep(MINT_RETRY_DELAY_MS)
  }

  spin.fail('Could not mint an API key; the context keeps the project\'s basic-auth credentials (everything still works).')
  return false
}

/**
 * Failures worth another attempt while the project warms up: anything
 * connection-level (no envelope, connection/timeout codes) and server-side
 * 5xx/429/408. Envelope-coded config errors and other 4xx are terminal.
 */
function isRetryableMintFailure (result: CliResult): boolean {
  const err = result.error
  if (err == null) return true
  if (err.status != null) return err.status >= 500 || err.status === 429 || err.status === 408
  return err.code === 'connection_error' || err.code === 'timeout' || err.code === 'transport_error'
}

/** Writes the minted key into the context via the writer + secret store. */
async function storeMintedKey (contextName: string, encoded: string): Promise<boolean> {
  try {
    const configPath = await resolveConfigPathForWrite()
    const config = await readRawConfig(configPath)
    const existing = config.contexts[contextName]
    if (existing == null) return false

    const store = await getSecretStore()
    let keyValue = encoded
    if (await store.isAvailable()) {
      const account = `${contextName}:elasticsearch.auth.api_key`
      await store.put(KEYCHAIN_SERVICE, account, encoded)
      keyValue = store.resolverExpr(KEYCHAIN_SERVICE, account)
    }

    const esBlock = existing.elasticsearch
    if (esBlock == null || typeof esBlock !== 'object') return false
    const nextContext: RawContext = {
      ...existing,
      elasticsearch: { ...(esBlock as Record<string, unknown>), auth: { api_key: keyValue } },
    }
    const next = upsertContext(config, contextName, nextContext)
    await writeConfig(configPath, next, { restrictPermissions: hasInlineSecrets(next) })
    return true
  } catch {
    return false
  }
}

function isEntitlementError (message: string | undefined): boolean {
  if (message == null) return false
  return message.includes('create_project.forbidden') ||
    (message.includes('403') && message.toLowerCase().includes('forbidden'))
}
