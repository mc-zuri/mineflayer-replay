'use strict'
// A minecraft-protocol client without a connection: what the bot writes is serialized with the real play-state codec
// and kept (`written`), what the server sent is decoded from the recorded bytes and emitted as the real client would.
const { EventEmitter } = require('events')
const mc = require('minecraft-protocol')

const codecs = new Map()
function codecsFor (version) {
  if (!codecs.has(version)) {
    codecs.set(version, {
      toServer: mc.createSerializer({ state: 'play', isServer: false, version }),
      fromServer: mc.createDeserializer({ state: 'play', isServer: false, version }),
      // what a server writes
      toClient: mc.createSerializer({ state: 'play', isServer: true, version }),
      // the recorded client packets, read as the server reads them
      readServerbound: mc.createDeserializer({ state: 'play', isServer: true, version })
    })
  }
  return codecs.get(version)
}

function createFakeClient (version, username = 'replay') {
  const codec = codecsFor(version)
  const client = new EventEmitter()
  client.setMaxListeners(0)
  client.version = version
  client.username = username
  client.state = 'handshaking'
  client.written = []
  client.write = (name, params) => {
    client.written.push({ name, params, bytes: codec.toServer.createPacketBuffer({ name, params }) })
  }
  client.end = reason => client.emit('end', reason ?? 'replay ended')
  require('minecraft-protocol/src/client/pluginChannels')(client, { version })
  // a packet the server sent, as decoded params
  client.receive = (name, params) => client.emit(name, params, { name, state: client.state })
  // a packet the server sent, as its recorded bytes (packet id and payload)
  client.receiveBytes = bytes => {
    const { data } = codec.fromServer.parsePacketBuffer(bytes)
    client.receive(data.name, data.params)
    return data.name
  }
  // a packet the server sent, as the server's codec writes it
  client.receiveWritten = (name, params) => client.receiveBytes(codec.toClient.createPacketBuffer({ name, params }))
  client.setState = state => {
    const previous = client.state
    client.state = state
    client.emit('state', state, previous)
  }
  return client
}

// The name of a recorded serverbound packet (packet id and payload), as minecraft-protocol calls it.
function serverboundName (version, bytes) {
  try {
    return codecsFor(version).readServerbound.parsePacketBuffer(bytes).data.name
  } catch {
    return 'unknown'
  }
}

// A recorded serverbound packet as minecraft-protocol decodes it ({ name, params }), or null.
function readServerbound (version, bytes) {
  try {
    return codecsFor(version).readServerbound.parsePacketBuffer(bytes).data
  } catch {
    return null
  }
}

// A recorded clientbound packet (packet id and payload) as minecraft-protocol decodes it ({ name, params }), or null.
function readClientbound (version, bytes) {
  try {
    return codecsFor(version).fromServer.parsePacketBuffer(bytes).data
  } catch {
    return null
  }
}

module.exports = { createFakeClient, serverboundName, readServerbound, readClientbound }
