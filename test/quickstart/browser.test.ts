/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { openBrowser, _testSetSpawn, _testSetPlatform } from '../../src/quickstart/browser.ts'

function recordSpawns () {
  const spawned: Array<{ cmd: string, args: string[] }> = []
  _testSetSpawn(((cmd: string, args: string[]) => {
    spawned.push({ cmd, args })
    const child = new EventEmitter() as EventEmitter & { unref: () => void }
    child.unref = () => {}
    return child
  }) as unknown as Parameters<typeof _testSetSpawn>[0])
  return spawned
}

describe('openBrowser', () => {
  afterEach(() => {
    _testSetSpawn(undefined)
    _testSetPlatform(undefined)
  })

  it('uses open on macOS', () => {
    _testSetPlatform('darwin')
    const spawned = recordSpawns()
    assert.equal(openBrowser('https://example.com'), true)
    assert.deepEqual(spawned[0], { cmd: 'open', args: ['https://example.com'] })
  })

  it('uses xdg-open on linux', () => {
    _testSetPlatform('linux')
    const spawned = recordSpawns()
    openBrowser('https://example.com')
    assert.equal(spawned[0]!.cmd, 'xdg-open')
  })

  it('uses cmd /c start on windows', () => {
    _testSetPlatform('win32')
    const spawned = recordSpawns()
    openBrowser('https://example.com')
    assert.deepEqual(spawned[0], { cmd: 'cmd', args: ['/c', 'start', '', 'https://example.com'] })
  })

  it('rejects non-http(s) URLs', () => {
    _testSetPlatform('darwin')
    const spawned = recordSpawns()
    assert.equal(openBrowser('file:///etc/passwd'), false)
    assert.equal(openBrowser('javascript:alert(1)'), false)
    assert.equal(spawned.length, 0)
  })

  it('returns false when the opener cannot spawn', () => {
    _testSetPlatform('darwin')
    _testSetSpawn((() => { throw new Error('ENOENT') }) as unknown as Parameters<typeof _testSetSpawn>[0])
    assert.equal(openBrowser('https://example.com'), false)
  })
})
