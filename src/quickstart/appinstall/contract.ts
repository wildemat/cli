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
 * the swappable installer module, never here. This payload is unversioned
 * and may change freely with the tree; publishing it to third-party
 * installers means stamping it with a schema_version first.
 *
 * Credential rule: installers never see the context's credentials or the
 * org-level cloud key. The only way to obtain one is mintDedicatedKey,
 * which creates a per-app Elasticsearch API key scoped to the project.
 */

import { mintEsApiKey } from '../es-keys.ts'
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
      const { result, encoded } = await mintEsApiKey(deps.runCli, appName, contextName)
      return result.ok ? encoded : undefined
    },
  }
}
