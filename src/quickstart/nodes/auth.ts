/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Auth node: detect first, ask second.
 *
 * If the active context already carries a working Cloud API key, the whole
 * node is skipped. Otherwise the browser is pointed at signup / API-key pages
 * (URLs always printed as text too), the key is pasted masked, probed, and
 * written through the in-process config writer + OS secret store — the key
 * never appears in argv or on stdout.
 *
 * This node is deliberately self-contained and swappable: OAuth/PKCE replaces
 * exactly this module later, so no auth assumptions may leak into other nodes.
 */

import { loadConfig, resolveConfigPathForWrite } from '../../config/loader.ts'
import { checkCloud } from '../../status/checks.ts'
import {
  readRawConfig,
  writeConfig,
  upsertContext,
  hasInlineSecrets,
} from '../../config/writer.ts'
import { getSecretStore } from '../../config/secret-store.ts'
import { hl } from '../prompts.ts'
import { QuickstartHalt, type QuickstartDeps } from '../types.ts'

const KEYCHAIN_SERVICE = 'elastic-cli'
const DEFAULT_CLOUD_CONTEXT = 'elastic-cloud'

export interface AuthResult {
  /** Context whose `cloud` block subsequent nodes should use. */
  cloudContextName: string
  /** True when an existing working credential was detected and reused. */
  reused: boolean
}

/**
 * Detects a working Cloud credential in the active context, or interviews
 * the user for one and persists it.
 */
export async function runAuthNode (deps: QuickstartDeps): Promise<AuthResult> {
  const detected = await detectExistingCloudContext(deps)
  if (detected != null) {
    deps.prompter.success(`Using Cloud credentials from context "${detected}"`)
    return { cloudContextName: detected, reused: true }
  }

  const { signupUrl, apiKeysUrl, apiUrl } = deps.cloudEnv
  deps.prompter.note(
    [
      'You need an Elastic Cloud account and an organization API key.',
      '',
      `  Sign up (free trial):  ${hl.url(signupUrl)}`,
      `  Create an API key:     ${hl.url(apiKeysUrl)}`,
      '',
      `When the key form asks you to assign roles, pick ${hl.val('Organization owner')} —`,
      'right for a fresh account of your own. On a shared organization you may',
      'want a narrower role; if so, you\'ll know which one fits.',
    ].join('\n'),
    'Connect to Elastic Cloud',
  )
  const opened = deps.openBrowser(apiKeysUrl)
  if (opened) deps.prompter.info('Opened your browser (links above if it did not appear).')

  const start = await deps.prompter.select('How do you want to start?', [
    { value: 'paste', label: 'Paste my Elastic Cloud API key', hint: 'the browser tab above has the key page' },
    { value: 'local', label: 'Run Elasticsearch locally instead', hint: 'no cloud account needed' },
  ])
  if (start === 'local') {
    deps.prompter.note(
      [
        'One command (requires Docker):',
        '',
        `  ${hl.cmd('curl -fsSL https://elastic.co/start-local | sh')}`,
        '',
        'That starts Elasticsearch and Kibana on localhost (ports 9200/5601)',
        'with credentials printed at the end.',
      ].join('\n'),
      'Run Elasticsearch locally',
    )
    throw new QuickstartHalt(
      'local_breakout',
      'Quickstart provisions Elastic Cloud projects; the command above starts a local Elasticsearch instead.',
      [
        'Run: curl -fsSL https://elastic.co/start-local | sh',
        'When you want a cloud project later, re-run: elastic quickstart',
      ],
    )
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    const key = (await deps.prompter.password('Paste your Elastic Cloud API key')).trim()
    if (key.length === 0) continue
    const probe = await checkCloud({ url: apiUrl, auth: { api_key: key } }, deps.fetchFn)
    if (probe.ok) {
      const contextName = await persistCloudKey(key, apiUrl)
      deps.prompter.success(`API key verified and saved to context "${contextName}" (secret stored securely)`)
      deps.prompter.info(`New to contexts? They're named connection profiles — see yours: ${hl.cmd('elastic config context list')}`)
      return { cloudContextName: contextName, reused: false }
    }
    deps.prompter.warn(`That key did not work — this check failed: GET ${apiUrl}/api/v1/user.${attempt === 1 ? ' One more try.' : ''}`)
  }

  throw new QuickstartHalt(
    'auth_failed',
    'Could not verify an Elastic Cloud API key.',
    [
      `Create a key at ${apiKeysUrl}`,
      `Then configure it manually: elastic config context add elastic-cloud --cloud-url ${apiUrl} --cloud-api-key <key>`,
      'Re-run: elastic quickstart',
    ],
  )
}

/** Trailing-slash/case-insensitive URL equality for cloud-block matching. */
function sameCloudUrl (a: string | undefined, b: string): boolean {
  if (a == null) return false
  const norm = (u: string): string => u.trim().replace(/\/+$/, '').toLowerCase()
  return norm(a) === norm(b)
}

/**
 * Returns the name of a context whose cloud block answers an authenticated
 * probe, or undefined. Checks the active context first, then any other
 * context that has a cloud block. Only contexts pointing at the selected
 * environment's API count — a prod context must never satisfy an
 * ELASTIC_ENV=qa run (or vice versa).
 */
async function detectExistingCloudContext (deps: QuickstartDeps): Promise<string | undefined> {
  const active = await loadConfig()
  const activeName = active.ok ? active.contextName : undefined

  const candidates: string[] = []
  if (active.ok && active.value.context.cloud != null) candidates.push(active.contextName)

  // Other contexts with a cloud block; raw scan only — secrets resolve per-context below.
  try {
    const raw = await readRawConfig(await resolveConfigPathForWrite())
    for (const [name, ctx] of Object.entries(raw.contexts)) {
      if (name === activeName) continue
      if (ctx != null && typeof ctx === 'object' && (ctx as Record<string, unknown>).cloud != null) {
        candidates.push(name)
      }
    }
  } catch {
    // unreadable config — treat as no existing credentials
  }

  for (const name of candidates) {
    const resolved = name === activeName && active.ok
      ? active
      : await loadConfig({ contextName: name, refresh: true })
    if (!resolved.ok) continue
    const cloud = resolved.value.context.cloud
    if (cloud?.auth == null || !('api_key' in cloud.auth)) continue
    if (!sameCloudUrl(cloud.url, deps.cloudEnv.apiUrl)) continue
    const probe = await checkCloud(cloud, deps.fetchFn)
    if (probe.ok) return name
  }
  return undefined
}

/**
 * Writes the pasted key into the config through the secret store; the YAML
 * holds a `$(keychain:...)` expression when an OS store is available, the
 * plain value (0600 file) otherwise.
 */
async function persistCloudKey (apiKey: string, cloudApiUrl: string): Promise<string> {
  const contextName = DEFAULT_CLOUD_CONTEXT
  const configPath = await resolveConfigPathForWrite()
  const config = await readRawConfig(configPath)

  const store = await getSecretStore()
  const storeAvailable = await store.isAvailable()
  let keyValue: string
  if (storeAvailable) {
    const account = `${contextName}:cloud.auth.api_key`
    await store.put(KEYCHAIN_SERVICE, account, apiKey)
    keyValue = store.resolverExpr(KEYCHAIN_SERVICE, account)
  } else {
    keyValue = apiKey
  }

  // Merge, not replace: a context of the same name may carry elasticsearch/
  // kibana blocks (and keychain references) that must survive a re-auth.
  let next = upsertContext(config, contextName, {
    ...config.contexts[contextName],
    cloud: { url: cloudApiUrl, auth: { api_key: keyValue } },
  })
  if (next.current_context === '') {
    next = { ...next, current_context: contextName }
  }
  await writeConfig(configPath, next, { restrictPermissions: hasInlineSecrets(next) })
  return contextName
}
