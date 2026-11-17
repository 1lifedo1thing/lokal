const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
function fixture(disconnect) {
  const source = fs.readFileSync(path.join(__dirname, '../src/cast/castStore.js'), 'utf8')
    .replace(/^import .*\n/gm, '').replaceAll('export const ', 'const ')
  let state
  const create = init => {
    const set = value => { state = { ...state, ...(typeof value === 'function' ? value(state) : value) } }
    state = init(set, () => state)
    return { getState: () => state, setState: set }
  }
  const api = { castAvailable: () => true, castDisconnect: disconnect }
  return new Function('create', 'api', source + '\nreturn useCastStore')(create, api)
}
test('failed Stop preserves the session and its error across routine polls', async () => {
  const store = fixture(async () => ({ error: 'Receiver offline' }))
  store.setState({ status: { state: 'connected' }, session: { at: 1 } })
  await store.getState().disconnect()
  assert.equal(store.getState().ended, null)
  store.getState().setStatus({ state: 'connected' })
  assert.equal(store.getState().error, 'Receiver offline')
  store.getState().setStatus({ state: 'idle' })
  assert.equal(store.getState().error, null)
})
test('explicit abandon releases the receiver with a non-autoplay reason', async () => {
  let options
  const store = fixture(async value => { options = value; return { state: 'connected', position: 25 } })
  store.setState({ status: { state: 'connected' }, session: { at: 1 } })
  await store.getState().leave()
  assert.equal(options.stopReceiver, false)
  assert.equal(store.getState().ended.reason, 'lost')
  assert.equal(store.getState().session, null)
})
test('ordinary confirmed disconnect retains the local-resume reason', async () => {
  const store = fixture(async () => ({ state: 'connected', position: 25 }))
  await store.getState().disconnect()
  assert.equal(store.getState().ended.reason, 'local')
})
