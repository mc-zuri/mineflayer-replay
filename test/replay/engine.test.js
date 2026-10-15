/* eslint-env mocha */
'use strict'
// Every recorded on-foot case through prismarine-physics: each tick of a continuous simulation must give
// the vanilla client's state exactly. Cases in known-failures.json ("case@version") are expected to differ; one that
// starts matching fails too, so the list only ever shrinks.
const assert = require('assert')
const { engineCase, versions, casesOf, knownFailures } = require('../../lib/cases')
const engine = require('../../lib/engine')
const { report } = require('../../lib/compare')

const known = new Set(knownFailures().engine ?? [])

for (const version of versions()) {
  describe(`engine replay ${version}v`, function () {
    for (const rec of casesOf(version, engineCase)) {
      const id = `${rec.name}@${version}`
      it(rec.name, function () {
        const result = engine.replay(version, rec, { mode: 'trajectory' })
        if (known.has(id)) {
          assert.ok(result.divergences.length > 0, `${id} matches vanilla now: remove it from known-failures.json`)
          return
        }
        if (result.divergences.length) {
          // the first tick that goes wrong on its own (every tick started from vanilla's state) says what to fix
          const stepwise = engine.replay(version, rec, { mode: 'stepwise' })
          assert.fail(`${report(version, rec.name, stepwise)}\n(continuous: ${report(version, rec.name, result)})`)
        }
      })
    }
  })
}
