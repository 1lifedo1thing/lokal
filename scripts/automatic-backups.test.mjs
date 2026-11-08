import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createAutomaticBackups, KEEP } = require('../electron/automaticBackups.js')

function fixture(dir, clock, exporter = () => ({ version: 1, users: [], play_history: [] })) {
  const state = new Map()
  const db = {
    prepare(query) {
      if (query.startsWith('SELECT')) return { get: key => ({ value: state.get(key) || '' }) }
      if (query.startsWith('INSERT')) return { run: (key, value) => state.set(key, value) }
      throw new Error(query)
    },
  }
  return createAutomaticBackups({ db, exportData: exporter, documentsPath: dir, now: () => clock.value })
}

test('daily automatic backups are opt-in, due-based and compatible with manual import', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lokal-auto-backup-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const clock = { value: Date.parse('2026-11-08T12:00:00Z') }
  const backup = fixture(dir, clock)
  assert.equal(backup.status().frequency, 'off')
  await backup.run()
  await assert.rejects(fs.stat(backup.status().directory), /ENOENT/)
  backup.configure({ frequency: 'daily' })
  backup.capturePrefs({ localTheme: 'dark' })
  const first = await backup.run()
  assert.equal(first.lastSuccess, clock.value)
  assert.ok(first.filePath.endsWith('.json'))
  assert.equal(JSON.parse(await fs.readFile(first.filePath, 'utf8')).localPrefs.localTheme, 'dark')
  assert.equal((await fs.readdir(first.directory)).length, 1)
  clock.value += 12 * 60 * 60 * 1000
  await backup.run()
  assert.equal((await fs.readdir(first.directory)).length, 1)
  clock.value += 12 * 60 * 60 * 1000
  await backup.run()
  assert.equal((await fs.readdir(first.directory)).length, 2)
})

test('failed scheduled exports preserve prior files and retry without recording success', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lokal-auto-backup-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const clock = { value: Date.parse('2026-11-08T12:00:00Z') }
  let broken = false
  const backup = fixture(dir, clock, () => {
    if (broken) throw Error('database busy')
    return { version: 1, playlists: [] }
  })
  backup.configure({ frequency: 'weekly' })
  const before = await backup.run()
  broken = true
  clock.value += 7 * 24 * 60 * 60 * 1000
  await assert.rejects(backup.run(), /database busy/)
  assert.equal(backup.status().lastSuccess, before.lastSuccess)
  assert.deepEqual(await fs.readdir(before.directory), [path.basename(before.filePath)])
})

test('rotation keeps the newest ten automatic exports without deleting other files', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lokal-auto-backup-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const clock = { value: Date.parse('2026-11-08T12:00:00Z') }
  const backup = fixture(dir, clock)
  backup.configure({ frequency: 'daily' })
  const directory = backup.status().directory
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(path.join(directory, 'manual-export.json'), '{}')
  for (let i = 0; i < KEEP + 3; i++) {
    await backup.run()
    clock.value += 24 * 60 * 60 * 1000
  }
  const files = await fs.readdir(directory)
  assert.equal(files.filter(file => file.startsWith('lokal-auto-backup-')).length, KEEP)
  assert.ok(files.includes('manual-export.json'))
})
