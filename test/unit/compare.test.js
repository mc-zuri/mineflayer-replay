/* eslint-env mocha */
'use strict'
const assert = require('assert')
const { Vec3 } = require('vec3')
const { differences, report } = require('../../lib/compare')

describe('compare', function () {
  it('compares vectors per axis, exactly', function () {
    const diffs = differences({ pos: new Vec3(1, 2, 3.0000001) }, { pos: [1, 2, 3] }, ['pos'])
    assert.deepStrictEqual(diffs, [{ field: 'pos.z', expected: 3, actual: 3.0000001 }])
  })

  it('tells -0 from 0', function () {
    assert.strictEqual(differences({ v: 0 }, { v: -0 }, ['v']).length, 1)
    assert.strictEqual(differences({ v: -0 }, { v: -0 }, ['v']).length, 0)
  })

  it('skips fields the recording does not hold', function () {
    assert.deepStrictEqual(differences({ onGround: true }, {}, ['onGround']), [])
  })

  it('reports the first diverging tick with its input', function () {
    const text = report('1.21.11', 'j_jump', {
      ticks: 10,
      divergences: [{ t: 3, input: { jump: true, yaw: 0, pitch: 0 }, diffs: [{ field: 'vel.y', expected: 0.42, actual: 0.4 }] }]
    })
    assert.match(text, /^j_jump on 1\.21\.11: 1 of 10 ticks differ; first at tick 3 \(jump, yaw 0, pitch 0\)/)
    assert.match(text, /vel\.y: vanilla 0\.42 ours 0\.4/)
  })
})
