'use strict'
// Exact comparison: numbers by Object.is (a -0 the client sends is other bytes than a 0), the rest by ===.
const { Vec3 } = require('vec3')

function valueOf (state, field) {
  const value = state[field]
  return value instanceof Vec3 ? [value.x, value.y, value.z] : value
}

function differences (actual, expected, fields) {
  const out = []
  for (const field of fields) {
    const want = expected[field]
    if (want === undefined) continue
    const have = valueOf(actual, field)
    if (Array.isArray(want)) {
      want.forEach((w, i) => {
        if (!Object.is(have?.[i], w)) out.push({ field: `${field}.${'xyz'[i]}`, expected: w, actual: have?.[i] })
      })
    } else if (!Object.is(have, want)) {
      out.push({ field, expected: want, actual: have })
    }
  }
  return out
}

const keysOf = input => Object.keys(input).filter(key => input[key] === true).join('+') || 'no keys'

// "<case> on <version>: N of M ticks differ; first at tick T (forward+jump, yaw 0, pitch 0)" and one line per field.
function report (version, name, { ticks, divergences }) {
  if (!divergences.length) return `${name} on ${version}: all ${ticks} ticks match`
  const first = divergences[0]
  const lines = [`${name} on ${version}: ${divergences.length} of ${ticks} ticks differ; first at tick ${first.t} (${keysOf(first.input)}, yaw ${first.input.yaw}, pitch ${first.input.pitch})`]
  for (const { field, expected, actual } of first.diffs) {
    const delta = typeof expected === 'number' && typeof actual === 'number' ? ` (Δ ${(actual - expected).toExponential(3)})` : ''
    lines.push(`  ${field}: vanilla ${expected} ours ${actual}${delta}`)
  }
  return lines.join('\n')
}

module.exports = { differences, report }
