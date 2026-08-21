/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { runCli, selfExecArgv, _testSetSpawn } from '../../src/quickstart/executor.ts'

interface FakeChildScript {
  stdout?: string
  stderr?: string | string[]
  exitCode?: number
  emitError?: string
  neverExit?: boolean
}

function fakeChild (script: FakeChildScript) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    kill: (sig?: string) => void
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = () => { /* recorded via neverExit */ }
  queueMicrotask(() => {
    if (script.emitError != null) {
      child.emit('error', new Error(script.emitError))
      return
    }
    if (script.stdout != null) child.stdout.emit('data', Buffer.from(script.stdout))
    const stderrChunks = Array.isArray(script.stderr) ? script.stderr : script.stderr != null ? [script.stderr] : []
    for (const chunk of stderrChunks) child.stderr.emit('data', Buffer.from(chunk))
    if (script.neverExit !== true) child.emit('close', script.exitCode ?? 0)
  })
  return child
}

describe('quickstart executor', () => {
  afterEach(() => { _testSetSpawn(undefined) })

  it('selfExecArgv re-execs the current entry with the current node binary', () => {
    const { command, prefix } = selfExecArgv()
    assert.equal(command, process.execPath)
    assert.equal(prefix[prefix.length - 1], process.argv[1])
  })

  it('appends --json, disables shell, and parses stdout JSON on success', async () => {
    let captured: { cmd: string, args: string[], opts: Record<string, unknown> } | undefined
    _testSetSpawn(((cmd: string, args: string[], opts: Record<string, unknown>) => {
      captured = { cmd, args, opts }
      return fakeChild({ stdout: '{"hello":"world"}\n' })
    }) as unknown as Parameters<typeof _testSetSpawn>[0])

    const result = await runCli(['status', '--use-context', 'x'])
    assert.equal(result.ok, true)
    assert.deepEqual(result.data, { hello: 'world' })
    assert.equal(captured!.cmd, process.execPath)
    assert.deepEqual(captured!.args.slice(-4), ['status', '--use-context', 'x', '--json'])
    assert.equal(captured!.opts.shell, false)
  })

  it('extracts the error envelope from stderr on failure', async () => {
    _testSetSpawn((() => fakeChild({
      stderr: 'Warning: something\n{"error":{"code":"cloud_api_error","message":"boom"}}\n',
      exitCode: 1,
    })) as unknown as Parameters<typeof _testSetSpawn>[0])

    const result = await runCli(['cloud', 'x'])
    assert.equal(result.ok, false)
    assert.equal(result.exitCode, 1)
    assert.deepEqual(result.error, { code: 'cloud_api_error', message: 'boom' })
    assert.match(result.stderr, /Warning/)
  })

  it('tolerates non-JSON stdout and missing envelope', async () => {
    _testSetSpawn((() => fakeChild({ stdout: 'not json', stderr: 'plain failure\n', exitCode: 2 })) as unknown as Parameters<typeof _testSetSpawn>[0])
    const result = await runCli(['x'])
    assert.equal(result.ok, false)
    assert.equal(result.data, undefined)
    assert.equal(result.error, undefined)
    assert.match(result.stderr, /plain failure/)
  })

  it('streams stderr lines to onStderrLine', async () => {
    _testSetSpawn((() => fakeChild({
      stderr: ['Waiting for project... phase: initializing\nWaiting for', ' project... phase: ready\n'],
      exitCode: 0,
      stdout: '{}',
    })) as unknown as Parameters<typeof _testSetSpawn>[0])
    const lines: string[] = []
    await runCli(['x'], { onStderrLine: (l) => lines.push(l) })
    assert.deepEqual(lines, [
      'Waiting for project... phase: initializing',
      'Waiting for project... phase: ready',
    ])
  })

  it('rejects when the child cannot be spawned', async () => {
    _testSetSpawn((() => fakeChild({ emitError: 'ENOENT' })) as unknown as Parameters<typeof _testSetSpawn>[0])
    await assert.rejects(runCli(['x']), /failed to spawn/)
  })

  it('kills and rejects on timeout', async () => {
    _testSetSpawn((() => fakeChild({ neverExit: true })) as unknown as Parameters<typeof _testSetSpawn>[0])
    await assert.rejects(runCli(['x'], { timeoutMs: 20 }), /timed out/)
  })
})
