/* eslint-env mocha */
'use strict'
// The replay layers on a small case built here: a player standing on a stone floor with no keys held. Vanilla keeps
// such a player in place and leaves it the motion of one tick of gravity, cancelled by the ground:
// (0, -0.0784000015258789, 0).
const assert = require('assert')
const fixtures = require('../../lib/fixture')
const engine = require('../../lib/engine')
const bot = require('../../lib/bot')
const { engineCase, botCase } = require('../../lib/cases')

const STANDING_VEL = [0, -0.0784000015258789, 0]

function standingCase (version, ticks) {
  const rec = {
    name: 'x_standing',
    area: 'floor',
    gamemode: 'survival',
    start: {
      pos: [0.5, 64, 0.5],
      vel: STANDING_VEL,
      yaw: 0,
      pitch: 0,
      onGround: true,
      isCollidedHorizontally: false,
      isCollidedVertically: true,
      isInWater: false,
      isInLava: false,
      isInWeb: false,
      jumpTicks: 0,
      food: 20,
      netState: { entityId: 1, lastPos: [0.5, 64, 0.5], lastYaw: 0, lastPitch: 0, lastOnGround: true }
    },
    ticks
  }
  fixtures.use(version, {
    edition: 'java',
    version,
    sources: [],
    areas: { floor: { name: 'floor', origin: [0, 0, 0], min: [-2, 63, -2], max: [2, 66, 2], fills: [[-2, 63, -2, 2, 63, 2, 'stone']] } },
    cases: [rec]
  })
  return rec
}

const still = t => ({ t, in: { yaw: 0, pitch: 0 }, pos: [0.5, 64, 0.5], vel: STANDING_VEL, onGround: true })

describe('case filters', function () {
  it('leaves riding and the mineflayer feature cases out of the engine', function () {
    assert.deepStrictEqual(['b_slab', 'v_boat', 'm_anvil', 'mk_kick'].filter(engineCase), ['b_slab'])
    assert.deepStrictEqual(['b_slab', 'v_boat', 'm_anvil', 'mk_kick'].filter(botCase), ['b_slab', 'v_boat', 'm_anvil'])
  })
})

describe('engine layer', function () {
  it('matches a player standing still', function () {
    const rec = standingCase('1.21.11', [still(1), still(2), still(3)])
    assert.deepStrictEqual(engine.replay('1.21.11', rec).divergences, [])
  })

  it('reports the first tick and field that differ', function () {
    const rec = standingCase('1.21.11', [still(1), { ...still(2), pos: [0.5, 64.5, 0.5] }, still(3)])
    const { divergences } = engine.replay('1.21.11', rec)
    assert.strictEqual(divergences[0].t, 2)
    assert.deepStrictEqual(divergences[0].diffs, [{ field: 'pos.y', expected: 64.5, actual: 64 }])
  })

  it('restarts every tick from vanilla\'s state in stepwise mode', function () {
    // vanilla said the player was pushed up on tick 2 (a teleport the case does not show): stepwise, tick 3 starts there
    const rec = standingCase('1.21.11', [still(1), { ...still(2), pos: [0.5, 64.5, 0.5], onGround: false, vel: [0, 0, 0] }, still(3)])
    const ticks = engine.replay('1.21.11', rec, { mode: 'stepwise' }).divergences.map(d => d.t)
    assert.ok(ticks.includes(2) && ticks.includes(3), 'tick 3 starts in the air, so it falls instead of standing')
  })
})

describe('bot layer', function () {
  this.timeout(20 * 1000)

  it('starts a bot where the case begins, with nothing written', async function () {
    const rec = standingCase('1.21.11', [still(1)])
    const { bot: started, client } = await bot.startBot('1.21.11', rec)
    try {
      assert.deepStrictEqual(started.entity.position.toArray(), [0.5, 64, 0.5])
      assert.strictEqual(started.entity.onGround, true)
      assert.deepStrictEqual(client.written, [])
    } finally {
      started.end()
    }
  })

  it('compares the packets the bot writes with the client\'s, byte for byte', async function () {
    // the recorded client sent nothing during the tick; the 1.21.11 bot ends its tick with tick_end
    const rec = standingCase('1.21.11', [{ ...still(1), paused: false }])
    const { divergences } = await bot.replay('1.21.11', rec)
    assert.strictEqual(divergences.length, 1)
    assert.strictEqual(divergences[0].diffs[0].field, 'packets')
    assert.strictEqual(divergences[0].diffs[0].expected, '(none)')
    assert.match(divergences[0].diffs[0].actual, /tick_end:0c$/)
  })
})
