/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { runVerifyNode } from '../../src/quickstart/nodes/verify.ts'
import { QuickstartHalt } from '../../src/quickstart/types.ts'
import { fakeDeps, fakePrompter, fakeRunCli, ok } from './helpers.ts'

const ALL_OK = {
  context: 'quickstart',
  services: {
    elasticsearch: { ok: true, url: 'https://es', status: 'green' },
    kibana: { ok: true, url: 'https://kb', status: 'available' },
  },
}

describe('runVerifyNode', () => {
  it('passes when every service answers', async () => {
    const runCli = fakeRunCli([{ match: 'status', result: ok(ALL_OK) }])
    const prompter = fakePrompter()
    const result = await runVerifyNode(fakeDeps(prompter, runCli), 'quickstart')
    assert.equal(result.services.elasticsearch!.ok, true)
    assert.ok(prompter.log.some((l) => l.startsWith('success:elasticsearch: ok')))
    assert.ok(prompter.log.some((l) => l.startsWith('success:kibana: ok')))
  })

  it('retries transient failures before succeeding', async () => {
    let calls = 0
    const runCli = fakeRunCli([{
      match: 'status',
      result: () => {
        calls++
        if (calls < 3) {
          return { ok: false, exitCode: 1, stderr: '', data: { services: { elasticsearch: { ok: false, error: 'network error: fetch failed' } } } }
        }
        return ok(ALL_OK)
      },
    }])
    const result = await runVerifyNode(fakeDeps(fakePrompter(), runCli), 'quickstart')
    assert.equal(calls, 3)
    assert.equal(result.services.kibana!.ok, true)
  })

  it('halts with the failing service and a next action after retries', async () => {
    const runCli = fakeRunCli([{
      match: 'status',
      result: {
        ok: false,
        exitCode: 1,
        stderr: '',
        data: {
          services: {
            elasticsearch: { ok: true, url: 'https://es', status: 'green' },
            kibana: { ok: false, url: 'https://kb', error: 'auth failed (401)' },
          },
        },
      },
    }])
    await assert.rejects(
      runVerifyNode(fakeDeps(fakePrompter(), runCli), 'quickstart'),
      (err: unknown) => err instanceof QuickstartHalt &&
        err.code === 'verify_failed' &&
        err.message.includes('kibana') &&
        err.nextSteps.some((s) => s.includes('elastic status --use-context quickstart')),
    )
  })

  it('halts when status reports no services at all', async () => {
    const runCli = fakeRunCli([{ match: 'status', result: { ok: false, exitCode: 1, stderr: '', error: { code: 'config_error', message: 'no context' } } }])
    await assert.rejects(
      runVerifyNode(fakeDeps(fakePrompter(), runCli), 'quickstart'),
      (err: unknown) => err instanceof QuickstartHalt && err.code === 'verify_failed',
    )
  })
})
