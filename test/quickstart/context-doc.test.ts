/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { stat, readFile } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'
import { renderContextDoc, writeContextDoc } from '../../src/quickstart/nodes/context-doc.ts'
import type { QuickstartState } from '../../src/quickstart/types.ts'

const STATE: QuickstartState = {
  target: 'cloud-serverless',
  cloudContextName: 'elastic-cloud',
  projectContextName: 'quickstart',
  projectType: 'vectordb',
  projectId: 'proj-123',
  projectName: 'quickstart',
  regionId: 'aws-eu-west-1',
  endpoints: { elasticsearch: 'https://es.example', kibana: 'https://kb.example' },
  indexName: 'books',
  docsIndexed: 74,
  demoQuery: 'a story about a girl growing up',
}

describe('renderContextDoc', () => {
  it('has parseable YAML frontmatter with schema_version and project facts', () => {
    const doc = renderContextDoc(STATE)
    const match = doc.match(/^---\n([\s\S]*?)\n---\n/)
    assert.ok(match, 'frontmatter block required')
    const fm = parseYaml(match![1]!) as Record<string, unknown>
    assert.equal(fm.schema_version, 1)
    assert.equal(fm.context, 'quickstart')
    assert.deepEqual(fm.project, { type: 'vectordb', id: 'proj-123', name: 'quickstart', region: 'aws-eu-west-1' })
    assert.equal((fm.endpoints as Record<string, string>).kibana, 'https://kb.example')
    assert.equal(fm.index, 'books')
  })

  it('references the context by name and contains no credentials', () => {
    const doc = renderContextDoc(STATE)
    assert.match(doc, /--use-context quickstart/)
    assert.doesNotMatch(doc, /password|api_key:|ApiKey /i)
  })

  it('carries the demo queries, next steps, and cost/cleanup guidance', () => {
    const doc = renderContextDoc(STATE)
    assert.match(doc, /"a story about a girl growing up"/)
    assert.match(doc, /semantic/)
    assert.match(doc, /Hybrid search/)
    assert.match(doc, /delete/)
    assert.match(doc, /billing/i)
    assert.match(doc, /search-reference-app/)
  })

  it('claims an API key only when one was actually minted', () => {
    const minted = renderContextDoc({ ...STATE, esApiKeyMinted: true })
    assert.match(minted, /holds the project endpoints and an Elasticsearch API key/)
    // Mint failed or unknown: the doc must not promise a key that isn't there.
    const notMinted = renderContextDoc({ ...STATE, esApiKeyMinted: false })
    assert.match(notMinted, /holds the project endpoints and its credentials/)
    assert.doesNotMatch(renderContextDoc(STATE), /an Elasticsearch API key/)
  })

  it('renders vector-namespace cleanup with the real cloud context', () => {
    const doc = renderContextDoc(STATE)
    assert.match(doc, /projects vector delete --id proj-123 --use-context elastic-cloud/)
  })

  it('renders search-namespace cleanup for the entitlement-fallback project', () => {
    const doc = renderContextDoc({ ...STATE, projectType: 'elasticsearch' })
    assert.match(doc, /projects search delete --id proj-123 --use-context elastic-cloud/)
    assert.doesNotMatch(doc, /projects vector delete/)
  })

  it('renders placeholders when state is sparse', () => {
    const doc = renderContextDoc({ target: 'cloud-serverless' })
    assert.match(doc, /schema_version: 1/)
    assert.match(doc, /type: null/)
  })
})

describe('writeContextDoc', () => {
  it('writes to a fresh tmp dir with restrictive permissions', async () => {
    const path = await writeContextDoc(STATE)
    assert.match(path, /elastic-quickstart-.*context\.md$/s)
    const content = await readFile(path, 'utf-8')
    assert.match(content, /^---\n/)
    if (process.platform !== 'win32') {
      const fileStat = await stat(path)
      assert.equal(fileStat.mode & 0o777, 0o600)
      const { dirname } = await import('node:path')
      const dirStat = await stat(dirname(path))
      assert.equal(dirStat.mode & 0o777, 0o700)
    }
  })
})
