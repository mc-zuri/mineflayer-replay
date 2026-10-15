#!/usr/bin/env node
// Downloads the fixtures fixtures.manifest.json lists into fixtures/ and verifies each one's sha256. A file already
// there with the right hash is kept.
//
//   node tools/fixtures.js [version ...]
'use strict'
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { DIR } = require('../lib/fixture')

const MANIFEST = path.join(__dirname, '..', 'fixtures.manifest.json')

const sha256 = buffer => crypto.createHash('sha256').update(buffer).digest('hex')

function readManifest (file = MANIFEST) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function assetUrl ({ release }, entry) {
  return `https://github.com/${release.repo}/releases/download/${release.tag}/${entry.asset}`
}

// true when `file` holds the fixture `entry` describes
function verified (file, entry) {
  if (!fs.existsSync(file)) return false
  return sha256(fs.readFileSync(file)) === entry.sha256
}

async function fetchFixture (manifest, version, dir = DIR) {
  const entry = manifest.fixtures[version]
  if (!entry) throw new Error(`fixtures.manifest.json has no fixture for ${version}`)
  const file = path.join(dir, `${version}.json.gz`)
  if (verified(file, entry)) return { version, file, downloaded: false }
  const response = await fetch(assetUrl(manifest, entry))
  if (!response.ok) throw new Error(`${version}: ${response.status} ${response.statusText} from ${assetUrl(manifest, entry)}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (sha256(buffer) !== entry.sha256) throw new Error(`${version}: downloaded fixture does not match its sha256`)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(file, buffer)
  return { version, file, downloaded: true }
}

async function main () {
  const manifest = readManifest()
  if (!manifest.release) throw new Error('fixtures.manifest.json lists no release yet')
  const wanted = process.argv.slice(2)
  const versions = wanted.length ? wanted : Object.keys(manifest.fixtures)
  for (const version of versions) {
    const { downloaded } = await fetchFixture(manifest, version)
    console.log(`${downloaded ? 'downloaded' : 'up to date'} ${version}`)
  }
}

if (require.main === module) main().catch(err => { console.error(err.message); process.exit(1) })

module.exports = { MANIFEST, sha256, readManifest, assetUrl, verified, fetchFixture }
