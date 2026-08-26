/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, afterEach, before } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdirSync } from 'node:fs'
import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { QuickstartDeps } from '../../../src/quickstart/types.ts'
import {
  bookshopInstaller,
  bookshopAgentGuide,
  envFileContent,
  runInstructions,
  _testSetSpawn,
} from '../../../src/quickstart/appinstall/bookshop.ts'
import type { AppInstallPayload } from '../../../src/quickstart/appinstall/contract.ts'
import { fakeDeps, fakePrompter, fakeRunCli } from '../helpers.ts'
import type { PromptScript } from '../helpers.ts'

function payload (overrides: Partial<AppInstallPayload> = {}): AppInstallPayload {
  return {
    contextName: 'quickstart',
    endpoints: { elasticsearch: 'https://es.example', kibana: 'https://kb.example' },
    indexName: 'books',
    demoQuery: 'a story about a girl growing up',
    projectType: 'vectordb',
    dedicatedApiKey: 'encoded-key',
    ...overrides,
  }
}

interface GitCall { cmd: string, args: string[], opts: Record<string, unknown> }

/** Fake `git clone` that creates the target dir (as git would) and exits. */
function fakeGit (exitCode = 0, stderrText = ''): GitCall[] {
  const calls: GitCall[] = []
  _testSetSpawn(((cmd: string, args: string[], opts: Record<string, unknown>) => {
    calls.push({ cmd, args, opts })
    const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter }
    child.stderr = new EventEmitter()
    queueMicrotask(() => {
      if (exitCode === 0) mkdirSync(args[args.length - 1]!, { recursive: true })
      if (stderrText !== '') child.stderr.emit('data', Buffer.from(stderrText))
      child.emit('close', exitCode)
    })
    return child
  }) as unknown as Parameters<typeof _testSetSpawn>[0])
  return calls
}

function install (script: PromptScript, p: AppInstallPayload = payload(), extra: Partial<QuickstartDeps> = {}) {
  const prompter = fakePrompter(script)
  const deps = fakeDeps(prompter, fakeRunCli([]), extra)
  return { prompter, run: () => bookshopInstaller.install(p, deps) }
}

/** Routes the spawn seam: git clones create the dir; docker answers from a queue. */
function fakeProcs (routes: { gitExit?: number, docker?: Array<{ code: number, out?: string }> }): GitCall[] {
  const calls: GitCall[] = []
  let dockerIdx = 0
  _testSetSpawn(((cmd: string, args: string[], opts: Record<string, unknown>) => {
    calls.push({ cmd, args, opts })
    const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter, stdout: EventEmitter }
    child.stderr = new EventEmitter()
    child.stdout = new EventEmitter()
    queueMicrotask(() => {
      if (cmd === 'git') {
        if ((routes.gitExit ?? 0) === 0) {
          const dest = args[args.length - 1]!
          mkdirSync(dest, { recursive: true })
          // Mirrors a real clone: evaluation/ is on disk but dockerignored out of the image.
          mkdirSync(join(dest, 'evaluation'), { recursive: true })
        }
        child.emit('close', routes.gitExit ?? 0)
        return
      }
      const step = (routes.docker ?? [])[dockerIdx++] ?? { code: 0 }
      if (step.out != null) child.stdout.emit('data', Buffer.from(step.out))
      child.emit('close', step.code)
    })
    return child
  }) as unknown as Parameters<typeof _testSetSpawn>[0])
  return calls
}

let tmp: string
let dockerBinDir: string

before(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'qs-bookshop-'))
  dockerBinDir = join(tmp, 'bins')
  mkdirSync(dockerBinDir)
  await writeFile(join(dockerBinDir, 'docker'), '#!/bin/sh\nexit 0\n', 'utf-8')
  await chmod(join(dockerBinDir, 'docker'), 0o755)
})
afterEach(() => { _testSetSpawn(undefined) })

describe('bookshopInstaller.install', () => {
  it('clones, seeds .env (0600) with the pre-minted key, and prints run commands', async () => {
    const target = join(tmp, 'happy')
    const git = fakeGit(0)
    const { prompter, run } = install({ selects: ['custom'], texts: [target] })
    const outcome = await run()

    assert.deepEqual(outcome, { dir: target, detail: 'installed' })
    assert.equal(git[0]!.cmd, 'git')
    assert.deepEqual(git[0]!.args, ['clone', '--depth', '1', 'https://github.com/elastic/search-reference-app.git', target])
    assert.equal(git[0]!.opts.shell, false)

    const env = await readFile(join(target, '.env'), 'utf-8')
    assert.match(env, /^ELASTICSEARCH_URL=https:\/\/es\.example$/m)
    assert.match(env, /^ELASTIC_API_KEY=encoded-key$/m)
    assert.match(env, /^KIBANA_URL=https:\/\/kb\.example$/m)
    assert.match(env, /^BOOKSHOP_PROFILE=demo$/m)
    assert.equal(((await stat(join(target, '.env'))).mode & 0o777), 0o600)

    const note = prompter.log.find((l) => l.startsWith('note:'))!
    assert.match(note, /docker compose up --build --detach/)
    assert.match(note, /setup --profile demo/)
    assert.match(note, /a story about a girl growing up/)
    // Plain pointer for newcomers instead of indices/cost jargon.
    assert.match(note, /More about the app: https:\/\/github\.com\/elastic\/search-reference-app/)
  })

  it('defaults to a fresh directory under the home folder', async () => {
    // Failing fake git keeps the test from writing into the real home dir;
    // the chosen path is asserted from the spinner label.
    fakeGit(1)
    const { prompter, run } = install({ selects: ['default'] })
    const outcome = await run()
    assert.equal(outcome.detail, 'clone failed')
    const spin = prompter.log.find((l) => l.startsWith('spinner:Cloning'))!
    assert.ok(spin.includes(join(homedir(), 'elastic-bookshop')))
  })

  it('accepts an existing empty directory and skips a non-empty one', async () => {
    const occupied = join(tmp, 'occupied')
    mkdirSync(occupied)
    await writeFile(join(occupied, 'keep.txt'), 'x', 'utf-8')
    const empty = join(tmp, 'empty')
    mkdirSync(empty)

    fakeGit(0)
    const { prompter, run } = install({ selects: ['custom'], texts: [occupied, empty] })
    const outcome = await run()
    assert.equal(outcome.dir, empty)
    assert.ok(prompter.log.some((l) => l.startsWith('warn:') && l.includes('not empty')))
  })

  it('rejects a file path and blank input, then gives up with manual instructions', async () => {
    const filePath = join(tmp, 'a-file')
    await writeFile(filePath, 'x', 'utf-8')

    const { prompter, run } = install({ selects: ['custom'], texts: [filePath, '', filePath, filePath, filePath] })
    const outcome = await run()
    assert.deepEqual(outcome, { detail: 'no directory chosen' })
    assert.ok(prompter.log.some((l) => l.startsWith('warn:') && l.includes('is a file or not accessible')))
    assert.ok(prompter.log.some((l) => l.startsWith('warn:') && l.includes('No path entered')))
    const info = prompter.log.find((l) => l.startsWith('info:'))!
    assert.match(info, /git clone/)
    assert.match(info, /ELASTIC_API_KEY=<mint one:/)
  })

  it('expands a leading ~ against the home directory', async () => {
    // The home dir exists and is non-empty, so the expanded path shows up in
    // the "not empty" warning without the test writing anywhere real. The
    // failing fake git is a backstop in case a bare home dir ever accepts.
    fakeGit(1)
    const { prompter, run } = install({ selects: ['custom'], texts: ['~', '', '', '', ''] })
    await run()
    assert.ok(prompter.log.some((l) => l.startsWith('warn:') && l.includes(homedir()) && !l.includes('~')))
  })

  it('downgrades a mkdir failure (file as parent) to manual instructions', async () => {
    const fileParent = join(tmp, 'parent-file')
    await writeFile(fileParent, 'x', 'utf-8')
    fakeGit(0)
    const { prompter, run } = install({ selects: ['custom'], texts: [join(fileParent, 'child')] })
    const outcome = await run()
    assert.deepEqual(outcome, { detail: 'clone failed' })
    assert.ok(prompter.log.some((l) => l.startsWith('spinner-fail:')))
    assert.ok(prompter.log.some((l) => l.startsWith('info:') && l.includes('git clone')))
  })

  it('downgrades a .env write failure and flags the already-minted key', async () => {
    const target = join(tmp, 'env-write-fail')
    // Clone "succeeds" without creating the directory, so the .env write fails.
    _testSetSpawn((() => {
      const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter }
      child.stderr = new EventEmitter()
      queueMicrotask(() => child.emit('close', 0))
      return child
    }) as unknown as Parameters<typeof _testSetSpawn>[0])
    const { prompter, run } = install({ selects: ['custom'], texts: [target] })
    const outcome = await run()
    assert.deepEqual(outcome, { detail: '.env write failed' })
    assert.ok(prompter.log.some((l) => l.startsWith('warn:') && l.includes('Could not write')))
    assert.ok(prompter.log.some((l) => l.startsWith('warn:') && l.includes('unused API key')))
    assert.ok(prompter.log.some((l) => l.startsWith('info:') && l.includes('git clone')))
  })

  it('downgrades a failed clone to manual instructions', async () => {
    const target = join(tmp, 'clone-fail')
    fakeGit(128, 'fatal: repository not found\n')
    const { prompter, run } = install({ selects: ['custom'], texts: [target] })
    const outcome = await run()
    assert.deepEqual(outcome, { detail: 'clone failed' })
    assert.ok(prompter.log.some((l) => l.startsWith('spinner-fail:') && l.includes('repository not found')))
    assert.ok(prompter.log.some((l) => l.startsWith('info:') && l.includes('git clone')))
  })

  it('survives git being missing entirely (spawn error event and sync throw)', async () => {
    const target = join(tmp, 'no-git')
    _testSetSpawn((() => {
      const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter }
      child.stderr = new EventEmitter()
      queueMicrotask(() => child.emit('error', new Error('spawn git ENOENT')))
      return child
    }) as unknown as Parameters<typeof _testSetSpawn>[0])
    const first = install({ selects: ['custom'], texts: [target] })
    assert.deepEqual(await first.run(), { detail: 'clone failed' })
    assert.ok(first.prompter.log.some((l) => l.includes('spawn git ENOENT')))

    _testSetSpawn((() => { throw new Error('ENOENT') }) as unknown as Parameters<typeof _testSetSpawn>[0])
    const second = install({ selects: ['custom'], texts: [join(tmp, 'no-git-2')] })
    assert.deepEqual(await second.run(), { detail: 'clone failed' })
  })

  it('reports a code-only clone failure when git wrote nothing to stderr', async () => {
    const target = join(tmp, 'quiet-fail')
    fakeGit(1)
    const { prompter, run } = install({ selects: ['custom'], texts: [target] })
    assert.deepEqual(await run(), { detail: 'clone failed' })
    assert.ok(prompter.log.some((l) => l.includes('git exited with code 1')))
  })

  it('writes a placeholder key and continues when the payload carries no key', async () => {
    const target = join(tmp, 'no-key')
    fakeGit(0)
    const p = payload()
    delete (p as Partial<AppInstallPayload>).dedicatedApiKey
    const { run } = install({ selects: ['custom'], texts: [target] }, p)
    const outcome = await run()
    assert.equal(outcome.detail, 'installed')
    const env = await readFile(join(target, '.env'), 'utf-8')
    assert.match(env, /ELASTIC_API_KEY=<mint one: elastic es security create-api-key --name elastic-bookshop --use-context quickstart>/)
  })
})

describe('bookshopInstaller.install — docker run', () => {
  it('runs compose up, setup, and the demo search itself, then opens the frontend', async () => {
    const target = join(tmp, 'docker-happy')
    const calls = fakeProcs({ docker: [{ code: 0 }, { code: 0 }, { code: 0 }, { code: 0, out: '1. Anne of Green Gables\n2. David Copperfield\n' }] })
    const opened: string[] = []
    const { prompter, run } = install(
      { selects: ['custom'], texts: [target], confirms: [true] },
      payload(),
      { env: { PATH: dockerBinDir }, openBrowser: (url) => { opened.push(url); return true } },
    )
    const outcome = await run()
    assert.deepEqual(outcome, { dir: target, detail: 'installed and started' })

    const dockerCalls = calls.filter((c) => c.cmd === 'docker')
    assert.deepEqual(dockerCalls.map((c) => c.args.join(' ')), [
      'compose up --build --detach',
      // Upstream .dockerignore excludes evaluation/, but ./bookshop imports it
      // at startup — copy the host checkout's copy into the running container.
      'compose cp evaluation backend:/app/evaluation',
      'compose exec backend ./bookshop setup --profile demo',
      // Explicit hybrid: bare `search` defaults to --strategy all, which runs
      // reranked and 429s on EIS capacity during the demo.
      'compose exec backend ./bookshop search --strategy hybrid a story about a girl growing up',
    ])
    // Every docker step runs in the install directory, never the cwd.
    assert.ok(dockerCalls.every((c) => c.opts.cwd === target))
    assert.ok(prompter.log.some((l) => l.startsWith('note:') && l.includes('Anne of Green Gables')))
    assert.deepEqual(opened, ['http://localhost:3000'])
  })

  it('prints the failed command and breaks out to manual instructions when compose up fails', async () => {
    const target = join(tmp, 'docker-up-fail')
    fakeProcs({ docker: [{ code: 1, out: 'Cannot connect to the Docker daemon\n' }] })
    const { prompter, run } = install(
      { selects: ['custom'], texts: [target], confirms: [true] },
      payload(),
      { env: { PATH: dockerBinDir } },
    )
    const outcome = await run()
    assert.deepEqual(outcome, { dir: target, detail: 'installed (docker step failed)' })
    assert.ok(prompter.log.some((l) => l.startsWith('info:') && l.includes('Cannot connect to the Docker daemon')))
    assert.ok(prompter.log.some((l) => l.startsWith('warn:') && l.includes('docker compose up --build --detach')))
    assert.ok(prompter.log.some((l) => l.startsWith('note:Continue the setup yourself')))
  })

  it('prints the run commands instead when the user declines the docker start', async () => {
    const target = join(tmp, 'docker-declined')
    const calls = fakeProcs({})
    const { prompter, run } = install(
      { selects: ['custom'], texts: [target], confirms: [false] },
      payload(),
      { env: { PATH: dockerBinDir } },
    )
    const outcome = await run()
    assert.deepEqual(outcome, { dir: target, detail: 'installed' })
    assert.equal(calls.filter((c) => c.cmd === 'docker').length, 0)
    assert.ok(prompter.log.some((l) => l.startsWith('note:Run the Bookshop app')))
  })
})

describe('envFileContent / runInstructions', () => {
  it('omits KIBANA_URL when the payload has no kibana endpoint', () => {
    const env = envFileContent(payload({ endpoints: { elasticsearch: 'https://es.example' } }), 'k')
    assert.doesNotMatch(env, /KIBANA_URL/)
  })

  it('falls back to defaults when the value node never ran', () => {
    const p = payload()
    delete (p as Partial<AppInstallPayload>).indexName
    delete (p as Partial<AppInstallPayload>).demoQuery
    const text = runInstructions('/x', p)
    assert.match(text, /a story about a girl growing up/)
    assert.match(text, /compose cp evaluation backend:\/app\/evaluation/)
    assert.doesNotMatch(text, /"books" index/)
  })

  it('shell-quotes paths and queries so the printed commands survive a paste', () => {
    const text = runInstructions('/Users/me/My Projects/bookshop', payload({ demoQuery: 'a "coming of age" story' }))
    assert.match(text, /^cd '\/Users\/me\/My Projects\/bookshop'$/m)
    assert.match(text, /search 'a "coming of age" story'$/m)
    // A plain path stays unquoted for readability.
    assert.match(runInstructions('/x/bookshop', payload()), /^cd \/x\/bookshop$/m)
  })
})

describe('bookshopAgentGuide', () => {
  it('carries the same app contract as the installer', () => {
    const guide = bookshopAgentGuide()
    const env = guide.env as Record<string, string>
    assert.deepEqual(Object.keys(env), ['ELASTICSEARCH_URL', 'ELASTIC_API_KEY', 'KIBANA_URL', 'BOOKSHOP_PROFILE'])
    assert.equal(env.BOOKSHOP_PROFILE, 'demo')
    const commands = guide.commands as string[]
    assert.ok(commands.some((c) => c.includes('git clone') && c.includes('search-reference-app')))
    assert.ok(commands.some((c) => c.includes('setup --profile demo')))
  })
})
