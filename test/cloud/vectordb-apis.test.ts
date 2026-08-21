/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Command } from 'commander'
import { vectordbProjectsDefinitions } from '../../src/cloud/vectordb-apis.ts'
import { validateCloudApiDefinition } from '../../src/cloud/types.ts'
import { registerCloudCommands } from '../../src/cloud/register.ts'
import { loadServerlessApis } from '../../src/cloud/serverless-apis.ts'
import { isCreateProjectCommand } from '../../src/cloud/handler.ts'
import { isCredentialCommand, isResetCredentialsCommand } from '../../src/cloud/credentials.ts'

describe('vectordb project definitions', () => {
  it('every definition passes CloudApiDefinition validation', () => {
    for (const def of vectordbProjectsDefinitions) {
      validateCloudApiDefinition(def)
    }
  })

  it('all definitions target the vectordb path and namespace', () => {
    for (const def of vectordbProjectsDefinitions) {
      assert.equal(def.namespace, 'vectordb-projects')
      assert.ok(def.path.startsWith('/api/v1/serverless/projects/vectordb'), def.path)
    }
  })

  it('create accepts name, region_id, alias, metadata, and search_lake', () => {
    const create = vectordbProjectsDefinitions.find((d) => d.name === 'create-vectordb-project')
    assert.ok(create)
    const props = Object.keys((create.input as { properties: Record<string, unknown> }).properties)
    assert.deepEqual(props.sort(), ['alias', 'metadata', 'name', 'region_id', 'search_lake'])
    assert.deepEqual((create.input as { required: string[] }).required, ['name', 'region_id'])
  })

  it('is included in the merged serverless API registry', async () => {
    const all = await loadServerlessApis()
    const names = all.map((d) => d.name)
    assert.ok(names.includes('create-vectordb-project'))
    assert.ok(names.includes('list-vectordb-projects'))
  })

  it('registers as `cloud serverless projects vector` with shortened action names', async () => {
    const group = await registerCloudCommands()
    const serverless = group.commands.find((c) => c.name() === 'serverless') as Command
    const projects = serverless.commands.find((c) => c.name() === 'projects') as Command
    const vector = projects.commands.find((c) => c.name() === 'vector') as Command
    assert.ok(vector, 'vector project group must exist')
    const actions = vector.commands.map((c) => c.name())
    assert.deepEqual(
      actions.sort(),
      ['create', 'delete', 'get', 'get-status', 'list', 'reset-credentials'],
    )
  })

  it('create is wired into the --wait poll and --save-as credential policy', async () => {
    assert.ok(isCreateProjectCommand('create-vectordb-project'), '--wait must poll for vectordb creates')
    assert.ok(isCredentialCommand('create-vectordb-project'))
    assert.ok(isCredentialCommand('reset-vectordb-project-credentials'))
    assert.ok(isResetCredentialsCommand('reset-vectordb-project-credentials'))

    const group = await registerCloudCommands()
    const serverless = group.commands.find((c) => c.name() === 'serverless') as Command
    const projects = serverless.commands.find((c) => c.name() === 'projects') as Command
    const vector = projects.commands.find((c) => c.name() === 'vector') as Command
    const create = vector.commands.find((c) => c.name() === 'create') as Command
    const optionNames = create.options.map((o) => o.long)
    assert.ok(optionNames.includes('--wait'), 'create must expose --wait')
    assert.ok(optionNames.includes('--save-as'), 'create must expose --save-as')
    assert.ok(optionNames.includes('--credentials-file'), 'create must expose --credentials-file')
  })
})
