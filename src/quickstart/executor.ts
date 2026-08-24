/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Subprocess executor: runs existing CLI commands as child processes and
 * parses their `--json` output.
 *
 * Quickstart orchestrates via subprocesses rather than in-process handlers
 * because the factory action wrapper owns input validation, `--dry-run`, and
 * error normalisation; `--wait` polling and `--save-as` are registration-time
 * wrappers, not handler logic; and the resolved-config store is write-once
 * per process, which breaks a flow that creates a context mid-run and must
 * then use it.
 *
 * Security: `shell: false`, explicit args array, and never a secret in argv.
 * Credential writes bypass this executor entirely (see the auth node).
 */

import { spawn } from 'node:child_process'
import type { JsonValue } from '../factory.ts'

/** Structured outcome of one CLI subprocess invocation. */
export interface CliResult {
  /** true when the process exited 0 */
  ok: boolean
  /** exit code (1 when the process was killed without a code) */
  exitCode: number
  /** parsed stdout JSON, when stdout contained valid JSON */
  data?: JsonValue
  /** structured error envelope parsed from stderr, when present */
  error?: { code: string, message: string, status?: number }
  /** raw stderr, for diagnostics when no envelope was found */
  stderr: string
}

export interface RunCliOptions {
  /** Called for each line the child writes to stderr (spinner phase text). */
  onStderrLine?: (line: string) => void
  /** Timeout in ms; the child is killed when exceeded. Default: 10 minutes. */
  timeoutMs?: number
}

export type RunCli = (argv: string[], opts?: RunCliOptions) => Promise<CliResult>

type SpawnFn = typeof spawn
let _spawn: SpawnFn = spawn

/** @internal test seam — replace spawn; pass undefined to restore. */
export function _testSetSpawn (fn: SpawnFn | undefined): void {
  _spawn = fn ?? spawn
}

const DEFAULT_TIMEOUT_MS = 600_000

/**
 * Resolves the argv needed to re-exec this CLI: the current Node binary, its
 * exec args (e.g. a TypeScript loader in dev), and the current entry script.
 */
export function selfExecArgv (): { command: string, prefix: string[] } {
  return {
    command: process.execPath,
    prefix: [...process.execArgv, process.argv[1] as string],
  }
}

function extractErrorEnvelope (stderr: string): CliResult['error'] | undefined {
  // The factory writes the envelope as a single JSON line on stderr; scan from
  // the end so trailing warnings printed earlier do not shadow it.
  const lines = stderr.split('\n').filter((l) => l.trim().length > 0)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim()
    if (!line.startsWith('{')) continue
    try {
      const parsed = JSON.parse(line) as {
        error?: { code?: unknown, message?: unknown, status_code?: unknown, body?: unknown }
      }
      const err = parsed.error
      if (err == null || typeof err.code !== 'string') continue
      const status = typeof err.status_code === 'number' ? err.status_code : undefined
      // ES transport errors carry status_code + body instead of message.
      const message = typeof err.message === 'string'
        ? err.message
        : err.body != null
          ? `${status != null ? `status ${status}: ` : ''}${JSON.stringify(err.body)}`
          : status != null ? `status ${status}` : err.code
      return { code: err.code, message, ...(status != null ? { status } : {}) }
    } catch {
      // not JSON; keep scanning
    }
  }
  return undefined
}

const SIGKILL_GRACE_MS = 5_000

/**
 * Runs `elastic <argv> --json` as a subprocess and returns the parsed result.
 *
 * stdout is parsed as JSON when possible (success payloads); stderr is
 * scanned for the `{"error":{...}}` envelope on failure. Both are returned
 * so callers can render diagnostics.
 *
 * Never rejects: timeouts and spawn failures come back as a CliResult whose
 * error.code is `timeout` / `spawn_error`, so callers have one failure path.
 */
export async function runCli (argv: string[], opts: RunCliOptions = {}): Promise<CliResult> {
  const { command, prefix } = selfExecArgv()
  const child = _spawn(command, [...prefix, ...argv, '--json'], {
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  })

  let stdout = ''
  let stderr = ''
  let stderrTail = ''

  child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf-8') })
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf-8')
    stderr += text
    if (opts.onStderrLine != null) {
      stderrTail += text
      let idx: number
      while ((idx = stderrTail.indexOf('\n')) !== -1) {
        const line = stderrTail.slice(0, idx).trim()
        stderrTail = stderrTail.slice(idx + 1)
        if (line.length > 0) opts.onStderrLine(line)
      }
    }
  })

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const outcome = await new Promise<{ exitCode: number, error?: CliResult['error'] }>((resolve) => {
    const timer = setTimeout(() => {
      // Resolve immediately with the output collected so far; escalate to
      // SIGKILL (unref'd, so it never holds the event loop) if SIGTERM is
      // ignored. A late 'close' resolves again, which is a no-op.
      child.kill('SIGTERM')
      setTimeout(() => { child.kill('SIGKILL') }, SIGKILL_GRACE_MS).unref()
      resolve({
        exitCode: 1,
        error: { code: 'timeout', message: `elastic ${argv.join(' ')} timed out after ${Math.round(timeoutMs / 1000)}s` },
      })
    }, timeoutMs)
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({
        exitCode: 1,
        error: { code: 'spawn_error', message: `failed to spawn elastic ${argv.join(' ')}: ${err.message}` },
      })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ exitCode: code ?? 1 })
    })
  })

  const result: CliResult = {
    ok: outcome.exitCode === 0 && outcome.error == null,
    exitCode: outcome.exitCode,
    stderr,
  }
  if (outcome.error != null) result.error = outcome.error

  const trimmed = stdout.trim()
  if (trimmed.length > 0) {
    try {
      result.data = JSON.parse(trimmed) as JsonValue
    } catch {
      // non-JSON stdout; leave data unset
    }
  }
  if (!result.ok && result.error == null) {
    const envelope = extractErrorEnvelope(stderr)
    if (envelope != null) result.error = envelope
  }
  return result
}
