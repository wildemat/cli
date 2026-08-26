/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Quickstart mode detection.
 *
 * Interactive mode requires BOTH stdin and stderr to be TTYs: stdin is the
 * binding constraint (the prompt library needs raw mode to read keys), and
 * stderr governs whether prompt UI can be drawn at all. `--json` forces agent
 * mode even at a TTY.
 *
 * Coding agents often allocate a PTY (so TTY detection alone is not enough).
 * Agents must pass `--json` explicitly — that is the published contract.
 */

export type QuickstartMode = 'interactive' | 'agent'

/** TTY facts about the process streams, injectable for tests. */
export interface StreamInfo {
  stdinIsTTY: boolean
  stderrIsTTY: boolean
}

/** Reads the real process streams. */
export function processStreamInfo (): StreamInfo {
  return {
    stdinIsTTY: process.stdin.isTTY === true,
    stderrIsTTY: process.stderr.isTTY === true,
  }
}

/**
 * Decides the quickstart rendering mode.
 *
 * @param jsonFlag - whether the user passed `--json`
 * @param streams - TTY facts (defaults to the real process streams)
 */
export function detectMode (jsonFlag: boolean, streams: StreamInfo = processStreamInfo()): QuickstartMode {
  if (jsonFlag) return 'agent'
  return streams.stdinIsTTY && streams.stderrIsTTY ? 'interactive' : 'agent'
}
