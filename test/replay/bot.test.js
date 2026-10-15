/* eslint-env mocha */
'use strict'
// Every recorded case through a whole mineflayer bot stepped tick by tick (physicsManual, bot.tickPhysics()): the movement and input
// packets it writes each tick must be the vanilla client's to the byte, and its position, motion and ground contact
// the client's. Cases in known-failures.json ("case@version") are expected to differ; one that starts matching fails
// too, so the list only ever shrinks.
const assert = require('assert')
const { botCase, versions, casesOf, knownFailures } = require('../../lib/cases')
const bot = require('../../lib/bot')
const { report } = require('../../lib/compare')

const known = new Set(knownFailures().bot ?? [])

for (const version of versions()) {
  describe(`bot replay ${version}v`, function () {
    this.timeout(20 * 1000)
    for (const rec of casesOf(version, botCase)) {
      const id = `${rec.name}@${version}`
      it(rec.name, async function () {
        const result = await bot.replay(version, rec)
        if (known.has(id)) {
          assert.ok(result.divergences.length > 0, `${id} matches vanilla now: remove it from known-failures.json`)
          return
        }
        if (result.divergences.length) assert.fail(report(version, rec.name, result))
      })
    }
  })
}
