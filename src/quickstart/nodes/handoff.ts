/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Terminal fork: two co-equal exits — agent handoff and Kibana — offered
 * together. Agent detection is PATH + config-dir reads only. Terminal agents
 * are spawned with the `@file` prompt as an explicit argument (`shell:
 * false`); IDE-only targets get their workspace opened plus printed
 * instructions, since they cannot accept an injected prompt.
 */

import { accessSync, constants, existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import spawn from 'cross-spawn'
import { openBrowser } from '../browser.ts'
import { buildInstallPayload } from '../appinstall/contract.ts'
import { bookshopInstaller } from '../appinstall/bookshop.ts'
import type { QuickstartDeps, QuickstartState } from '../types.ts'

export interface AgentCandidate {
  id: string
  label: string
  /** Binary name looked up on PATH. */
  bin: string
  kind: 'terminal' | 'ide'
  /** Config dir (under $HOME) that corroborates an install. */
  configDir?: string
}

/** Known agents, in menu order. Multi-agent is the expected case. */
export const KNOWN_AGENTS: AgentCandidate[] = [
  { id: 'claude', label: 'Claude Code', bin: 'claude', kind: 'terminal', configDir: '.claude' },
  { id: 'codex', label: 'Codex CLI', bin: 'codex', kind: 'terminal', configDir: '.codex' },
  { id: 'cursor-agent', label: 'Cursor Agent (CLI)', bin: 'cursor-agent', kind: 'terminal', configDir: '.cursor' },
  { id: 'gemini', label: 'Gemini CLI', bin: 'gemini', kind: 'terminal', configDir: '.gemini' },
  { id: 'cursor', label: 'Cursor (IDE)', bin: 'cursor', kind: 'ide', configDir: '.cursor' },
  { id: 'code', label: 'VS Code', bin: 'code', kind: 'ide' },
]

export interface DetectedAgent extends AgentCandidate {
  /** Absolute path of the resolved binary. */
  binPath: string
}

interface DetectDeps {
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
export function whichBin (bin: string, deps: DetectDeps): string | undefined {
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

/** Finds installed agents: a PATH hit is required; config dirs corroborate. */
export function detectAgents (deps: DetectDeps): DetectedAgent[] {
  const found: DetectedAgent[] = []
  for (const agent of KNOWN_AGENTS) {
    const binPath = whichBin(agent.bin, deps)
    if (binPath != null) found.push({ ...agent, binPath })
  }
  return found
}

/** The `@file` handoff prompt — the native idiom in Claude Code/Cursor/Codex. */
export function handoffPrompt (contextDocPath: string): string {
  return `@${contextDocPath} let's continue building my search app`
}

export interface HandoffOutcome {
  choice: string
  detail?: string
}

type SpawnFn = typeof spawn
let _spawn: SpawnFn = spawn
let _openBrowser: typeof openBrowser = openBrowser

/** @internal test seams */
export function _testSetSpawn (fn: SpawnFn | undefined): void { _spawn = fn ?? spawn }
export function _testSetOpenBrowser (fn: typeof openBrowser | undefined): void { _openBrowser = fn ?? openBrowser }

/**
 * Offers the terminal fork and executes the chosen exit. Always prints the
 * context-doc path and a "what now" list first, so no choice is a dead end.
 */
export async function runHandoffNode (
  deps: QuickstartDeps,
  state: QuickstartState,
): Promise<HandoffOutcome> {
  const { prompter } = deps
  const docPath = state.contextDocPath ?? ''
  const kibanaUrl = state.endpoints?.kibana
  const ctx = state.projectContextName ?? ''

  prompter.note(
    [
      `Context doc for your agent: ${docPath}`,
      '',
      'Useful next commands:',
      `  elastic status --use-context ${ctx}`,
      `  elastic es search --index ${state.indexName ?? 'books'} --use-context ${ctx} --input-file <query.json>`,
      ...(kibanaUrl != null ? [`  Kibana: ${kibanaUrl}`] : []),
    ].join('\n'),
    'Where to go from here',
  )

  const agents = detectAgents({ env: deps.env })
  const installValue = `install:${bookshopInstaller.id}`
  const options = [
    ...agents.map((a) => ({
      value: `agent:${a.id}`,
      label: `Hand off to ${a.label}`,
      hint: a.kind === 'ide' ? 'opens the workspace; paste the prompt' : 'launches with the context doc',
    })),
    { value: installValue, label: bookshopInstaller.label, hint: bookshopInstaller.hint },
    ...(kibanaUrl != null ? [{ value: 'kibana', label: 'Open Kibana', hint: 'explore the books index in the UI' }] : []),
    { value: 'done', label: 'I\'m done — just leave the summary', hint: 'everything above stays in your scrollback' },
  ]

  const choice = await prompter.select('Keep building — how do you want to continue?', options)

  if (choice === installValue) {
    const outcome = await bookshopInstaller.install(buildInstallPayload(state, deps), deps)
    return { choice: installValue, detail: outcome.detail }
  }

  if (choice === 'kibana' && kibanaUrl != null) {
    _openBrowser(kibanaUrl)
    prompter.success(`Kibana: ${kibanaUrl}`)
    prompter.info('If a login page appears, sign in with your Elastic Cloud account (the one that owns this project).')
    return { choice: 'kibana', detail: kibanaUrl }
  }

  if (choice.startsWith('agent:')) {
    const agent = agents.find((a) => `agent:${a.id}` === choice)
    if (agent != null) {
      const prompt = handoffPrompt(docPath)
      if (agent.kind === 'terminal') {
        prompter.success(`Launching ${agent.label}…`)
        prompter.info(`Prompt: ${prompt}`)
        const exitCode = await spawnAgentAndWait(agent.binPath, [prompt])
        return { choice: agent.id, detail: `exit ${exitCode}` }
      }
      // IDE: open the current directory; prompts cannot be injected. The
      // detached child outlives this call, so a spawn failure (binary gone,
      // EACCES) surfaces as an 'error' event that would crash the process if
      // unhandled — downgrade it to manual instructions instead.
      const openFailed = (err: Error): void => {
        prompter.warn(`Could not open ${agent.label}: ${err.message}`)
        prompter.info(`Open it yourself and paste this to its agent panel:\n  ${prompt}\nThe context doc is saved at: ${docPath}`)
      }
      try {
        const child = _spawn(agent.binPath, ['.'], { stdio: 'ignore', detached: true, shell: false })
        child.on('error', openFailed)
        child.unref()
      } catch (err) {
        openFailed(err instanceof Error ? err : new Error(String(err)))
        return { choice: agent.id, detail: 'open failed' }
      }
      prompter.success(`Opened ${agent.label}. Paste this to its agent panel:`)
      prompter.info(prompt)
      return { choice: agent.id, detail: 'workspace opened' }
    }
  }

  if (agents.length === 0) {
    prompter.info(`No coding agent found on PATH. Paste this into your agent of choice:\n  ${handoffPrompt(docPath)}`)
  }
  return { choice: 'done' }
}

function spawnAgentAndWait (binPath: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    let child: ReturnType<SpawnFn>
    try {
      child = _spawn(binPath, args, { stdio: 'inherit', shell: false })
    } catch {
      resolve(1)
      return
    }
    child.on('error', () => resolve(1))
    child.on('close', (code) => resolve(code ?? 1))
  })
}
