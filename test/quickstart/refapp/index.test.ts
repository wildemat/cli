/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for the THROWAWAY reference-app installer. Deleted together with
 * src/quickstart/refapp/ when the generalised install contract lands.
 */

import { describe, it, beforeEach, afterEach, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, stat, mkdir, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  setupReferenceApp,
  _testSetSpawn,
  _testSetOpenBrowser,
} from '../../../src/quickstart/refapp/index.ts'
import { QuickstartHalt, type QuickstartState } from '../../../src/quickstart/types.ts'
import { fakeDeps, fakePrompter, fakeRunCli, ok, fail } from '../helpers.ts'
import type { PromptScript } from '../helpers.ts'

const STATE: QuickstartState = {
  target: 'cloud-serverless',
  projectContextName: 'quickstart',
  endpoints: { elasticsearch: 'https://es.example', kibana: 'https://kb.example' },
  contextDocPath: '/tmp/qs/context.md',
}

interface SpawnRoute { match: string, code?: number, stdout?: string }

/** Fake spawn matched on `cmd args...` prefix; unmatched commands exit 0. */
function fakeSpawn (routes: SpawnRoute[]) {
  const calls: string[] = []
  _testSetSpawn(((cmd: string, args: string[]) => {
    const joined = `${cmd} ${args.join(' ')}`
    calls.push(joined)
    const route = routes.find((r) => joined.startsWith(r.match))
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter, stderr: EventEmitter }
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    queueMicrotask(() => {
      if (route?.stdout != null) child.stdout.emit('data', Buffer.from(route.stdout))
      child.emit('close', route?.code ?? 0)
    })
    return child
  }) as unknown as Parameters<typeof _testSetSpawn>[0])
  return calls
}

let workDir: string
let originalCwd: string

before(() => { originalCwd = process.cwd() })
after(() => { process.chdir(originalCwd) })

beforeEach(async () => {
  // realpath: macOS tmpdir is a symlink (/var → /private/var) and the
  // installer resolves against process.cwd(), which is already resolved.
  workDir = await realpath(await mkdtemp(join(tmpdir(), 'qs-refapp-')))
  process.chdir(workDir)
})

afterEach(() => {
  _testSetSpawn(undefined)
  _testSetOpenBrowser(undefined)
})

function deps (script: PromptScript = { confirms: [true] }, keyResult = ok({ encoded: 'ZW5jb2RlZA==' })) {
  const runCli = fakeRunCli([{ match: 'es security create-api-key', result: keyResult }])
  const prompter = fakePrompter(script)
  return { deps: fakeDeps(prompter, runCli), prompter, runCli }
}

describe('setupReferenceApp', () => {
  it('clones, writes the app\'s .env (0600), builds, seeds, searches, and opens the browser', async () => {
    const spawns = fakeSpawn([{ match: 'docker compose exec -T backend ./bookshop search', stdout: '1. A Book\n' }])
    const opened: string[] = []
    _testSetOpenBrowser((url) => { opened.push(url); return true })

    const { deps: d, prompter } = deps()
    const result = await setupReferenceApp(d, STATE)

    assert.equal(result.appDir, join(workDir, 'elastic-bookshop'))
    assert.equal(result.appUrl, 'http://localhost:3000')
    assert.equal(result.ranQueries.length, 2)

    // .env uses the APP's env-var names (not ES_URL / ELASTIC_ES_URL).
    const env = await readFile(join(workDir, 'elastic-bookshop', '.env'), 'utf-8')
    assert.match(env, /^ELASTICSEARCH_URL=https:\/\/es\.example$/m)
    assert.match(env, /^ELASTIC_API_KEY=ZW5jb2RlZA==$/m)
    assert.match(env, /^KIBANA_URL=https:\/\/kb\.example$/m)
    assert.match(env, /^BOOKSHOP_PROFILE=demo$/m)
    if (process.platform !== 'win32') {
      assert.equal((await stat(join(workDir, 'elastic-bookshop', '.env'))).mode & 0o777, 0o600)
    }

    // The API key is never echoed to the prompter.
    assert.ok(!prompter.log.some((l) => l.includes('ZW5jb2RlZA==')), 'key must not be echoed')

    // Command sequence: clone → compose up → setup demo profile → searches.
    assert.ok(spawns.some((s) => s.startsWith('git clone')))
    assert.ok(spawns.some((s) => s.includes('compose up --build')))
    assert.ok(spawns.some((s) => s.includes('setup --profile demo')))
    assert.deepEqual(opened, ['http://localhost:3000'])

    // Stop/where/guide/security-caveat all land in the final note.
    const finalNote = prompter.log.filter((l) => l.startsWith('note:')).pop()!
    assert.match(finalNote, /docker compose down/)
    assert.match(finalNote, /\/guide/)
    assert.match(finalNote, /cost/)
  })

  it('halts when git is missing', async () => {
    fakeSpawn([{ match: 'git --version', code: 1 }])
    const { deps: d } = deps()
    await assert.rejects(
      setupReferenceApp(d, STATE),
      (err: unknown) => err instanceof QuickstartHalt && err.code === 'refapp_needs_git',
    )
  })

  it('halts with a way forward when the docker daemon is unusable', async () => {
    fakeSpawn([{ match: 'docker info', code: 1 }])
    const { deps: d } = deps()
    await assert.rejects(
      setupReferenceApp(d, STATE),
      (err: unknown) => err instanceof QuickstartHalt &&
        err.code === 'refapp_needs_docker' &&
        err.nextSteps.some((s) => s.includes('DEPLOYMENT.md')),
    )
  })

  it('halts cleanly when the user declines the clone path', async () => {
    fakeSpawn([])
    const { deps: d } = deps({ confirms: [false] })
    await assert.rejects(
      setupReferenceApp(d, STATE),
      (err: unknown) => err instanceof QuickstartHalt && err.code === 'refapp_declined',
    )
  })

  it('refuses a non-empty target directory', async () => {
    fakeSpawn([])
    await mkdir(join(workDir, 'elastic-bookshop'), { recursive: true })
    await writeFile(join(workDir, 'elastic-bookshop', 'keep.txt'), 'x', 'utf-8')
    const { deps: d } = deps()
    await assert.rejects(
      setupReferenceApp(d, STATE),
      (err: unknown) => err instanceof QuickstartHalt && err.code === 'refapp_dir_not_empty',
    )
  })

  it('stops with the exact failing command when a step fails', async () => {
    fakeSpawn([{ match: 'docker compose up', code: 1 }])
    const { deps: d } = deps()
    await assert.rejects(
      setupReferenceApp(d, STATE),
      (err: unknown) => err instanceof QuickstartHalt &&
        err.code === 'refapp_step_failed' &&
        err.nextSteps.some((s) => s.includes('docker compose up --build')),
    )
  })

  it('halts when the API key cannot be minted', async () => {
    fakeSpawn([])
    const { deps: d } = deps({ confirms: [true] }, fail('es_api_error', 'forbidden'))
    await assert.rejects(
      setupReferenceApp(d, STATE),
      (err: unknown) => err instanceof QuickstartHalt && err.code === 'refapp_step_failed',
    )
  })
})
