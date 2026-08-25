/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Persistent side of the sample-app install seam.
 *
 * Quickstart hands installers a neutral payload — endpoints, names, and a
 * key-minting capability, all in quickstart's own vocabulary. Everything
 * app-specific (repo URL, the app's env-var names, run commands) lives in
 * the swappable installer module, never here. When the generalised
 * third-party install contract lands (quickstart PRD fast follow #16), this
 * payload gains a schema_version and becomes the published surface; until
 * then it may change freely with the tree.
 *
 * Credential rule: installers never see the context's credentials or the
 * org-level cloud key. The only way to obtain one is mintDedicatedKey,
 * which creates a per-app Elasticsearch API key scoped to the project.
 */

import type { ProjectType, QuickstartDeps, QuickstartState } from '../types.ts'

/** Neutral facts an installer may consume; no app-specific vocabulary. */
export interface AppInstallPayload {
  /** Config context holding the project connection (for printed commands). */
  contextName: string
  endpoints: { elasticsearch?: string, kibana?: string }
  /** Sample index quickstart created, when the value node ran. */
  indexName?: string
  /** The query just demonstrated, reusable as the app's first search. */
  demoQuery?: string
  projectType: ProjectType
  /**
   * Mints a dedicated ES API key for the app and returns its encoded value
   * (undefined on failure). Single attempt: by handoff time the project has
   * already served searches, so warm-up retries are provision's concern.
   */
  mintDedicatedKey: (appName: string) => Promise<string | undefined>
}

export interface AppInstallOutcome {
  /** Absolute directory the app landed in, when the install got that far. */
  dir?: string
  detail: string
}

/** One installable sample app, offered as a handoff-fork option. */
export interface AppInstaller {
  id: string
  label: string
  hint: string
  install: (payload: AppInstallPayload, deps: QuickstartDeps) => Promise<AppInstallOutcome>
}

/** Projects the run state into the neutral payload installers receive. */
export function buildInstallPayload (state: QuickstartState, deps: QuickstartDeps): AppInstallPayload {
  const contextName = state.projectContextName ?? ''
  return {
    contextName,
    endpoints: { ...state.endpoints },
    ...(state.indexName != null ? { indexName: state.indexName } : {}),
    ...(state.demoQuery != null ? { demoQuery: state.demoQuery } : {}),
    projectType: state.projectType ?? 'vectordb',
    mintDedicatedKey: async (appName) => {
      const result = await deps.runCli([
        'es', 'security', 'create-api-key',
        '--name', appName,
        '--use-context', contextName,
      ])
      const body = (result.data ?? {}) as { encoded?: string, api_key?: string }
      const encoded = body.encoded ?? body.api_key
      return result.ok && typeof encoded === 'string' ? encoded : undefined
    },
  }
}
