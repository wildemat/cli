/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Prompt layer: the only module allowed to import `@clack/prompts`.
 *
 * All decoration (prompts, spinners, notes) is drawn on **stderr** so stdout
 * stays pipeable. Ctrl-C anywhere raises {@link PromptCancelled}. Prompts
 * never time out: mode detection (TTY on stdin+stderr) decides interactive
 * vs agent up front, and a human at a real terminal may read slowly.
 *
 * After each printed (non-input) step, {@link createPrompter} pauses briefly
 * so successive lines do not scroll past before the user can read them.
 */

import * as clack from '@clack/prompts'
import { styleText } from 'node:util'

/** Raised when the user cancels (Ctrl-C) any prompt. */
export class PromptCancelled extends Error {
  constructor () { super('cancelled') }
}

/** Default digest pause after each printed interactive step. */
export const STEP_PAUSE_MS = 2000

/**
 * Blocks briefly so the user can read the last printed step. Sync on purpose:
 * callers keep using a fire-and-forget print API; only {@link createPrompter}
 * applies the pause. Pass `0` to no-op (tests).
 */
export function pauseAfterStep (ms: number = STEP_PAUSE_MS): void {
  if (ms <= 0) return
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** Styles text for the stderr decoration channel; plain when not a TTY. */
function paint (format: Parameters<typeof styleText>[0], text: string): string {
  return process.stderr.isTTY === true ? styleText(format, text) : text
}

/**
 * Highlight vocabulary for prompt copy: commands cyan, values/names yellow,
 * URLs underlined, step markers bold. One place so the flow stays consistent.
 */
export const hl = {
  cmd: (s: string): string => paint('cyan', s),
  val: (s: string): string => paint('yellow', s),
  url: (s: string): string => paint(['cyan', 'underline'], s),
  step: (s: string): string => paint('bold', s),
  /** Column / section headers in multi-line notes. */
  head: (s: string): string => paint(['bold', 'cyan'], s),
  ok: (s: string): string => paint('green', s),
  dim: (s: string): string => paint('dim', s),
}

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
  text (message: string, initial?: string): Promise<string>
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
  text: typeof clack.text
  spinner: typeof clack.spinner
  isCancel: typeof clack.isCancel
}

let _clack: ClackLike = clack

/** @internal test seam — replace the clack implementation; undefined restores. */
export function _testSetClack (impl: ClackLike | undefined): void {
  _clack = impl ?? clack
}

/** Options for {@link createPrompter}. */
export interface PrompterOptions {
  /**
   * Digest pause after each printed step (intro/outro/note/log and spinner
   * stop/fail). Defaults to {@link STEP_PAUSE_MS}. Use `0` in tests.
   * Interactive inputs (select/confirm/password/text) and spinner updates
   * are not paused — the user already sets the pace.
   */
  stepPauseMs?: number
}

/** Creates the production prompter (stderr-only decoration). */
export function createPrompter (opts: PrompterOptions = {}): Prompter {
  const output = process.stderr
  const pauseMs = opts.stepPauseMs ?? STEP_PAUSE_MS
  const afterPrint = (): void => { pauseAfterStep(pauseMs) }

  function unwrap<T> (value: T | symbol): T {
    if (_clack.isCancel(value)) throw new PromptCancelled()
    return value as T
  }

  return {
    intro: (title) => { _clack.intro(styleText('bold', title), { output }); afterPrint() },
    outro: (message) => { _clack.outro(message, { output }); afterPrint() },
    note: (message, title) => { _clack.note(message, title, { output }); afterPrint() },
    info: (message) => { _clack.log.info(message, { output }); afterPrint() },
    success: (message) => { _clack.log.success(message, { output }); afterPrint() },
    warn: (message) => { _clack.log.warn(message, { output }); afterPrint() },
    select: async (message, options) => unwrap(await _clack.select({ message, options, output })),
    confirm: async (message, initial = true) => unwrap(await _clack.confirm({ message, initialValue: initial, output })),
    password: async (message) => unwrap(await _clack.password({ message, output })),
    text: async (message, initial) => unwrap(
      await _clack.text({ message, ...(initial != null ? { initialValue: initial } : {}), output }),
    ) ?? '',
    spinner: (message) => {
      const s = _clack.spinner({ output })
      s.start(message)
      return {
        message: (text) => s.message(text),
        stop: (text) => { s.stop(text); afterPrint() },
        fail: (text) => { s.error(text); afterPrint() },
      }
    },
  }
}
