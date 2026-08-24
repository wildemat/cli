/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { runAuthNode } from '../../src/quickstart/nodes/auth.ts'
import { QuickstartHalt } from '../../src/quickstart/types.ts'
import { clearConfigCache } from '../../src/config/loader.ts'
import { _testSetPlatform, _testSetExecSync } from '../../src/config/secret-store.ts'
import { fakeDeps, fakePrompter, fakeRunCli } from './helpers.ts'
import type { PromptScript } from './helpers.ts'
import type { QuickstartDeps } from '../../src/quickstart/types.ts'

let dir: string
let configFile: string
let restorePlatform: (() => void) | undefined
let restoreExec: (() => void) | undefined

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qs-auth-'))
  configFile = join(dir, 'rc.yml')
  process.env.ELASTIC_CLI_CONFIG_FILE = configFile
  clearConfigCache()
  // Force the no-secret-store path so tests never touch a real OS keychain.
  restorePlatform = _testSetPlatform('sunos')
  restoreExec = _testSetExecSync((() => { throw new Error('no secret tool') }) as unknown as Parameters<typeof _testSetExecSync>[0])
})

afterEach(() => {
  restorePlatform?.()
  restoreExec?.()
  clearConfigCache()
})

/** fetch fake keyed by API key: returns 200 only for `validKey`. */
function fetchForKey (validKey: string): typeof fetch {
  return (async (_url: unknown, init?: { headers?: Record<string, string> }) => {
    const auth = init?.headers?.Authorization ?? ''
    const ok = auth === `ApiKey ${validKey}`
    return {
      ok,
      status: ok ? 200 : 401,
      text: async () => '{}',
    }
  }) as unknown as typeof fetch
}

function authDeps (script: PromptScript, validKey: string): QuickstartDeps {
  return fakeDeps(fakePrompter(script), fakeRunCli([]), { fetchFn: fetchForKey(validKey) })
}

describe('runAuthNode — detection', () => {
  it('reuses the active context when its cloud key answers', async () => {
    await writeFile(configFile, [
      'current_context: qa-cloud',
      'contexts:',
      '  qa-cloud:',
      '    cloud:',
      '      url: https://cloud.example',
      '      auth:',
      '        api_key: working-key',
    ].join('\n'), 'utf-8')
    await chmod(configFile, 0o600)

    const result = await runAuthNode(authDeps({}, 'working-key'))
    assert.equal(result.cloudContextName, 'qa-cloud')
    assert.equal(result.reused, true)
  })

  it('finds a working cloud block in a non-active context', async () => {
    await writeFile(configFile, [
      'current_context: project-only',
      'contexts:',
      '  project-only:',
      '    elasticsearch:',
      '      url: https://es.example',
      '  cloudy:',
      '    cloud:',
      '      url: https://cloud.example',
      '      auth:',
      '        api_key: working-key',
    ].join('\n'), 'utf-8')
    await chmod(configFile, 0o600)

    const result = await runAuthNode(authDeps({}, 'working-key'))
    assert.equal(result.cloudContextName, 'cloudy')
    assert.equal(result.reused, true)
  })
})

describe('runAuthNode — paste flow', () => {
  it('probes the pasted key, persists it, and sets current_context when empty', async () => {
    const deps = authDeps({ passwords: ['fresh-key'] }, 'fresh-key')
    const result = await runAuthNode(deps)
    assert.equal(result.cloudContextName, 'elastic-cloud')
    assert.equal(result.reused, false)

    const written = parseYaml(await readFile(configFile, 'utf-8')) as {
      current_context: string
      contexts: Record<string, { cloud: { url: string, auth: { api_key: string } } }>
    }
    assert.equal(written.current_context, 'elastic-cloud')
    assert.equal(written.contexts['elastic-cloud']!.cloud.url, 'https://api.elastic-cloud.com')
    // No secret store available in tests → inline (0600 file), never argv.
    assert.equal(written.contexts['elastic-cloud']!.cloud.auth.api_key, 'fresh-key')
  })

  it('preserves other service blocks when re-authing an existing elastic-cloud context', async () => {
    await writeFile(configFile, [
      'current_context: elastic-cloud',
      'contexts:',
      '  elastic-cloud:',
      '    cloud:',
      '      url: https://cloud.example',
      '      auth:',
      '        api_key: expired-key',
      '    elasticsearch:',
      '      url: https://es.example',
    ].join('\n'), 'utf-8')
    await chmod(configFile, 0o600)

    const result = await runAuthNode(authDeps({ passwords: ['fresh-key'] }, 'fresh-key'))
    assert.equal(result.cloudContextName, 'elastic-cloud')
    assert.equal(result.reused, false)

    const written = parseYaml(await readFile(configFile, 'utf-8')) as {
      contexts: Record<string, { cloud: { auth: { api_key: string } }, elasticsearch?: { url: string } }>
    }
    assert.equal(written.contexts['elastic-cloud']!.cloud.auth.api_key, 'fresh-key')
    assert.equal(written.contexts['elastic-cloud']!.elasticsearch?.url, 'https://es.example')
  })

  it('retries once after a bad key', async () => {
    const prompter = fakePrompter({ passwords: ['bad-key', 'fresh-key'] })
    const deps = fakeDeps(prompter, fakeRunCli([]), { fetchFn: fetchForKey('fresh-key') })
    const result = await runAuthNode(deps)
    assert.equal(result.cloudContextName, 'elastic-cloud')
    assert.ok(prompter.log.some((l) => l.startsWith('warn:That key did not work')))
  })

  it('halts with manual guidance after two bad keys', async () => {
    const deps = authDeps({ passwords: ['bad-1', 'bad-2'] }, 'never-matches')
    await assert.rejects(
      runAuthNode(deps),
      (err: unknown) => err instanceof QuickstartHalt &&
        err.code === 'auth_failed' &&
        err.nextSteps.some((s) => s.includes('elastic config')),
    )
  })

  it('prints signup and API-key URLs as text (browser may fail silently)', async () => {
    const prompter = fakePrompter({ passwords: ['fresh-key'] })
    let openedUrl = ''
    const deps = fakeDeps(prompter, fakeRunCli([]), {
      fetchFn: fetchForKey('fresh-key'),
      openBrowser: (url) => { openedUrl = url; return false },
    })
    await runAuthNode(deps)
    const note = prompter.log.find((l) => l.startsWith('note:'))!
    assert.match(note, /registration/)
    assert.match(note, /account\/keys/)
    assert.match(openedUrl, /account\/keys/)
  })
})
