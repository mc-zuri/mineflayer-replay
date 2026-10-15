'use strict'
// The recorded area of a case as a world the physics engine can read: getBlock(pos) -> prismarine-block with its position.
const { Vec3 } = require('vec3')
const { registryFor } = require('./registry')

// "oak_fence[east=true,north=false]" -> { name, properties }
function parseState (text) {
  const open = text.indexOf('[')
  if (open < 0) return { name: text, properties: {} }
  const properties = {}
  for (const pair of text.slice(open + 1, -1).split(',')) {
    const [key, value] = pair.split('=')
    properties[key] = value
  }
  return { name: text.slice(0, open), properties }
}

// A recorded block state as a prismarine state id. 1.13+: "name[prop=value,...]". Before the flattening the recorder
// appends the stored id and metadata ("fence[east=true,...]@85:0"), and the state id is id << 4 | metadata.
function parseStateId (text, registry, Block) {
  const at = text.lastIndexOf('@')
  if (at >= 0) {
    const [id, metadata] = text.slice(at + 1).split(':').map(Number)
    return id * 16 + (metadata || 0)
  }
  const { name, properties } = parseState(text)
  const block = registry.blocksByName[name]
  if (!block) throw new Error(`minecraft-data ${registry.version.minecraftVersion} has no block ${name}`)
  if (registry.isOlderThan('1.13')) {
    if (Object.keys(properties).length === 0) return block.id * 16
    try { return Block.fromProperties(name, properties, 0).stateId } catch { return block.id * 16 }
  }
  return Block.fromProperties(name, properties, 0).stateId
}

const prepared = new Map()
function cellsOf (version, key, area) {
  const id = `${version}/${key}`
  if (!prepared.has(id)) {
    const registry = registryFor(version)
    const Block = require('prismarine-block')(registry)
    const states = new Map()
    const stateId = text => {
      if (!states.has(text)) states.set(text, parseStateId(text, registry, Block))
      return states.get(text)
    }
    const cells = new Map()
    for (const [x0, y0, z0, x1, y1, z1, state] of area.fills) {
      const sid = stateId(state)
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          for (let z = z0; z <= z1; z++) cells.set(`${x},${y},${z}`, sid)
        }
      }
    }
    prepared.set(id, { cells, stateId, Block, air: registry.blocksByName.air.defaultState ?? registry.blocksByName.air.id * 16 })
  }
  return prepared.get(id)
}

// The world of one case. Each replay gets its own overlay, so block changes the server sent stay inside it.
function caseWorld (fixture, rec) {
  const area = fixture.areas[rec.area]
  if (!area) throw new Error(`${rec.name}: fixture of ${fixture.version} has no area ${rec.area}`)
  const { cells, stateId, Block, air } = cellsOf(fixture.version, rec.area, area)
  const changed = new Map()
  return {
    area,
    stateIdAt (x, y, z) {
      const key = `${x},${y},${z}`
      return changed.get(key) ?? cells.get(key) ?? air
    },
    getBlock (pos) {
      const x = Math.floor(pos.x)
      const y = Math.floor(pos.y)
      const z = Math.floor(pos.z)
      const block = Block.fromStateId(this.stateIdAt(x, y, z), 0)
      block.position = new Vec3(x, y, z)
      return block
    },
    // [x, y, z, "state"] as the recorder lists a block change
    setBlock ([x, y, z, state]) {
      changed.set(`${x},${y},${z}`, stateId(state))
    },
    // a block the client set itself, by state id
    setStateId ([x, y, z], id) {
      changed.set(`${x},${y},${z}`, id)
    }
  }
}

module.exports = { caseWorld, parseStateId }
