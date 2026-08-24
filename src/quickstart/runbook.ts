/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Agent-mode projection: the whole flow emitted once as a goal-oriented
 * runbook. The agent interviews its own user and runs the listed commands
 * directly — it never re-invokes `elastic quickstart`. Only this projection
 * (stamped with `schema_version`) is a published contract; the internal tree
 * stays private and free to change.
 */

import {
  API_KEYS_URL,
  CLOUD_API_URL,
  CREATE_PROJECT_URL,
  DEMO_QUERY,
  LEXICAL_FIELD,
  LINKS,
  METADATA_TAGS,
  QUICKSTART_SCHEMA_VERSION,
  SAMPLE_INDEX,
  SEMANTIC_FIELD,
  SIGNUP_URL,
} from './constants.ts'
import { sampleIndexMappings, bm25QueryBody, semanticQueryBody } from './nodes/value.ts'
import type { JsonValue } from '../factory.ts'

/** Builds the runbook object emitted in agent mode. */
export function buildRunbook (): JsonValue {
  return {
    schema_version: QUICKSTART_SCHEMA_VERSION,
    kind: 'elastic-quickstart-runbook',
    goal: 'Take a brand-new Elastic user from nothing to a working Vector DB serverless project on Elastic Cloud with sample data indexed and a proof-of-value semantic-vs-keyword comparison, then keep building their search application.',
    for_agents: 'You are driving. Interview your user where a step says ask_user, run the commands yourself with --json, and do not re-invoke `elastic quickstart`. Discover any command\'s full input schema with `elastic <command> --help --json` or the whole surface with `elastic cli-schema`.',
    discovery: {
      command_help: 'elastic cloud --help --json',
      full_schema: 'elastic cli-schema',
    },
    steps: [
      {
        id: 'auth',
        title: 'Connect to Elastic Cloud',
        capability: 'An org API key stored in a named config context; secrets go to the OS keychain, never argv.',
        ask_user: `Do you already have an Elastic Cloud account and API key? If not, send them to ${SIGNUP_URL} then ${API_KEYS_URL}.`,
        commands: [
          `elastic config context add <name> --cloud-url ${CLOUD_API_URL} --cloud-api-key <key> --json`,
          'elastic status --json  # probes the cloud block; 401/403 means a bad key',
        ],
        notes: 'If a context with a working cloud api_key already exists, skip this step.',
      },
      {
        id: 'provision',
        title: 'Create a Vector DB serverless project',
        capability: 'Creates the project, waits for readiness, and saves endpoints + credentials as a reusable context in one command. Then mint an ES API key and keep it in the context — downstream tooling wants API keys, and the config context (OS keychain-backed) is the canonical place for credentials; reference them by running commands with --use-context, never by copying values around.',
        commands: [
          'elastic cloud serverless regions list-regions --json  # pick a region; it is permanent for the project',
          `elastic cloud serverless projects vector create --name quickstart --region-id <region> --metadata '${JSON.stringify({ tags: METADATA_TAGS })}' --wait --save-as quickstart --json`,
          'elastic es security create-api-key --name quickstart-cli --use-context quickstart --json  # then store it in the context: elastic config context edit quickstart --es-api-key <encoded>',
        ],
        on_failure: {
          '403 projects.create_project.forbidden': `The org is not entitled to Vector DB projects yet. Create a Search project optimized for vectors instead (same metadata tags — the funnel must see this cohort too): elastic cloud serverless projects search create --name quickstart --region-id <region> --optimized-for vector --metadata '${JSON.stringify({ tags: METADATA_TAGS })}' --wait --save-as quickstart --json`,
          fallback_console: CREATE_PROJECT_URL,
        },
      },
      {
        id: 'verify',
        title: 'Verify connectivity',
        capability: 'Per-service probe of Elasticsearch, Kibana, and Cloud; distinguishes auth failures from network errors.',
        commands: ['elastic status --use-context quickstart --json'],
        notes: 'Do not index against a cluster that is not answering. A fresh project can take a moment; retry briefly.',
      },
      {
        id: 'value',
        title: 'Index sample data and prove semantic search',
        capability: `semantic_text auto-embeds at ingest via the default EIS inference endpoint — no model setup, multilingual. Only the semantic field needs declaring (dynamic mapping covers the rest). On a Vector DB project the vectordb_document index mode is auto-applied; do not hand-tune HNSW or quantization.`,
        commands: [
          `elastic es indices create --index ${SAMPLE_INDEX} --mappings '${JSON.stringify(sampleIndexMappings())}' --use-context quickstart --json`,
          `elastic es helpers bulk-ingest --index ${SAMPLE_INDEX} --data-file <your-docs.ndjson> --use-context quickstart --json`,
          `elastic es search --index ${SAMPLE_INDEX} --use-context quickstart --json  # pass the query bodies below via stdin or --input-file`,
        ],
        query_bodies: {
          keyword_bm25: bm25QueryBody(DEMO_QUERY, 5),
          semantic: semanticQueryBody(DEMO_QUERY, 5),
        },
        notes: `Show the user both result lists side by side: semantic search matches meaning where keyword search needs the words "${DEMO_QUERY}" to appear. Fields: ${LEXICAL_FIELD} (text) copy_to ${SEMANTIC_FIELD} (semantic_text).`,
      },
      {
        id: 'handoff',
        title: 'Keep building',
        capability: 'Two co-equal exits: keep working here with the saved context, or open Kibana (endpoint saved in the context).',
        commands: [
          'elastic config context list --json  # contexts and their endpoints, including kibana',
          `elastic es search --index ${SAMPLE_INDEX} --use-context quickstart --json`,
        ],
        notes: 'Next: hybrid retrieval (RRF), ES|QL aggregations, or point the Elastic Bookshop reference app at the project.',
      },
    ],
    reference_app: {
      title: 'Optional: run the Elastic Bookshop demo app against the project',
      repo: LINKS.referenceApp,
      notes: 'The app runs on the user\'s machine and points at the project — nothing deploys into Elastic Cloud. Its .env uses the APP\'s variable names (not ES_URL, not ELASTIC_ES_URL). Keep the demo profile; never hybrid (21k books, slow).',
      env: {
        ELASTICSEARCH_URL: '<elasticsearch endpoint from the context>',
        ELASTIC_API_KEY: '<mint with: elastic es security create-api-key --name elastic-bookshop --use-context quickstart --json>',
        KIBANA_URL: '<kibana endpoint from the context, optional>',
        BOOKSHOP_PROFILE: 'demo',
      },
      commands: [
        'git clone https://github.com/elastic/search-reference-app.git elastic-bookshop',
        'cd elastic-bookshop && <write .env with the vars above, mode 0600>',
        'docker compose up --build --detach   # backend :8001, frontend :3000',
        'docker compose exec backend ./bookshop setup --profile demo',
        'docker compose exec backend ./bookshop search "a story about growing up"',
        'open http://localhost:3000 — self-guided tour at /guide',
      ],
      caveat: 'Beyond localhost, publicly reachable agent/inference routes can run up cost against the user\'s API key — see the repo\'s DEPLOYMENT.md.',
    },
    links: {
      docs_quickstart: LINKS.docsQuickstart,
      agent_skill: LINKS.agentSkill,
      vector_search: LINKS.vectorSearch,
      eis_models: LINKS.eisModels,
      semantic_text: LINKS.semanticText,
      billing: LINKS.billing,
      reference_app: LINKS.referenceApp,
    },
    cost_awareness: 'Serverless bills by usage. The project is disposable: elastic cloud serverless projects vector delete --id <id> --json (a Search project created via the 403 fallback lives under `projects search` — use `projects search delete`)',
  } as JsonValue
}
