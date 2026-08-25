/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The internal quickstart flow model and its interactive interpreter.
 *
 * One model, two projections: the interpreter here walks the nodes with
 * prompts and subprocesses; `runbook.ts` projects the same flow once as a
 * self-describing runbook for agents. The internal shape is private — only
 * the runbook (with its schema_version) is a published contract.
 *
 * v1 is nearly linear on purpose (one region question before provisioning,
 * confirm gates around the value moment). The node structure exists so
 * fast-follow branches (search project type, local via start-local, own-data
 * ingestion) slot in without a rewrite. Three seams
 * are kept explicit, each with one v1 implementation: provision(),
 * writeContext() (delegated to --save-as), and inferenceStrategy() (EIS
 * defaults — nothing to configure on cloud).
 */

import { runAuthNode } from './nodes/auth.ts'
import { runProvisionNode } from './nodes/provision.ts'
import { runVerifyNode } from './nodes/verify.ts'
import { runValueNode } from './nodes/value.ts'
import { writeContextDoc } from './nodes/context-doc.ts'
import { runHandoffNode } from './nodes/handoff.ts'
import { DEMO_QUERY } from './constants.ts'
import type { QuickstartDeps, QuickstartState } from './types.ts'

export type NodeKind = 'check' | 'command' | 'question' | 'handoff' | 'terminal'

/** A step in the flow; `run` advances the shared state. */
export interface FlowNode {
  id: string
  kind: NodeKind
  title: string
  run: (state: QuickstartState, deps: QuickstartDeps) => Promise<void>
}

/** The v1 flow, in execution order. */
export function buildFlow (): FlowNode[] {
  return [
    {
      id: 'auth',
      kind: 'check',
      title: 'Connect to Elastic Cloud',
      run: async (state, deps) => {
        const auth = await runAuthNode(deps)
        state.cloudContextName = auth.cloudContextName
      },
    },
    {
      id: 'provision',
      kind: 'command',
      title: 'Create a Vector DB serverless project',
      run: async (state, deps) => {
        const result = await runProvisionNode(deps, state.cloudContextName!)
        state.projectType = result.projectType
        state.projectId = result.projectId
        state.projectName = result.projectName
        state.regionId = result.regionId
        state.projectContextName = result.projectContextName
        state.endpoints = result.endpoints
        state.esApiKeyMinted = result.esApiKeyMinted
      },
    },
    {
      id: 'verify',
      kind: 'check',
      title: 'Verify connectivity',
      run: async (state, deps) => {
        await runVerifyNode(deps, state.projectContextName!, {
          projectType: state.projectType,
          projectId: state.projectId,
          cloudContextName: state.cloudContextName,
        })
      },
    },
    {
      id: 'value',
      kind: 'command',
      title: 'Index sample data and compare keyword vs semantic search',
      run: async (state, deps) => {
        const result = await runValueNode(deps, state.projectContextName!)
        state.indexName = result.indexName
        state.docsIndexed = result.docsIndexed
        state.comparison = result.comparison
        state.demoQuery = DEMO_QUERY
      },
    },
    {
      id: 'context-doc',
      kind: 'command',
      title: 'Write the handoff context doc',
      run: async (state) => {
        state.contextDocPath = await writeContextDoc(state)
      },
    },
    {
      id: 'handoff',
      kind: 'handoff',
      title: 'Continue with an agent or Kibana',
      run: async (state, deps) => {
        state.handoff = await runHandoffNode(deps, state)
      },
    },
  ]
}

/** Walks the flow, mutating and returning the state. Halts propagate. */
export async function walkFlow (deps: QuickstartDeps, nodes: FlowNode[] = buildFlow()): Promise<QuickstartState> {
  const state: QuickstartState = { target: 'cloud-serverless' }
  for (const node of nodes) {
    await node.run(state, deps)
  }
  return state
}
