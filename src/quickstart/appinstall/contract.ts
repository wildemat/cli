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
 * org-level cloud key, and they cannot mint keys themselves. Quickstart
 * mints the per-app Elasticsearch key (named by the installer's keyName)
 * before invoking install, owning the failure/retry conversation, and
 * passes at most that one credential in the payload.
 */

import type { ProjectType, QuickstartState } from '../types.ts'
import type { QuickstartDeps } from '../types.ts'

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
  /** Pre-minted per-app ES API key (encoded); absent when minting failed. */
  dedicatedApiKey?: string
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
  /** Name quickstart uses when minting the app's dedicated ES API key. */
  keyName: string
  install: (payload: AppInstallPayload, deps: QuickstartDeps) => Promise<AppInstallOutcome>
}

/** Projects the run state into the neutral payload installers receive. */
export function buildInstallPayload (state: QuickstartState, dedicatedApiKey?: string): AppInstallPayload {
  return {
    contextName: state.projectContextName ?? '',
    endpoints: { ...state.endpoints },
    ...(state.indexName != null ? { indexName: state.indexName } : {}),
    ...(state.demoQuery != null ? { demoQuery: state.demoQuery } : {}),
    projectType: state.projectType ?? 'vectordb',
    ...(dedicatedApiKey != null ? { dedicatedApiKey } : {}),
  }
}
