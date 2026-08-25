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
 */

import * as clack from '@clack/prompts'
import { styleText } from 'node:util'

/** Raised when the user cancels (Ctrl-C) any prompt. */
export class PromptCancelled extends Error {
  constructor () { super('cancelled') }
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

/** Creates the production prompter (stderr-only decoration). */
export function createPrompter (): Prompter {
  const output = process.stderr

  function unwrap<T> (value: T | symbol): T {
    if (_clack.isCancel(value)) throw new PromptCancelled()
    return value as T
  }

  return {
    intro: (title) => _clack.intro(styleText('bold', title), { output }),
    outro: (message) => _clack.outro(message, { output }),
    note: (message, title) => _clack.note(message, title, { output }),
    info: (message) => _clack.log.info(message, { output }),
    success: (message) => _clack.log.success(message, { output }),
    warn: (message) => _clack.log.warn(message, { output }),
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
        stop: (text) => s.stop(text),
        fail: (text) => s.error(text),
      }
    },
  }
}
