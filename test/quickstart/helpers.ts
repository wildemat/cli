/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/** Shared fakes for quickstart tests: scripted prompter and runCli. */

import type { Prompter, SelectOption, Spinner } from '../../src/quickstart/prompts.ts'
import type { CliResult, RunCli, RunCliOptions } from '../../src/quickstart/executor.ts'
import type { QuickstartDeps } from '../../src/quickstart/types.ts'
import { CLOUD_ENVS } from '../../src/quickstart/constants.ts'

export interface PromptScript {
  /** Values returned by select prompts, in order. */
  selects?: string[]
  /** Values returned by confirm prompts, in order. */
  confirms?: boolean[]
  /** Values returned by password prompts, in order. */
  passwords?: string[]
  /** Values returned by text prompts, in order. */
  texts?: string[]
}

export interface RecordedPrompter extends Prompter {
  readonly log: string[]
}

/** A prompter that replays a script and records every interaction. */
export function fakePrompter (script: PromptScript = {}): RecordedPrompter {
  const log: string[] = []
  const selects = [...(script.selects ?? [])]
  const confirms = [...(script.confirms ?? [])]
  const passwords = [...(script.passwords ?? [])]
  const texts = [...(script.texts ?? [])]
  const spinner = (message: string): Spinner => {
    log.push(`spinner:${message}`)
    return {
      message: (t) => log.push(`spinner-message:${t}`),
      stop: (t) => log.push(`spinner-stop:${t}`),
      fail: (t) => log.push(`spinner-fail:${t}`),
    }
  }
  return {
    log,
    intro: (t) => log.push(`intro:${t}`),
    outro: (t) => log.push(`outro:${t}`),
    note: (m, t) => log.push(`note:${t ?? ''}:${m}`),
    info: (m) => log.push(`info:${m}`),
    success: (m) => log.push(`success:${m}`),
    warn: (m) => log.push(`warn:${m}`),
    select: async (message: string, options: SelectOption[]) => {
      log.push(`select:${message}:${options.map((o) => o.value).join(',')}`)
      const next = selects.shift()
      if (next == null) throw new Error(`unscripted select: ${message}`)
      return next
    },
    confirm: async (message: string) => {
      log.push(`confirm:${message}`)
      const next = confirms.shift()
      if (next == null) throw new Error(`unscripted confirm: ${message}`)
      return next
    },
    password: async (message: string) => {
      log.push(`password:${message}`)
      const next = passwords.shift()
      if (next == null) throw new Error(`unscripted password: ${message}`)
      return next
    },
    text: async (message: string, initial?: string) => {
      log.push(`text:${message}:${initial ?? ''}`)
      const next = texts.shift()
      if (next == null) throw new Error(`unscripted text: ${message}`)
      return next
    },
    spinner,
  }
}

export interface CliCall { argv: string[], opts?: RunCliOptions }

/**
 * A runCli fake that matches invocations by argv prefix (space-joined) and
 * records every call.
 */
export function fakeRunCli (
  routes: Array<{ match: string, result: CliResult | ((argv: string[]) => CliResult) }>,
): RunCli & { calls: CliCall[] } {
  const calls: CliCall[] = []
  const fn = (async (argv: string[], opts?: RunCliOptions) => {
    calls.push({ argv, ...(opts != null ? { opts } : {}) })
    const joined = argv.join(' ')
    for (const route of routes) {
      if (joined.startsWith(route.match)) {
        return typeof route.result === 'function' ? route.result(argv) : route.result
      }
    }
    throw new Error(`unrouted runCli call: ${joined}`)
  }) as RunCli & { calls: CliCall[] }
  fn.calls = calls
  return fn
}

export function ok (data: unknown): CliResult {
  return { ok: true, exitCode: 0, data: data as CliResult['data'], stderr: '' }
}

export function fail (code: string, message: string, exitCode = 1): CliResult {
  return { ok: false, exitCode, error: { code, message }, stderr: '' }
}

/** Builds full deps from a prompter + runCli, with instant sleep. */
export function fakeDeps (prompter: Prompter, runCli: RunCli, extra: Partial<QuickstartDeps> = {}): QuickstartDeps {
  return {
    runCli,
    prompter,
    fetchFn: (async () => { throw new Error('unexpected fetch') }) as unknown as typeof fetch,
    openBrowser: () => true,
    env: {},
    cloudEnv: CLOUD_ENVS.prod,
    sleep: async () => {},
    ...extra,
  }
}
