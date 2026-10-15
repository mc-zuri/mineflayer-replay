'use strict'
// What the replays run: a stamp (every file's path, size and modification time) of the code and data a replay loads,
// as resolved from this package. A run that sees it change midway (a branch switch in a dependency, a relink) mixes
// two versions of the code across its child processes and its results flip between runs; the baseline refuses to
// write such a run.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

function packageDir (name, from) {
  return path.dirname(require.resolve(`${name}/package.json`, { paths: [from] }))
}

function defaultCode () {
  const mineflayer = packageDir('mineflayer', __dirname)
  const data = packageDir('minecraft-data', mineflayer)
  return [
    path.join(mineflayer, 'lib'),
    path.join(mineflayer, 'index.js'),
    packageDir('prismarine-physics', mineflayer),
    path.join(packageDir('minecraft-protocol', mineflayer), 'src'),
    path.join(data, 'minecraft-data', 'data', 'pc'),
    path.join(data, 'minecraft-data', 'data', 'dataPaths.json'),
    path.join(packageDir('prismarine-chunk', mineflayer), 'src'),
    packageDir('prismarine-block', mineflayer),
    path.join(packageDir('prismarine-registry', mineflayer), 'lib'),
    __dirname
  ]
}

const SKIP = new Set(['node_modules', '.git', 'test', 'docs', 'examples'])

function walk (entry, out) {
  let stat
  try { stat = fs.statSync(entry) } catch { out.push(`${entry} missing`); return }
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(entry).sort()) if (!SKIP.has(name)) walk(path.join(entry, name), out)
  } else {
    out.push(`${entry} ${stat.size} ${stat.mtimeMs}`)
  }
}

/** A hash of the size and modification time of every file under `paths` (by default the code a replay loads). */
function codeStamp (paths = defaultCode()) {
  const lines = []
  for (const entry of paths) walk(entry, lines)
  return crypto.createHash('sha1').update(lines.join('\n')).digest('hex')
}

module.exports = { codeStamp, defaultCode }
