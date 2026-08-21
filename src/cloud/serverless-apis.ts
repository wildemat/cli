/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CloudApiDefinition } from './types.ts'

/** Lazily loaded cache of all Serverless API definitions. */
let _allServerlessApis: CloudApiDefinition[] | null = null

/**
 * Returns all Serverless API definitions, lazy-loading the per-namespace
 * modules from `@elastic/schemas` on first call.
 */
export async function loadServerlessApis (): Promise<CloudApiDefinition[]> {
  if (_allServerlessApis != null) return _allServerlessApis

  const [
    { elasticsearchProjectsDefinitions },
    { linkedCandidateProjectsDefinitions },
    { linkedProjectsDefinitions },
    { observabilityProjectsDefinitions },
    { regionsDefinitions },
    { securityProjectsDefinitions },
    { trafficFiltersDefinitions },
    { vectordbProjectsDefinitions },
  ] = await Promise.all([
    import('@elastic/schemas/serverless/tools/apis/elasticsearch-projects.js'),
    import('@elastic/schemas/serverless/tools/apis/linked-candidate-projects.js'),
    import('@elastic/schemas/serverless/tools/apis/linked-projects.js'),
    import('@elastic/schemas/serverless/tools/apis/observability-projects.js'),
    import('@elastic/schemas/serverless/tools/apis/regions.js'),
    import('@elastic/schemas/serverless/tools/apis/security-projects.js'),
    import('@elastic/schemas/serverless/tools/apis/traffic-filters.js'),
    // Hand-authored until @elastic/schemas publishes vectordb-projects (see vectordb-apis.ts)
    import('./vectordb-apis.ts'),
  ])

  _allServerlessApis = [
    ...elasticsearchProjectsDefinitions,
    ...linkedCandidateProjectsDefinitions,
    ...linkedProjectsDefinitions,
    ...observabilityProjectsDefinitions,
    ...regionsDefinitions,
    ...securityProjectsDefinitions,
    ...trafficFiltersDefinitions,
    // Hand-authored until @elastic/schemas publishes vectordb-projects (see vectordb-apis.ts)
    ...vectordbProjectsDefinitions,
  ] as CloudApiDefinition[]

  return _allServerlessApis
}
