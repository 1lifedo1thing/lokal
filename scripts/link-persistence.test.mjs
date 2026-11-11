import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { createHmac, createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
const require = createRequire(import.meta.url)
const { LinkStore } = require('../electron/link/store')

const phone = 'phone_12345678', user = 'owner', challenge = 'a'.repeat(64)
function open(path, now) {
  const db = new DatabaseSync(path)
  db.exec('CREATE TABLE IF NOT EXISTS playlists (id TEXT PRIMARY KEY, uuid TEXT)')
  return { db, store: new LinkStore(db, { now: () => now.value }) }
}
function paired(store) {
  const { code } = store.createPairing(user)
  return store.pair({ code, deviceId: phone, deviceName: 'Phone' }, '192.168.1.10')
}

test('pair survives days without traffic and desktop restarts until explicitly revoked', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lokal-link-'))
  const path = join(directory, 'link.db'), now = { value: 1000 }
  let { db, store } = open(path, now)
  try {
    const { token, desktopId } = paired(store)
    db.close()
    now.value += 7 * 86400000
    ;({ db, store } = open(path, now))
    assert.equal(store.deviceId, desktopId)
    assert.equal(store.authenticate(token).id, phone)
    const identity = store.identity({ deviceId: phone, challenge }, user)
    const key = createHash('sha256').update(token).digest()
    const expected = createHmac('sha256', key)
      .update(JSON.stringify(['lokal-link-identity-v1', challenge, desktopId, phone, user])).digest('hex')
    assert.deepEqual(identity, { desktopId, userId: user, proof: expected })
    assert.equal(JSON.stringify(identity).includes(token), false)
    assert.equal(store.revoke(phone, user), true)
    assert.equal(store.authenticate(token), null)
    assert.throws(() => store.identity({ deviceId: phone, challenge }, user), { status: 401 })
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }) }
})

test('proof is bound to challenge, profile and current pairing', () => {
  const { db, store } = open(':memory:', { value: 1 })
  try {
    paired(store)
    const first = store.identity({ deviceId: phone, challenge }, user).proof
    assert.notEqual(store.identity({ deviceId: phone, challenge: 'b'.repeat(64) }, user).proof, first)
    assert.throws(() => store.identity({ deviceId: phone, challenge }, 'different-owner'), { status: 401 })
    assert.throws(() => store.identity({ deviceId: phone, challenge: 'a'.repeat(10000) }, user), { status: 400 })
    assert.throws(() => store.identity({ deviceId: 'unknown_phone', challenge }, user), { status: 401 })
    paired(store)
    assert.notEqual(store.identity({ deviceId: phone, challenge }, user).proof, first)
  } finally { db.close() }
})
