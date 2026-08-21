/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Hand-authored API definitions for the `vectordb` serverless project type.
 *
 * `@elastic/schemas` does not yet publish
 * `serverless/tools/apis/vectordb-projects.js` (checked at ^0.7.0). The Cloud
 * control plane already serves `/api/v1/serverless/projects/vectordb`, so
 * these definitions are authored here against the live API contract
 * (`CreateVectorDBProjectRequest`) and mirror the upstream module shape
 * exactly. Delete this file and switch `serverless-apis.ts` to the upstream
 * import once the schemas package ships the module.
 */

import type { CloudApiDefinition } from './types.ts'

const BASE_PATH = '/api/v1/serverless/projects/vectordb'

const idProperty = {
  type: 'string',
  description: 'The ID of the project',
  'x-found-in': 'path',
} as const

const createVectordbProjectSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'createVectordbProject',
  'x-api': {
    id: 'vectordb-projects.create-vectordb-project',
    name: 'create-vectordb-project',
    namespace: 'vectordb-projects',
  },
  'x-method': 'POST',
  'x-path': BASE_PATH,
  'x-destructive': true,
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: 'Descriptive name for the project',
      'x-found-in': 'body',
    },
    alias: {
      type: 'string',
      description: 'Custom domain label; also used in generated endpoint URLs',
      'x-found-in': 'body',
    },
    region_id: {
      type: 'string',
      description: 'Unique identifier of the region to create the project in',
      'x-found-in': 'body',
    },
    metadata: {
      type: 'object',
      description: 'Project metadata: {"tags": {"key": "value"}} (tag values: lowercase alphanumerics, "-", "_")',
      properties: {
        tags: {
          type: 'object',
          additionalProperties: { type: 'string' },
        },
      },
      'x-found-in': 'body',
    },
    search_lake: {
      type: 'object',
      description: 'Search lake sizing (search_power, boost_window)',
      properties: {
        search_power: { type: 'number' },
        boost_window: { type: 'number' },
      },
      'x-found-in': 'body',
    },
  },
  required: ['name', 'region_id'],
} as const

const listVectordbProjectsSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'listVectordbProjects',
  'x-api': {
    id: 'vectordb-projects.list-vectordb-projects',
    name: 'list-vectordb-projects',
    namespace: 'vectordb-projects',
  },
  'x-method': 'GET',
  'x-path': BASE_PATH,
  'x-destructive': false,
  type: 'object',
  properties: {},
} as const

const getVectordbProjectSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'getVectordbProject',
  'x-api': {
    id: 'vectordb-projects.get-vectordb-project',
    name: 'get-vectordb-project',
    namespace: 'vectordb-projects',
  },
  'x-method': 'GET',
  'x-path': `${BASE_PATH}/{id}`,
  'x-destructive': false,
  type: 'object',
  properties: { id: idProperty },
  required: ['id'],
} as const

const deleteVectordbProjectSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'deleteVectordbProject',
  'x-api': {
    id: 'vectordb-projects.delete-vectordb-project',
    name: 'delete-vectordb-project',
    namespace: 'vectordb-projects',
  },
  'x-method': 'DELETE',
  'x-path': `${BASE_PATH}/{id}`,
  'x-destructive': true,
  type: 'object',
  properties: { id: idProperty },
  required: ['id'],
} as const

const resetVectordbProjectCredentialsSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'resetVectordbProjectCredentials',
  'x-api': {
    id: 'vectordb-projects.reset-vectordb-project-credentials',
    name: 'reset-vectordb-project-credentials',
    namespace: 'vectordb-projects',
  },
  'x-method': 'POST',
  'x-path': `${BASE_PATH}/{id}/_reset-credentials`,
  'x-destructive': true,
  type: 'object',
  properties: { id: idProperty },
  required: ['id'],
} as const

const getVectordbProjectStatusSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'getVectordbProjectStatus',
  'x-api': {
    id: 'vectordb-projects.get-vectordb-project-status',
    name: 'get-vectordb-project-status',
    namespace: 'vectordb-projects',
  },
  'x-method': 'GET',
  'x-path': `${BASE_PATH}/{id}/status`,
  'x-destructive': false,
  type: 'object',
  properties: { id: idProperty },
  required: ['id'],
} as const

export const vectordbProjectsDefinitions = [
  {
    name: 'list-vectordb-projects',
    namespace: 'vectordb-projects',
    description: 'Get Vector DB projects',
    method: 'GET',
    path: BASE_PATH,
    destructive: false,
    input: listVectordbProjectsSchema,
  },
  {
    name: 'create-vectordb-project',
    namespace: 'vectordb-projects',
    description: 'Create a Vector DB project',
    method: 'POST',
    path: BASE_PATH,
    destructive: true,
    input: createVectordbProjectSchema,
  },
  {
    name: 'get-vectordb-project',
    namespace: 'vectordb-projects',
    description: 'Get a Vector DB project',
    method: 'GET',
    path: `${BASE_PATH}/{id}`,
    destructive: false,
    input: getVectordbProjectSchema,
  },
  {
    name: 'delete-vectordb-project',
    namespace: 'vectordb-projects',
    description: 'Delete a Vector DB project',
    method: 'DELETE',
    path: `${BASE_PATH}/{id}`,
    destructive: true,
    input: deleteVectordbProjectSchema,
  },
  {
    name: 'reset-vectordb-project-credentials',
    namespace: 'vectordb-projects',
    description: 'Reset the project credentials',
    method: 'POST',
    path: `${BASE_PATH}/{id}/_reset-credentials`,
    destructive: true,
    input: resetVectordbProjectCredentialsSchema,
  },
  {
    name: 'get-vectordb-project-status',
    namespace: 'vectordb-projects',
    description: 'Get the status of a Vector DB project',
    method: 'GET',
    path: `${BASE_PATH}/{id}/status`,
    destructive: false,
    input: getVectordbProjectStatusSchema,
  },
] as unknown as CloudApiDefinition[]
