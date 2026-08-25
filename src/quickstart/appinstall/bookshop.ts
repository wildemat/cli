/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SWAPPABLE installer for the Elastic Bookshop reference app
 * (https://github.com/elastic/search-reference-app).
 *
 * v1 of the install seam is deliberately bound to this one app. Everything
 * app-specific is hardcoded HERE and nowhere else: repo URL, the app's own
 * env-var names (ELASTICSEARCH_URL / ELASTIC_API_KEY — not the docs'
 * ES_URL, not the extension contract's ELASTIC_ES_URL), profile, ports, and
 * run commands. The persistent side (contract.ts, the handoff fork) sees
 * only the neutral payload.
 *
 * Swap procedure: replace this module (or add siblings) behind the
 * AppInstaller interface; the single import lives in ../nodes/handoff.ts.
 * Nothing else may depend on this module.
 *
 * It clones and configures but never runs the app — the user gets
 * copy-paste commands for a fresh shell. Data-plane only: the app talks to
 * the project's Elasticsearch endpoint with its own minted key, writes to
 * its own `bookshop-*` indices, and never creates projects.
 */

import { existsSync } from 'node:fs'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import spawn from 'cross-spawn'
import type { Prompter } from '../prompts.ts'
import type { QuickstartDeps } from '../types.ts'
import type { AppInstaller, AppInstallOutcome, AppInstallPayload } from './contract.ts'

const REPO_URL = 'https://github.com/elastic/search-reference-app.git'
const DEFAULT_DIR = 'elastic-bookshop'
const APP_KEY_NAME = 'elastic-bookshop'
/** Never `hybrid` — 21k books, far slower to set up. */
const PROFILE = 'demo'
const FRONTEND_URL = 'http://localhost:3000'
const DIR_ATTEMPTS = 3

type SpawnFn = typeof spawn
let _spawn: SpawnFn = spawn

/** @internal test seam — replace spawn; pass undefined to restore. */
export function _testSetSpawn (fn: SpawnFn | undefined): void { _spawn = fn ?? spawn }

export const bookshopInstaller: AppInstaller = {
  id: 'bookshop',
  label: 'Install the Elastic Bookshop sample app',
  hint: 'clones + configures it against this project; you run it',
  install: installBookshop,
}

async function installBookshop (payload: AppInstallPayload, deps: QuickstartDeps): Promise<AppInstallOutcome> {
  const { prompter } = deps

  const dir = await pickTargetDir(prompter)
  if (dir == null) {
    prompter.info(manualInstructions(payload))
    return { detail: 'no directory chosen' }
  }

  const spin = prompter.spinner(`Cloning Elastic Bookshop into ${dir}…`)
  const clone = await runGitClone(dir)
  if (!clone.ok) {
    spin.fail(`Clone failed: ${clone.detail}`)
    prompter.info(manualInstructions(payload))
    return { detail: 'clone failed' }
  }
  spin.stop(`Cloned Elastic Bookshop into ${dir}`)

  const keySpin = prompter.spinner(`Minting the app a dedicated API key ("${APP_KEY_NAME}")…`)
  const key = await payload.mintDedicatedKey(APP_KEY_NAME)
  if (key == null) {
    keySpin.fail('Could not mint an API key — .env gets a placeholder to fill in.')
  } else {
    keySpin.stop('Minted a dedicated API key (the context\'s own credentials stay in the keychain).')
  }

  const envPath = join(dir, '.env')
  await writeFile(envPath, envFileContent(payload, key), { encoding: 'utf-8', mode: 0o600 })
  prompter.success(`Wrote ${envPath} (0600) with the project connection.`)

  prompter.note(runInstructions(dir, payload), 'Run the Bookshop app (new shell)')
  return { dir, detail: 'installed' }
}

/** Asks for a new or empty target directory; undefined after 3 misses. */
async function pickTargetDir (prompter: Prompter): Promise<string | undefined> {
  for (let attempt = 1; attempt <= DIR_ATTEMPTS; attempt++) {
    const raw = (await prompter.text('Where should Elastic Bookshop be installed?', DEFAULT_DIR)).trim()
    if (raw.length === 0) continue
    const dir = resolve(raw)
    if (!existsSync(dir)) return dir
    try {
      if ((await readdir(dir)).length === 0) return dir
      prompter.warn(`${dir} is not empty — pick a new or empty directory.`)
    } catch {
      prompter.warn(`${dir} exists and is not a directory — pick another path.`)
    }
  }
  return undefined
}

async function runGitClone (dir: string): Promise<{ ok: boolean, detail?: string }> {
  await mkdir(dirname(dir), { recursive: true })
  return await new Promise((resolvePromise) => {
    let child: ReturnType<SpawnFn>
    try {
      child = _spawn('git', ['clone', '--depth', '1', REPO_URL, dir], {
        stdio: ['ignore', 'ignore', 'pipe'],
        shell: false,
      })
    } catch (err) {
      resolvePromise({ ok: false, detail: err instanceof Error ? err.message : String(err) })
      return
    }
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf-8') })
    child.on('error', (err) => resolvePromise({ ok: false, detail: err.message }))
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise({ ok: true })
        return
      }
      const lines = stderr.trim().split('\n')
      const last = lines[lines.length - 1] ?? ''
      resolvePromise({ ok: false, detail: last !== '' ? last : `git exited with code ${String(code)}` })
    })
  })
}

/** Neutral payload → the APP's env contract (matches its .env.example). */
export function envFileContent (payload: AppInstallPayload, apiKey: string | undefined): string {
  const keyValue = apiKey ??
    `<mint one: elastic es security create-api-key --name ${APP_KEY_NAME} --use-context ${payload.contextName}>`
  const lines = [
    '# Generated by `elastic quickstart` for the Elastic Bookshop app.',
    `ELASTICSEARCH_URL=${payload.endpoints.elasticsearch ?? ''}`,
    `ELASTIC_API_KEY=${keyValue}`,
    ...(payload.endpoints.kibana != null ? [`KIBANA_URL=${payload.endpoints.kibana}`] : []),
    `BOOKSHOP_PROFILE=${PROFILE}`,
  ]
  return lines.join('\n') + '\n'
}

/** Copy-paste commands for a fresh shell; the installer never runs these. */
export function runInstructions (dir: string, payload: AppInstallPayload): string {
  const query = payload.demoQuery ?? 'a story about growing up'
  return [
    `cd ${dir}`,
    'docker compose up --build --detach   # backend :8001, frontend :3000',
    `docker compose exec backend ./bookshop setup --profile ${PROFILE}`,
    `docker compose exec backend ./bookshop search "${query}"`,
    `Open ${FRONTEND_URL} — self-guided tour at /guide`,
    '',
    `The app sets up its own bookshop-* indices in your project${payload.indexName != null ? `; the "${payload.indexName}" index is untouched` : ''}.`,
    'Keep it on localhost — publicly reachable inference routes can run up cost.',
  ].join('\n')
}

function manualInstructions (payload: AppInstallPayload): string {
  const envLines = envFileContent(payload, undefined)
    .trimEnd().split('\n')
    .filter((l) => !l.startsWith('#'))
    .map((l) => `    ${l}`)
  return [
    'Install it manually:',
    `  git clone ${REPO_URL} ${DEFAULT_DIR}`,
    `  cd ${DEFAULT_DIR}`,
    '  Write .env (mode 0600) with:',
    ...envLines,
    `  Then: docker compose up --build --detach && docker compose exec backend ./bookshop setup --profile ${PROFILE}`,
  ].join('\n')
}
