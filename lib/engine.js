'use strict'
// Replays a recorded case through prismarine-physics alone: no bot, no packets. The engine is handed what a correct
// bot would hand it (the vanilla keys and view, the attributes, effects and abilities the server synced) and its state
// after every tick is compared with the vanilla client's.
//
//   mode 'trajectory': one continuous simulation, as a bot runs it.
//   mode 'stepwise':   every tick starts from vanilla's state after the tick before, so each tick's error is its own.
const { Vec3 } = require('vec3')
const conv = require('mineflayer/lib/conversions')
const { Physics, PlayerState } = require('prismarine-physics')
const { registryFor } = require('./registry')
const { caseWorld } = require('./world')
const fixtures = require('./fixture')
const { differences } = require('./compare')

// State the engine computes, compared on every tick.
const FIELDS = ['pos', 'vel', 'onGround', 'isCollidedHorizontally', 'isCollidedVertically', 'isInWater', 'isInLava',
  'isInWeb', 'elytraFlying']
const KEYS = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak']

const camel = name => name.replace(/[._]([a-z])/g, (m, c) => c.toUpperCase())
const pascal = name => name.split('_').map(part => part[0].toUpperCase() + part.slice(1)).join('')

// minecraft-data's attribute for the recorder's name of it. The recorder names some attributes without the
// generic./player. prefix minecraft-data has (1.21.1's sneaking_speed is player.sneaking_speed there).
function attributeOf (registry, name) {
  const bare = name.replace(/^(minecraft:)?(generic|player)\./, '').replace(/^minecraft:/, '')
  return [name, bare, `generic.${bare}`, `player.${bare}`].map(n => registry.attributesByName[camel(n)]).find(Boolean) ?? null
}

// The attributes as mineflayer keeps them on bot.entity.attributes (keyed by the attribute's resource name, as
// prismarine-physics reads them): the base and the modifiers the server synced.
function attributesOf (registry, row) {
  const out = {}
  for (const [name, value] of Object.entries(row.attributes ?? {})) {
    const attribute = attributeOf(registry, name)
    if (!attribute) continue
    const synced = row.attributeModifiers?.[name]
    out[attribute.resource] = synced
      ? { value: synced.base, modifiers: synced.modifiers.map(m => ({ uuid: m.id, amount: m.amount, operation: m.operation })) }
      : { value, modifiers: [] }
  }
  return out
}

// The recorder's "jump_boost:1" (name:amplifier) as mineflayer's bot.entity.effects, keyed by effect id.
function effectsOf (registry, row) {
  const out = {}
  for (const entry of row.effects ?? []) {
    const [name, amplifier] = entry.split(':')
    const effect = registry.effectsByName[pascal(name)]
    if (effect) out[effect.id] = { id: effect.id, amplifier: Number(amplifier), duration: 0 }
  }
  return out
}

const enchantment = (rec, slot, id) => rec.setup?.equipment?.[slot]?.enchantments?.[id] ?? 0

// How many of the row's rockets the client attaches to the player. Before 1.14 a rocket keeps its shooter as an int
// whose 0 means none, so a player whose entity id is 0 is never boosted. (Rockets attach from 1.11.)
function attachedRockets (registry, row) {
  if (registry.version['<']('1.14') && !(row.netState?.entityId > 0)) return 0
  return row.fireworks?.length ?? 0
}

// A bot as prismarine-physics' PlayerState reads it, standing where the recording starts.
function botAt (registry, start) {
  return {
    version: registry.version.minecraftVersion,
    registry,
    entity: {
      position: new Vec3(...start.pos),
      velocity: new Vec3(...start.vel),
      onGround: start.onGround,
      yaw: conv.fromNotchianYaw(start.yaw),
      pitch: conv.fromNotchianPitch(start.pitch),
      effects: {},
      attributes: {}
    },
    jumpTicks: 0,
    jumpQueued: false,
    fireworkRocketDuration: 0,
    inventory: { slots: [] }
  }
}

// The bot state of a recorded snapshot: what the tick after it starts from.
function useRecorded (bot, s) {
  const entity = bot.entity
  entity.position = new Vec3(...s.pos)
  entity.velocity = new Vec3(...s.vel)
  entity.onGround = s.onGround
  entity.isCollidedHorizontally = s.isCollidedHorizontally
  entity.minorHorizontalCollision = !!s.minorHorizontalCollision
  entity.isCollidedVertically = s.isCollidedVertically
  entity.isInWater = s.isInWater
  entity.isInLava = s.isInLava
  entity.isInWeb = s.isInWeb
  entity.isSprinting = !!s.sprinting
  entity.elytraFlying = !!s.elytraFlying
  entity.flying = !!s.flying
  bot.jumpTicks = s.jumpTicks ?? 0
}

// The tick's input: the keys and view of the row, and what the server had synced by then. The row's attributes,
// effects and abilities already hold this tick's packets, which the client handles before it ticks.
function useInput (bot, registry, rec, row) {
  const input = row.in
  bot.entity.yaw = conv.fromNotchianYaw(input.yaw)
  bot.entity.pitch = conv.fromNotchianPitch(input.pitch)
  bot.entity.attributes = attributesOf(registry, row)
  bot.entity.effects = effectsOf(registry, row)
  bot.entity.flyingSpeed = row.attributes?.['abilities.flyingSpeed'] ?? 0.05
  bot.fireworkRocketDuration = attachedRockets(registry, row) > 0 ? 1 : 0
  return Object.fromEntries(KEYS.map(key => [key, !!input[key]]))
}

// The server's position corrections (teleports), whose handling the recorder keeps as the position and motion they left.
const POSITION_PACKETS = new Set(['PlayerPositionLookS2CPacket', 'minecraft:player_position'])

// What the server sent before the tick, as the client applied it. The server sends an explosion's packet as it
// explodes and the motion it gave the player with its entity tracker later in that tick, so the explosion's knockback
// comes first and a velocity packet after it replaces the velocity.
function useEvents (bot, world, events) {
  const entity = bot.entity
  for (const change of events.blockChanges ?? []) world.setBlock(change)
  for (const { type, after } of events.serverPackets ?? []) {
    if (!POSITION_PACKETS.has(type) || !after) continue
    if (after.pos) entity.position = new Vec3(...after.pos)
    if (after.vel) entity.velocity = new Vec3(...after.vel)
  }
  for (const [x, y, z] of events.explosionKnockback ?? []) entity.velocity.translate(x, y, z)
  for (const [target, x, y, z] of events.velocityPackets ?? []) {
    if (target === 0) entity.velocity = new Vec3(x, y, z)
  }
  for (const p of events.serverPackets ?? []) if (p.after?.elytraFlying !== undefined) entity.elytraFlying = p.after.elytraFlying
}

const stateOf = bot => {
  const e = bot.entity
  return {
    pos: e.position,
    vel: e.velocity,
    onGround: e.onGround,
    isCollidedHorizontally: e.isCollidedHorizontally,
    isCollidedVertically: e.isCollidedVertically,
    isInWater: e.isInWater,
    isInLava: e.isInLava,
    isInWeb: e.isInWeb,
    elytraFlying: e.elytraFlying
  }
}

function replay (version, rec, { mode = 'trajectory', fields = FIELDS } = {}) {
  const registry = registryFor(version)
  const world = caseWorld(fixtures.load(version), rec)
  const physics = Physics(registry, world)
  const start = fixtures.start(rec)
  const rows = fixtures.expand(rec)
  const bot = botAt(registry, start)
  useRecorded(bot, start)
  const divergences = []
  rows.forEach((row, i) => {
    if (mode === 'stepwise' && i > 0) useRecorded(bot, rows[i - 1])
    const control = useInput(bot, registry, rec, row)
    useEvents(bot, world, row.events)
    const state = new PlayerState(bot, control)
    // the equipment the case set up, as a bot would read it from its inventory
    state.depthStrider = enchantment(rec, 'feet', 'depth_strider')
    state.elytraEquipped = rec.setup?.equipment?.chest?.id === 'elytra'
    physics.simulatePlayer(state, world).apply(bot)
    const diffs = differences(stateOf(bot), row, fields)
    if (diffs.length) divergences.push({ t: row.t, input: row.in, diffs })
  })
  return { ticks: rows.length, divergences }
}

module.exports = { FIELDS, replay, attributeOf, attributesOf, effectsOf }
