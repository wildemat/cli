/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Quickstart constants: names, URLs, and the demo query.
 *
 * The signup / create-project URLs (and any attribution params) are an
 * external dependency on product/marketing; the values here follow the
 * published vector-search docs quickstart and must be confirmed before GA.
 */

import type { ProjectType } from './types.ts'

/** Version stamp for the agent runbook and context-doc frontmatter. */
export const QUICKSTART_SCHEMA_VERSION = 1

/** Default serverless project (and context) name; suffixed -2, -3 on collision. */
export const DEFAULT_PROJECT_NAME = 'quickstart'

/** Cloud environment selected via ELASTIC_ENV (dev/demo switch; prod for users). */
export type CloudEnvName = 'prod' | 'qa'

/** Every environment-dependent URL: the control-plane API and console pages. */
export interface CloudEnv {
  name: CloudEnvName
  /** Cloud control-plane API for probes and newly-authored contexts. */
  apiUrl: string
  /** Trial signup page (attribution params pending product owner). */
  signupUrl: string
  /** Where an existing user mints an organization API key. */
  apiKeysUrl: string
  /** One-click console fallback for creating the project manually. */
  createProjectUrl: string
  /** Console home for serverless projects (find/manage an existing project). */
  projectsUrl: string
}

function cloudEnv (name: CloudEnvName, apiUrl: string, consoleUrl: string): CloudEnv {
  return {
    name,
    apiUrl,
    signupUrl: `${consoleUrl}/registration`,
    apiKeysUrl: `${consoleUrl}/account/keys`,
    createProjectUrl: `${consoleUrl}/projects/create/elasticsearch?use_case=vector_search`,
    projectsUrl: `${consoleUrl}/projects`,
  }
}

export const CLOUD_ENVS: Record<CloudEnvName, CloudEnv> = {
  prod: cloudEnv('prod', 'https://api.elastic-cloud.com', 'https://cloud.elastic.co'),
  qa: cloudEnv('qa', 'https://public-api.qa.cld.elstc.co', 'https://console.qa.cld.elstc.co'),
}

/**
 * Resolves ELASTIC_ENV ("prod" default, "qa"; case-insensitive) to its URL
 * set. Unknown values throw rather than silently targeting prod.
 */
export function resolveCloudEnv (env: NodeJS.ProcessEnv): CloudEnv {
  const raw = (env['ELASTIC_ENV'] ?? '').trim().toLowerCase()
  if (raw === '') return CLOUD_ENVS.prod
  const resolved = (CLOUD_ENVS as Record<string, CloudEnv>)[raw]
  if (resolved == null) {
    throw new Error(`Unknown ELASTIC_ENV "${env['ELASTIC_ENV']}" — expected "prod" or "qa" (unset defaults to prod)`)
  }
  return resolved
}

/** Sample index name — matches the docs quickstart's books dataset. */
export const SAMPLE_INDEX = 'books'

/** Lexical field; copied into the semantic field at index time. */
export const LEXICAL_FIELD = 'description'

/** semantic_text field fed by copy_to from {@link LEXICAL_FIELD}. */
export const SEMANTIC_FIELD = 'description_semantic'

/**
 * The proof-of-value query. Phrased so BM25 visibly whiffs: the sample
 * descriptions express the concept without using these words, while common
 * terms ("story") match irrelevant books.
 */
export const DEMO_QUERY = 'a story about growing up'

/**
 * Tags attached to created projects via --metadata (server-side funnel).
 * The Vector DB branch tag is product-specified; no branch value has been
 * specified for the Search fallback, so it carries source only.
 */
export const METADATA_TAGS_BY_TYPE: Record<ProjectType, Record<string, string>> = {
  vectordb: { source: 'quickstart', branch: 'cloud-vectordb' },
  elasticsearch: { source: 'quickstart' },
}

/** Region preference when defaulting (the user is shown the choice, never asked). */
export const REGION_PREFERENCE = ['aws-us-east-1', 'aws-eu-west-1', 'gcp-us-central1', 'azure-eastus2']

/** Docs links surfaced in the context doc and terminal summaries. */
export const LINKS = {
  docsQuickstart: 'https://www.elastic.co/docs/solutions/vector-database/vector-full-text-search',
  agentSkill: 'https://github.com/elastic/agent-skills/tree/main/skills/elasticsearch/elasticsearch-onboarding',
  vectorSearch: 'https://www.elastic.co/docs/solutions/search/vector',
  eisModels: 'https://www.elastic.co/docs/explore-analyze/elastic-inference/eis-supported-models#embedding-models',
  semanticText: 'https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/semantic-text',
  ranking: 'https://www.elastic.co/docs/solutions/search/ranking',
  billing: 'https://www.elastic.co/docs/deploy-manage/cloud-organization/billing/serverless-project-billing-dimensions',
  deleteProject: 'https://www.elastic.co/docs/deploy-manage/deploy/elastic-cloud/project-settings',
  referenceApp: 'https://github.com/elastic/search-reference-app',
} as const
