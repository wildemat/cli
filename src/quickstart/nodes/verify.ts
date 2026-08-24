/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Verify node: run `elastic status` against the new project's context and
 * surface a per-service result. A brand-new project can briefly refuse
 * connections after reaching "initialized", so transient failures are
 * retried a few times before halting. Never proceeds to indexing against a
 * cluster that is not answering.
 */

import { QuickstartHalt, projectCommandGroup, type ProjectType, type QuickstartDeps } from '../types.ts'

const MAX_ATTEMPTS = 4
const RETRY_DELAY_MS = 10_000

interface ServiceCheck { ok: boolean, url?: string, error?: string, status?: string }
interface StatusBody { services?: Record<string, ServiceCheck | undefined> }

export interface VerifyResult {
  services: Record<string, ServiceCheck>
}

/** Provision facts needed only to render correct remediation commands. */
export interface VerifyProjectInfo {
  projectType?: ProjectType | undefined
  projectId?: string | undefined
  cloudContextName?: string | undefined
}

export async function runVerifyNode (
  deps: QuickstartDeps,
  projectContextName: string,
  project: VerifyProjectInfo = {},
): Promise<VerifyResult> {
  const { prompter, runCli, sleep } = deps
  const spin = prompter.spinner('Verifying connectivity…')

  let services: Record<string, ServiceCheck> = {}
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = await runCli(['status', '--use-context', projectContextName])
    services = collectServices(result.data as StatusBody | undefined)
    const failing = Object.entries(services).filter(([, s]) => !s.ok)
    if (result.ok && failing.length === 0 && Object.keys(services).length > 0) {
      spin.stop('All services are answering.')
      for (const [name, svc] of Object.entries(services)) {
        prompter.success(`${name}: ok${svc.status != null ? ` (${svc.status})` : ''}`)
      }
      return { services }
    }
    if (attempt < MAX_ATTEMPTS) {
      const summary = failing.map(([name, s]) => `${name}: ${s.error ?? 'not ready'}`).join(', ')
      spin.message(`Waiting for services (${summary.length > 0 ? summary : 'no response yet'}) — retry ${attempt}/${MAX_ATTEMPTS - 1}…`)
      await sleep(RETRY_DELAY_MS)
    }
  }

  spin.fail('Some services are not answering.')
  const failing = Object.entries(services).filter(([, s]) => !s.ok)
  for (const [name, svc] of Object.entries(services)) {
    if (svc.ok) prompter.success(`${name}: ok`)
    else prompter.warn(`${name}: ${svc.error ?? 'failed'}`)
  }
  const group = projectCommandGroup(project.projectType ?? 'vectordb')
  throw new QuickstartHalt(
    'verify_failed',
    `Service check failed: ${failing.map(([n, s]) => `${n} (${s.error ?? 'failed'})`).join(', ') || 'no services reported'}`,
    [
      `Re-check: elastic status --use-context ${projectContextName}`,
      `If auth failed, reset credentials: elastic cloud serverless projects ${group} reset-credentials --id ${project.projectId ?? '<project-id>'} --save-as ${projectContextName} --use-context ${project.cloudContextName ?? '<cloud-context>'}`,
      'Then re-run: elastic quickstart',
    ],
  )
}

function collectServices (body: StatusBody | undefined): Record<string, ServiceCheck> {
  const out: Record<string, ServiceCheck> = {}
  for (const [name, svc] of Object.entries(body?.services ?? {})) {
    if (svc != null && typeof svc === 'object' && typeof svc.ok === 'boolean') out[name] = svc
  }
  return out
}
