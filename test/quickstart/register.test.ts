/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Command } from 'commander'
import {
  registerQuickstartCommand,
  quickstartHandler,
  buildSummary,
  formatSummaryText,
} from '../../src/quickstart/register.ts'
import type { JsonValue } from '../../src/factory.ts'
import type { QuickstartState } from '../../src/quickstart/types.ts'

describe('registerQuickstartCommand', () => {
  it('registers a zero-flag command (only --dry-run and --help)', () => {
    const cmd = registerQuickstartCommand() as Command
    assert.equal(cmd.name(), 'quickstart')
    const flags = cmd.options.map((o) => o.long)
    assert.deepEqual(flags, ['--dry-run'])
    assert.equal(cmd.registeredArguments.length, 0, 'no positional args allowed')
  })
})

describe('quickstartHandler in agent mode', () => {
  it('emits the runbook when --json is passed', async () => {
    const result = await quickstartHandler({ options: { json: true } }) as Record<string, JsonValue>
    assert.equal(result.kind, 'elastic-quickstart-runbook')
    assert.equal(result.schema_version, 1)
  })

  it('emits the runbook when no TTY is attached', async () => {
    // The test runner has no TTY on stdin/stderr, so agent mode applies.
    const result = await quickstartHandler({ options: {} }) as Record<string, JsonValue>
    assert.equal(result.kind, 'elastic-quickstart-runbook')
  })

  it('runbook URLs follow ELASTIC_ENV', async () => {
    process.env.ELASTIC_ENV = 'qa'
    try {
      const result = await quickstartHandler({ options: { json: true } })
      const serialized = JSON.stringify(result)
      assert.match(serialized, /public-api\.qa\.cld\.elstc\.co/)
      assert.match(serialized, /console\.qa\.cld\.elstc\.co/)
      assert.doesNotMatch(serialized, /api\.elastic-cloud\.com/)
    } finally {
      delete process.env.ELASTIC_ENV
    }
  })

  it('rejects an unknown ELASTIC_ENV instead of silently targeting prod', async () => {
    process.env.ELASTIC_ENV = 'staging'
    try {
      const result = await quickstartHandler({ options: { json: true } }) as Record<string, JsonValue>
      const error = result.error as Record<string, JsonValue>
      assert.equal(error.code, 'bad_env')
      assert.match(String(error.message), /staging/)
    } finally {
      delete process.env.ELASTIC_ENV
    }
  })
})

describe('summary projection', () => {
  const state: QuickstartState = {
    target: 'cloud-serverless',
    projectType: 'vectordb',
    projectId: 'p-1',
    projectName: 'quickstart',
    regionId: 'aws-eu-west-1',
    projectContextName: 'quickstart',
    endpoints: { elasticsearch: 'https://es.x', kibana: 'https://kb.x' },
    indexName: 'books',
    docsIndexed: 74,
    contextDocPath: '/tmp/ctx/context.md',
    handoff: { choice: 'kibana' },
  }

  it('buildSummary carries every fact the scrollback needs', () => {
    const summary = buildSummary(state) as Record<string, JsonValue>
    assert.equal(summary.kind, 'elastic-quickstart-summary')
    assert.equal(summary.context, 'quickstart')
    assert.equal(summary.index, 'books')
    assert.equal(summary.docs_indexed, 74)
    assert.equal(summary.context_doc, '/tmp/ctx/context.md')
    assert.equal(summary.handoff, 'kibana')
  })

  it('buildSummary tolerates missing state', () => {
    const summary = buildSummary({ target: 'cloud-serverless' }) as Record<string, JsonValue>
    assert.equal(summary.context, null)
    assert.equal((summary.project as Record<string, JsonValue>).id, null)
  })

  it('formatSummaryText renders the durable scrollback record', () => {
    const summary = buildSummary(state) as Record<string, JsonValue>
    const text = formatSummaryText(summary)
    assert.match(text, /quickstart \(vectordb, aws-eu-west-1\)/)
    assert.match(text, /https:\/\/kb\.x/)
    assert.match(text, /books \(74 docs\)/)
    assert.match(text, /--use-context quickstart/)
  })
})
