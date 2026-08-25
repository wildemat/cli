/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mintEsApiKey } from '../../src/quickstart/es-keys.ts'
import { fakeRunCli, ok, fail } from './helpers.ts'

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
