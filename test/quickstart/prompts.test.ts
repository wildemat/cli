/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  createPrompter,
  pauseAfterStep,
  PromptCancelled,
  _testSetClack,
} from '../../src/quickstart/prompts.ts'

const CANCEL = Symbol('cancel')

interface FakeClackCall { fn: string, args: unknown[] }

function fakeClack (script: { select?: unknown[], confirm?: unknown[], password?: unknown[], text?: unknown[] }) {
  const calls: FakeClackCall[] = []
  const selects = [...(script.select ?? [])]
  const confirms = [...(script.confirm ?? [])]
  const passwords = [...(script.password ?? [])]
  const texts = [...(script.text ?? [])]

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
    select: async (opts: unknown) => { calls.push({ fn: 'select', args: [opts] }); return selects.shift() },
    confirm: async (opts: unknown) => { calls.push({ fn: 'confirm', args: [opts] }); return confirms.shift() },
    password: async (opts: unknown) => { calls.push({ fn: 'password', args: [opts] }); return passwords.shift() },
    text: async (opts: unknown) => { calls.push({ fn: 'text', args: [opts] }); return texts.shift() },
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

  /** Production pause would stall the suite; tests opt out. */
  const prompt = (): ReturnType<typeof createPrompter> => createPrompter({ stepPauseMs: 0 })

  it('returns scripted values and draws on stderr', async () => {
    const { impl, calls } = fakeClack({ select: ['a'], confirm: [true], password: ['key'], text: ['./dir'] })
    _testSetClack(impl)
    const p = prompt()
    assert.equal(await p.select('q', [{ value: 'a', label: 'A' }]), 'a')
    assert.equal(await p.confirm('sure?'), true)
    assert.equal(await p.password('paste'), 'key')
    assert.equal(await p.text('where?', './default'), './dir')
    const selectCall = calls.find((c) => c.fn === 'select')!
    assert.equal((selectCall.args[0] as { output: unknown }).output, process.stderr)
    const textCall = calls.find((c) => c.fn === 'text')!
    assert.equal((textCall.args[0] as { initialValue?: string }).initialValue, './default')
  })

  it('text tolerates a missing initial value and an empty submission', async () => {
    const { impl, calls } = fakeClack({ text: [undefined] })
    _testSetClack(impl)
    const p = prompt()
    assert.equal(await p.text('where?'), '')
    assert.equal('initialValue' in (calls[0]!.args[0] as object), false)
  })

  it('throws PromptCancelled on Ctrl-C', async () => {
    const { impl } = fakeClack({ select: [CANCEL] })
    _testSetClack(impl)
    const p = prompt()
    await assert.rejects(p.select('q', []), PromptCancelled)
  })

  it('never arms a timeout — prompts wait indefinitely for a human', async () => {
    const { impl, calls } = fakeClack({ select: ['a'], confirm: [true] })
    _testSetClack(impl)
    const p = prompt()
    await p.select('first', [])
    await p.confirm('second')
    for (const call of calls.filter((c) => c.fn === 'select' || c.fn === 'confirm')) {
      assert.equal((call.args[0] as { signal?: unknown }).signal, undefined)
    }
  })

  it('maps spinner events', async () => {
    const { impl, calls } = fakeClack({})
    _testSetClack(impl)
    const p = prompt()
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
    const p = prompt()
    p.intro('t'); p.outro('o'); p.note('n', 'title'); p.info('i'); p.success('s'); p.warn('w')
    assert.deepEqual(calls.map((c) => c.fn), ['intro', 'outro', 'note', 'log.info', 'log.success', 'log.warn'])
  })

  it('pauseAfterStep(0) is a no-op; printed steps pause, inputs do not', async () => {
    const { impl } = fakeClack({ select: ['a'] })
    _testSetClack(impl)

    const tNoop = Date.now()
    pauseAfterStep(0)
    assert.ok(Date.now() - tNoop < 50)

    const p = createPrompter({ stepPauseMs: 40 })
    const tInfo = Date.now()
    p.info('digest me')
    assert.ok(Date.now() - tInfo >= 30, 'printed steps should pause')

    const tSelect = Date.now()
    await p.select('pick', [{ value: 'a', label: 'A' }])
    assert.ok(Date.now() - tSelect < 30, 'inputs should not add a digest pause')

    const spin = p.spinner('work')
    const tMsg = Date.now()
    spin.message('tick')
    assert.ok(Date.now() - tMsg < 30, 'spinner updates should not pause')
    const tStop = Date.now()
    spin.stop('done')
    assert.ok(Date.now() - tStop >= 30, 'spinner stop should pause')
  })
})
