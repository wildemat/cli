/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Value moment: create a `semantic_text` index, load the bundled books
 * dataset, and run the same natural-language query as BM25 and as semantic
 * search, side by side. This is the payoff of the whole command.
 *
 * On a Vector DB project the `vectordb_document` index mode is auto-applied
 * and embeddings come from the EIS default inference endpoint — nothing is
 * hand-tuned here, deliberately. The index is a throwaway sample (mappings
 * are immutable, which is fine here and load-bearing for own-data later).
 */

import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSampleDataset, toNdjson } from '../data/dataset.ts'
import { DEMO_QUERY, LEXICAL_FIELD, SAMPLE_INDEX, SEMANTIC_FIELD } from '../constants.ts'
import { hl } from '../prompts.ts'
import { QuickstartHalt, type ComparisonResult, type QuickstartDeps, type SearchOutcome } from '../types.ts'

export interface ValueResult {
  indexName: string
  docsIndexed: number
  comparison: ComparisonResult
}

/** Mappings: lexical field copied into the semantic field; rest is dynamic. */
export function sampleIndexMappings (): Record<string, unknown> {
  return {
    properties: {
      [LEXICAL_FIELD]: { type: 'text', copy_to: [SEMANTIC_FIELD] },
      [SEMANTIC_FIELD]: { type: 'semantic_text' },
      title: { type: 'text' },
      release_year: { type: 'integer' },
    },
  }
}

/** BM25 body: plain keyword match on the lexical field. */
export function bm25QueryBody (query: string, size: number): Record<string, unknown> {
  return {
    query: { match: { [LEXICAL_FIELD]: { query } } },
    size,
    _source: ['title', 'author', 'release_year'],
  }
}

/** Semantic body: meaning match on the semantic_text field. */
export function semanticQueryBody (query: string, size: number): Record<string, unknown> {
  return {
    query: { semantic: { field: SEMANTIC_FIELD, query } },
    size,
    _source: ['title', 'author', 'release_year'],
  }
}

interface SearchHit { _score?: number, _source?: { title?: string } }
interface SearchBody { took?: number, hits?: { hits?: SearchHit[] } }

function toOutcome (body: SearchBody | undefined): SearchOutcome {
  const hits = (body?.hits?.hits ?? []).map((h) => ({
    title: h._source?.title ?? '(untitled)',
    score: typeof h._score === 'number' ? h._score : 0,
  }))
  return { tookMs: body?.took ?? 0, hits }
}

export async function runValueNode (
  deps: QuickstartDeps,
  projectContextName: string,
): Promise<ValueResult> {
  const { prompter, runCli } = deps
  const ctxArgs = ['--use-context', projectContextName]

  // Stepwise: show the real commands first, run them on Enter — the user
  // should feel each command happen, not watch a wall of output scroll by.
  const createCmd = `elastic es indices create --index ${SAMPLE_INDEX} --mappings '<${SEMANTIC_FIELD}: semantic_text>' --use-context ${projectContextName}`
  const ingestCmd = `elastic es helpers bulk-ingest --index ${SAMPLE_INDEX} --data-file books.ndjson --use-context ${projectContextName}`
  prompter.note(
    [
      'One declared field is all vector search needs — embeddings are',
      'generated automatically at ingest. No ML model to set up.',
      '',
      `  ${hl.cmd(createCmd)}`,
      `  ${hl.cmd(ingestCmd)}`,
    ].join('\n'),
    'Let\'s create an index to see the power of vector search',
  )
  if (!(await prompter.confirm('Press Enter to run these', true))) {
    throw new QuickstartHalt('value_skipped', 'Skipped the sample-data step.', [
      `Run it yourself: ${createCmd}`,
      `Then: ${ingestCmd}`,
      'Or re-run: elastic quickstart',
    ])
  }

  // 1. Create the index. semantic_text auto-embeds at ingest via the default
  //    (EIS) inference endpoint — no model to deploy, nothing to configure.
  const createResult = await runCli([
    'es', 'indices', 'create',
    '--index', SAMPLE_INDEX,
    '--mappings', JSON.stringify(sampleIndexMappings()),
    ...ctxArgs,
  ])
  if (!createResult.ok) {
    const message = createResult.error?.message ?? 'index creation failed'
    if (message.includes('resource_already_exists_exception')) {
      throw new QuickstartHalt(
        'index_exists',
        `The sample index "${SAMPLE_INDEX}" already exists in this project.`,
        [
          `Delete it and re-run: elastic es indices delete --index ${SAMPLE_INDEX} --use-context ${projectContextName}`,
        ],
      )
    }
    throw new QuickstartHalt('index_create_failed', message, [
      `Retry: elastic es indices create --index ${SAMPLE_INDEX} --use-context ${projectContextName}`,
    ])
  }
  prompter.success(`Created index "${hl.val(SAMPLE_INDEX)}"`)
  prompter.success(`Mapped "${LEXICAL_FIELD}" as ${hl.val('semantic_text')} (auto-embedded at ingest)`)

  // 2. Load the sample dataset via the bulk helper.
  const docs = await loadSampleDataset()
  const dir = await mkdtemp(join(tmpdir(), 'elastic-quickstart-data-'))
  const dataFile = join(dir, 'books.ndjson')
  await writeFile(dataFile, toNdjson(docs), { encoding: 'utf-8', mode: 0o600 })

  const spin = prompter.spinner(`Indexing ${docs.length} books (embeddings are generated at ingest)…`)
  const ingest = await runCli([
    'es', 'helpers', 'bulk-ingest',
    '--index', SAMPLE_INDEX,
    '--data-file', dataFile,
    ...ctxArgs,
  ], { timeoutMs: 300_000 })
  if (!ingest.ok) {
    spin.fail('Bulk ingest failed.')
    throw new QuickstartHalt('ingest_failed', ingest.error?.message ?? 'bulk ingest failed', [
      `Retry: elastic es helpers bulk-ingest --index ${SAMPLE_INDEX} --data-file ${dataFile} --use-context ${projectContextName}`,
    ])
  }
  spin.stop(`Indexed ${docs.length} books — embeddings handled for you, no ML model to set up.`)

  await runCli(['es', 'indices', 'refresh', '--index', SAMPLE_INDEX, ...ctxArgs])

  // 3. Same question, two ways — behind its own gate so the payoff lands as
  //    a deliberate step, not tail output of the setup.
  const searchCmd = `elastic es search --index ${SAMPLE_INDEX} --use-context ${projectContextName} --input-file <query.json>`
  prompter.note(
    [
      `The same natural-language question, two ways: ${hl.val(`"${DEMO_QUERY}"`)}`,
      '',
      `  keyword (BM25):  ${hl.cmd(searchCmd.replace('<query.json>', 'bm25.json'))}`,
      `  semantic:        ${hl.cmd(searchCmd.replace('<query.json>', 'semantic.json'))}`,
    ].join('\n'),
    'Ready. Let\'s prove why vector search matters',
  )
  if (!(await prompter.confirm('Press Enter to run the comparison', true))) {
    throw new QuickstartHalt('value_skipped', 'Skipped the search comparison.', [
      `Run it yourself: ${searchCmd}`,
      'Query bodies: {"query":{"match":{"description":{"query":"…"}}}} vs {"query":{"semantic":{"field":"description_semantic","query":"…"}}}',
    ])
  }
  const size = 5
  const bm25 = await search(deps, projectContextName, dir, 'bm25', bm25QueryBody(DEMO_QUERY, size))
  const semantic = await search(deps, projectContextName, dir, 'semantic', semanticQueryBody(DEMO_QUERY, size))

  const comparison: ComparisonResult = { query: DEMO_QUERY, bm25, semantic }
  prompter.note(renderComparison(comparison), `"${DEMO_QUERY}" — keyword vs meaning`)
  prompter.info('Semantic search matches meaning; keyword (BM25) search needs the words to match. Hybrid search combines both.')

  return { indexName: SAMPLE_INDEX, docsIndexed: docs.length, comparison }
}

async function search (
  deps: QuickstartDeps,
  projectContextName: string,
  dir: string,
  label: string,
  body: Record<string, unknown>,
): Promise<SearchOutcome> {
  const file = join(dir, `query-${label}.json`)
  await writeFile(file, JSON.stringify(body), { encoding: 'utf-8', mode: 0o600 })
  const result = await deps.runCli([
    'es', 'search',
    '--index', SAMPLE_INDEX,
    '--input-file', file,
    '--use-context', projectContextName,
  ])
  if (!result.ok) {
    throw new QuickstartHalt('search_failed', result.error?.message ?? `${label} search failed`, [
      `Retry: elastic es search --index ${SAMPLE_INDEX} --input-file ${file} --use-context ${projectContextName}`,
    ])
  }
  return toOutcome(result.data as SearchBody | undefined)
}

/**
 * Renders the two result lists side by side. Kept dependency-free (plain
 * padding, no cli-table3) so the note body wraps cleanly inside clack's frame.
 */
export function renderComparison (comparison: ComparisonResult): string {
  const width = 34
  const rows = Math.max(comparison.bm25.hits.length, comparison.semantic.hits.length)
  const lines: string[] = []
  const pad = (s: string): string => s.length > width ? s.slice(0, width - 1) + '…' : s.padEnd(width)
  lines.push(`${pad(`Keyword (BM25) — ${comparison.bm25.tookMs}ms`)} │ Semantic — ${comparison.semantic.tookMs}ms`)
  lines.push(`${'─'.repeat(width)}─┼─${'─'.repeat(width)}`)
  for (let i = 0; i < rows; i++) {
    const left = comparison.bm25.hits[i]
    const right = comparison.semantic.hits[i]
    const l = left != null ? `${i + 1}. ${left.title} (${left.score.toFixed(2)})` : ''
    const r = right != null ? `${i + 1}. ${right.title} (${right.score.toFixed(2)})` : ''
    lines.push(`${pad(l)} │ ${r}`)
  }
  if (comparison.bm25.hits.length === 0) lines.push('(keyword search found nothing — the words never appear)')
  return lines.join('\n')
}
