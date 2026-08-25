/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CLOUD_ENVS, resolveCloudEnv } from '../../src/quickstart/constants.ts'

describe('resolveCloudEnv', () => {
  it('defaults to prod when ELASTIC_ENV is unset or blank', () => {
    assert.equal(resolveCloudEnv({}).name, 'prod')
    assert.equal(resolveCloudEnv({ ELASTIC_ENV: '' }).name, 'prod')
    assert.equal(resolveCloudEnv({ ELASTIC_ENV: '   ' }).name, 'prod')
  })

  it('selects qa case-insensitively, ignoring whitespace', () => {
    assert.equal(resolveCloudEnv({ ELASTIC_ENV: 'qa' }).name, 'qa')
    assert.equal(resolveCloudEnv({ ELASTIC_ENV: ' QA ' }).name, 'qa')
    assert.equal(resolveCloudEnv({ ELASTIC_ENV: 'Prod' }).name, 'prod')
  })

  it('throws on unknown values rather than silently targeting prod', () => {
    assert.throws(() => resolveCloudEnv({ ELASTIC_ENV: 'staging' }), /staging/)
  })

  it('every environment carries a full, https-only URL set', () => {
    for (const env of Object.values(CLOUD_ENVS)) {
      for (const url of [env.apiUrl, env.signupUrl, env.apiKeysUrl, env.createProjectUrl, env.projectsUrl]) {
        assert.match(url, /^https:\/\//, `${env.name}: ${url}`)
      }
    }
  })

  it('qa points at the QA control plane and console', () => {
    const qa = CLOUD_ENVS.qa
    assert.equal(qa.apiUrl, 'https://public-api.qa.cld.elstc.co')
    assert.match(qa.apiKeysUrl, /^https:\/\/console\.qa\.cld\.elstc\.co\//)
  })
})
