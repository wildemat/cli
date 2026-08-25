/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CliResult, RunCli } from './executor.ts'

export interface MintKeyOutcome {
  result: CliResult
  /** Encoded key value when the mint succeeded and the response carried one. */
  encoded?: string
}

/**
 * Mints an ES API key via subprocess (`es security create-api-key`) — the key
 * travels over the child's stdout pipe, never argv. Single shared parser for
 * the response shape; retry/storage policy stays with each caller.
 */
export async function mintEsApiKey (runCli: RunCli, name: string, contextName: string): Promise<MintKeyOutcome> {
  const result = await runCli([
    'es', 'security', 'create-api-key',
    '--name', name,
    '--use-context', contextName,
  ])
  const body = (result.data ?? {}) as { encoded?: string, api_key?: string }
  const encoded = body.encoded ?? body.api_key
  return typeof encoded === 'string' ? { result, encoded } : { result }
}
