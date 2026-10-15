'use strict'
// Replays a recorded case through a whole mineflayer bot. The bot is put where the vanilla client was when the case
// began, then each client tick gets the server packets the client received, the keys and view it had, and runs once
// (physicsManual, bot.tickPhysics()). The packets the bot writes during a tick must be the client's to the byte; its
// state after the tick must be the client's.
//
// The bot is driven through mineflayer's public API and the packets a server would send. What the client held that
// neither can set is listed in the README ("Known harness gaps"); a case can diverge because of one of those alone.
const path = require('path')
const mc = require('minecraft-protocol')
const mineflayer = require('mineflayer')
const conv = require('mineflayer/lib/conversions')
const { Vec3 } = require('vec3')
const fixtures = require('./fixture')
const { registryFor } = require('./registry')
const { caseWorld } = require('./world')
const { createFakeClient, serverboundName, readServerbound, readClientbound } = require('./fakeClient')
const { differences } = require('./compare')
const { attributeOf } = require('./engine')

const KEYS = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak']
// minecraft-protocol's names of the packets a client tick sends about movement and input
const MOVEMENT = new Set(['position', 'position_look', 'look', 'flying', 'player_input', 'entity_action', 'tick_end',
  'teleport_confirm', 'steer_vehicle', 'vehicle_move', 'steer_boat'])
const FIELDS = ['pos', 'vel', 'onGround']
const GAME_MODES = { survival: 0, creative: 1, adventure: 2, spectator: 3 }

const mineflayerDir = path.dirname(require.resolve('mineflayer'))
const fromMineflayer = name => require(require.resolve(name, { paths: [mineflayerDir] }))

function loginPacket (registry, start, rec) {
  const gameMode = GAME_MODES[start.gameMode ?? rec.gamemode ?? 'survival']
  const entityId = start.netState?.entityId ?? 1
  if (registry.supportFeature('usesLoginPacket')) {
    const packet = structuredClone(registry.loginPacket)
    packet.entityId = entityId
    if (packet.worldState) packet.worldState.gamemode = Object.keys(GAME_MODES)[gameMode]
    else packet.gameMode = gameMode
    return packet
  }
  return { entityId, levelType: 'default', gameMode, dimension: 0, difficulty: 0, maxPlayers: 20, reducedDebugInfo: false }
}

// The case's equipment (rec.setup.equipment) and inventory (rec.setup.inventory, by inventory index: the hotbar is
// 0 - 8) as the server gives them: a set_slot into the player's inventory window per item, encoded and decoded with
// the version's codec, then the selected hotbar slot. (prismarine-item does not encode enchantments as 1.20.5+
// components: the enchantments component is added here, by the enchantments' registry ids.)
const EQUIPMENT_SLOTS = { head: 5, chest: 6, legs: 7, feet: 8, mainhand: 36, offhand: 45 }
const ITEM_NAMES = { firework_rocket: ['firework_rocket', 'fireworks'], oak_sign: ['oak_sign', 'sign'] }
const inventorySlot = index => index < 9 ? 36 + index : index
function equip (client, registry, version, rec) {
  const Item = fromMineflayer('prismarine-item')(registry)
  const serializer = mc.createSerializer({ state: 'play', isServer: true, version })
  const give = (slot, { id, count = 1, enchantments = {} }) => {
    const name = (ITEM_NAMES[id] ?? [id]).find(name => registry.itemsByName[name])
    if (!name || slot === undefined) return
    const item = new Item(registry.itemsByName[name].id, count)
    const enchants = Object.entries(enchantments).map(([name, lvl]) => ({ name, lvl }))
    if (enchants.length) item.enchants = enchants
    const notch = Item.toNotch(item)
    if (Array.isArray(notch.components) && enchants.length) {
      const levels = enchants.map(({ name, lvl }) => ({ id: registry.enchantmentsByName[name].id, level: lvl }))
      notch.components.push({ type: 'enchantments', data: { enchantments: levels, showTooltip: true } })
      notch.addedComponentCount = notch.components.length
    }
    const params = { windowId: 0, stateId: 0, slot, item: notch }
    client.receiveBytes(serializer.createPacketBuffer({ name: 'set_slot', params }))
  }
  for (const [slot, spec] of Object.entries(rec.setup?.equipment ?? {})) give(EQUIPMENT_SLOTS[slot], spec)
  for (const [index, spec] of Object.entries(rec.setup?.inventory ?? {})) give(inventorySlot(Number(index)), spec)
  if (rec.setup?.selected != null) {
    client.receiveBytes(serializer.createPacketBuffer({ name: 'held_item_slot', params: { slot: rec.setup.selected } }))
  }
}

const pascal = name => name.split('_').map(part => part[0].toUpperCase() + part.slice(1)).join('')
const unprefixed = name => name.replace(/^minecraft:/, '')

// The player's abilities when the case began, as the server sends them: its game mode's, may fly where the case let
// it (setup.flying), and flying as the client was.
function receiveAbilities (client, start, rec) {
  const gameMode = start.gameMode ?? rec.gamemode ?? 'survival'
  const creative = gameMode === 'creative'
  const spectator = gameMode === 'spectator'
  const mayFly = creative || spectator || !!rec.setup?.flying
  const flags = (creative || spectator ? 1 : 0) | (start.flying || spectator ? 2 : 0) | (mayFly ? 4 : 0) | (creative ? 8 : 0)
  client.receiveWritten('abilities', { flags, flyingSpeed: start.attributes?.['abilities.flyingSpeed'] ?? 0.05, walkingSpeed: 0.1 })
}

// The effects and attributes the server had synced when the case began, as the packets that synced them: the recorder's
// "speed:0" (name:amplifier) effects, and every attribute with the modifiers it holds.
function receiveSynced (client, registry, start) {
  const entityId = start.netState?.entityId ?? 1
  for (const entry of start.effects ?? []) {
    const [name, amplifier] = entry.split(':')
    const effect = registry.effectsByName[pascal(name)]
    if (effect) client.receiveWritten('entity_effect', { entityId, effectId: effect.id, amplifier: Number(amplifier), duration: 32767, hideParticles: 0, flags: 0 })
  }
  const packetName = registry.version['>=']('1.9') ? 'entity_update_attributes' : 'update_attributes'
  const [keyField] = registry.protocol.play.toClient.types[`packet_${packetName}`][1][1].type[1].type[1]
  const properties = []
  for (const [name, value] of Object.entries(start.attributes ?? {})) {
    const attribute = attributeOf(registry, name)
    if (!attribute) continue
    // the attribute's name as the protocol writes it: its registry name (namespaced from 1.16), from 1.20.5 its id
    let key = registry.version['>=']('1.16') ? `minecraft:${unprefixed(attribute.resource)}` : attribute.resource
    if (Array.isArray(keyField.type)) {
      key = Object.values(keyField.type[1].mappings).find(mapped => unprefixed(mapped) === unprefixed(attribute.resource))
      if (key === undefined) continue
    }
    const synced = start.attributeModifiers?.[name]
    properties.push({
      [keyField.name]: key,
      value: synced ? synced.base : value,
      modifiers: (synced?.modifiers ?? []).map(m => ({ uuid: m.id, amount: m.amount, operation: m.operation }))
    })
  }
  if (properties.length) client.receiveWritten(packetName, { entityId, properties })
}

// The case's area as chunk columns, built once per version and area and copied for each replay.
const columns = new Map()
function columnsOf (bot, fixture, rec) {
  const key = `${fixture.version}/${rec.area}/${bot.game.minY}/${bot.game.height}`
  const Chunk = require('prismarine-chunk')(bot.registry)
  if (!columns.has(key)) {
    const world = caseWorld(fixture, rec)
    const area = world.area
    const air = world.stateIdAt(Number.MAX_SAFE_INTEGER, 0, 0)
    const built = new Map()
    const columnAt = (x, z) => {
      const id = `${x >> 4},${z >> 4}`
      if (!built.has(id)) built.set(id, new Chunk({ minY: bot.game.minY ?? 0, worldHeight: bot.game.height ?? 256 }))
      return built.get(id)
    }
    for (let x = area.min[0]; x <= area.max[0]; x++) {
      for (let z = area.min[2]; z <= area.max[2]; z++) {
        const column = columnAt(x, z)
        for (let y = area.min[1]; y <= area.max[1]; y++) {
          const stateId = world.stateIdAt(x, y, z)
          if (stateId !== air) column.setBlockStateId(new Vec3(x & 15, y, z & 15), stateId)
        }
      }
    }
    columns.set(key, [...built].map(([id, column]) => [...id.split(',').map(Number), column.toJson()]))
  }
  return columns.get(key).map(([x, z, json]) => [x, z, Chunk.fromJson(json)])
}

// The view the client had: mineflayer keeps it in radians on bot.entity.
function setLook (bot, yaw, pitch) {
  bot.entity.yaw = conv.fromNotchianYaw(yaw)
  bot.entity.pitch = conv.fromNotchianPitch(pitch)
}

function setKeys (bot, input) {
  for (const key of KEYS) {
    if (bot.getControlState(key) !== !!input[key]) bot.setControlState(key, !!input[key])
  }
}

// The use key as the client handles it before its tick (Minecraft.handleKeybinds), at the tick's look. While an item
// is in use, letting go releases it (deactivateItem). Otherwise a press starts using (startUseItem), and so does a
// held key once rightClickDelay, which each start sets to 4 and each tick counts down, is back to 0. startUseItem
// interacts first with an entity (3 blocks) or a block (4.5) at the crosshair; a block only passes the use on to the
// held item (bot.activateItem) when neither the block nor the item acts on it, and an empty hand uses nothing.
// (An item used up by its last use leaves the hand empty on the client at once: LivingEntity.completeUsingItem.)
const BLOCK_REACH = 4.5
const ENTITY_REACH = 3
function createUseKey (bot) {
  const key = { down: false, rightClickDelay: 0, using: false }
  return input => {
    const down = !!input.use
    const pressed = down && !key.down
    const usedUp = key.using && !bot.usingHeldItem && bot.heldItem?.count === 1
    key.down = down
    if (key.rightClickDelay > 0) key.rightClickDelay--
    if (bot.usingHeldItem) {
      if (!down) bot.deactivateItem()
    } else if (pressed || (down && !key.rightClickDelay)) {
      key.rightClickDelay = 4
      startUseItem(bot, usedUp)
    }
    key.using = bot.usingHeldItem
  }
}

function startUseItem (bot, usedUp) {
  if (bot.entityAtCursor(ENTITY_REACH)) return
  const block = bot.blockAtCursor(BLOCK_REACH)
  if (block && INTERACTIVE_BLOCK.test(block.name)) return
  // the main hand, then the off hand
  for (const [item, offHand] of [[usedUp ? null : bot.heldItem, false], [bot.inventory.slots[45], true]]) {
    if (!itemEnabled(bot, item)) return
    if (block && bot.registry.blocksByName[item?.name]) return
    if (item) return bot.activateItem(offHand)
  }
}

// ItemStack.isItemEnabled: 1.20.5 - 1.20.6 hold 1.21's items behind the update_1_21 experiment, off on the recording
// servers
const UPDATE_1_21_ITEMS = new Set(['wind_charge', 'mace', 'breeze_rod', 'heavy_core', 'trial_key', 'ominous_trial_key', 'ominous_bottle'])
const itemEnabled = (bot, item) => !(item && UPDATE_1_21_ITEMS.has(item.name) && bot.registry.version['<']('1.21'))

// Blocks whose use acts on a click (BlockBehaviour.use): containers, doors, command blocks and the like
const INTERACTIVE_BLOCK = /chest|barrel|shulker_box|door|gate|button|lever|furnace|smoker|crafting_table|anvil|table|bed|loom|stonecutter|grindstone|brewing_stand|hopper|dispenser|dropper|beacon|bell|repeater|comparator|note_block|jukebox|lectern|cake|campfire|composter|respawn_anchor|sign|command_block/

// The Leave Bed button (InBedChatScreen.sendWakeUp), a click the client handles before its tick: where the recorded
// client sent its STOP_SLEEPING, the sleeping bot wakes up (bot.wake).
function leaveBed (bot, version, row) {
  const stops = (row.events.clientPackets ?? []).some(p => {
    if (!fixtures.isRecorded(p.bytes)) return false
    const packet = readServerbound(version, fixtures.bytesOf(p.bytes))
    return packet?.name === 'entity_action' && packet.params.actionId === 'stop_sleeping'
  })
  if (stops && bot.isSleeping) bot.wake().catch(() => {})
}

// The client's state when the case began, on the public model (bot.entity) mineflayer's physics reads.
function useStart (bot, start) {
  const entity = bot.entity
  entity.position.set(...start.pos)
  entity.velocity.set(...start.vel)
  entity.onGround = start.onGround
  entity.isCollidedHorizontally = start.isCollidedHorizontally
  entity.minorHorizontalCollision = !!start.minorHorizontalCollision
  entity.isCollidedVertically = start.isCollidedVertically
  entity.isInWater = start.isInWater
  entity.isInLava = start.isInLava
  entity.isInWeb = start.isInWeb
  entity.isSprinting = !!start.sprinting
  bot.jumpTicks = start.jumpTicks ?? 0
}

// The other entities the client held when the case began, in bot.entities as their spawn packets would have left them
// (the server's later packets about them then move them).
function useEntities (bot, start) {
  const Entity = fromMineflayer('prismarine-entity')(bot.version)
  for (const { id, type, pos, vel, yaw, pitch, onGround } of start.entities ?? []) {
    const data = bot.registry.entitiesByName[type]
    const entity = bot.entities[id] ?? (bot.entities[id] = new Entity(id))
    Object.assign(entity, { type: data?.type ?? 'other', name: type, displayName: data?.displayName, entityType: data?.id, kind: data?.category, width: data?.width, height: data?.height })
    entity.position.set(...pos)
    entity.velocity.set(...vel)
    if (yaw !== undefined) entity.yaw = conv.fromNotchianYaw(yaw)
    if (pitch !== undefined) entity.pitch = conv.fromNotchianPitch(pitch)
    if (onGround !== undefined) entity.onGround = onGround
  }
}

// The vehicle the client rode when the case began, as the server put it there: set_passengers (1.9+), attach_entity
// before. A horse the case rode was tame and saddled: its AbstractHorse flags (bits 2 and 4) at the version's metadata
// index, and from 1.21.5 the saddle it wears (equipment slot 7).
const HORSE_TYPES = new Set(['horse', 'donkey', 'mule', 'skeleton_horse', 'zombie_horse', 'llama', 'trader_llama', 'camel'])
function useVehicle (bot, client, registry, start) {
  const vehicleId = start.netState?.vehicleId
  if (vehicleId == null) return
  const entityId = start.netState?.entityId ?? 1
  const vehicle = bot.entities[vehicleId]
  if (vehicle && (HORSE_TYPES.has(vehicle.name) || vehicle.name === 'EntityHorse')) {
    const v = registry.version
    const flagsIndex = v['<']('1.9') ? 16 : v['<']('1.10') ? 12 : v['<']('1.14') ? 13 : v['<']('1.15') ? 15 : v['<']('1.17') ? 16 : 17
    vehicle.metadata ??= []
    vehicle.metadata[flagsIndex] = 0x02 | 0x04
    if (v['>=']('1.21.5') && registry.itemsByName.saddle) {
      const Item = fromMineflayer('prismarine-item')(registry)
      vehicle.setEquipment(7, new Item(registry.itemsByName.saddle.id, 1))
    }
  }
  if (registry.version['>=']('1.9')) client.receive('set_passengers', { entityId: vehicleId, passengers: [entityId] })
  else client.receive('attach_entity', { entityId, vehicleId, leash: false })
}

function recordedUuid (version, rec) {
  for (const row of fixtures.expand(rec)) {
    for (const entry of row.events.serverPackets ?? []) {
      if (!fixtures.isRecorded(entry.bytes)) continue
      const packet = readClientbound(version, fixtures.bytesOf(entry.bytes))
      const uuid = packet?.name === 'player_info' && packet.params.data?.find(item => item.uuid)?.uuid
      if (uuid) return uuid
    }
  }
  return undefined
}

function teleport (registry, [x, y, z], yaw, pitch) {
  return {
    x,
    y,
    z,
    yaw,
    pitch,
    flags: registry.supportFeature('positionPacketHasBitflags') ? { x: false, y: false, z: false, yaw: false, pitch: false } : 0,
    teleportId: 0,
    dx: 0,
    dy: 0,
    dz: 0
  }
}

async function startBot (version, rec) {
  const registry = registryFor(version)
  const fixture = fixtures.load(version)
  const start = fixtures.start(rec)
  const net = start.netState ?? {}
  const client = createFakeClient(version)
  // the player's UUID, as the login told the client (minecraft-protocol keeps it as client.uuid)
  client.uuid = recordedUuid(version, rec)
  const bot = mineflayer.createBot({ client, username: client.username, physicsManual: true, respawn: false, hideErrors: true, logErrors: false })
  // mineflayer injects its plugins on a timer after createBot: the packets below need their handlers
  await new Promise(resolve => bot.once('inject_allowed', () => setImmediate(resolve)))
  client.setState('play')
  // the dimensions a server sends during configuration (1.20.2+), or in the login packet before
  const codec = registry.registryCodec ?? registry.loginPacket?.dimensionCodec
  if (registry.supportFeature('segmentedRegistryCodecData')) {
    for (const entry of Object.values(codec ?? {})) client.receive('registry_data', entry)
  } else if (registry.supportFeature('hasConfigurationState')) {
    client.receive('registry_data', { codec: codec ?? {} })
  }
  client.receive('login', loginPacket(registry, start, rec))
  // a 1.21.4+ server follows the login with level_chunks_load_start (PlayerList.placeNewPlayer)
  if (registry.version['>=']('1.21.4')) client.receive('game_state_change', { reason: 'level_chunks_load_start', gameMode: 0 })
  for (const [x, z, column] of columnsOf(bot, fixture, rec)) bot.world.setColumn(x, z, column)
  equip(client, registry, version, rec)
  useEntities(bot, start)
  client.receive('update_health', { health: 20, food: start.food ?? 20, foodSaturation: 5 })
  receiveSynced(client, registry, start)
  receiveAbilities(client, start, rec)
  // A teleport to where the client last told the server it was, answered by one tick: the bot's own record of what it
  // sent is then the client's (position and rotation). The client was moving on from there: the start state follows.
  const lastYaw = net.lastYaw ?? start.yaw
  const lastPitch = net.lastPitch ?? start.pitch
  client.receive('position', teleport(registry, net.lastPos ?? start.pos, lastYaw, lastPitch))
  setLook(bot, lastYaw, lastPitch)
  bot.tickPhysics()
  // sprinting and sneaking as the client last told the server (each change writes its packet)
  if (net.wasSprinting) bot.setControlState('sprint', true)
  if (net.lastSentInput ? net.lastSentInput[5] : net.wasSneaking) bot.setControlState('sneak', true)
  useVehicle(bot, client, registry, start)
  useStart(bot, start)
  client.written.length = 0
  return { bot, client }
}

function entityState (bot) {
  return { pos: bot.entity.position, vel: bot.entity.velocity, onGround: bot.entity.onGround }
}

async function replay (version, rec) {
  const rows = fixtures.expand(rec)
  const packetsOf = packets => (packets ?? [])
    .filter(p => fixtures.isRecorded(p.bytes))
    .map(p => ({ bytes: fixtures.bytesOf(p.bytes) }))
    .map(p => ({ ...p, name: serverboundName(version, p.bytes) }))
  const theirsOf = row => packetsOf(row.events.clientPackets)
  const { bot, client } = await startBot(version, rec)
  const useKey = createUseKey(bot)
  // A pausing screen in singleplayer stops the client's ticks; a real bot never pauses, so it skips those rows. The
  // recorder's flag where the fixture has it, else from 1.21.2 the missing tick_end every client tick ends with, else a
  // row that sent nothing and left LocalPlayer.positionReminder as the row before had it (every tick of a player not
  // riding counts it up or, sending its position, back to 0).
  const endsTick = row => theirsOf(row).some(p => p.name === 'tick_end')
  const marksTicks = rows.some(endsTick)
  const reminderOf = index => (index > 0 ? rows[index - 1] : fixtures.start(rec)).netState?.positionReminder
  const stood = (row, index) => row.netState?.positionReminder != null && row.netState.positionReminder === reminderOf(index) &&
    !row.netState.vehicleId && !(row.events.clientPackets ?? []).length
  const paused = (row, index) => row.paused ?? (marksTicks ? !endsTick(row) : stood(row, index))
  const divergences = []
  let inventoryHeld = false
  try {
    for (const [index, row] of rows.entries()) {
      // A row's food is sampled after its tick, so the food of a set_health the client handled after the tick shows in
      // that row without its packet: the bot gets the food the row before ended with.
      const foodBefore = (index > 0 ? rows[index - 1] : fixtures.start(rec)).food
      if (foodBefore != null && bot.food !== foodBefore) bot.food = foodBefore
      // a click on the screen comes before the server packets its server answers
      client.written.length = 0
      if (!paused(row, index)) leaveBed(bot, version, row)
      const clicked = client.written.filter(p => MOVEMENT.has(p.name))
      // what the bot sends while handling a server packet is checked against the client's responses to it
      const answered = []
      const responded = []
      for (const entry of row.events.serverPackets ?? []) {
        client.written.length = 0
        for (const part of entry.packets ?? [entry]) {
          if (!fixtures.isRecorded(part.bytes)) continue
          try { client.receiveBytes(fixtures.bytesOf(part.bytes)) } catch (err) { /* a packet the codec can't read is skipped */ }
        }
        answered.push(...client.written.filter(p => MOVEMENT.has(p.name)))
        responded.push(...packetsOf(entry.responses).filter(p => MOVEMENT.has(p.name)))
      }
      client.written.length = 0
      setKeys(bot, row.in)
      setLook(bot, row.in.yaw, row.in.pitch)
      // a press of the inventory key: a rider opens its mount's inventory (Minecraft.handleKeybinds, before the tick)
      if (row.in.inventory && !inventoryHeld && bot.vehicle) bot.openEntity(bot.vehicle).catch(() => {})
      inventoryHeld = !!row.in.inventory
      if (!paused(row, index)) {
        useKey(row.in)
        bot.tickPhysics()
      }
      const ours = [...clicked, ...client.written.filter(p => MOVEMENT.has(p.name))]
      const theirs = theirsOf(row).filter(p => MOVEMENT.has(p.name))
      client.written.length = 0
      const diffs = differences(entityState(bot), row, FIELDS)
      const differ = (a, b) => a.length !== b.length || a.some((p, i) => !p.bytes.equals(b[i].bytes))
      if (differ(ours, theirs)) diffs.unshift({ field: 'packets', expected: describe(theirs), actual: describe(ours) })
      if (differ(answered, responded)) diffs.unshift({ field: 'responses', expected: describe(responded), actual: describe(answered) })
      if (diffs.length) divergences.push({ t: row.t, input: row.in, diffs })
    }
  } finally {
    bot.end()
  }
  return { ticks: rows.length, divergences }
}

const describe = packets => packets.map(p => `${p.name}:${p.bytes.toString('hex')}`).join(' ') || '(none)'

module.exports = { replay, startBot, MOVEMENT }
