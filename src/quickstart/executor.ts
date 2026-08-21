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
  error?: { code: string, message: string }
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

function extractErrorEnvelope (stderr: string): { code: string, message: string } | undefined {
  // The factory writes the envelope as a single JSON line on stderr; scan from
  // the end so trailing warnings printed earlier do not shadow it.
  const lines = stderr.split('\n').filter((l) => l.trim().length > 0)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim()
    if (!line.startsWith('{')) continue
    try {
      const parsed = JSON.parse(line) as { error?: { code?: unknown, message?: unknown } }
      if (parsed.error != null && typeof parsed.error.code === 'string' && typeof parsed.error.message === 'string') {
        return { code: parsed.error.code, message: parsed.error.message }
      }
    } catch {
      // not JSON; keep scanning
    }
  }
  return undefined
}

/**
 * Runs `elastic <argv> --json` as a subprocess and returns the parsed result.
 *
 * stdout is parsed as JSON when possible (success payloads); stderr is
 * scanned for the `{"error":{...}}` envelope on failure. Both are returned
 * so callers can render diagnostics.
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
  const exitCode = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`elastic ${argv.join(' ')} timed out after ${Math.round(timeoutMs / 1000)}s`))
    }, timeoutMs)
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(new Error(`failed to spawn elastic ${argv.join(' ')}: ${err.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve(code ?? 1)
    })
  })

  const result: CliResult = { ok: exitCode === 0, exitCode, stderr }

  const trimmed = stdout.trim()
  if (trimmed.length > 0) {
    try {
      result.data = JSON.parse(trimmed) as JsonValue
    } catch {
      // non-JSON stdout; leave data unset
    }
  }
  if (exitCode !== 0) {
    const envelope = extractErrorEnvelope(stderr)
    if (envelope != null) result.error = envelope
  }
  return result
}
