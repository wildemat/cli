/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, afterEach, before } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdirSync } from 'node:fs'
import { mkdtemp, readFile, writeFile, chmod } from 'node:fs/promises'
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
import { _testSetSpawn as _testSetBookshopSpawn } from '../../src/quickstart/appinstall/bookshop.ts'
import type { QuickstartState } from '../../src/quickstart/types.ts'
import { fakeDeps, fakePrompter, fakeRunCli, ok } from './helpers.ts'

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
  _testSetBookshopSpawn(undefined)
  _testSetOpenBrowser(undefined)
})

describe('agent detection', () => {
  it('resolves binaries from PATH', () => {
    assert.ok(whichBin('claude', { env: { PATH: binDir } })!.endsWith('claude'))
    assert.equal(whichBin('claude', { env: { PATH: '/nonexistent-dir' } }), undefined)
    assert.equal(whichBin('claude', { env: {} }), undefined)
  })

  it('resolves Windows binaries via Path and default PATHEXT suffixes', async () => {
    await writeFile(join(binDir, 'claude.cmd'), 'exit 0', 'utf-8')
    const hit = whichBin('claude', { env: { Path: binDir }, platform: 'win32' })
    assert.ok(hit != null && hit.toLowerCase().endsWith('claude.cmd'))
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

  it('offers detected agents plus the sample app plus Kibana plus done, together', async () => {
    const prompter = fakePrompter({ selects: ['done'] })
    await runHandoffNode(fakeDeps(prompter, fakeRunCli([]), { env: { PATH: binDir } }), STATE)
    const selectLine = prompter.log.find((l) => l.startsWith('select:'))!
    assert.match(selectLine, /agent:claude/)
    assert.match(selectLine, /agent:code/)
    assert.match(selectLine, /install:bookshop/)
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

  it('reports exit 1 when a terminal agent cannot be spawned', async () => {
    _testSetSpawn((() => { throw new Error('spawn EACCES') }) as unknown as Parameters<typeof _testSetSpawn>[0])
    const prompter = fakePrompter({ selects: ['agent:claude'] })
    const outcome = await runHandoffNode(fakeDeps(prompter, fakeRunCli([]), { env: { PATH: binDir } }), STATE)
    assert.deepEqual(outcome, { choice: 'claude', detail: 'exit 1' })
  })

  it('survives an async IDE spawn failure and prints manual instructions', async () => {
    _testSetSpawn((() => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void }
      child.unref = () => {}
      queueMicrotask(() => child.emit('error', new Error('EACCES')))
      return child
    }) as unknown as Parameters<typeof _testSetSpawn>[0])
    const prompter = fakePrompter({ selects: ['agent:code'] })
    const outcome = await runHandoffNode(fakeDeps(prompter, fakeRunCli([]), { env: { PATH: binDir } }), STATE)
    assert.equal(outcome.choice, 'code')
    // The 'error' event fires after the node returns; it must not crash and
    // must leave the user a way to hand off manually.
    await new Promise((resolve) => setImmediate(resolve))
    assert.ok(prompter.log.some((l) => l.startsWith('warn:Could not open VS Code: EACCES')))
    assert.ok(prompter.log.some((l) => l.startsWith('info:') && l.includes(STATE.contextDocPath!)))
  })

  it('survives a synchronous IDE spawn throw', async () => {
    _testSetSpawn((() => { throw new Error('spawn EACCES') }) as unknown as Parameters<typeof _testSetSpawn>[0])
    const prompter = fakePrompter({ selects: ['agent:code'] })
    const outcome = await runHandoffNode(fakeDeps(prompter, fakeRunCli([]), { env: { PATH: binDir } }), STATE)
    assert.equal(outcome.detail, 'open failed')
    assert.ok(prompter.log.some((l) => l.startsWith('warn:Could not open VS Code: spawn EACCES')))
    assert.ok(prompter.log.some((l) => l.includes(STATE.contextDocPath!)))
  })

  it('runs the sample-app installer end to end with a neutral payload', async () => {
    const target = join(binDir, 'bookshop-target')
    _testSetBookshopSpawn(((cmd: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter }
      child.stderr = new EventEmitter()
      queueMicrotask(() => {
        mkdirSync(args[args.length - 1]!, { recursive: true })
        child.emit('close', 0)
      })
      return child
    }) as unknown as Parameters<typeof _testSetBookshopSpawn>[0])
    const runCli = fakeRunCli([{ match: 'es security create-api-key', result: ok({ encoded: 'handoff-key' }) }])
    const prompter = fakePrompter({ selects: ['install:bookshop'], texts: [target] })
    const outcome = await runHandoffNode(fakeDeps(prompter, runCli, { env: { PATH: binDir } }), STATE)
    assert.deepEqual(outcome, { choice: 'install:bookshop', detail: 'installed' })
    // The minted key was requested against the project context, then seeded.
    assert.match(runCli.calls[0]!.argv.join(' '), /--use-context quickstart/)
    const env = await readFile(join(target, '.env'), 'utf-8')
    assert.match(env, /ELASTICSEARCH_URL=https:\/\/es\.example/)
    assert.match(env, /ELASTIC_API_KEY=handoff-key/)
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
