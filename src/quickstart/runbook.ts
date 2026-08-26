/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Agent-mode projection: translate flow nodes that declare an `agent` block
 * into a goal-oriented runbook. The agent interviews its own user and runs
 * the listed commands directly — it never re-invokes `elastic quickstart`.
 * Only this projection (stamped with `schema_version`) is a published
 * contract; the internal tree stays private and free to change.
 *
 * See `AGENTS.md` in this directory for how nodes opt into this translation.
 */

import {
  LINKS,
  QUICKSTART_SCHEMA_VERSION,
  type CloudEnv,
} from './constants.ts'
import { bookshopAgentGuide } from './appinstall/bookshop.ts'
import { buildFlow, type AgentField, type FlowNode, type FlowNodeAgent } from './tree.ts'
import type { JsonValue } from '../factory.ts'

function resolveAgentField<T> (field: AgentField<T>, env: CloudEnv): T {
  return typeof field === 'function' ? (field as (env: CloudEnv) => T)(env) : field
}

/** Maps one opted-in node to a runbook step object. */
function translateStep (node: FlowNode & { agent: FlowNodeAgent }, env: CloudEnv): Record<string, JsonValue> {
  const { agent } = node
  const step: Record<string, JsonValue> = {
    id: node.id,
    title: agent.title ?? node.title,
    capability: resolveAgentField(agent.capability, env),
  }
  if (agent.ask_user != null) step.ask_user = resolveAgentField(agent.ask_user, env)
  if (agent.commands != null) step.commands = resolveAgentField(agent.commands, env)
  if (agent.on_failure != null) step.on_failure = resolveAgentField(agent.on_failure, env)
  if (agent.notes != null) step.notes = resolveAgentField(agent.notes, env)
  if (agent.extras != null) Object.assign(step, resolveAgentField(agent.extras, env))
  return step
}

/**
 * Builds the runbook from a flow. Nodes without an `agent` block are omitted
 * (interactive-only). Envelope fields (goal, links, reference_app) live here.
 */
export function translate (nodes: FlowNode[], cloudEnv: CloudEnv): JsonValue {
  const steps = nodes
    .filter((n): n is FlowNode & { agent: FlowNodeAgent } => n.agent != null)
    .map((n) => translateStep(n, cloudEnv))

  return {
    schema_version: QUICKSTART_SCHEMA_VERSION,
    kind: 'elastic-quickstart-runbook',
    goal: 'Take a brand-new Elastic user from nothing to a working Vector DB serverless project on Elastic Cloud with sample data indexed and a proof-of-value semantic-vs-keyword comparison, then keep building their search application.',
    for_agents: 'Bootstrap: run `elastic quickstart --json` once (required — do not run bare `elastic quickstart`; agents often have a PTY and would enter interactive mode). Treat stdout as your only plan (kind=elastic-quickstart-runbook). Walk steps in order at a human educational pace: announce each step, run its commands, show the user the important output (especially search hits), and wait on ask_user before continuing — do not batch, summarize-away, or skip ahead to cleanup/handoff. Interview on ask_user; run listed commands with --json; follow on_failure when present. After bootstrap, never re-invoke `elastic quickstart`. Discover schemas with `elastic <command> --help --json` or `elastic cli-schema`.',
    discovery: {
      command_help: 'elastic cloud --help --json',
      full_schema: 'elastic cli-schema',
      bootstrap: 'elastic quickstart --json',
    },
    steps,
    reference_app: bookshopAgentGuide() as JsonValue,
    links: {
      docs_quickstart: LINKS.docsQuickstart,
      agent_skill: LINKS.agentSkill,
      vector_search: LINKS.vectorSearch,
      eis_models: LINKS.eisModels,
      semantic_text: LINKS.semanticText,
      billing: LINKS.billing,
      reference_app: LINKS.referenceApp,
    },
    cost_awareness: 'Serverless bills by usage. The project is disposable: elastic cloud serverless projects vector delete --id <id> --json (a Search project created via the 403 fallback lives under `projects search` — use `projects search delete`)',
  }
}

/** Builds the runbook object emitted in agent mode from the current flow. */
export function buildRunbook (cloudEnv: CloudEnv): JsonValue {
  return translate(buildFlow(), cloudEnv)
}
