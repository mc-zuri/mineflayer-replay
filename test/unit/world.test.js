/* eslint-env mocha */
'use strict'
const assert = require('assert')
const { Vec3 } = require('vec3')
const { caseWorld, parseStateId } = require('../../lib/world')
const { registryFor } = require('../../lib/registry')

describe('world', function () {
  it('reads a flattened block state', function () {
    const registry = registryFor('1.21.11')
    const Block = require('prismarine-block')(registry)
    const id = parseStateId('oak_slab[type=top,waterlogged=false]', registry, Block)
    const block = Block.fromStateId(id, 0)
    assert.strictEqual(block.name, 'oak_slab')
    assert.strictEqual(block.getProperties().type, 'top')
  })

  it('reads a block state before the flattening by its stored id and metadata', function () {
    const registry = registryFor('1.12.2')
    const Block = require('prismarine-block')(registry)
    assert.strictEqual(parseStateId('stone_slab[half=top,variant=stone]@44:8', registry, Block), 44 * 16 + 8)
  })

  it('fills the area and keeps block changes to one replay', function () {
    const fixture = { version: '1.21.11', areas: { a: { name: 'a', min: [0, 0, 0], max: [1, 1, 1], fills: [[0, 0, 0, 1, 0, 1, 'stone']] } } }
    const rec = { name: 'x', area: 'a' }
    const world = caseWorld(fixture, rec)
    assert.strictEqual(world.getBlock(new Vec3(1.5, 0.2, 0)).name, 'stone')
    assert.deepStrictEqual(world.getBlock(new Vec3(1.5, 0.2, 0)).position, new Vec3(1, 0, 0))
    assert.strictEqual(world.getBlock(new Vec3(0, 1, 0)).name, 'air')
    world.setBlock([0, 0, 0, 'air'])
    assert.strictEqual(world.getBlock(new Vec3(0, 0, 0)).name, 'air')
    assert.strictEqual(caseWorld(fixture, rec).getBlock(new Vec3(0, 0, 0)).name, 'stone', 'another replay starts from the area')
  })
})
