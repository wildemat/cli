# Quickstart (`src/quickstart`)

One flow model, two projections: interactive walk and agent runbook. The tree is the source of truth; the runbook is **translated at runtime** from nodes that opt in via an `agent` block.

## Roles

| Artifact | Audience | Role |
|---|---|---|
| [`tree.ts`](./tree.ts) | Interactive TTY + agent metadata | **Source of truth** for journey order, required input, `run`, and optional `agent` fields |
| [`runbook.ts`](./runbook.ts) | Agents (`--json` / non-TTY) | `translate(flow, env)` → published skill JSON (`schema_version`). Envelope only (goal, links, `reference_app`) |
| [`nodes/*`](./nodes/) | Interactive | Executable implementations behind `run` |
| [`constants.ts`](./constants.ts) | Both | Shared demo query, index name, links, env URLs, schema version |

Mode selection: [`mode.ts`](./mode.ts) — `--json` or missing stdin/stderr TTY → `buildRunbook()`; otherwise `walkFlow()`.

## Tenets

1. **`tree.ts` owns the journey.** Step order, required inputs, and outcomes live on `FlowNode`. Change the tree first.
2. **Opt into the runbook with `agent`.** If a node has no `agent` key, `translate()` skips it. Interactive-only today: `context-doc` (agents already hold conversation context — do not emit a context-doc step).
3. **`agent` holds agent-specific data only.** `capability`, `ask_user`, `commands`, `on_failure`, `notes`, optional `title` override, and `extras` (e.g. `query_bodies`). Use `AgentField<T>` (`T | ((env: CloudEnv) => T)`) when a field needs signup/API URLs.
4. **Share facts, not UI.** Demo query, mappings, query bodies, metadata tags come from shared helpers — do not fork copies for agents.
5. **Runbook is the published contract.** Bump `QUICKSTART_SCHEMA_VERSION` when step ids, required commands, or failure semantics change for agents. Pure interactive chrome does not require a bump.
6. **Agents never re-invoke `elastic quickstart` to execute the journey.** They follow the emitted runbook and call the listed commands with `--json`.

## Limits

### Interactive (`run`)

- May prompt, confirm, print tables, open browsers, install the reference app, write `context.md`.
- Must not leak `run` / internal `kind` into the runbook JSON.

### Agent (`agent` + `translate`)

- Goal-oriented and command-complete enough to finish without calling `elastic quickstart` again.
- Must not generate or require a context markdown file.
- Must not re-encode interactive chrome (Enter gates, score legends, menus).
- Envelope `reference_app` / `links` may be richer than handoff UI; keep commands aligned with what interactive handoff actually does.

## When you change the journey

1. Edit `buildFlow()` / node runners first.
2. **Journey step** → add or update `agent: { … }` on that node (same `id`).
3. **Interactive-only** → omit `agent` (and note why in a short comment if non-obvious).
4. Resolve CloudEnv-dependent strings with `(env) => …`.
5. Put step-local JSON (query bodies, etc.) in `agent.extras`.
6. Extend tests in `test/quickstart/runbook.test.ts` and `tree.test.ts`.
7. Bump schema version only when the agent contract would break.

### Current opt-in map

| Tree id | `agent`? | Why |
|---|---|---|
| `auth` | yes | Credentials / context |
| `provision` | yes | Create project + API key path |
| `verify` | yes | Do not index a dead cluster |
| `value` | yes | Index + BM25 vs semantic proof |
| `context-doc` | **no** | Agent already has conversation context |
| `handoff` | yes | Next actions; `reference_app` is envelope-level |

## Do not

- Hand-maintain a parallel step list in `runbook.ts` (envelope + `translate` only).
- Add `agent` on `context-doc` or instruct writing `context.md` for agents.
- Let demo query / mappings / 403 fallback diverge from what interactive nodes use.
- Document `elastic quickstart` as a step inside the runbook.
