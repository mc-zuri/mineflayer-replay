/* eslint-env mocha */
'use strict'
// The baseline refuses a run during which the code it replays changed (its children would mix two builds).
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { codeStamp } = require('../../lib/codeStamp')

describe('code stamp', function () {
  let dir
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-stamp-'))
    fs.mkdirSync(path.join(dir, 'dist'))
    fs.writeFileSync(path.join(dir, 'dist', 'index.js'), 'module.exports = 1\n')
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('stays the same while the code does', function () {
    assert.strictEqual(codeStamp([dir]), codeStamp([dir]))
  })

  it('changes when a file is rebuilt', function () {
    const before = codeStamp([dir])
    const file = path.join(dir, 'dist', 'index.js')
    fs.writeFileSync(file, 'module.exports = 2\n')
    fs.utimesSync(file, new Date(), new Date(Date.now() + 1000))
    assert.notStrictEqual(codeStamp([dir]), before)
  })

  it('changes when a file appears or goes', function () {
    const before = codeStamp([dir])
    fs.writeFileSync(path.join(dir, 'dist', 'extra.js'), '')
    const added = codeStamp([dir])
    assert.notStrictEqual(added, before)
    fs.rmSync(path.join(dir, 'dist', 'extra.js'))
    assert.strictEqual(codeStamp([dir]), before)
  })

  it('stamps the code the replays load by default', function () {
    assert.match(codeStamp(), /^[0-9a-f]{40}$/)
  })
})
