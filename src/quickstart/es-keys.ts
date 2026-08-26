/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Elasticsearch API-key minting for quickstart.
 *
 * Provision mints while the project context still has basic auth (subprocess
 * via `--use-context`). The sample-app installer runs later, after that
 * context has been switched to an API key — and ES forbids creating a
 * *usable* derived key from an API key (empty-privilege derived keys auth
 * but 403 on every API). So app keys are minted with the project's admin
 * basic-auth pair, which quickstart keeps on the Kibana block.
 */

import { loadConfig } from '../config/loader.ts'
import { EsClient, EsResponseError } from '../lib/es-client.ts'
import type { CliResult, RunCli } from './executor.ts'

export interface MintKeyOutcome {
  result: CliResult
  /** Encoded key value when the mint succeeded and the response carried one. */
  encoded?: string
  /** True when the context's existing ES API key was reused (no dedicated mint). */
  reused?: boolean
}

/**
 * How the app-key mint authenticates. Basic auth is preferred: derived keys
 * created under an API-key parent cannot call Elasticsearch APIs.
 */
export type AppMintAuth =
  | { mode: 'basic', url: string, username: string, password: string }
  | { mode: 'subprocess' }
  | { mode: 'reuse', encoded: string }

type ResolveAppMintAuth = (contextName: string) => Promise<AppMintAuth>

/**
 * Resolves mint credentials for the sample-app key: Kibana basic auth against
 * the ES URL when available, else the context's own ES auth (subprocess), else
 * reuse the context API key.
 */
export async function resolveAppMintAuth (contextName: string): Promise<AppMintAuth> {
  const loaded = await loadConfig({ contextName, refresh: true })
  if (!loaded.ok) return { mode: 'subprocess' }
  const es = loaded.value.context.elasticsearch
  const kb = loaded.value.context.kibana
  if (es?.url != null && kb?.auth != null && 'username' in kb.auth && 'password' in kb.auth) {
    return { mode: 'basic', url: es.url, username: kb.auth.username, password: kb.auth.password }
  }
  if (es?.auth != null && 'username' in es.auth) return { mode: 'subprocess' }
  if (es?.auth != null && 'api_key' in es.auth) return { mode: 'reuse', encoded: es.auth.api_key }
  return { mode: 'subprocess' }
}

let _resolveAppMintAuth: ResolveAppMintAuth = resolveAppMintAuth

/** @internal test seam — replace auth resolution; pass undefined to restore. */
export function _testSetResolveAppMintAuth (fn: ResolveAppMintAuth | undefined): void {
  _resolveAppMintAuth = fn ?? resolveAppMintAuth
}

/**
 * Mints an ES API key via subprocess (`es security create-api-key`) — the key
 * travels over the child's stdout pipe, never argv. Used when the context
 * still authenticates with basic auth (provision-time mint).
 */
export async function mintEsApiKey (runCli: RunCli, name: string, contextName: string): Promise<MintKeyOutcome> {
  const result = await runCli([
    'es', 'security', 'create-api-key',
    '--name', name,
    '--use-context', contextName,
  ])
  return parseMintResponse(result)
}

/**
 * Mints the sample-app's dedicated key. Prefers the project's admin basic
 * auth (kept on the Kibana block after provision swaps ES over to an API
 * key); falls back to subprocess mint or reusing the context key.
 */
export async function mintEsApiKeyForApp (
  runCli: RunCli,
  fetchFn: typeof fetch,
  name: string,
  contextName: string,
): Promise<MintKeyOutcome> {
  const auth = await _resolveAppMintAuth(contextName)
  if (auth.mode === 'basic') return mintWithBasicAuth(fetchFn, auth, name)
  if (auth.mode === 'reuse') {
    return {
      result: { ok: true, exitCode: 0, stderr: '' },
      encoded: auth.encoded,
      reused: true,
    }
  }
  return mintEsApiKey(runCli, name, contextName)
}

async function mintWithBasicAuth (
  fetchFn: typeof fetch,
  auth: Extract<AppMintAuth, { mode: 'basic' }>,
  name: string,
): Promise<MintKeyOutcome> {
  const client = new EsClient(auth.url, { username: auth.username, password: auth.password })
  client._testSetFetch(fetchFn)
  try {
    const body = await client.request<{ encoded?: string, api_key?: string }>({
      method: 'POST',
      path: '/_security/api_key',
      body: { name },
    })
    const encoded = body.encoded ?? body.api_key
    const result: CliResult = { ok: true, exitCode: 0, stderr: '', data: body as never }
    return typeof encoded === 'string' ? { result, encoded } : { result }
  } catch (err) {
    if (err instanceof EsResponseError) {
      return {
        result: {
          ok: false,
          exitCode: 1,
          stderr: '',
          error: {
            code: 'es_api_error',
            message: `status ${err.statusCode}: ${typeof err.body === 'string' ? err.body : JSON.stringify(err.body)}`,
            status: err.statusCode,
          },
        },
      }
    }
    return {
      result: {
        ok: false,
        exitCode: 1,
        stderr: '',
        error: {
          code: 'es_connection_error',
          message: err instanceof Error ? err.message : String(err),
        },
      },
    }
  }
}

function parseMintResponse (result: CliResult): MintKeyOutcome {
  const body = (result.data ?? {}) as { encoded?: string, api_key?: string }
  const encoded = body.encoded ?? body.api_key
  return typeof encoded === 'string' ? { result, encoded } : { result }
}
