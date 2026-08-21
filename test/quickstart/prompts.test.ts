/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  createPrompter,
  PromptCancelled,
  FirstPromptTimeout,
  _testSetClack,
} from '../../src/quickstart/prompts.ts'

const CANCEL = Symbol('cancel')

interface FakeClackCall { fn: string, args: unknown[] }

function fakeClack (script: { select?: unknown[], confirm?: unknown[], password?: unknown[], honourSignal?: boolean }) {
  const calls: FakeClackCall[] = []
  const selects = [...(script.select ?? [])]
  const confirms = [...(script.confirm ?? [])]
  const passwords = [...(script.password ?? [])]

  async function answer (queue: unknown[], opts: { signal?: AbortSignal }): Promise<unknown> {
    if (script.honourSignal === true && opts.signal != null) {
      // Simulate a prompt that renders and waits: resolve to cancel on abort.
      return new Promise((resolve) => {
        opts.signal!.addEventListener('abort', () => resolve(CANCEL))
      })
    }
    return queue.shift()
  }

  const impl = {
    intro: (...args: unknown[]) => { calls.push({ fn: 'intro', args }) },
    outro: (...args: unknown[]) => { calls.push({ fn: 'outro', args }) },
    note: (...args: unknown[]) => { calls.push({ fn: 'note', args }) },
    log: {
      info: (...args: unknown[]) => { calls.push({ fn: 'log.info', args }) },
      success: (...args: unknown[]) => { calls.push({ fn: 'log.success', args }) },
      warn: (...args: unknown[]) => { calls.push({ fn: 'log.warn', args }) },
      error: (...args: unknown[]) => { calls.push({ fn: 'log.error', args }) },
      message: (...args: unknown[]) => { calls.push({ fn: 'log.message', args }) },
    },
    select: (opts: { signal?: AbortSignal }) => { calls.push({ fn: 'select', args: [opts] }); return answer(selects, opts) },
    confirm: (opts: { signal?: AbortSignal }) => { calls.push({ fn: 'confirm', args: [opts] }); return answer(confirms, opts) },
    password: (opts: { signal?: AbortSignal }) => { calls.push({ fn: 'password', args: [opts] }); return answer(passwords, opts) },
    spinner: () => {
      const events: string[] = []
      calls.push({ fn: 'spinner', args: [events] })
      return {
        start: (m?: string) => events.push(`start:${m}`),
        stop: (m?: string) => events.push(`stop:${m}`),
        cancel: (m?: string) => events.push(`cancel:${m}`),
        error: (m?: string) => events.push(`error:${m}`),
        message: (m?: string) => events.push(`message:${m}`),
        clear: () => events.push('clear'),
        isCancelled: false,
      }
    },
    isCancel: (v: unknown) => v === CANCEL,
  }
  return { impl: impl as unknown as Parameters<typeof _testSetClack>[0], calls }
}

describe('quickstart prompter', () => {
  afterEach(() => { _testSetClack(undefined) })

  it('returns scripted values and draws on stderr', async () => {
    const { impl, calls } = fakeClack({ select: ['a'], confirm: [true], password: ['key'] })
    _testSetClack(impl)
    const p = createPrompter(0)
    assert.equal(await p.select('q', [{ value: 'a', label: 'A' }]), 'a')
    assert.equal(await p.confirm('sure?'), true)
    assert.equal(await p.password('paste'), 'key')
    const selectCall = calls.find((c) => c.fn === 'select')!
    assert.equal((selectCall.args[0] as { output: unknown }).output, process.stderr)
  })

  it('throws PromptCancelled on Ctrl-C', async () => {
    const { impl } = fakeClack({ select: [CANCEL] })
    _testSetClack(impl)
    const p = createPrompter(0)
    await assert.rejects(p.select('q', []), PromptCancelled)
  })

  it('times out the FIRST prompt only, raising FirstPromptTimeout', async () => {
    const { impl } = fakeClack({ honourSignal: true })
    _testSetClack(impl)
    const p = createPrompter(25)
    await assert.rejects(p.confirm('first'), FirstPromptTimeout)
  })

  it('does not arm a timeout on subsequent prompts', async () => {
    const { impl, calls } = fakeClack({ select: ['a', 'b'] })
    _testSetClack(impl)
    const p = createPrompter(25)
    await p.select('first', [])
    await p.select('second', [])
    const [first, second] = calls.filter((c) => c.fn === 'select')
    assert.ok((first!.args[0] as { signal?: unknown }).signal != null, 'first prompt must carry a timeout signal')
    assert.equal((second!.args[0] as { signal?: unknown }).signal, undefined, 'later prompts must never time out')
  })

  it('maps spinner events', async () => {
    const { impl, calls } = fakeClack({})
    _testSetClack(impl)
    const p = createPrompter(0)
    const s = p.spinner('working')
    s.message('phase')
    s.stop('done')
    s.fail('bad')
    const events = calls.find((c) => c.fn === 'spinner')!.args[0] as string[]
    assert.deepEqual(events, ['start:working', 'message:phase', 'stop:done', 'error:bad'])
  })

  it('forwards intro/outro/note/log lines', async () => {
    const { impl, calls } = fakeClack({})
    _testSetClack(impl)
    const p = createPrompter(0)
    p.intro('t'); p.outro('o'); p.note('n', 'title'); p.info('i'); p.success('s'); p.warn('w')
    assert.deepEqual(calls.map((c) => c.fn), ['intro', 'outro', 'note', 'log.info', 'log.success', 'log.warn'])
  })
})
