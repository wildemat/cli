/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildInstallPayload } from '../../../src/quickstart/appinstall/contract.ts'
import type { QuickstartState } from '../../../src/quickstart/types.ts'
import { fakeDeps, fakePrompter, fakeRunCli, ok, fail } from '../helpers.ts'

const STATE: QuickstartState = {
  target: 'cloud-serverless',
  projectContextName: 'quickstart',
  projectType: 'elasticsearch',
  endpoints: { elasticsearch: 'https://es.example', kibana: 'https://kb.example' },
  indexName: 'books',
  demoQuery: 'a story about growing up',
}

describe('buildInstallPayload', () => {
  it('projects the run state into neutral facts', () => {
    const payload = buildInstallPayload(STATE, fakeDeps(fakePrompter(), fakeRunCli([])))
    assert.equal(payload.contextName, 'quickstart')
    assert.deepEqual(payload.endpoints, { elasticsearch: 'https://es.example', kibana: 'https://kb.example' })
    assert.equal(payload.indexName, 'books')
    assert.equal(payload.demoQuery, 'a story about growing up')
    assert.equal(payload.projectType, 'elasticsearch')
  })

  it('omits optional facts the run never produced', () => {
    const payload = buildInstallPayload({ target: 'cloud-serverless' }, fakeDeps(fakePrompter(), fakeRunCli([])))
    assert.equal('indexName' in payload, false)
    assert.equal('demoQuery' in payload, false)
    assert.deepEqual(payload.endpoints, {})
    assert.equal(payload.projectType, 'vectordb')
  })

  it('mints a dedicated key via the CLI, never exposing context credentials', async () => {
    const runCli = fakeRunCli([{ match: 'es security create-api-key', result: ok({ encoded: 'enc-123' }) }])
    const payload = buildInstallPayload(STATE, fakeDeps(fakePrompter(), runCli))
    assert.equal(await payload.mintDedicatedKey('my-app'), 'enc-123')
    assert.deepEqual(runCli.calls[0]!.argv, [
      'es', 'security', 'create-api-key',
      '--name', 'my-app',
      '--use-context', 'quickstart',
    ])
  })

  it('falls back to the api_key field when encoded is absent', async () => {
    const runCli = fakeRunCli([{ match: 'es security create-api-key', result: ok({ api_key: 'raw-key' }) }])
    const payload = buildInstallPayload(STATE, fakeDeps(fakePrompter(), runCli))
    assert.equal(await payload.mintDedicatedKey('my-app'), 'raw-key')
  })

  it('returns undefined when minting fails or yields no key', async () => {
    const failing = fakeRunCli([{ match: 'es security create-api-key', result: fail('forbidden', 'nope') }])
    const noKey = fakeRunCli([{ match: 'es security create-api-key', result: ok({}) }])
    const deps = fakeDeps(fakePrompter(), failing)
    assert.equal(await buildInstallPayload(STATE, deps).mintDedicatedKey('a'), undefined)
    const deps2 = fakeDeps(fakePrompter(), noKey)
    assert.equal(await buildInstallPayload(STATE, deps2).mintDedicatedKey('a'), undefined)
  })
})
