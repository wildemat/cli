/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { loadSampleDataset, toNdjson } from '../../src/quickstart/data/dataset.ts'
import { DEMO_QUERY } from '../../src/quickstart/constants.ts'

describe('sample dataset', () => {
  it('loads a non-trivial books dataset with the docs-quickstart fields', async () => {
    const docs = await loadSampleDataset()
    assert.ok(docs.length >= 50, `expected a substantial dataset, got ${docs.length}`)
    for (const doc of docs) {
      assert.equal(typeof doc.title, 'string')
      assert.equal(typeof doc.author, 'string')
      assert.equal(typeof doc.description, 'string')
      assert.ok(Number.isInteger(doc.release_year))
      assert.ok(doc.description.length > 40, `description too thin for semantic demo: ${doc.title}`)
    }
  })

  it('has no duplicate titles', async () => {
    const docs = await loadSampleDataset()
    const titles = new Set(docs.map((d) => d.title))
    assert.equal(titles.size, docs.length)
  })

  it('guarantees the demo query whiffs lexically but has semantic targets', async () => {
    const docs = await loadSampleDataset()
    // No description may contain the demo phrase verbatim — otherwise BM25
    // would win and the comparison loses its point.
    for (const doc of docs) {
      assert.ok(
        !doc.description.toLowerCase().includes(DEMO_QUERY.toLowerCase()),
        `"${doc.title}" contains the demo query verbatim`,
      )
    }
    // But BM25 must have keyword bait ("story"/"growing"/"girl" in unrelated books)…
    assert.ok(docs.some((d) => `${d.title} ${d.description}`.toLowerCase().includes('story')))
    assert.ok(docs.some((d) => d.description.toLowerCase().includes('growing')))
    assert.ok(docs.some((d) => d.title.toLowerCase().includes('girl')))
    // …and the semantic side has real coming-of-age material.
    assert.ok(docs.some((d) => d.description.toLowerCase().includes('coming of age') ||
      d.description.toLowerCase().includes('comes of age') ||
      d.description.toLowerCase().includes('childhood')))
  })

  it('serializes to one JSON object per NDJSON line', async () => {
    const docs = await loadSampleDataset()
    const ndjson = toNdjson(docs)
    assert.ok(ndjson.endsWith('\n'))
    const lines = ndjson.trim().split('\n')
    assert.equal(lines.length, docs.length)
    assert.deepEqual(JSON.parse(lines[lines.length - 1]!), docs[docs.length - 1])
  })
})
