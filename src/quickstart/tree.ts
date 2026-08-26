/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The internal quickstart flow model and its interactive interpreter.
 *
 * See `AGENTS.md` in this directory for how this file relates to `runbook.ts`
 * and how to keep them in parity.
 *
 * One model, two projections: the interpreter here walks the nodes with
 * prompts and subprocesses; `runbook.ts` translates nodes that declare an
 * `agent` block into the published runbook. The internal shape is private —
 * only the runbook (with its schema_version) is a published contract.
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
import { runValueNode, sampleIndexMappings, bm25QueryBody, semanticQueryBody } from './nodes/value.ts'
import { writeContextDoc } from './nodes/context-doc.ts'
import { runHandoffNode } from './nodes/handoff.ts'
import {
  DEMO_QUERY,
  LEXICAL_FIELD,
  METADATA_TAGS_BY_TYPE,
  SAMPLE_INDEX,
  SEMANTIC_FIELD,
  type CloudEnv,
} from './constants.ts'
import type { JsonValue } from '../factory.ts'
import type { QuickstartDeps, QuickstartState } from './types.ts'

export type NodeKind = 'check' | 'command' | 'question' | 'handoff' | 'terminal'

/** Static value or CloudEnv-resolved value for agent-facing fields. */
export type AgentField<T> = T | ((env: CloudEnv) => T)

/**
 * Agent-mode metadata for a flow node. Presence of this object opts the node
 * into `translate()`; omit it for interactive-only steps (e.g. context-doc).
 */
export interface FlowNodeAgent {
  /** Override the interactive title when agent wording should differ. */
  title?: string
  capability: AgentField<string>
  ask_user?: AgentField<string>
  commands?: AgentField<string[]>
  on_failure?: AgentField<Record<string, string>>
  notes?: AgentField<string>
  /** Merged into the emitted step (e.g. `query_bodies`). */
  extras?: AgentField<Record<string, JsonValue>>
}

/** A step in the flow; `run` advances the shared state. */
export interface FlowNode {
  id: string
  kind: NodeKind
  title: string
  run: (state: QuickstartState, deps: QuickstartDeps) => Promise<void>
  agent?: FlowNodeAgent
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
      agent: {
        capability: 'An org API key stored in a named config context; secrets go to the OS keychain, never argv.',
        ask_user: (env) =>
          `Do you already have an Elastic Cloud account and API key? If not, send them to ${env.signupUrl} then ${env.apiKeysUrl}. When the key form asks for roles, Organization owner is right for their own fresh account; members of a shared org should pick their usual narrower role.`,
        commands: (env) => [
          `elastic config context add <name> --cloud-url ${env.apiUrl} --cloud-api-key <key> --json`,
          'elastic status --json  # probes the cloud block; 401/403 means a bad key',
        ],
        notes: 'If a context with a working cloud api_key already exists, skip this step.',
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
      agent: {
        capability: 'Creates the project, waits for readiness, and saves endpoints + credentials as a reusable context in one command. Then mint an ES API key and keep it in the context — downstream tooling wants API keys, and the config context (OS keychain-backed) is the canonical place for credentials; reference them by running commands with --use-context, never by copying values around.',
        commands: [
          'elastic cloud serverless regions list-regions --json  # pick a region; it is permanent for the project',
          `elastic cloud serverless projects vector create --name quickstart --region-id <region> --metadata '${JSON.stringify({ tags: METADATA_TAGS_BY_TYPE.vectordb })}' --wait --save-as quickstart --json`,
          'elastic es security create-api-key --name quickstart-cli --use-context quickstart --json  # then store it in the context: elastic config context edit quickstart --es-api-key <encoded>',
        ],
        on_failure: (env) => ({
          '403 projects.create_project.forbidden': `The org is not entitled to Vector DB projects yet. Create a Search project optimized for vectors instead: elastic cloud serverless projects search create --name quickstart --region-id <region> --optimized-for vector --metadata '${JSON.stringify({ tags: METADATA_TAGS_BY_TYPE.elasticsearch })}' --wait --save-as quickstart --json`,
          fallback_console: env.createProjectUrl,
        }),
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
      agent: {
        capability: 'Per-service probe of Elasticsearch, Kibana, and Cloud; distinguishes auth failures from network errors.',
        commands: ['elastic status --use-context quickstart --json'],
        notes: 'Do not index against a cluster that is not answering. A fresh project can take a moment; retry briefly.',
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
      agent: {
        title: 'Index sample data and prove semantic search',
        capability: 'semantic_text auto-embeds at ingest via the default EIS inference endpoint — no model setup, multilingual. Only the semantic field needs declaring (dynamic mapping covers the rest). On a Vector DB project the vectordb_document index mode is auto-applied; do not hand-tune HNSW or quantization.',
        commands: [
          `elastic es indices create --index ${SAMPLE_INDEX} --mappings '${JSON.stringify(sampleIndexMappings())}' --use-context quickstart --json`,
          `elastic es helpers bulk-ingest --index ${SAMPLE_INDEX} --data-file <your-docs.ndjson> --use-context quickstart --json`,
          `elastic es search --index ${SAMPLE_INDEX} --use-context quickstart --json  # pass the query bodies below via stdin or --input-file`,
        ],
        notes: `Show the user both result lists side by side: semantic search matches meaning where keyword search needs the words "${DEMO_QUERY}" to appear. Fields: ${LEXICAL_FIELD} (text) copy_to ${SEMANTIC_FIELD} (semantic_text).`,
        extras: {
          query_bodies: {
            keyword_bm25: bm25QueryBody(DEMO_QUERY, 5) as JsonValue,
            semantic: semanticQueryBody(DEMO_QUERY, 5) as JsonValue,
          },
        },
      },
    },
    {
      id: 'context-doc',
      kind: 'command',
      title: 'Write the handoff context doc',
      run: async (state) => {
        state.contextDocPath = await writeContextDoc(state)
      },
      // No `agent` — interactive-only. Agents already hold conversation context.
    },
    {
      id: 'handoff',
      kind: 'handoff',
      title: 'Continue with an agent or Kibana',
      run: async (state, deps) => {
        state.handoff = await runHandoffNode(deps, state)
      },
      agent: {
        title: 'Keep building',
        capability: 'Two co-equal exits: keep working here with the saved context, or open Kibana (endpoint saved in the context).',
        commands: [
          'elastic config context list --json  # contexts and their endpoints, including kibana',
          `elastic es search --index ${SAMPLE_INDEX} --use-context quickstart --json`,
        ],
        notes: 'Next: hybrid retrieval (RRF), ES|QL aggregations, or point the Elastic Bookshop reference app at the project.',
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
