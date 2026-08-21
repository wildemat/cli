/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildFlow, walkFlow } from '../../src/quickstart/tree.ts'
import type { FlowNode } from '../../src/quickstart/tree.ts'
import { fakeDeps, fakePrompter, fakeRunCli } from './helpers.ts'

describe('buildFlow', () => {
  it('models the v1 flow in order with node kinds', () => {
    const flow = buildFlow()
    assert.deepEqual(
      flow.map((n) => [n.id, n.kind]),
      [
        ['auth', 'check'],
        ['provision', 'command'],
        ['verify', 'check'],
        ['value', 'command'],
        ['context-doc', 'command'],
        ['handoff', 'handoff'],
      ],
    )
  })
})

describe('walkFlow', () => {
  it('threads one mutable state through every node in order', async () => {
    const order: string[] = []
    const nodes: FlowNode[] = [
      {
        id: 'a',
        kind: 'check',
        title: 'A',
        run: async (state) => { order.push('a'); state.projectName = 'set-by-a' },
      },
      {
        id: 'b',
        kind: 'command',
        title: 'B',
        run: async (state) => { order.push('b'); state.indexName = `${state.projectName}-index` },
      },
    ]
    const state = await walkFlow(fakeDeps(fakePrompter(), fakeRunCli([])), nodes)
    assert.deepEqual(order, ['a', 'b'])
    assert.equal(state.target, 'cloud-serverless')
    assert.equal(state.indexName, 'set-by-a-index')
  })

  it('propagates node failures without running later nodes', async () => {
    const order: string[] = []
    const nodes: FlowNode[] = [
      { id: 'a', kind: 'check', title: 'A', run: async () => { order.push('a'); throw new Error('halt') } },
      { id: 'b', kind: 'command', title: 'B', run: async () => { order.push('b') } },
    ]
    await assert.rejects(walkFlow(fakeDeps(fakePrompter(), fakeRunCli([])), nodes), /halt/)
    assert.deepEqual(order, ['a'])
  })
})
