#!/usr/bin/env node
// Writes fixtures.manifest.json for the fixtures in a directory (<version>.json.gz) that mineflayer tests, as assets of
// one GitHub release. Upload the same files to that release.
//
//   node tools/manifest.js <dir> --repo <owner/name> --tag <tag> --source "<where the recordings came from>"
'use strict'
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const { testedVersions } = require('mineflayer/lib/version')
const { MANIFEST, sha256 } = require('./fixtures')

function option (args, name) {
  const at = args.indexOf(name)
  if (at < 0 || at + 1 >= args.length) throw new Error(`missing ${name}`)
  return args[at + 1]
}

function entryOf (file, source) {
  const buffer = fs.readFileSync(file)
  const { cases } = JSON.parse(zlib.gunzipSync(buffer))
  return { asset: path.basename(file), sha256: sha256(buffer), bytes: buffer.length, cases: cases.length, source }
}

function manifestOf (dir, { repo, tag, source }) {
  const fixtures = {}
  for (const version of testedVersions) {
    const file = path.join(dir, `${version}.json.gz`)
    if (fs.existsSync(file)) fixtures[version] = entryOf(file, source)
  }
  return { schema: 1, release: { repo, tag }, fixtures }
}

function main () {
  const args = process.argv.slice(2)
  const manifest = manifestOf(path.resolve(args[0]), { repo: option(args, '--repo'), tag: option(args, '--tag'), source: option(args, '--source') })
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`${Object.keys(manifest.fixtures).length} fixtures listed`)
}

if (require.main === module) main()

module.exports = { manifestOf }
