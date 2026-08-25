# `elastic quickstart` MVP — implementation notes, sharp edges, product decisions

Status: MVP implemented on `feat/quickstart-mvp`, validated end-to-end against the QA
Cloud org (`console.qa.cld.elstc.co`). Companion to the quickstart PRD.

## What shipped

PRD build steps 1–13: `vectordb` project type wiring, `quickstart` scaffold, mode
detection, subprocess executor, `@clack/prompts` layer, tree + interpreter + runbook
projection, auth/provision/verify/value/context-doc/handoff nodes, and the sample-app
install seam (`src/quickstart/appinstall/` — a persistent neutral-payload contract plus
a swappable Bookshop installer; see direction change 4 for its history).

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

## Direction changes confirmed by product (2026-08-21)

1. **First-prompt timeout dropped.** TTY detection alone decides the mode; prompts wait
   indefinitely. (The timeout could only ever fire after provisioning — zero questions
   before provisioning guarantees the first prompt is post-create — so the fallback
   runbook risked double-provisioning by the driving agent.)
2. **No re-run detection**, reaffirmed. Each run creates a new suffixed project.
3. **API key minted at provision time.** After `--save-as`, quickstart mints an ES API
   key (`es security create-api-key`, subprocess stdout only — never argv) and rewrites
   the context's `elasticsearch.auth` to `api_key` via the in-process writer + keychain.
   The handoff doc never contains the key; agents reference credentials by running
   commands with `--use-context`. Kibana keeps the basic-auth pair. Mint failure warns
   and continues on basic auth. Apps should mint their own dedicated keys.
4. **In-band reference-app installer removed, then reinstated as a seam** (`208499b`).
   The throwaway `refapp/` installer's deletion contract was executed; guidance-only
   handoff survived one iteration, then the installer returned as two sides of one
   seam: `appinstall/contract.ts` (persistent — neutral payload of endpoints, names,
   demo query, and a `mintDedicatedKey` capability that is the *only* credential an
   installer can obtain; context/org credentials never cross the boundary) and
   `appinstall/bookshop.ts` (swappable — repo URL, env-var names, run commands, with
   a header swap contract and a single import in `nodes/handoff.ts`). It clones and
   seeds `.env` (0600) but never runs the app; failures downgrade to manual
   instructions. When the generalised third-party contract lands (PRD fast follow
   #16), the payload gains a `schema_version` and becomes the published surface.
5. **Environment forking via `ELASTIC_ENV`** (2026-08-25, user-directed; supersedes
   the earlier "no environment forking" decision). `resolveCloudEnv` in
   `quickstart/constants.ts` maps `ELASTIC_ENV` (unset/`prod` default, `qa`;
   case-insensitive; unknown → hard `bad_env` error, never a silent prod fallback)
   to a `CloudEnv` URL set (API + console pages) carried on `QuickstartDeps`.
   The paste path probes and persists the selected env's API; runbook and console
   links follow; auth detection only reuses contexts whose `cloud.url` matches the
   selected env; off-prod interactive runs print a targeting banner. QA console
   page paths are derived from the prod paths (base verified, paths not).

## User-directed UX changes (2026-08-25, live-testing round)

1. **Auth interview**: role guidance in the connect note (pick Organization owner
   on your own account); a paste-vs-local select after the browser opens — the
   local branch prints the `start-local` one-liner and halts (`local_breakout`);
   key-probe failures print a generic message naming the failed check
   (`GET <api>/api/v1/user`); after the key saves, a one-liner explains contexts
   (`elastic config context list`).
2. **Region is now asked** (supersedes "defaulted and displayed, never asked"):
   default guessed from the machine's IANA timezone (the Cloud public API has no
   geolocation endpoint; `regionFragmentsForTimezone`), with a "Choose my own"
   escape listing every creatable region. `deps.timezone` keeps tests
   deterministic.
3. **Create spinner**: carries a "~2 minutes" estimate and a 1-second local
   ticker (`--wait` poll lines only arrive every ~10s).
4. **Value moment is stepwise**: the real commands print first, each phase runs
   behind a "Press Enter" confirm (decline → `value_skipped` halt carrying the
   commands), and progress renders as discrete checkmarks.
5. **Handoff menu restructured**: sample-app install first ("Install the
   complete sample app to showcase Elastic features"), then "Continue building
   with my agent/IDE" (submenu of detected agents + "None of these — copy the
   context document path", best-effort pbcopy), Kibana, done.
6. **Install seam credential flow inverted**: quickstart mints the per-app key
   *before* invoking the installer (spinner, failure surfaced with the exact
   failing command, retry loop, or continue keyless); the payload carries
   `dedicatedApiKey` instead of a mint capability. Installer directory prompt is
   a select (full-path home default `~/elastic-bookshop`, suffixed; or custom
   path with ~ expansion, re-asked while invalid); step output is paced
   (`STEP_PAUSE_MS`); the closing note links the app repo instead of
   indices/cost jargon.
7. **Color highlighting** (`hl` in prompts.ts): commands cyan, values yellow,
   URLs underlined — TTY-gated so agent mode and tests see plain text.

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
  for real apps; the Bookshop installer already mints one via the payload's
  `mintDedicatedKey` (`es security create-api-key`).
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
