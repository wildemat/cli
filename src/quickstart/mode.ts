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
 * mode even at a TTY. Deliberately no agent-specific env sniffing: agents
 * invoking the CLI through a shell have no TTY on fd 0/2, so TTY detection
 * alone is correct and portable.
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
