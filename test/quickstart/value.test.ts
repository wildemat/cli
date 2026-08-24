/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  sampleIndexMappings,
  bm25QueryBody,
  semanticQueryBody,
  renderComparison,
  runValueNode,
} from '../../src/quickstart/nodes/value.ts'
import { QuickstartHalt } from '../../src/quickstart/types.ts'
import { BOOKS } from '../../src/quickstart/data/books.ts'
import { fakeDeps, fakePrompter, fakeRunCli, ok, fail } from './helpers.ts'

function hits (titles: string[]): unknown {
  return {
    took: 7,
    hits: { hits: titles.map((t, i) => ({ _score: 3 - i * 0.5, _source: { title: t } })) },
  }
}

describe('value moment builders', () => {
  it('declares the lexical field copied into semantic_text; rest dynamic', () => {
    const mappings = sampleIndexMappings() as { properties: Record<string, Record<string, unknown>> }
    assert.equal(mappings.properties.description!.type, 'text')
    assert.deepEqual(mappings.properties.description!.copy_to, ['description_semantic'])
    assert.equal(mappings.properties.description_semantic!.type, 'semantic_text')
    // Deliberately NOT hand-tuning vectors: no index-level HNSW/quantization settings.
    assert.equal(Object.keys(mappings).length, 1)
  })

  it('builds a match query for BM25 and a semantic query for meaning', () => {
    const bm25 = bm25QueryBody('growing up', 5) as { query: { match: Record<string, unknown> } }
    assert.deepEqual(bm25.query.match.description, { query: 'growing up' })
    const semantic = semanticQueryBody('growing up', 5) as { query: { semantic: Record<string, unknown> } }
    assert.deepEqual(semantic.query.semantic, { field: 'description_semantic', query: 'growing up' })
  })
})

describe('renderComparison', () => {
  it('renders both columns with scores and timing', () => {
    const out = renderComparison({
      query: 'q',
      bm25: { tookMs: 12, hits: [{ title: 'The Story of Art', score: 2.1 }] },
      semantic: { tookMs: 34, hits: [{ title: 'To Kill a Mockingbird', score: 0.9 }, { title: 'Little Women', score: 0.8 }] },
    })
    assert.match(out, /Keyword \(BM25\) — 12ms/)
    assert.match(out, /Semantic — 34ms/)
    assert.match(out, /1\. The Story of Art \(2\.10\)/)
    assert.match(out, /2\. Little Women \(0\.80\)/)
  })

  it('says so when keyword search finds nothing', () => {
    const out = renderComparison({
      query: 'q',
      bm25: { tookMs: 1, hits: [] },
      semantic: { tookMs: 2, hits: [{ title: 'X', score: 1 }] },
    })
    assert.match(out, /keyword search found nothing/)
  })
})

describe('runValueNode', () => {
  it('creates the index, ingests the dataset, and runs both searches', async () => {
    let dataFilePath = ''
    const runCli = fakeRunCli([
      { match: 'es indices create', result: ok({ acknowledged: true }) },
      {
        match: 'es helpers bulk-ingest',
        result: (argv) => {
          dataFilePath = argv[argv.indexOf('--data-file') + 1]!
          return ok({ indexed: BOOKS.length })
        },
      },
      { match: 'es indices refresh', result: ok({}) },
      {
        match: 'es search',
        result: (argv) => {
          const file = argv[argv.indexOf('--input-file') + 1]!
          return file.includes('bm25')
            ? ok(hits(['The Story of Art']))
            : ok(hits(['To Kill a Mockingbird', 'The Catcher in the Rye']))
        },
      },
    ])
    const prompter = fakePrompter()
    const result = await runValueNode(fakeDeps(prompter, runCli), 'quickstart')

    assert.equal(result.indexName, 'books')
    assert.equal(result.docsIndexed, BOOKS.length)
    assert.equal(result.comparison.bm25.hits[0]!.title, 'The Story of Art')
    assert.equal(result.comparison.semantic.hits[0]!.title, 'To Kill a Mockingbird')

    // The ingest file must be real NDJSON of the bundled dataset.
    const ndjson = await readFile(dataFilePath, 'utf-8')
    const lines = ndjson.trim().split('\n')
    assert.equal(lines.length, BOOKS.length)
    assert.equal((JSON.parse(lines[0]!) as { title: string }).title, BOOKS[0]!.title)

    // Checklist rendering: create + ingest milestones, then the comparison.
    assert.ok(prompter.log.some((l) => l.startsWith('success:Created index "books"')))
    assert.ok(prompter.log.some((l) => l.includes('keyword vs meaning')))
  })

  it('halts with delete guidance when the index already exists', async () => {
    const runCli = fakeRunCli([
      { match: 'es indices create', result: fail('es_api_error', 'resource_already_exists_exception: index [books] already exists') },
    ])
    await assert.rejects(
      runValueNode(fakeDeps(fakePrompter(), runCli), 'quickstart'),
      (err: unknown) => err instanceof QuickstartHalt &&
        err.code === 'index_exists' &&
        err.nextSteps.some((s) => s.includes('es indices delete')),
    )
  })

  it('halts on index creation failure', async () => {
    const runCli = fakeRunCli([
      { match: 'es indices create', result: fail('es_api_error', 'mapper_parsing_exception') },
    ])
    await assert.rejects(
      runValueNode(fakeDeps(fakePrompter(), runCli), 'quickstart'),
      (err: unknown) => err instanceof QuickstartHalt && err.code === 'index_create_failed',
    )
  })

  it('halts with generic messages when failures carry no error envelope', async () => {
    const noEnvelope = { ok: false, exitCode: 1, stderr: '' }
    const createFail = fakeRunCli([{ match: 'es indices create', result: noEnvelope }])
    await assert.rejects(
      runValueNode(fakeDeps(fakePrompter(), createFail), 'quickstart'),
      (err: unknown) => err instanceof QuickstartHalt && err.message === 'index creation failed',
    )
    const ingestFail = fakeRunCli([
      { match: 'es indices create', result: ok({}) },
      { match: 'es helpers bulk-ingest', result: noEnvelope },
    ])
    await assert.rejects(
      runValueNode(fakeDeps(fakePrompter(), ingestFail), 'quickstart'),
      (err: unknown) => err instanceof QuickstartHalt && err.message === 'bulk ingest failed',
    )
  })

  it('halts with a retry command when ingest fails', async () => {
    const runCli = fakeRunCli([
      { match: 'es indices create', result: ok({}) },
      { match: 'es helpers bulk-ingest', result: fail('bulk_error', 'inference timed out') },
    ])
    await assert.rejects(
      runValueNode(fakeDeps(fakePrompter(), runCli), 'quickstart'),
      (err: unknown) => err instanceof QuickstartHalt &&
        err.code === 'ingest_failed' &&
        err.nextSteps.some((s) => s.includes('bulk-ingest')),
    )
  })

  it('halts when a comparison search fails', async () => {
    const runCli = fakeRunCli([
      { match: 'es indices create', result: ok({}) },
      { match: 'es helpers bulk-ingest', result: ok({}) },
      { match: 'es indices refresh', result: ok({}) },
      { match: 'es search', result: fail('es_api_error', 'search_phase_execution_exception') },
    ])
    await assert.rejects(
      runValueNode(fakeDeps(fakePrompter(), runCli), 'quickstart'),
      (err: unknown) => err instanceof QuickstartHalt && err.code === 'search_failed',
    )
  })
})
