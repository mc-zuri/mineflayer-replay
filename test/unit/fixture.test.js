/* eslint-env mocha */
'use strict'
const assert = require('assert')
const fixtures = require('../../lib/fixture')

const rec = {
  name: 'x_sample',
  start: { pos: [0, 64, 0], vel: [0, 0, 0], yaw: 0.1, onGround: true, netState: { lastYaw: 0.1, entityId: 1 } },
  ticks: [
    { t: 1, in: { forward: true, yaw: 0.1, pitch: 0 }, pos: [0, 64, 0.1], clientPackets: [{ type: 'p', bytes: '1d00' }] },
    { t: 2, in: { forward: true, yaw: 0.1, pitch: 0 }, vel: [0, 0, -0] },
    { t: 3, in: { yaw: 0.1, pitch: 0 }, onGround: false }
  ]
}

describe('fixture', function () {
  it('rounds the start floats back to Java floats', function () {
    const start = fixtures.start(rec)
    assert.strictEqual(start.yaw, Math.fround(0.1))
    assert.strictEqual(start.netState.lastYaw, Math.fround(0.1))
    assert.notStrictEqual(rec.start.yaw, start.yaw, 'the recording itself is left as read')
  })

  it('fills rows forward from the start and the rows before', function () {
    const rows = fixtures.expand(rec)
    assert.deepStrictEqual(rows.map(r => r.pos), [[0, 64, 0.1], [0, 64, 0.1], [0, 64, 0.1]])
    assert.deepStrictEqual(rows.map(r => r.onGround), [true, true, false])
    assert.strictEqual(rows[2].in.forward, undefined, 'the input is the row\'s own')
  })

  it('keeps events to their own row', function () {
    const rows = fixtures.expand(rec)
    assert.deepStrictEqual(rows[0].events.clientPackets, [{ type: 'p', bytes: '1d00' }])
    assert.deepStrictEqual(rows[1].events, {})
    assert.strictEqual(rows[1].clientPackets, undefined)
  })

  it('keeps a recorded -0', function () {
    assert.ok(Object.is(fixtures.expand(rec)[1].vel[2], -0))
  })

  it('tells recorded bytes from the reason a packet could not be encoded', function () {
    assert.ok(fixtures.isRecorded('1d00ff'))
    assert.ok(!fixtures.isRecorded('unencodable: net.minecraft.network.SkipPacketEncoderException: Not in creative mode'))
    assert.ok(!fixtures.isRecorded('abc'))
    assert.ok(!fixtures.isRecorded(undefined))
  })
})
