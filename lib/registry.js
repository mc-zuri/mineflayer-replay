'use strict'
// One prismarine registry per version, shared by the world, the engine and the packet codecs.
const registries = new Map()

function registryFor (version) {
  if (!registries.has(version)) registries.set(version, require('prismarine-registry')(version))
  return registries.get(version)
}

module.exports = { registryFor }
