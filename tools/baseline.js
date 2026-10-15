#!/usr/bin/env node
// Rewrites known-failures.json from a full run: every case that does not match yet, as "case@version", per layer.
//
//   node tools/baseline.js [engine|bot ...] [--jobs N] [--summary]
//     --jobs N     runs the versions in N child processes (default 1)
//     --summary    also counts the first diverging field of the failures by case group
'use strict'
const fs = require('fs')
const os = require('os')
const { fork } = require('child_process')
const { KNOWN_FAILURES, engineCase, botCase, versions, casesOf, knownFailures } = require('../lib/cases')
const { codeStamp } = require('../lib/codeStamp')

// Each layer fails a case as its test does; the divergence summarised is the first tick that goes wrong on its own.
const LAYERS = {
  engine: {
    filter: engineCase,
    run (version, rec) {
      const engine = require('../lib/engine')
      if (!engine.replay(version, rec).divergences.length) return null
      const stepwise = engine.replay(version, rec, { mode: 'stepwise' }).divergences
      return (stepwise.length ? stepwise : engine.replay(version, rec).divergences)[0]
    }
  },
  bot: {
    filter: botCase,
    async run (version, rec) {
      return (await require('../lib/bot').replay(version, rec)).divergences[0] ?? null
    }
  }
}

// One version of one layer: { id, key } for each failing case
async function runVersion (layer, version) {
  const { filter, run } = LAYERS[layer]
  const failing = []
  for (const rec of casesOf(version, filter)) {
    const first = await run(version, rec)
    if (first) failing.push({ id: `${rec.name}@${version}`, key: `${rec.name.split('_')[0]} ${first.diffs[0].field}` })
  }
  return failing
}

// a child reports the code it ran with: a run whose children saw other code than it started with is not written
function inChild (layer, version, stamp) {
  return new Promise((resolve, reject) => {
    const child = fork(__filename, ['--child', layer, version])
    child.once('message', ({ failing, stamp: childStamp }) => {
      if (childStamp !== stamp) reject(new Error(`the code changed during the run (${layer} ${version}): not writing it`))
      else resolve(failing)
    })
    child.once('error', reject)
    child.once('exit', code => code && reject(new Error(`${layer} ${version} exited with ${code}`)))
  })
}

async function runLayer (layer, jobs) {
  const queue = versions()
  const results = []
  const stamp = codeStamp()
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    while (queue.length) {
      const version = queue.shift()
      results.push(...(jobs > 1 ? await inChild(layer, version, stamp) : await runVersion(layer, version)))
    }
  }))
  if (codeStamp() !== stamp) throw new Error(`the code changed during the ${layer} run: not writing it`)
  return results
}

async function main () {
  const args = process.argv.slice(2)
  if (args[0] === '--child') {
    const stamp = codeStamp()
    process.send({ failing: await runVersion(args[1], args[2]), stamp }, () => process.exit(0))
    return
  }
  const summary = args.includes('--summary')
  const jobsAt = args.indexOf('--jobs')
  const jobs = jobsAt >= 0 ? Number(args[jobsAt + 1]) || os.availableParallelism() : 1
  const layers = args.filter(a => LAYERS[a])
  const known = knownFailures()
  for (const layer of layers.length ? layers : Object.keys(LAYERS)) {
    const failing = await runLayer(layer, jobs)
    const total = versions().reduce((n, v) => n + casesOf(v, LAYERS[layer].filter).length, 0)
    known[layer] = failing.map(f => f.id).sort()
    console.log(`${layer}: ${total - failing.length} of ${total} cases match`)
    if (summary) {
      const counts = new Map()
      for (const { key } of failing) counts.set(key, (counts.get(key) ?? 0) + 1)
      for (const [key, count] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`${String(count).padStart(6)}  ${key}`)
    }
  }
  fs.writeFileSync(KNOWN_FAILURES, JSON.stringify(known, null, 2) + '\n')
  process.exit(0)
}

main().catch(err => { console.error(err.message); process.exit(1) })
