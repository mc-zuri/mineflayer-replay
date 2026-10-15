/* eslint-env mocha */
'use strict'
const assert = require('assert')
const { createFakeClient, readServerbound, readClientbound, serverboundName } = require('../../lib/fakeClient')

for (const version of ['1.8.8', '1.21.11']) {
  describe(`fake client ${version}`, function () {
    it('keeps what the bot writes with the bytes the server would read', function () {
      const client = createFakeClient(version)
      client.write('position', { x: 1.5, y: 64, z: -2.25, onGround: true, flags: { onGround: true, hasHorizontalCollision: false } })
      const [{ name, bytes }] = client.written
      assert.strictEqual(name, 'position')
      const read = readServerbound(version, bytes)
      assert.strictEqual(read.name, 'position')
      assert.strictEqual(read.params.x, 1.5)
      assert.strictEqual(read.params.z, -2.25)
      assert.strictEqual(serverboundName(version, bytes), 'position')
    })

    it('emits a server packet decoded from its bytes, as the real client does', function () {
      const client = createFakeClient(version)
      let received = null
      client.on('update_health', (params, meta) => { received = { params, meta } })
      client.setState('play')
      client.receiveWritten('update_health', { health: 7, food: 15, foodSaturation: 2 })
      assert.strictEqual(received.meta.name, 'update_health')
      assert.strictEqual(received.params.health, 7)
      assert.strictEqual(received.params.food, 15)
    })

    it('reads nothing from bytes that are not a packet', function () {
      assert.strictEqual(readClientbound(version, Buffer.from([0xff, 0xff, 0xff])), null)
      assert.strictEqual(serverboundName(version, Buffer.from([0xff, 0xff, 0xff])), 'unknown')
    })
  })
}
