/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { detectMode, processStreamInfo } from '../../src/quickstart/mode.ts'

describe('detectMode', () => {
  it('is interactive only when stdin AND stderr are TTYs', () => {
    assert.equal(detectMode(false, { stdinIsTTY: true, stderrIsTTY: true }), 'interactive')
    assert.equal(detectMode(false, { stdinIsTTY: false, stderrIsTTY: true }), 'agent')
    assert.equal(detectMode(false, { stdinIsTTY: true, stderrIsTTY: false }), 'agent')
    assert.equal(detectMode(false, { stdinIsTTY: false, stderrIsTTY: false }), 'agent')
  })

  it('--json forces agent mode even at a TTY', () => {
    assert.equal(detectMode(true, { stdinIsTTY: true, stderrIsTTY: true }), 'agent')
  })

  it('defaults to the real process streams', () => {
    const info = processStreamInfo()
    assert.equal(typeof info.stdinIsTTY, 'boolean')
    assert.equal(typeof info.stderrIsTTY, 'boolean')
    // In the test runner neither stream is a TTY-with-json combination we control,
    // but the default-parameter path must agree with the explicit one.
    assert.equal(detectMode(false), detectMode(false, info))
  })
})
