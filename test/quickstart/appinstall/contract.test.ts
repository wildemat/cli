/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildInstallPayload } from '../../../src/quickstart/appinstall/contract.ts'
import type { QuickstartState } from '../../../src/quickstart/types.ts'

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
    const payload = buildInstallPayload(STATE, 'enc-123')
    assert.equal(payload.contextName, 'quickstart')
    assert.deepEqual(payload.endpoints, { elasticsearch: 'https://es.example', kibana: 'https://kb.example' })
    assert.equal(payload.indexName, 'books')
    assert.equal(payload.demoQuery, 'a story about growing up')
    assert.equal(payload.projectType, 'elasticsearch')
    assert.equal(payload.dedicatedApiKey, 'enc-123')
  })

  it('omits optional facts the run never produced, including a failed key', () => {
    const payload = buildInstallPayload({ target: 'cloud-serverless' })
    assert.equal('indexName' in payload, false)
    assert.equal('demoQuery' in payload, false)
    assert.equal('dedicatedApiKey' in payload, false)
    assert.deepEqual(payload.endpoints, {})
    assert.equal(payload.projectType, 'vectordb')
  })
})
