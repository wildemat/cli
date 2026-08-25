/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, afterEach, before } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdirSync } from 'node:fs'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  bookshopInstaller,
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
    demoQuery: 'a story about growing up',
    projectType: 'vectordb',
    mintDedicatedKey: async () => 'encoded-key',
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

function install (script: PromptScript, p: AppInstallPayload = payload()) {
  const prompter = fakePrompter(script)
  const deps = fakeDeps(prompter, fakeRunCli([]))
  return { prompter, run: () => bookshopInstaller.install(p, deps) }
}

let tmp: string

before(async () => { tmp = await mkdtemp(join(tmpdir(), 'qs-bookshop-')) })
afterEach(() => { _testSetSpawn(undefined) })

describe('bookshopInstaller.install', () => {
  it('clones, mints a key, seeds .env (0600), and prints run commands', async () => {
    const target = join(tmp, 'happy')
    const git = fakeGit(0)
    const { prompter, run } = install({ texts: [target] })
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
    assert.match(note, /a story about growing up/)
  })

  it('accepts an existing empty directory and skips a non-empty one', async () => {
    const occupied = join(tmp, 'occupied')
    mkdirSync(occupied)
    await writeFile(join(occupied, 'keep.txt'), 'x', 'utf-8')
    const empty = join(tmp, 'empty')
    mkdirSync(empty)

    fakeGit(0)
    const { prompter, run } = install({ texts: [occupied, empty] })
    const outcome = await run()
    assert.equal(outcome.dir, empty)
    assert.ok(prompter.log.some((l) => l.startsWith('warn:') && l.includes('not empty')))
  })

  it('rejects a file path and blank input, then gives up with manual instructions', async () => {
    const filePath = join(tmp, 'a-file')
    await writeFile(filePath, 'x', 'utf-8')

    const { prompter, run } = install({ texts: [filePath, '', filePath, filePath] })
    const outcome = await run()
    assert.deepEqual(outcome, { detail: 'no directory chosen' })
    assert.ok(prompter.log.some((l) => l.startsWith('warn:') && l.includes('not a directory')))
    const info = prompter.log.find((l) => l.startsWith('info:'))!
    assert.match(info, /git clone/)
    assert.match(info, /ELASTIC_API_KEY=<mint one:/)
  })

  it('downgrades a failed clone to manual instructions', async () => {
    const target = join(tmp, 'clone-fail')
    fakeGit(128, 'fatal: repository not found\n')
    const { prompter, run } = install({ texts: [target] })
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
    const first = install({ texts: [target] })
    assert.deepEqual(await first.run(), { detail: 'clone failed' })
    assert.ok(first.prompter.log.some((l) => l.includes('spawn git ENOENT')))

    _testSetSpawn((() => { throw new Error('ENOENT') }) as unknown as Parameters<typeof _testSetSpawn>[0])
    const second = install({ texts: [join(tmp, 'no-git-2')] })
    assert.deepEqual(await second.run(), { detail: 'clone failed' })
  })

  it('reports a code-only clone failure when git wrote nothing to stderr', async () => {
    const target = join(tmp, 'quiet-fail')
    fakeGit(1)
    const { prompter, run } = install({ texts: [target] })
    assert.deepEqual(await run(), { detail: 'clone failed' })
    assert.ok(prompter.log.some((l) => l.includes('git exited with code 1')))
  })

  it('writes a placeholder key and continues when minting fails', async () => {
    const target = join(tmp, 'no-key')
    fakeGit(0)
    const { prompter, run } = install(
      { texts: [target] },
      payload({ mintDedicatedKey: async () => undefined }),
    )
    const outcome = await run()
    assert.equal(outcome.detail, 'installed')
    const env = await readFile(join(target, '.env'), 'utf-8')
    assert.match(env, /ELASTIC_API_KEY=<mint one: elastic es security create-api-key --name elastic-bookshop --use-context quickstart>/)
    assert.ok(prompter.log.some((l) => l.startsWith('spinner-fail:') && l.includes('placeholder')))
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
    assert.match(text, /a story about growing up/)
    assert.doesNotMatch(text, /"books" index/)
  })
})
