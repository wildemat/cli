/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildRunbook, translate } from '../../src/quickstart/runbook.ts'
import { CLOUD_ENVS } from '../../src/quickstart/constants.ts'
import type { FlowNode } from '../../src/quickstart/tree.ts'

interface Step {
  id: string
  commands?: string[]
  on_failure?: Record<string, string>
  query_bodies?: Record<string, unknown>
}

describe('translate', () => {
  it('includes only nodes that declare agent metadata', () => {
    const nodes: FlowNode[] = [
      {
        id: 'auth',
        kind: 'check',
        title: 'Auth',
        run: async () => {},
        agent: { capability: 'creds', commands: ['elastic status --json'] },
      },
      {
        id: 'context-doc',
        kind: 'command',
        title: 'Write context doc',
        run: async () => {},
      },
      {
        id: 'handoff',
        kind: 'handoff',
        title: 'Interactive handoff title',
        run: async () => {},
        agent: {
          title: 'Keep building',
          capability: 'exits',
          commands: (env) => [`elastic config context list --json # ${env.name}`],
        },
      },
    ]
    const runbook = translate(nodes, CLOUD_ENVS.qa) as Record<string, unknown>
    const steps = runbook.steps as Step[]
    assert.deepEqual(steps.map((s) => s.id), ['auth', 'handoff'])
    assert.equal(steps[1]?.commands?.[0], 'elastic config context list --json # qa')
    assert.equal((steps[1] as { title?: string }).title, 'Keep building')
  })
})

describe('buildRunbook', () => {
  const runbook = buildRunbook(CLOUD_ENVS.prod) as Record<string, unknown>
  const steps = runbook.steps as Step[]

  it('is a versioned, self-describing contract', () => {
    assert.equal(runbook.schema_version, 1)
    assert.equal(runbook.kind, 'elastic-quickstart-runbook')
    assert.match(String(runbook.for_agents), /elastic quickstart --json/)
    assert.match(String(runbook.for_agents), /do not run bare|never re-invoke|do not re-invoke/i)
    assert.ok((runbook.discovery as Record<string, string>).full_schema.includes('cli-schema'))
    assert.equal((runbook.discovery as Record<string, string>).bootstrap, 'elastic quickstart --json')
  })

  it('covers the whole flow in order', () => {
    assert.deepEqual(steps.map((s) => s.id), ['auth', 'provision', 'verify', 'value', 'handoff'])
  })

  it('documents auth key storage: separate-terminal vs env+inline-secrets', () => {
    const auth = steps.find((s) => s.id === 'auth')!
    const ask = String((auth as { ask_user?: string }).ask_user ?? '')
    assert.match(ask, /Pick ONE/)
    assert.match(ask, /Separate terminal/)
    assert.match(ask, /Paste in chat/)
    assert.match(ask, /--inline-secrets/)
    const cmds = auth.commands ?? []
    assert.ok(cmds.some((c) => c.includes('--cloud-api-key <key>') && !c.includes('$(env:')))
    assert.ok(cmds.some((c) =>
      c.includes("$(env:ELASTIC_CLOUD_API_KEY)") && c.includes('--inline-secrets'),
    ))
    assert.match(String((auth as { notes?: string }).notes ?? ''), /Never pass \$\(env:/)
  })

  it('documents the 403 entitlement branch and the console fallback', () => {
    const provision = steps.find((s) => s.id === 'provision')!
    const onFailure = provision.on_failure!
    const forbidden = onFailure['403 projects.create_project.forbidden']!
    assert.match(forbidden, /different key|API key/)
    assert.match(forbidden, /--optimized-for vector/)
    // The fallback cohort reaches the funnel via source; no branch tag is
    // product-specified for the Search fallback.
    assert.match(forbidden, /--metadata '\{"tags":\{"source":"quickstart"\}\}'/)
    assert.doesNotMatch(forbidden, /"branch"/)
    assert.match(onFailure.fallback_console!, /^https:\/\//)
  })

  it('publishes runnable commands, never frozen internal state', () => {
    for (const step of steps) {
      for (const cmd of step.commands ?? []) {
        assert.ok(cmd.startsWith('elastic '), `commands must be CLI invocations: ${cmd}`)
      }
    }
    const serialized = JSON.stringify(runbook)
    assert.doesNotMatch(serialized, /"run":|"kind":"command"/, 'internal tree nodes must not leak')
  })

  it('ships both demo query bodies for the value step', () => {
    const value = steps.find((s) => s.id === 'value')!
    const bodies = value.query_bodies!
    assert.ok('keyword_bm25' in bodies)
    assert.ok('semantic' in bodies)
    const create = (value.commands ?? []).find((c) => c.includes('es indices create'))!
    assert.match(create, /semantic_text/)
    assert.match(create, /--metadata|--mappings/)
  })

  it('requires the agent to present the search comparison before handoff', () => {
    const value = steps.find((s) => s.id === 'value') as Step & { ask_user?: string, notes?: string }
    assert.match(String(value.ask_user), /REQUIRED teaching beat|side-by-side|two-column/i)
    assert.match(String(value.ask_user), /acknowledge|confirm/i)
    assert.match(String(value.notes), /Skipping or summarizing/)
    const handoff = steps.find((s) => s.id === 'handoff') as Step & { ask_user?: string }
    assert.match(String(handoff.ask_user), /comparison was shown|acknowledged/i)
    assert.match(String(runbook.for_agents), /educational pace|show the user the important output/i)
  })

  it('serializes cleanly to JSON', () => {
    assert.equal(typeof JSON.stringify(runbook), 'string')
  })
})
