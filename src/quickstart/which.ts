/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { accessSync, constants, existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

export interface WhichDeps {
  env: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}

function isExecutable (p: string): boolean {
  try {
    accessSync(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Resolves `bin` against PATH (with PATHEXT suffixes on Windows). */
export function whichBin (bin: string, deps: WhichDeps): string | undefined {
  const platform = deps.platform ?? process.platform
  const pathVar = deps.env.PATH ?? deps.env.Path ?? ''
  const exts = platform === 'win32'
    ? (deps.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').map((e) => e.toLowerCase())
    : ['']
  for (const dir of pathVar.split(delimiter)) {
    if (dir.length === 0) continue
    for (const ext of exts) {
      const candidate = join(dir, bin + ext)
      if (platform === 'win32' ? existsSync(candidate) : isExecutable(candidate)) return candidate
    }
  }
  return undefined
}
