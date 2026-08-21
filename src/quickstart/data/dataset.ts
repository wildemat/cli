/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Sample-dataset loader. The indirection exists so a CDN- or registry-hosted
 * dataset can replace the bundled one without touching the quickstart flow.
 */

import { BOOKS, type BookDoc } from './books.ts'

export type { BookDoc }

/** Returns the sample documents to index during the value moment. */
export async function loadSampleDataset (): Promise<BookDoc[]> {
  return BOOKS
}

/** Serializes docs as NDJSON for `es helpers bulk-ingest --data-file`. */
export function toNdjson (docs: BookDoc[]): string {
  return docs.map((d) => JSON.stringify(d)).join('\n') + '\n'
}
