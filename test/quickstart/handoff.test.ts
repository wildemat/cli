/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, afterEach, before } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  KNOWN_AGENTS,
  whichBin,
  detectAgents,
  handoffPrompt,
  runHandoffNode,
  _testSetSpawn,
  _testSetOpenBrowser,
} from '../../src/quickstart/nodes/handoff.ts'
import type { QuickstartState } from '../../src/quickstart/types.ts'
import { fakeDeps, fakePrompter, fakeRunCli } from './helpers.ts'

const STATE: QuickstartState = {
  target: 'cloud-serverless',
  projectContextName: 'quickstart',
  indexName: 'books',
  endpoints: { elasticsearch: 'https://es.example', kibana: 'https://kb.example' },
  contextDocPath: '/tmp/elastic-quickstart-x/context.md',
}

let binDir: string

before(async () => {
  binDir = await mkdtemp(join(tmpdir(), 'qs-bins-'))
  for (const bin of ['claude', 'code']) {
    const p = join(binDir, bin)
    await writeFile(p, '#!/bin/sh\nexit 0\n', 'utf-8')
    await chmod(p, 0o755)
  }
})

afterEach(() => {
  _testSetSpawn(undefined)
  _testSetOpenBrowser(undefined)
})

describe('agent detection', () => {
  it('resolves binaries from PATH', () => {
    assert.ok(whichBin('claude', { env: { PATH: binDir } })!.endsWith('claude'))
    assert.equal(whichBin('claude', { env: { PATH: '/nonexistent-dir' } }), undefined)
    assert.equal(whichBin('claude', { env: {} }), undefined)
  })

  it('detects only installed agents, in menu order', () => {
    const agents = detectAgents({ env: { PATH: binDir } })
    assert.deepEqual(agents.map((a) => a.id), ['claude', 'code'])
    assert.ok(agents[0]!.binPath.endsWith('claude'))
  })

  it('covers the known-agent roster', () => {
    assert.deepEqual(
      KNOWN_AGENTS.map((a) => a.id),
      ['claude', 'codex', 'cursor-agent', 'gemini', 'cursor', 'code'],
    )
  })
})

describe('handoffPrompt', () => {
  it('uses the @file idiom with a short instruction', () => {
    assert.equal(
      handoffPrompt('/tmp/x/context.md'),
      "@/tmp/x/context.md let's continue building my search app",
    )
  })
})

describe('runHandoffNode', () => {
  function spawnRecorder (exitCode = 0) {
    const spawned: Array<{ cmd: string, args: string[], opts: Record<string, unknown> }> = []
    _testSetSpawn(((cmd: string, args: string[], opts: Record<string, unknown>) => {
      spawned.push({ cmd, args, opts })
      const child = new EventEmitter() as EventEmitter & { unref: () => void }
      child.unref = () => {}
      queueMicrotask(() => child.emit('close', exitCode))
      return child
    }) as unknown as Parameters<typeof _testSetSpawn>[0])
    return spawned
  }

  it('offers detected agents plus Kibana plus done, together', async () => {
    const prompter = fakePrompter({ selects: ['done'] })
    await runHandoffNode(fakeDeps(prompter, fakeRunCli([]), { env: { PATH: binDir } }), STATE)
    const selectLine = prompter.log.find((l) => l.startsWith('select:'))!
    assert.match(selectLine, /agent:claude/)
    assert.match(selectLine, /agent:code/)
    assert.match(selectLine, /kibana/)
    assert.match(selectLine, /done/)
    // The context doc path and next commands are always printed first.
    assert.ok(prompter.log.some((l) => l.includes(STATE.contextDocPath!)))
    assert.ok(prompter.log.some((l) => l.includes('elastic status --use-context quickstart')))
  })

  it('spawns a terminal agent with the @file prompt as one argument', async () => {
    const spawned = spawnRecorder(0)
    const prompter = fakePrompter({ selects: ['agent:claude'] })
    const outcome = await runHandoffNode(fakeDeps(prompter, fakeRunCli([]), { env: { PATH: binDir } }), STATE)
    assert.equal(outcome.choice, 'claude')
    assert.equal(spawned.length, 1)
    assert.deepEqual(spawned[0]!.args, [handoffPrompt(STATE.contextDocPath!)])
    assert.equal(spawned[0]!.opts.shell, false)
    assert.equal(spawned[0]!.opts.stdio, 'inherit')
  })

  it('opens the workspace and prints the prompt for IDE-only targets', async () => {
    const spawned = spawnRecorder(0)
    const prompter = fakePrompter({ selects: ['agent:code'] })
    const outcome = await runHandoffNode(fakeDeps(prompter, fakeRunCli([]), { env: { PATH: binDir } }), STATE)
    assert.equal(outcome.choice, 'code')
    assert.deepEqual(spawned[0]!.args, ['.'])
    assert.ok(prompter.log.some((l) => l.includes("let's continue building my search app")))
  })

  it('opens Kibana via the saved endpoint', async () => {
    const opened: string[] = []
    _testSetOpenBrowser((url) => { opened.push(url); return true })
    const prompter = fakePrompter({ selects: ['kibana'] })
    const outcome = await runHandoffNode(fakeDeps(prompter, fakeRunCli([]), { env: { PATH: binDir } }), STATE)
    assert.equal(outcome.choice, 'kibana')
    assert.deepEqual(opened, ['https://kb.example'])
  })

  it('prints the paste-this instruction when no agent is installed', async () => {
    const prompter = fakePrompter({ selects: ['done'] })
    await runHandoffNode(fakeDeps(prompter, fakeRunCli([]), { env: { PATH: '/nonexistent' } }), STATE)
    assert.ok(prompter.log.some((l) => l.includes('No coding agent found')))
  })
})
