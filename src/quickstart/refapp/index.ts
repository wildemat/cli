/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * THROWAWAY in-band installer for the Elastic Bookshop reference app
 * (https://github.com/elastic/search-reference-app).
 *
 * Deliberately temporary, single-purpose code for one known repo. It exists
 * because a running storefront + browser preview is an aha moment a handoff
 * cannot guarantee. It is deleted wholesale when the generalised third-party
 * install contract lands (fast follow #16 in the quickstart PRD).
 *
 * Deletion procedure: delete this directory, remove the single import in
 * `../nodes/handoff.ts`, remove the one terminal-fork option there, delete
 * `test/quickstart/refapp/`. Nothing else may depend on this module: no
 * exported types are consumed elsewhere, and no values from here leak into
 * the tree model, config, or shared constants.
 *
 * Everything app-specific is hardcoded HERE: repo URL, install commands, env
 * var names (the app's own: ELASTICSEARCH_URL / ELASTIC_API_KEY, NOT the
 * docs' ES_URL or the extension contract's ELASTIC_ES_URL), profile, ports,
 * and demo queries.
 */

import { spawn } from 'node:child_process'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { openBrowser } from '../browser.ts'
import { QuickstartHalt, type QuickstartDeps, type QuickstartState } from '../types.ts'

const REPO_URL = 'https://github.com/elastic/search-reference-app.git'
const DEFAULT_DIR = 'elastic-bookshop'
const PROFILE = 'demo' // never `hybrid` (21k books, far slower)
const FRONTEND_URL = 'http://localhost:3000'
const DEMO_QUERIES = [
  'a story about growing up',
  'a detective in a rainy city',
]

export interface RefAppResult {
  appDir: string
  appUrl: string
  ranQueries: string[]
}

// ---------------------------------------------------------------------------
// Test seams
// ---------------------------------------------------------------------------

type SpawnFn = typeof spawn
let _spawn: SpawnFn = spawn
let _openBrowser: typeof openBrowser = openBrowser

/** @internal */
export function _testSetSpawn (fn: SpawnFn | undefined): void { _spawn = fn ?? spawn }
/** @internal */
export function _testSetOpenBrowser (fn: typeof openBrowser | undefined): void { _openBrowser = fn ?? openBrowser }

interface RunResult { code: number, stdout: string, stderr: string }

function run (
  cmd: string,
  args: string[],
  opts: { cwd?: string, onLine?: (line: string) => void } = {},
): Promise<RunResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = _spawn(cmd, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(opts.cwd != null ? { cwd: opts.cwd } : {}),
    })
    let stdout = ''
    let stderr = ''
    let tail = ''
    child.stdout?.on('data', (c: Buffer) => { stdout += c.toString('utf-8') })
    child.stderr?.on('data', (c: Buffer) => {
      const text = c.toString('utf-8')
      stderr += text
      if (opts.onLine != null) {
        tail += text
        let idx: number
        while ((idx = tail.indexOf('\n')) !== -1) {
          const line = tail.slice(0, idx).trim()
          tail = tail.slice(idx + 1)
          if (line.length > 0) opts.onLine(line)
        }
      }
    })
    child.on('error', (err) => rejectPromise(new Error(`failed to run ${cmd}: ${err.message}`)))
    child.on('close', (code) => resolvePromise({ code: code ?? 1, stdout, stderr }))
  })
}

async function probeBinary (cmd: string, args: string[]): Promise<boolean> {
  try {
    const result = await run(cmd, args)
    return result.code === 0
  } catch {
    return false
  }
}

function stepFailure (what: string, command: string, docPath: string | undefined): QuickstartHalt {
  return new QuickstartHalt('refapp_step_failed', `${what} failed.`, [
    `Run it manually: ${command}`,
    `Or hand the setup to your agent — the context doc has everything it needs${docPath != null ? `: ${docPath}` : ''}`,
  ])
}

/**
 * Clones, configures, and starts Elastic Bookshop against the project the
 * quickstart just created (Docker path; catalogue ships in the image).
 * Interactive-only — agent mode gets the same steps in the runbook.
 */
export async function setupReferenceApp (
  deps: QuickstartDeps,
  state: QuickstartState,
): Promise<RefAppResult> {
  const { prompter, runCli } = deps
  const ctx = state.projectContextName ?? ''
  const esUrl = state.endpoints?.elasticsearch
  if (esUrl == null) {
    throw new QuickstartHalt('refapp_no_endpoint', 'No Elasticsearch endpoint available for the reference app.', [])
  }

  // Preconditions: git and a usable Docker daemon (not just the binary).
  if (!(await probeBinary('git', ['--version']))) {
    throw new QuickstartHalt('refapp_needs_git', 'git is required to clone the reference app.', [
      `Install git, then: git clone ${REPO_URL}`,
    ])
  }
  if (!(await probeBinary('docker', ['info']))) {
    throw new QuickstartHalt('refapp_needs_docker', 'Docker is not available (daemon not running?).', [
      'Start Docker Desktop (or the docker daemon) and choose this option again',
      `Or hand it to your agent: clone ${REPO_URL} and follow its DEPLOYMENT.md`,
    ])
  }

  // Clone target: an artifact the user keeps — never tmp. Confirm the path.
  const targetDir = resolve(process.cwd(), DEFAULT_DIR)
  const confirmed = await prompter.confirm(`Clone Elastic Bookshop into ${targetDir}?`)
  if (!confirmed) {
    throw new QuickstartHalt('refapp_declined', 'Reference app setup skipped.', [
      `Later: git clone ${REPO_URL} && see its DEPLOYMENT.md`,
    ])
  }
  await mkdir(targetDir, { recursive: true })
  if ((await readdir(targetDir)).length > 0) {
    throw new QuickstartHalt('refapp_dir_not_empty', `${targetDir} already exists and is not empty.`, [
      'Move it aside or pick an empty directory, then choose this option again',
    ])
  }

  const cloneSpin = prompter.spinner('Cloning elastic/search-reference-app…')
  const clone = await run('git', ['clone', '--depth', '1', REPO_URL, targetDir])
  if (clone.code !== 0) {
    cloneSpin.fail('Clone failed.')
    throw stepFailure('git clone', `git clone ${REPO_URL} ${targetDir}`, state.contextDocPath)
  }
  cloneSpin.stop('Cloned.')

  // Credentials: mint a real API key from the project context and write it
  // straight into .env (0600). Never echoed, never in argv.
  const keyResult = await runCli(['es', 'security', 'create-api-key', '--name', 'elastic-bookshop', '--use-context', ctx])
  const keyBody = (keyResult.data ?? {}) as { encoded?: string, api_key?: string }
  const apiKey = keyBody.encoded ?? keyBody.api_key
  if (!keyResult.ok || apiKey == null) {
    throw stepFailure('Minting an API key', `elastic es security create-api-key --name elastic-bookshop --use-context ${ctx}`, state.contextDocPath)
  }
  const envLines = [
    `ELASTICSEARCH_URL=${esUrl}`,
    `ELASTIC_API_KEY=${apiKey}`,
    ...(state.endpoints?.kibana != null ? [`KIBANA_URL=${state.endpoints.kibana}`] : []),
    `BOOKSHOP_PROFILE=${PROFILE}`,
    '',
  ]
  await writeFile(join(targetDir, '.env'), envLines.join('\n'), { encoding: 'utf-8', mode: 0o600 })
  prompter.success('Wrote .env (0600) with a freshly minted API key.')

  // Build + start (path B: Docker, Cloud-backed). Cold builds take minutes.
  const buildSpin = prompter.spinner('docker compose up --build (cold builds take a few minutes)…')
  const started = Date.now()
  const up = await run('docker', ['compose', 'up', '--build', '--detach'], {
    cwd: targetDir,
    onLine: (line) => {
      const elapsed = Math.round((Date.now() - started) / 1000)
      buildSpin.message(`docker compose up --build… ${line.slice(0, 60)} (${elapsed}s)`)
    },
  })
  if (up.code !== 0) {
    buildSpin.fail('docker compose up failed.')
    throw stepFailure('docker compose up --build', `cd ${targetDir} && docker compose up --build`, state.contextDocPath)
  }
  buildSpin.stop('Containers are up (backend :8001, frontend :3000).')

  const setupSpin = prompter.spinner(`Loading the ${PROFILE} catalogue (1,735 books)…`)
  const setup = await run('docker', ['compose', 'exec', '-T', 'backend', './bookshop', 'setup', '--profile', PROFILE], {
    cwd: targetDir,
    onLine: (line) => setupSpin.message(line.slice(0, 70)),
  })
  if (setup.code !== 0) {
    setupSpin.fail('bookshop setup failed.')
    throw stepFailure('bookshop setup', `cd ${targetDir} && docker compose exec backend ./bookshop setup --profile ${PROFILE}`, state.contextDocPath)
  }
  setupSpin.stop('Catalogue loaded.')

  // Aha moments: semantic beating lexical inside a real storefront.
  const ranQueries: string[] = []
  for (const query of DEMO_QUERIES) {
    const result = await run('docker', ['compose', 'exec', '-T', 'backend', './bookshop', 'search', query], { cwd: targetDir })
    if (result.code === 0) {
      ranQueries.push(query)
      prompter.note(result.stdout.trim().split('\n').slice(0, 12).join('\n'), `bookshop search "${query}"`)
    }
  }

  _openBrowser(FRONTEND_URL)
  prompter.note(
    [
      `Storefront:  ${FRONTEND_URL}  (self-guided tour at ${FRONTEND_URL}/guide)`,
      `Location:    ${targetDir} — it is yours to edit`,
      `Stop it:     cd ${targetDir} && docker compose down`,
      '',
      'Caveat: beyond localhost, the app\'s agent/inference routes can run up',
      'cost against your own API key — see its DEPLOYMENT.md before exposing it.',
    ].join('\n'),
    'Elastic Bookshop is running',
  )

  return { appDir: targetDir, appUrl: FRONTEND_URL, ranQueries }
}
