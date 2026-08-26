/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  pickDefaultRegion,
  regionFragmentsForTimezone,
  firstFreeName,
  runProvisionNode,
} from '../../src/quickstart/nodes/provision.ts'
import { QuickstartHalt } from '../../src/quickstart/types.ts'
import { _testSetPlatform, _testSetExecSync } from '../../src/config/secret-store.ts'
import { fakeDeps, fakePrompter, fakeRunCli, ok, fail } from './helpers.ts'

const REGIONS = [
  { id: 'azure-eastus2', name: 'East US 2', project_creation_enabled: true },
  { id: 'aws-eu-west-1', name: 'EU (Ireland)', project_creation_enabled: true },
  { id: 'gcp-us-central1', name: 'Iowa', project_creation_enabled: true },
]

const CREATED = {
  id: 'proj-1',
  endpoints: { elasticsearch: 'https://es.example', kibana: 'https://kb.example' },
  savedAs: 'quickstart',
}

describe('pickDefaultRegion', () => {
  it('follows the preference order', () => {
    assert.equal(pickDefaultRegion(REGIONS)?.id, 'aws-eu-west-1')
  })

  it('skips regions with creation disabled', () => {
    const regions = [
      { id: 'aws-eu-west-1', project_creation_enabled: false },
      { id: 'gcp-us-central1', project_creation_enabled: true },
    ]
    assert.equal(pickDefaultRegion(regions)?.id, 'gcp-us-central1')
  })

  it('falls back to the first creatable region and handles none', () => {
    assert.equal(pickDefaultRegion([{ id: 'x-1' }])?.id, 'x-1')
    assert.equal(pickDefaultRegion([]), undefined)
    assert.equal(pickDefaultRegion([{ id: 'x', project_creation_enabled: false }]), undefined)
  })

  it('prefers a timezone-suggested region over the static preference list', () => {
    const fragments = regionFragmentsForTimezone('Europe/Berlin')
    assert.equal(pickDefaultRegion(REGIONS, fragments)?.id, 'aws-eu-west-1')
    const us = regionFragmentsForTimezone('America/New_York')
    assert.equal(pickDefaultRegion(REGIONS, us)?.id, 'gcp-us-central1')
  })
})

describe('regionFragmentsForTimezone', () => {
  it('maps continents to region fragments and unknowns to none', () => {
    assert.ok(regionFragmentsForTimezone('Europe/Berlin').includes('eu-west'))
    assert.ok(regionFragmentsForTimezone('Asia/Tokyo').includes('ap-southeast'))
    assert.ok(regionFragmentsForTimezone('America/New_York').includes('us-east'))
    assert.deepEqual(regionFragmentsForTimezone('Etc/UTC'), [])
    assert.deepEqual(regionFragmentsForTimezone(undefined), [])
    assert.deepEqual(regionFragmentsForTimezone(''), [])
  })
})

describe('firstFreeName', () => {
  it('returns the base when free, else appends -2, -3, …', () => {
    assert.equal(firstFreeName(new Set()), 'quickstart')
    assert.equal(firstFreeName(new Set(['quickstart'])), 'quickstart-2')
    assert.equal(firstFreeName(new Set(['quickstart', 'quickstart-2'])), 'quickstart-3')
  })
})

describe('runProvisionNode', () => {
  let configFile: string
  let restorePlatform: (() => void) | undefined
  let restoreExec: (() => void) | undefined

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qs-provision-'))
    configFile = join(dir, 'rc.yml')
    process.env.ELASTIC_CLI_CONFIG_FILE = configFile
    // Force the no-secret-store path so tests never touch a real OS keychain.
    restorePlatform = _testSetPlatform('sunos')
    restoreExec = _testSetExecSync((() => { throw new Error('no secret tool') }) as unknown as Parameters<typeof _testSetExecSync>[0])
  })

  afterEach(() => {
    restorePlatform?.()
    restoreExec?.()
  })

  /** Routes shared by every test that reaches the post-create mint step. */
  const mintRoute = { match: 'es security create-api-key', result: ok({ encoded: 'bWludGVkLWtleQ==' }) }

  /**
   * Simulates --save-as: production create writes the context as a side
   * effect, so the fake create route seeds the config file the same way.
   */
  function seedSavedContextSync (name: string): void {
    writeFileSync(configFile, [
      `current_context: ${name}`,
      'contexts:',
      `  ${name}:`,
      '    elasticsearch:',
      '      url: https://es.example',
      '      auth:',
      '        username: admin',
      '        password: basic-pass',
      '    kibana:',
      '      url: https://kb.example',
      '      auth:',
      '        username: admin',
      '        password: basic-pass',
    ].join('\n') + '\n', 'utf-8')
  }

  it('creates the project with metadata, --wait, and --save-as, then mints an API key into the context', async () => {
    const runCli = fakeRunCli([
      { match: 'cloud serverless regions list-regions', result: ok(REGIONS) },
      { match: 'cloud serverless projects vector list', result: ok({ items: [] }) },
      {
        match: 'cloud serverless projects vector create',
        result: () => { seedSavedContextSync('quickstart'); return ok(CREATED) },
      },
      mintRoute,
    ])
    const prompter = fakePrompter({ selects: ['default'] })
    const result = await runProvisionNode(fakeDeps(prompter, runCli), 'cloud-ctx')

    assert.equal(result.projectType, 'vectordb')
    assert.equal(result.projectId, 'proj-1')
    assert.equal(result.projectName, 'quickstart')
    assert.equal(result.regionId, 'aws-eu-west-1')
    assert.equal(result.projectContextName, 'quickstart')
    assert.equal(result.endpoints.elasticsearch, 'https://es.example')

    const createCall = runCli.calls.find((c) => c.argv.includes('create'))!
    const joined = createCall.argv.join(' ')
    assert.match(joined, /--metadata \{"tags":\{"source":"quickstart","branch":"cloud-vectordb"\}\}/)
    assert.ok(createCall.argv.includes('--wait'))
    assert.ok(createCall.argv.includes('--save-as'))
    assert.ok(createCall.argv.includes('--use-context'))
    // Region irreversibility must be surfaced to the user.
    assert.ok(prompter.log.some((l) => l.includes('cannot be changed later')))

    // The context's ES credential becomes the minted API key (canonical
    // location; the key itself never goes through argv or the prompter).
    const mintCall = runCli.calls.find((c) => c.argv.join(' ').startsWith('es security create-api-key'))!
    assert.ok(mintCall.argv.includes('--use-context'))
    assert.ok(!mintCall.argv.some((a) => a.includes('bWludGVkLWtleQ==')), 'key must not be in argv')
    assert.ok(!prompter.log.some((l) => l.includes('bWludGVkLWtleQ==')), 'key must not be echoed')
    const written = parseYaml(await readFile(configFile, 'utf-8')) as {
      contexts: Record<string, { elasticsearch: { auth: Record<string, string> }, kibana: { auth: Record<string, string> } }>
    }
    assert.deepEqual(written.contexts.quickstart!.elasticsearch.auth, { api_key: 'bWludGVkLWtleQ==' })
    // Kibana keeps its basic-auth pair — ES API keys are an ES credential.
    assert.equal(written.contexts.quickstart!.kibana.auth.username, 'admin')
    assert.equal(result.esApiKeyMinted, true)
    assert.ok(prompter.log.some((l) => l.startsWith('spinner-stop:Minted an Elasticsearch API key')))
  })

  it('continues with basic auth (warn, not halt) when key minting fails terminally', async () => {
    const runCli = fakeRunCli([
      { match: 'cloud serverless regions list-regions', result: ok(REGIONS) },
      { match: 'cloud serverless projects vector list', result: ok({ items: [] }) },
      {
        match: 'cloud serverless projects vector create',
        result: () => { seedSavedContextSync('quickstart'); return ok(CREATED) },
      },
      { match: 'es security create-api-key', result: fail('es_api_error', 'forbidden') },
    ])
    const prompter = fakePrompter({ selects: ['default'] })
    const result = await runProvisionNode(fakeDeps(prompter, runCli), 'cloud-ctx')
    assert.equal(result.projectContextName, 'quickstart')
    assert.equal(result.esApiKeyMinted, false)
    // Terminal (non-retryable) failure: exactly one mint attempt.
    assert.equal(runCli.calls.filter((c) => c.argv.join(' ').startsWith('es security create-api-key')).length, 1)
    assert.ok(prompter.log.some((l) => l.startsWith('spinner-fail:Could not mint an API key')))
    const written = parseYaml(await readFile(configFile, 'utf-8')) as {
      contexts: Record<string, { elasticsearch: { auth: Record<string, string> } }>
    }
    assert.equal(written.contexts.quickstart!.elasticsearch.auth.password, 'basic-pass')
  })

  it('holds and retries minting while the fresh project refuses connections', async () => {
    let mintCalls = 0
    const runCli = fakeRunCli([
      { match: 'cloud serverless regions list-regions', result: ok(REGIONS) },
      { match: 'cloud serverless projects vector list', result: ok({ items: [] }) },
      {
        match: 'cloud serverless projects vector create',
        result: () => { seedSavedContextSync('quickstart'); return ok(CREATED) },
      },
      {
        match: 'es security create-api-key',
        result: () => {
          mintCalls++
          if (mintCalls < 3) return fail('connection_error', 'fetch failed: ECONNREFUSED')
          return ok({ encoded: 'bWludGVkLWtleQ==' })
        },
      },
    ])
    const prompter = fakePrompter({ selects: ['default'] })
    const result = await runProvisionNode(fakeDeps(prompter, runCli), 'cloud-ctx')
    assert.equal(mintCalls, 3)
    assert.equal(result.esApiKeyMinted, true)
    assert.ok(prompter.log.some((l) => l.startsWith('spinner-message:Minting an Elasticsearch API key… project not accepting requests yet')))
  })

  it('gives up minting after the attempt budget', async () => {
    let mintCalls = 0
    const runCli = fakeRunCli([
      { match: 'cloud serverless regions list-regions', result: ok(REGIONS) },
      { match: 'cloud serverless projects vector list', result: ok({ items: [] }) },
      {
        match: 'cloud serverless projects vector create',
        result: () => { seedSavedContextSync('quickstart'); return ok(CREATED) },
      },
      {
        match: 'es security create-api-key',
        result: () => { mintCalls++; return fail('connection_error', 'fetch failed') },
      },
    ])
    const result = await runProvisionNode(fakeDeps(fakePrompter({ selects: ['default'] }), runCli), 'cloud-ctx')
    assert.equal(mintCalls, 6)
    assert.equal(result.esApiKeyMinted, false)
  })

  it('lets the user choose a region instead of the default', async () => {
    const runCli = fakeRunCli([
      { match: 'cloud serverless regions list-regions', result: ok(REGIONS) },
      { match: 'cloud serverless projects vector list', result: ok({ items: [] }) },
      {
        match: 'cloud serverless projects vector create',
        result: () => { seedSavedContextSync('quickstart'); return ok(CREATED) },
      },
      mintRoute,
    ])
    const prompter = fakePrompter({ selects: ['choose', 'azure-eastus2'] })
    const result = await runProvisionNode(fakeDeps(prompter, runCli), 'cloud-ctx')
    assert.equal(result.regionId, 'azure-eastus2')
    // The full-list submenu offered every creatable region.
    const submenu = prompter.log.filter((l) => l.startsWith('select:'))[1]!
    assert.match(submenu, /azure-eastus2,aws-eu-west-1,gcp-us-central1/)
  })

  it('suffixes the name past existing projects', async () => {
    const runCli = fakeRunCli([
      { match: 'cloud serverless regions list-regions', result: ok(REGIONS) },
      { match: 'cloud serverless projects vector list', result: ok({ items: [{ name: 'quickstart' }] }) },
      {
        match: 'cloud serverless projects vector create',
        result: (argv) => ok({ ...CREATED, savedAs: argv[argv.indexOf('--save-as') + 1] }),
      },
      mintRoute,
    ])
    const result = await runProvisionNode(fakeDeps(fakePrompter({ selects: ['default'] }), runCli), 'cloud-ctx')
    assert.equal(result.projectName, 'quickstart-2')
    assert.equal(result.projectContextName, 'quickstart-2')
  })

  it('offers the Search fallback on the 403 entitlement branch', async () => {
    const runCli = fakeRunCli([
      { match: 'cloud serverless regions list-regions', result: ok(REGIONS) },
      { match: 'cloud serverless projects vector list', result: ok({ items: [] }) },
      {
        match: 'cloud serverless projects vector create',
        result: fail('cloud_api_error', 'Cloud API error 403: {"errors":[{"code":"projects.create_project.forbidden"}]}'),
      },
      { match: 'cloud serverless projects search create', result: ok(CREATED) },
      mintRoute,
    ])
    const result = await runProvisionNode(
      fakeDeps(fakePrompter({ selects: ['default', 'search'] }), runCli),
      'cloud-ctx',
    )
    assert.equal(result.projectType, 'elasticsearch')
    const searchCreate = runCli.calls.find((c) => c.argv.join(' ').startsWith('cloud serverless projects search create'))!
    assert.ok(searchCreate.argv.includes('--optimized-for'))
    assert.ok(searchCreate.argv.includes('vector'))
    // The fallback is the same journey: funnel metadata, --wait, --save-as.
    // No branch tag — none is product-specified for the Search fallback.
    assert.match(searchCreate.argv.join(' '), /--metadata \{"tags":\{"source":"quickstart"\}\}/)
    assert.doesNotMatch(searchCreate.argv.join(' '), /"branch"/)
    assert.ok(searchCreate.argv.includes('--wait'))
    assert.ok(searchCreate.argv.includes('--save-as'))
  })

  it('retries Vector DB create after the user pastes a new API key on 403', async () => {
    await writeFile(configFile, [
      'current_context: cloud-ctx',
      'contexts:',
      '  cloud-ctx:',
      '    cloud:',
      '      url: https://api.elastic-cloud.com',
      '      auth:',
      '        api_key: old-key',
    ].join('\n') + '\n', 'utf-8')

    let vectorCreates = 0
    const runCli = fakeRunCli([
      { match: 'cloud serverless regions list-regions', result: ok(REGIONS) },
      { match: 'cloud serverless projects vector list', result: ok({ items: [] }) },
      {
        match: 'cloud serverless projects vector create',
        result: () => {
          vectorCreates++
          if (vectorCreates === 1) {
            return fail('cloud_api_error', 'Cloud API error 403: {"errors":[{"code":"projects.create_project.forbidden"}]}')
          }
          // Preserve the cloud context that just received the replacement key.
          writeFileSync(configFile, [
            'current_context: quickstart',
            'contexts:',
            '  cloud-ctx:',
            '    cloud:',
            '      url: https://api.elastic-cloud.com',
            '      auth:',
            '        api_key: replacement-key',
            '  quickstart:',
            '    elasticsearch:',
            '      url: https://es.example',
            '      auth:',
            '        username: admin',
            '        password: basic-pass',
            '    kibana:',
            '      url: https://kb.example',
            '      auth:',
            '        username: admin',
            '        password: basic-pass',
          ].join('\n') + '\n', 'utf-8')
          return ok(CREATED)
        },
      },
      mintRoute,
    ])
    const fetchFn = (async (_url: unknown, init?: { headers?: Record<string, string> }) => {
      const auth = init?.headers?.Authorization ?? ''
      const good = auth === 'ApiKey replacement-key'
      return { ok: good, status: good ? 200 : 401, text: async () => '{}' }
    }) as unknown as typeof fetch

    const result = await runProvisionNode(
      fakeDeps(
        fakePrompter({ selects: ['default', 'new_key'], passwords: ['replacement-key'] }),
        runCli,
        { fetchFn },
      ),
      'cloud-ctx',
    )
    assert.equal(result.projectType, 'vectordb')
    assert.equal(vectorCreates, 2)
    const written = parseYaml(await readFile(configFile, 'utf-8')) as {
      contexts: Record<string, { cloud?: { auth?: { api_key?: string } } }>
    }
    assert.equal(written.contexts['cloud-ctx']?.cloud?.auth?.api_key, 'replacement-key')
    assert.equal(runCli.calls.filter((c) => c.argv.join(' ').includes('projects search create')).length, 0)
  })

  it('halts with search-namespace retry guidance when the fallback create also fails', async () => {
    const runCli = fakeRunCli([
      { match: 'cloud serverless regions list-regions', result: ok(REGIONS) },
      { match: 'cloud serverless projects vector list', result: ok({ items: [] }) },
      {
        match: 'cloud serverless projects vector create',
        result: fail('cloud_api_error', 'Cloud API error 403: {"errors":[{"code":"projects.create_project.forbidden"}]}'),
      },
      { match: 'cloud serverless projects search create', result: fail('cloud_api_error', 'quota exceeded') },
    ])
    await assert.rejects(
      runProvisionNode(fakeDeps(fakePrompter({ selects: ['default', 'search'] }), runCli), 'cloud-ctx'),
      (err: unknown) => err instanceof QuickstartHalt &&
        err.code === 'provision_failed' &&
        err.nextSteps.some((s) => s.includes('projects search create')),
    )
  })

  it('retries minting on 5xx and surfaces stderr when regions fail without an envelope', async () => {
    let mintCalls = 0
    const runCli = fakeRunCli([
      { match: 'cloud serverless regions list-regions', result: ok(REGIONS) },
      { match: 'cloud serverless projects vector list', result: ok({ items: [] }) },
      {
        match: 'cloud serverless projects vector create',
        result: () => { seedSavedContextSync('quickstart'); return ok(CREATED) },
      },
      {
        match: 'es security create-api-key',
        result: () => {
          mintCalls++
          if (mintCalls < 2) return { ok: false, exitCode: 1, stderr: '', error: { code: 'transport_error', message: 'status 503', status: 503 } }
          return ok({ encoded: 'bWludGVkLWtleQ==' })
        },
      },
    ])
    const result = await runProvisionNode(fakeDeps(fakePrompter({ selects: ['default'] }), runCli), 'cloud-ctx')
    assert.equal(mintCalls, 2)
    assert.equal(result.esApiKeyMinted, true)

    const runCli2 = fakeRunCli([
      { match: 'cloud serverless regions list-regions', result: { ok: false, exitCode: 7, stderr: 'connection reset\n' } },
    ])
    await assert.rejects(
      runProvisionNode(fakeDeps(fakePrompter(), runCli2), 'cloud-ctx'),
      (err: unknown) => err instanceof QuickstartHalt &&
        err.code === 'regions_failed' &&
        err.message.includes('connection reset'),
    )
  })

  it('halts when the 403 recovery is cancelled', async () => {
    const runCli = fakeRunCli([
      { match: 'cloud serverless regions list-regions', result: ok(REGIONS) },
      { match: 'cloud serverless projects vector list', result: ok({ items: [] }) },
      {
        match: 'cloud serverless projects vector create',
        result: fail('cloud_api_error', '403 forbidden'),
      },
    ])
    await assert.rejects(
      runProvisionNode(fakeDeps(fakePrompter({ selects: ['default', 'abort'] }), runCli), 'cloud-ctx'),
      (err: unknown) => err instanceof QuickstartHalt && err.code === 'vectordb_forbidden',
    )
  })

  it('halts with console guidance when --wait times out — never a second create', async () => {
    const runCli = fakeRunCli([
      { match: 'cloud serverless regions list-regions', result: ok(REGIONS) },
      { match: 'cloud serverless projects vector list', result: ok({ items: [] }) },
      {
        match: 'cloud serverless projects vector create',
        result: fail('wait_timeout', 'Timed out waiting for project proj-1 to reach "initialized" phase'),
      },
    ])
    const prompter = fakePrompter({ selects: ['default'] })
    await assert.rejects(
      runProvisionNode(fakeDeps(prompter, runCli), 'cloud-ctx'),
      (err: unknown) => err instanceof QuickstartHalt &&
        err.code === 'provision_wait_timeout' &&
        err.message.includes('was created') &&
        err.nextSteps.some((s) => s.includes('https://cloud.elastic.co/projects')) &&
        err.nextSteps.some((s) => s.includes('config context add quickstart --es-url')) &&
        !err.nextSteps.some((s) => s.includes('create --name')),
    )
    assert.ok(prompter.log.some((l) => l.startsWith('spinner-fail:') && l.includes('did not finish initializing')))
  })

  it('halts with reset-credentials guidance when the context save fails', async () => {
    const runCli = fakeRunCli([
      { match: 'cloud serverless regions list-regions', result: ok(REGIONS) },
      { match: 'cloud serverless projects vector list', result: ok({ items: [] }) },
      {
        match: 'cloud serverless projects vector create',
        result: fail('credential_policy_error', 'Keychain write failed'),
      },
    ])
    await assert.rejects(
      runProvisionNode(fakeDeps(fakePrompter({ selects: ['default'] }), runCli), 'cloud-ctx'),
      (err: unknown) => err instanceof QuickstartHalt &&
        err.code === 'context_save_failed' &&
        err.nextSteps.some((s) => s.includes('reset-credentials')),
    )
  })

  it('surfaces the regions listing failure instead of claiming no region exists', async () => {
    const runCli = fakeRunCli([
      { match: 'cloud serverless regions list-regions', result: fail('cloud_api_error', 'Cloud API error 401: unauthorized') },
    ])
    await assert.rejects(
      runProvisionNode(fakeDeps(fakePrompter(), runCli), 'cloud-ctx'),
      (err: unknown) => err instanceof QuickstartHalt &&
        err.code === 'regions_failed' &&
        err.message.includes('401'),
    )
  })

  it('halts when no creatable region exists', async () => {
    const runCli = fakeRunCli([
      { match: 'cloud serverless regions list-regions', result: ok([]) },
    ])
    await assert.rejects(
      runProvisionNode(fakeDeps(fakePrompter(), runCli), 'cloud-ctx'),
      (err: unknown) => err instanceof QuickstartHalt && err.code === 'no_region',
    )
  })

  it('halts with retry guidance on other create failures', async () => {
    const runCli = fakeRunCli([
      { match: 'cloud serverless regions list-regions', result: ok(REGIONS) },
      { match: 'cloud serverless projects vector list', result: ok({ items: [] }) },
      { match: 'cloud serverless projects vector create', result: fail('cloud_api_error', 'quota exceeded') },
    ])
    await assert.rejects(
      runProvisionNode(fakeDeps(fakePrompter({ selects: ['default'] }), runCli), 'cloud-ctx'),
      (err: unknown) => err instanceof QuickstartHalt && err.code === 'provision_failed',
    )
  })

  it('counts existing config contexts when picking the context name', async () => {
    await writeFile(configFile, 'current_context: quickstart\ncontexts:\n  quickstart:\n    elasticsearch:\n      url: https://x\n', 'utf-8')
    const runCli = fakeRunCli([
      { match: 'cloud serverless regions list-regions', result: ok(REGIONS) },
      { match: 'cloud serverless projects vector list', result: ok({ items: [] }) },
      {
        match: 'cloud serverless projects vector create',
        result: (argv) => ok({ ...CREATED, savedAs: argv[argv.indexOf('--save-as') + 1] }),
      },
      mintRoute,
    ])
    const result = await runProvisionNode(fakeDeps(fakePrompter({ selects: ['default'] }), runCli), 'cloud-ctx')
    assert.equal(result.projectName, 'quickstart-2')
  })
})
