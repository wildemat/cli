# `elastic quickstart` MVP — implementation notes, sharp edges, product decisions

Status: MVP implemented on `feat/quickstart-mvp`, validated end-to-end against the QA
Cloud org (`console.qa.cld.elstc.co`). Companion to the quickstart PRD.

## What shipped

PRD build steps 1–13: `vectordb` project type wiring, `quickstart` scaffold, mode
detection, subprocess executor, `@clack/prompts` layer, tree + interpreter + runbook
projection, auth/provision/verify/value/context-doc/handoff nodes, and the throwaway
Bookshop installer (`src/quickstart/refapp/`, with its deletion contract in the header).

## Bugs found in existing code (fixed on this branch)

1. **Keychain writes hung at any real terminal.** `security add-generic-password -w`
   prompts on `/dev/tty` when a controlling TTY exists (ignoring piped stdin), so every
   interactive `--save-as` timed out after 5s; without a TTY it demands the password
   twice and could silently store an **empty string**. Fixed with a detached spawn
   (no controlling TTY) answering the stdin prompt twice. Existing tests mocked
   `execSync`, so this was never caught — worth a functional test on a real macOS runner.
2. **`elastic status` always failed against serverless projects.** The Elasticsearch
   probe used `_cluster/health`, which serverless answers with `410 Gone` (no
   cluster-level APIs). Fixed with a fallback probe of `GET /`.

## Blocked / external dependencies (unchanged from PRD, verified)

- **`@elastic/schemas` still does not publish `vectordb-projects`** (checked 0.7.0, the
  latest). Shipped hand-authored definitions in `src/cloud/vectordb-apis.ts` validated
  against the live QA API (`CreateVectorDBProjectRequest`), marked for deletion when the
  module lands. Launch is 2026-09-09; this remains the top follow-up with schemas owners.
- **Signup / API-key URLs** are placeholders from the docs PR
  (`cloud.elastic.co/registration`, `/account/keys`, create-link with
  `use_case=vector_search`) in `src/quickstart/constants.ts`. Attribution params need a
  product owner.
- **Sample dataset**: 93 hand-curated book records in `src/quickstart/data/books.ts`
  (docs-quickstart-compatible fields: `title`, `description` → semantic, `release_year`).
  Descriptions are deliberately engineered so "a story about growing up" whiffs on BM25
  (top hits: Lab Girl, The Botany of Desire) and lands semantically (David Copperfield,
  Anne of Green Gables, To Kill a Mockingbird). Content/hosting still needs an owner;
  the loader indirection (`data/dataset.ts`) makes replacement one-file.

## Verified against QA (2026-08-21)

- `metadata: {tags: {...}}` **is** the accepted create-body shape (tag values must match
  `^[a-z0-9][a-z0-9_-]*$`); `--metadata '{"tags":{"source":"quickstart","branch":"cloud-vectordb"}}'`
  works and is the whole measurement plan.
- QA org **is** entitled to Vector DB projects; the 403 branch is implemented + unit
  tested but could not be exercised live.
- EIS default inference on a Vector DB project embeds 93 docs in <2s at ingest; the
  semantic query type works against `semantic_text` with zero configuration.
- A fresh project's ES endpoint can serve 410 for ~10–60s after `--wait` returns
  `initialized`; the verify node retries (4 × 10s) before failing.

## Product decisions made unilaterally (flag if wrong)

1. **BM25 needs a lexical field**, so the index maps `description` (text) with `copy_to`
   → `description_semantic` (semantic_text), rather than only the semantic field as the
   docs tutorial does. Without this the BM25-vs-semantic comparison is impossible.
2. **First-prompt timeout is 60s.** PRD specifies the mechanism, not the number. Fires
   only if the user's first interaction (usually the terminal fork, since v1 asks
   nothing before provisioning) sits idle; emits the runbook and exits 0.
3. **Comparison table is plain padded text inside the clack note frame**, not
   cli-table3 — nested borders read worse. Swap is trivial if design disagrees.
4. **Context naming:** the cloud API key lives in context `elastic-cloud`; the project
   context is named after the project (`quickstart`, `quickstart-2`, …). Collisions are
   avoided against both existing projects and existing context names.
5. **403 fallback creates a Search project with `--optimized-for vector`** after an
   explicit confirm, per PRD; it is labelled Search, never "Vector DB" (one-way-door
   guard).
6. **Agent-mode runbook is emitted even without `--json`** when no TTY is present, as
   pretty-printed JSON. Agents get identical content either way.
7. **Agent detection requires a PATH hit** (config dirs alone can't be spawned).
   Detected here: claude, codex, cursor-agent, gemini, cursor, code.
8. **Verify retries transient failures 4×10s** — not in the PRD, but required in
   practice (see the 410 warm-up above).

## Known sharp edges (not fixed, by scope)

- **`--save-as` stores basic auth**, so the context doc tells agents to mint an API key
  for real apps; the refapp installer already mints one (`es security create-api-key`).
- **Re-run creates a new project** (PRD explicitly excludes re-run detection). Cost
  guard: name suffixing + delete instructions in the context doc.
- **The handoff prompt-as-argv convention** (`claude "<prompt>"`) is verified for
  Claude Code; codex/gemini arg conventions are assumed and cheap to adjust.
- **Windows**: mode detection, paths, and browser opening are guarded, but no Windows
  E2E was run; the keychain fix is macOS-specific (Windows/Linux stores untouched).
- **Trial orgs may cap concurrent projects**; quickstart doesn't check quota before
  creating. The create error surfaces loudly with a retry command.

## E2E simulation harness

`expect`-driven PTY runs (see scratchpad scripts in the session): full happy path with
"done", first-prompt-timeout → runbook fallback, `--json` and piped agent modes, and a
PATH-shimmed `claude` handoff. tmux is unsuitable on macOS (its detached server loses
the user's keychain security session — keychain writes fail with ETIMEDOUT).
