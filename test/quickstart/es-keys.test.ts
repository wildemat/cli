/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  mintEsApiKey,
  mintEsApiKeyForApp,
  _testSetResolveAppMintAuth,
} from '../../src/quickstart/es-keys.ts'
import { fakeRunCli, ok, fail } from './helpers.ts'

afterEach(() => {
  _testSetResolveAppMintAuth(undefined)
})

describe('mintEsApiKey', () => {
  it('runs create-api-key against the context and returns the encoded key', async () => {
    const runCli = fakeRunCli([{ match: 'es security create-api-key', result: ok({ encoded: 'enc-123' }) }])
    const { result, encoded } = await mintEsApiKey(runCli, 'my-app', 'quickstart')
    assert.equal(result.ok, true)
    assert.equal(encoded, 'enc-123')
    assert.deepEqual(runCli.calls[0]!.argv, [
      'es', 'security', 'create-api-key',
      '--name', 'my-app',
      '--use-context', 'quickstart',
    ])
  })

  it('falls back to the api_key field when encoded is absent', async () => {
    const runCli = fakeRunCli([{ match: 'es security create-api-key', result: ok({ api_key: 'raw-key' }) }])
    assert.equal((await mintEsApiKey(runCli, 'a', 'ctx')).encoded, 'raw-key')
  })

  it('carries the failure and omits the key when minting fails or yields none', async () => {
    const failing = fakeRunCli([{ match: 'es security create-api-key', result: fail('forbidden', 'nope') }])
    const failed = await mintEsApiKey(failing, 'a', 'ctx')
    assert.equal(failed.result.ok, false)
    assert.equal('encoded' in failed, false)

    const noKey = fakeRunCli([{ match: 'es security create-api-key', result: ok({}) }])
    assert.equal('encoded' in await mintEsApiKey(noKey, 'a', 'ctx'), false)
  })
})

describe('mintEsApiKeyForApp', () => {
  it('mints with project basic auth against the ES URL (not a derived key)', async () => {
    _testSetResolveAppMintAuth(async () => ({
      mode: 'basic',
      url: 'https://es.example',
      username: 'admin',
      password: 'secret',
    }))
    const calls: Array<{ url: string, init: RequestInit }> = []
    const fetchFn: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} })
      return new Response(JSON.stringify({ encoded: 'basic-minted' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const runCli = fakeRunCli([])
    const out = await mintEsApiKeyForApp(runCli, fetchFn, 'elastic-bookshop', 'quickstart')
    assert.equal(out.encoded, 'basic-minted')
    assert.equal(out.reused, undefined)
    assert.equal(runCli.calls.length, 0)
    assert.equal(calls.length, 1)
    assert.match(calls[0]!.url, /\/_security\/api_key$/)
    assert.equal(calls[0]!.init.method, 'POST')
    assert.match(String(calls[0]!.init.headers && (calls[0]!.init.headers as Record<string, string>).Authorization), /^Basic /)
    assert.equal(calls[0]!.init.body, JSON.stringify({ name: 'elastic-bookshop' }))
  })

  it('falls back to subprocess mint when auth resolution says so', async () => {
    _testSetResolveAppMintAuth(async () => ({ mode: 'subprocess' }))
    const runCli = fakeRunCli([{ match: 'es security create-api-key', result: ok({ encoded: 'via-cli' }) }])
    const out = await mintEsApiKeyForApp(runCli, globalThis.fetch, 'app', 'ctx')
    assert.equal(out.encoded, 'via-cli')
    assert.equal(runCli.calls.length, 1)
  })

  it('reuses the context API key when no basic auth remains', async () => {
    _testSetResolveAppMintAuth(async () => ({ mode: 'reuse', encoded: 'context-key' }))
    const runCli = fakeRunCli([])
    const out = await mintEsApiKeyForApp(runCli, globalThis.fetch, 'app', 'ctx')
    assert.equal(out.encoded, 'context-key')
    assert.equal(out.reused, true)
    assert.equal(runCli.calls.length, 0)
  })

  it('surfaces ES errors from the basic-auth mint path', async () => {
    _testSetResolveAppMintAuth(async () => ({
      mode: 'basic',
      url: 'https://es.example',
      username: 'admin',
      password: 'secret',
    }))
    const fetchFn: typeof fetch = async () => new Response(
      JSON.stringify({ error: { reason: 'nope' } }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    )
    const out = await mintEsApiKeyForApp(fakeRunCli([]), fetchFn, 'app', 'ctx')
    assert.equal(out.result.ok, false)
    assert.equal(out.result.error?.status, 403)
    assert.match(out.result.error?.message ?? '', /nope/)
  })
})
