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

/** Cloud control-plane API for newly-authored contexts. */
export const CLOUD_API_URL = 'https://api.elastic-cloud.com'

/** Trial signup page (attribution params pending product owner). */
export const SIGNUP_URL = 'https://cloud.elastic.co/registration'

/** Where an existing user mints an organization API key. */
export const API_KEYS_URL = 'https://cloud.elastic.co/account/keys'

/** One-click console fallback for creating the project manually. */
export const CREATE_PROJECT_URL = 'https://cloud.elastic.co/projects/create/elasticsearch?use_case=vector_search'

/** Console home for serverless projects (find/manage an existing project). */
export const CLOUD_PROJECTS_URL = 'https://cloud.elastic.co/projects'

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
