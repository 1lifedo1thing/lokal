// Opt-in daily/weekly app-data exports. Lives in Electron's main process so
// the schedule does not depend on the Settings page remaining open.
const fs = require('node:fs/promises')
const path = require('node:path')

const INTERVALS = { daily: 24 * 60 * 60 * 1000, weekly: 7 * 24 * 60 * 60 * 1000 }
const PREFIX = 'lokal-auto-backup-'
const KEEP = 10
const RETRY_MS = 60 * 60 * 1000

function createAutomaticBackups({ db, exportData, documentsPath, now = Date.now, files = fs }) {
  if (!db || typeof exportData !== 'function') throw new Error('Automatic backup needs a database and exporter')
  const read = key => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || ''
  const save = (key, value) => db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value))
  const defaultDirectory = path.resolve(documentsPath, 'Lokal Backups')
  let pending = null
  let lastAttempt = 0
  let localPrefs = null

  function status() {
    const frequency = INTERVALS[read('automatic_backup_frequency')] ? read('automatic_backup_frequency') : 'off'
    const raw = read('automatic_backup_directory')
    const directory = raw && path.isAbsolute(raw) ? path.resolve(raw) : defaultDirectory
    const lastSuccess = Number(read('automatic_backup_last_success')) || 0
    return {
      frequency, directory, lastSuccess, busy: !!pending,
      nextDue: frequency === 'off' ? null : lastSuccess + INTERVALS[frequency],
    }
  }
  function configure({ frequency, directory } = {}) {
    if (frequency !== undefined) {
      if (frequency !== 'off' && !INTERVALS[frequency]) throw new Error('Invalid backup frequency')
      save('automatic_backup_frequency', frequency)
    }
    if (directory !== undefined) {
      if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('Choose an absolute backup directory')
      save('automatic_backup_directory', path.resolve(directory))
    }
    return status()
  }
  function capturePrefs(value) {
    // Only the curated renderer preference export is accepted; never credentials.
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const encoded = JSON.stringify(value)
      if (encoded.length < 1024 * 1024) localPrefs = JSON.parse(encoded)
    }
  }
  async function writeBackup() {
    const { directory } = status()
    await files.mkdir(directory, { recursive: true, mode: 0o700 })
    const timestamp = new Date(now()).toISOString().replace(/[:.]/g, '-')
    const name = `${PREFIX}${timestamp}.json`
    const destination = path.join(directory, name)
    const temporary = `${destination}.tmp`
    try {
      const data = exportData()
      if (!data || data.version !== 1) throw new Error('Backup exporter returned an invalid payload')
      if (localPrefs) data.localPrefs = localPrefs
      // A complete, unmodified export remains compatible with Import Backup.
      await files.writeFile(temporary, JSON.stringify(data), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      await files.rename(temporary, destination)
    } catch (error) {
      await files.rm(temporary, { force: true }).catch(() => {})
      throw error
    }
    save('automatic_backup_last_success', now())
    // Only rotate files created by this feature. Never touch manual exports.
    try {
      const entries = (await files.readdir(directory)).filter(name =>
        /^lokal-auto-backup-\d{4}-\d{2}-\d{2}T[\d-]+Z\.json$/.test(name),
      ).sort().reverse()
      for (const extra of entries.slice(KEEP)) await files.rm(path.join(directory, extra), { force: true })
    } catch (error) {
      // Rotation failure cannot turn an already completed export into a failure.
      console.warn('[backups] Could not rotate old backups:', error.message)
    }
    return { ...status(), filePath: destination }
  }
  function run({ force = false } = {}) {
    if (pending) return pending
    const state = status()
    if (!force) {
      if (state.frequency === 'off' || now() < state.nextDue || now() - lastAttempt < RETRY_MS) return Promise.resolve(state)
    }
    lastAttempt = now()
    pending = writeBackup().finally(() => { pending = null })
    return pending
  }
  return { status, configure, capturePrefs, run }
}

module.exports = { createAutomaticBackups, INTERVALS, KEEP }
