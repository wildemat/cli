/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Minimal cross-platform browser opener (`open` / `xdg-open` / `start`).
 * Fire-and-forget: opening can fail silently (headless boxes, containers),
 * so callers must always print the URL as text too.
 */

import spawn from 'cross-spawn'

type SpawnFn = typeof spawn
let _spawn: SpawnFn = spawn
let _platform: NodeJS.Platform = process.platform

/** @internal test seam */
export function _testSetSpawn (fn: SpawnFn | undefined): void {
  _spawn = fn ?? spawn
}

/** @internal test seam */
export function _testSetPlatform (p: NodeJS.Platform | undefined): void {
  _platform = p ?? process.platform
}

/**
 * Opens `url` in the default browser. Returns false when the opener could
 * not be spawned; never throws and never blocks on the browser process.
 * Only http(s) URLs are accepted.
 */
export function openBrowser (url: string): boolean {
  if (!/^https?:\/\//.test(url)) return false
  let command: string
  let args: string[]
  if (_platform === 'darwin') {
    command = 'open'
    args = [url]
  } else if (_platform === 'win32') {
    // `start` is a cmd.exe built-in; the empty string is the window title slot.
    command = 'cmd'
    args = ['/c', 'start', '', url]
  } else {
    command = 'xdg-open'
    args = [url]
  }
  try {
    const child = _spawn(command, args, { stdio: 'ignore', detached: true })
    child.on('error', () => { /* silent — the URL is always printed as text */ })
    child.unref()
    return true
  } catch {
    return false
  }
}
