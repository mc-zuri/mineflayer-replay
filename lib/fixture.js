'use strict'
// Fixtures: fixtures/<version>.json.gz, one per tested version (see fixtures.manifest.json and tools/fixtures.js).
//
// A case is the player state before its first tick (`start`) and per client tick the input (`in`: keys held, yaw and
// pitch in vanilla degrees) and the state after the tick. Rows hold only what changed since the row before; events
// (EVENTS) belong to their own row only. Doubles are written by Java's Double.toString and parse to the same double;
// floats are written by Float.toString, so FLOATS are rounded back to floats here.
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const DIR = process.env.REPLAY_FIXTURES ? path.resolve(process.env.REPLAY_FIXTURES) : path.resolve(__dirname, '..', 'fixtures')

// What the server sent before a tick or what the client sent during it: never filled forward.
const EVENTS = ['velocityPackets', 'blockChanges', 'vehicleServer', 'vehicleRearing', 'explosionKnockback', 'corrected', 'serverPackets', 'clientPackets']

// Fields vanilla keeps as Java floats.
const FLOATS = ['yaw', 'pitch', 'xxa', 'yya', 'zza', 'speed']
const NET_FLOATS = ['lastYaw', 'lastPitch']

function versions () {
  if (!fs.existsSync(DIR)) return []
  return fs.readdirSync(DIR).filter(f => f.endsWith('.json.gz')).map(f => f.slice(0, -'.json.gz'.length))
}

const loaded = new Map()
function load (version) {
  if (!loaded.has(version)) {
    const file = path.join(DIR, `${version}.json.gz`)
    if (!fs.existsSync(file)) {
      loaded.set(version, null)
    } else {
      const fixture = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)))
      fixture.byName = new Map(fixture.cases.map(c => [c.name, c]))
      loaded.set(version, fixture)
    }
  }
  return loaded.get(version)
}

// A fixture object as load() returns it, for tests that build one in memory.
function use (version, fixture) {
  fixture.byName = new Map(fixture.cases.map(c => [c.name, c]))
  loaded.set(version, fixture)
  return fixture
}

function scenario (version, name) {
  return load(version)?.byName.get(name) ?? null
}

function roundFloats (state) {
  for (const key of FLOATS) if (typeof state[key] === 'number') state[key] = Math.fround(state[key])
  if (state.in) state.in = roundInput(state.in)
  if (state.netState) {
    state.netState = { ...state.netState }
    for (const key of NET_FLOATS) if (typeof state.netState[key] === 'number') state.netState[key] = Math.fround(state.netState[key])
  }
  return state
}

function roundInput (input) {
  const out = { ...input }
  if (typeof out.yaw === 'number') out.yaw = Math.fround(out.yaw)
  if (typeof out.pitch === 'number') out.pitch = Math.fround(out.pitch)
  return out
}

// The start state with its floats.
function start (rec) {
  return roundFloats({ ...rec.start })
}

// Every row complete: the fields carried forward from the start and the rows before, the row's own events under
// `events`.
function expand (rec) {
  let last = start(rec)
  return rec.ticks.map(row => {
    const state = {}
    const events = {}
    for (const [key, value] of Object.entries(row)) (EVENTS.includes(key) ? events : state)[key] = value
    last = roundFloats({ ...last, ...state })
    return { ...last, events }
  })
}

// A recorded packet's bytes (packet id and payload). The recorder writes a reason instead of hex for a packet the
// client could not encode (e.g. "unencodable: ..."): such an entry has no bytes.
const HEX = /^(?:[0-9a-f]{2})*$/i
const isRecorded = hex => typeof hex === 'string' && HEX.test(hex)
const bytesOf = hex => Buffer.from(hex, 'hex')

module.exports = { DIR, EVENTS, FLOATS, versions, load, use, scenario, start, expand, isRecorded, bytesOf }
