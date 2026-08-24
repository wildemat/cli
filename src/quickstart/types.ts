/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared quickstart types: the run state threaded through nodes, the
 * dependency surface injected into them, and the halt error used for
 * fail-loudly-with-a-way-forward terminal states.
 */

import type { RunCli } from './executor.ts'
import type { Prompter } from './prompts.ts'

/** Deployment target seam — one value in v1; local lands as a fast follow. */
export type DeploymentTarget = 'cloud-serverless'

/** Serverless project type created by the provision node. */
export type ProjectType = 'vectordb' | 'elasticsearch'

/**
 * CLI command group for a project type (`projects vector …` vs
 * `projects search …`). Every rendered command that names a project must go
 * through this — the two types live under different API namespaces, so a
 * `vector` command can never find a Search project.
 */
export function projectCommandGroup (type: ProjectType): 'vector' | 'search' {
  return type === 'vectordb' ? 'vector' : 'search'
}

/** Everything a node needs from the outside world, injectable for tests. */
export interface QuickstartDeps {
  runCli: RunCli
  prompter: Prompter
  fetchFn: typeof fetch
  openBrowser: (url: string) => boolean
  env: NodeJS.ProcessEnv
  /** Sleep, injectable so retry loops are instant under test. */
  sleep: (ms: number) => Promise<void>
}

/** Mutable state accumulated as the interpreter walks the tree. */
export interface QuickstartState {
  target: DeploymentTarget
  /** Context holding the Cloud API key (auth node output). */
  cloudContextName?: string
  /** Context written by `--save-as` for the new project. */
  projectContextName?: string
  projectType?: ProjectType
  projectId?: string
  projectName?: string
  regionId?: string
  endpoints?: { elasticsearch?: string, kibana?: string }
  indexName?: string
  docsIndexed?: number
  demoQuery?: string
  comparison?: ComparisonResult
  contextDocPath?: string
  handoff?: { choice: string, detail?: string }
}

/** One side of the BM25-vs-semantic comparison. */
export interface SearchOutcome {
  tookMs: number
  hits: Array<{ title: string, score: number }>
}

export interface ComparisonResult {
  query: string
  bm25: SearchOutcome
  semantic: SearchOutcome
}

/**
 * Thrown by nodes to stop the run with an actionable message. Every halt
 * carries a way forward — a terminal state is never a dead end.
 */
export class QuickstartHalt extends Error {
  readonly code: string
  readonly nextSteps: string[]

  constructor (code: string, message: string, nextSteps: string[] = []) {
    super(message)
    this.code = code
    this.nextSteps = nextSteps
  }
}
