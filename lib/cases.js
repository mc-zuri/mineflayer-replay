'use strict'
// Which recorded cases each replay layer runs, and the known failures it expects.
const fs = require('fs')
const path = require('path')
const fixtures = require('./fixture')
const { testedVersions } = require('mineflayer/lib/version')

const KNOWN_FAILURES = path.join(__dirname, '..', 'known-failures.json')

// The engine replays the player on foot through prismarine-physics: not the mineflayer feature cases (m_*, mk_*),
// nor riding (v_*), for which prismarine-physics has no vehicle engine.
const engineCase = name => !/^(mk?|v)_/.test(name)
// The bot replays every case but the kick (mk_*), riding included; the feature cases' movement counts too.
const botCase = name => !/^mk_/.test(name)

// The versions a layer replays, oldest first: mineflayer's tested versions that have a fixture.
function versions () {
  const available = new Set(fixtures.versions())
  return testedVersions.filter(v => available.has(v))
}

function casesOf (version, filter) {
  return fixtures.load(version).cases.filter(c => filter(c.name) && (filter !== engineCase || !c.start?.vehicle))
}

function knownFailures () {
  if (!fs.existsSync(KNOWN_FAILURES)) return {}
  return JSON.parse(fs.readFileSync(KNOWN_FAILURES, 'utf8'))
}

module.exports = { KNOWN_FAILURES, engineCase, botCase, versions, casesOf, knownFailures }
