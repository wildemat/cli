/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Prompt layer: the only module allowed to import `@clack/prompts`.
 *
 * All decoration (prompts, spinners, notes) is drawn on **stderr** so stdout
 * stays pipeable. Ctrl-C anywhere raises {@link PromptCancelled}; the first
 * prompt of the run carries a timeout that raises {@link FirstPromptTimeout}
 * so PTY-allocating agent harnesses fall back to the runbook instead of
 * hanging. Subsequent prompts never time out (a human may read slowly).
 */

import * as clack from '@clack/prompts'
import { styleText } from 'node:util'

/** Raised when the user cancels (Ctrl-C) any prompt. */
export class PromptCancelled extends Error {
  constructor () { super('cancelled') }
}

/** Raised when the first prompt times out (agent-harness safety net). */
export class FirstPromptTimeout extends Error {
  constructor () { super('first prompt timed out') }
}

/** Milliseconds before the first prompt falls back to agent mode. */
export const FIRST_PROMPT_TIMEOUT_MS = 60_000

export interface SelectOption {
  value: string
  label: string
  hint?: string
}

/** A running spinner handle. */
export interface Spinner {
  message (text: string): void
  stop (text: string): void
  fail (text: string): void
}

/**
 * Interactive prompt surface consumed by the tree interpreter. A single
 * implementation wraps clack; tests substitute a scripted fake.
 */
export interface Prompter {
  intro (title: string): void
  outro (message: string): void
  note (message: string, title?: string): void
  info (message: string): void
  success (message: string): void
  warn (message: string): void
  select (message: string, options: SelectOption[]): Promise<string>
  confirm (message: string, initial?: boolean): Promise<boolean>
  password (message: string): Promise<string>
  spinner (message: string): Spinner
}

interface ClackLike {
  intro: typeof clack.intro
  outro: typeof clack.outro
  note: typeof clack.note
  log: typeof clack.log
  select: typeof clack.select
  confirm: typeof clack.confirm
  password: typeof clack.password
  spinner: typeof clack.spinner
  isCancel: typeof clack.isCancel
}

let _clack: ClackLike = clack

/** @internal test seam — replace the clack implementation; undefined restores. */
export function _testSetClack (impl: ClackLike | undefined): void {
  _clack = impl ?? clack
}

/**
 * Creates the production prompter. `firstPromptTimeoutMs` applies to the
 * first prompt only; pass 0 to disable (tests).
 */
export function createPrompter (firstPromptTimeoutMs: number = FIRST_PROMPT_TIMEOUT_MS): Prompter {
  const output = process.stderr
  let promptsShown = 0

  function firstPromptSignal (): AbortSignal | undefined {
    if (promptsShown > 0 || firstPromptTimeoutMs <= 0) return undefined
    return AbortSignal.timeout(firstPromptTimeoutMs)
  }

  function unwrap<T> (value: T | symbol, timedOut: () => boolean): T {
    if (_clack.isCancel(value)) {
      if (timedOut()) throw new FirstPromptTimeout()
      throw new PromptCancelled()
    }
    return value as T
  }

  async function ask<T> (run: (signal: AbortSignal | undefined) => Promise<T | symbol>): Promise<T> {
    const signal = firstPromptSignal()
    promptsShown++
    let timedOut = false
    signal?.addEventListener('abort', () => { timedOut = true })
    const value = await run(signal)
    return unwrap(value, () => timedOut)
  }

  return {
    intro: (title) => _clack.intro(styleText('bold', title), { output }),
    outro: (message) => _clack.outro(message, { output }),
    note: (message, title) => _clack.note(message, title, { output }),
    info: (message) => _clack.log.info(message, { output }),
    success: (message) => _clack.log.success(message, { output }),
    warn: (message) => _clack.log.warn(message, { output }),
    select: (message, options) => ask((signal) =>
      _clack.select({ message, options, output, ...(signal != null ? { signal } : {}) })),
    confirm: (message, initial = true) => ask((signal) =>
      _clack.confirm({ message, initialValue: initial, output, ...(signal != null ? { signal } : {}) })),
    password: (message) => ask((signal) =>
      _clack.password({ message, output, ...(signal != null ? { signal } : {}) })),
    spinner: (message) => {
      const s = _clack.spinner({ output })
      s.start(message)
      return {
        message: (text) => s.message(text),
        stop: (text) => s.stop(text),
        fail: (text) => s.error(text),
      }
    },
  }
}
