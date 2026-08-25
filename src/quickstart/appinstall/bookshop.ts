/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SWAPPABLE installer for the Elastic Bookshop reference app
 * (https://github.com/elastic/search-reference-app).
 *
 * v1 of the install seam is deliberately bound to this one app. Everything
 * app-specific lives HERE and nowhere else: the app's own env-var names
 * (ELASTICSEARCH_URL / ELASTIC_API_KEY — not the docs' ES_URL, not the
 * extension contract's ELASTIC_ES_URL), profile, ports, and run commands.
 * The persistent side (contract.ts, the handoff fork) sees only the
 * neutral payload.
 *
 * Swap procedure: replace this module (or add siblings) behind the
 * AppInstaller interface. Imports live only in ../nodes/handoff.ts (the
 * interactive fork) and ../runbook.ts (the agent projection, via
 * {@link bookshopAgentGuide} so both stay on one contract). Nothing else
 * may depend on this module.
 *
 * It clones and configures but never runs the app — the user gets
 * copy-paste commands for a fresh shell. Data-plane only: the app talks to
 * the project's Elasticsearch endpoint with its own minted key, writes to
 * its own `bookshop-*` indices, and never creates projects.
 */

import { existsSync } from 'node:fs'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import spawn from 'cross-spawn'
import { DEMO_QUERY, LINKS } from '../constants.ts'
import type { QuickstartDeps } from '../types.ts'
import type { AppInstaller, AppInstallOutcome, AppInstallPayload } from './contract.ts'

const REPO_URL = `${LINKS.referenceApp}.git`
const DEFAULT_DIR = 'elastic-bookshop'
const APP_KEY_NAME = 'elastic-bookshop'
/** Never `hybrid` — 21k books, far slower to set up. */
const PROFILE = 'demo'
const FRONTEND_URL = 'http://localhost:3000'
const DIR_ATTEMPTS = 5

type SpawnFn = typeof spawn
let _spawn: SpawnFn = spawn

/** @internal test seam — replace spawn; pass undefined to restore. */
export function _testSetSpawn (fn: SpawnFn | undefined): void { _spawn = fn ?? spawn }

export const bookshopInstaller: AppInstaller = {
  id: 'bookshop',
  label: 'Install the complete sample app to showcase Elastic features',
  hint: 'Elastic Bookshop — cloned + configured against this project; you run it',
  keyName: APP_KEY_NAME,
  install: installBookshop,
}

/** Pause between completed steps so the progression reads as steps, not a blast. */
const STEP_PAUSE_MS = 2000

async function installBookshop (payload: AppInstallPayload, deps: QuickstartDeps): Promise<AppInstallOutcome> {
  const { prompter } = deps

  const dir = await pickTargetDir(deps)
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
  await deps.sleep(STEP_PAUSE_MS)

  const key = payload.dedicatedApiKey
  const envPath = join(dir, '.env')
  try {
    await writeFile(envPath, envFileContent(payload, key), { encoding: 'utf-8', mode: 0o600 })
  } catch (err) {
    prompter.warn(`Could not write ${envPath}: ${err instanceof Error ? err.message : String(err)}`)
    if (key != null) {
      prompter.warn(`An unused API key named "${APP_KEY_NAME}" was minted for the app — delete it in Kibana (Stack Management → API keys) or reuse the name when installing manually.`)
    }
    prompter.info(manualInstructions(payload))
    return { detail: '.env write failed' }
  }
  prompter.success(`Wrote ${envPath} (0600) with the project connection${key != null ? ' and the app\'s dedicated API key' : ''}.`)
  await deps.sleep(STEP_PAUSE_MS)

  prompter.note(runInstructions(dir, payload), 'Run the Bookshop app (new shell)')
  return { dir, detail: 'installed' }
}

/** Leading-tilde home expansion — the prompt is free text, shells don't expand it for us. */
function expandTilde (p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  return p
}

/** First absent `~/elastic-bookshop`, `~/elastic-bookshop-2`, … */
function defaultInstallDir (): string {
  const base = join(homedir(), DEFAULT_DIR)
  if (!existsSync(base)) return base
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`
    if (!existsSync(candidate)) return candidate
  }
}

/** undefined = usable; otherwise the warning to show. */
async function targetDirProblem (dir: string): Promise<string | undefined> {
  if (!existsSync(dir)) return undefined
  try {
    if ((await readdir(dir)).length === 0) return undefined
    return `${dir} is not empty — pick a new or empty directory.`
  } catch {
    return `${dir} is a file or not accessible — pick another path.`
  }
}

/**
 * Full-path default in the home directory, or a typed path (with ~
 * expansion), re-asked while invalid; undefined after the attempt budget.
 */
async function pickTargetDir (deps: QuickstartDeps): Promise<string | undefined> {
  const { prompter } = deps
  const defaultDir = defaultInstallDir()
  const mode = await prompter.select('Where should the app be installed?', [
    { value: 'default', label: `Install to ${defaultDir}`, hint: 'a new directory in your home folder' },
    { value: 'custom', label: 'Choose my own path', hint: 'type a directory' },
  ])
  if (mode === 'default') return defaultDir

  for (let attempt = 1; attempt <= DIR_ATTEMPTS; attempt++) {
    const raw = (await prompter.text('Directory for the app', defaultDir)).trim()
    if (raw.length === 0) {
      prompter.warn('No path entered — a new or empty directory is required.')
      continue
    }
    const dir = resolve(expandTilde(raw))
    const problem = await targetDirProblem(dir)
    if (problem == null) return dir
    prompter.warn(problem)
  }
  return undefined
}

async function runGitClone (dir: string): Promise<{ ok: boolean, detail?: string }> {
  // Never throws: any failure here must reach the caller's downgrade path.
  try {
    await mkdir(dirname(dir), { recursive: true })
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) }
  }
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

/** Single-quotes a value for copy-paste shell safety; plain paths stay bare. */
function shq (s: string): string {
  if (/^[A-Za-z0-9_./~-]+$/.test(s)) return s
  return `'${s.replaceAll("'", "'\\''")}'`
}

/** Copy-paste commands for a fresh shell; the installer never runs these. */
export function runInstructions (dir: string, payload: AppInstallPayload): string {
  const query = payload.demoQuery ?? DEMO_QUERY
  return [
    `cd ${shq(dir)}`,
    'docker compose up --build --detach   # backend :8001, frontend :3000',
    `docker compose exec backend ./bookshop setup --profile ${PROFILE}`,
    `docker compose exec backend ./bookshop search ${shq(query)}`,
    `Open ${FRONTEND_URL} — self-guided tour at /guide`,
    '',
    `More about the app: ${LINKS.referenceApp}`,
  ].join('\n')
}

/**
 * The agent-runbook projection of the same app contract. Lives here so the
 * runbook can never drift from the installer on env-var names, profile, or
 * run commands.
 */
export function bookshopAgentGuide (): Record<string, unknown> {
  return {
    title: 'Optional: run the Elastic Bookshop demo app against the project',
    repo: LINKS.referenceApp,
    notes: `The app runs on the user's machine and points at the project — nothing deploys into Elastic Cloud. Its .env uses the APP's variable names (not ES_URL, not ELASTIC_ES_URL). Keep the ${PROFILE} profile; never hybrid (21k books, slow).`,
    env: {
      ELASTICSEARCH_URL: '<elasticsearch endpoint from the context>',
      ELASTIC_API_KEY: `<mint with: elastic es security create-api-key --name ${APP_KEY_NAME} --use-context quickstart --json>`,
      KIBANA_URL: '<kibana endpoint from the context, optional>',
      BOOKSHOP_PROFILE: PROFILE,
    },
    commands: [
      `git clone ${REPO_URL} ${DEFAULT_DIR}`,
      `cd ${DEFAULT_DIR} && <write .env with the vars above, mode 0600>`,
      'docker compose up --build --detach   # backend :8001, frontend :3000',
      `docker compose exec backend ./bookshop setup --profile ${PROFILE}`,
      `docker compose exec backend ./bookshop search ${shq(DEMO_QUERY)}`,
      `open ${FRONTEND_URL} — self-guided tour at /guide`,
    ],
    caveat: 'Beyond localhost, publicly reachable agent/inference routes can run up cost against the user\'s API key — see the repo\'s DEPLOYMENT.md.',
  }
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
