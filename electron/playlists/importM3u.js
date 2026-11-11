'use strict'

// Portable M3U/M3U8 parser and path matcher for Electron and web-server imports.
// Unlike a local absolute path, an exported playlist may refer to another
// device's file tree, a Windows drive or a SAF-backed library.
function basename(raw) {
  let value = String(raw || '').trim().replace(/^\uFEFF/, '')
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
  if (/^file:/i.test(value)) {
    try {
      value = new URL(value).pathname.replace(/^\/([a-z]:)/i, '$1')
    } catch {}
  }
  value = value.replace(/\\/g, '/').split(/[?#]/)[0]
  value = value.slice(value.lastIndexOf('/') + 1)
  try { value = decodeURIComponent(value) } catch {}
  return value.trim()
}

function parseM3U(content) {
  const entries = []
  let pending = null
  for (const raw of String(content || '').split(/\r\n|\r|\n/)) {
    const line = raw.trim().replace(/^\uFEFF/, '')
    if (!line) continue
    if (/^#EXTINF:/i.test(line)) {
      const body = line.slice('#EXTINF:'.length)
      const comma = body.indexOf(',')
      pending = comma >= 0 ? {
        duration: Number.isFinite(Number.parseFloat(body.slice(0, comma)))
          ? Math.round(Number.parseFloat(body.slice(0, comma))) : null,
        display: body.slice(comma + 1).trim(),
      } : null
      continue
    }
    if (line.startsWith('#')) continue
    const display = pending?.display || basename(line).replace(/\.[^.]+$/, '')
    const separator = display.indexOf(' - ')
    const artist = separator > 0 ? display.slice(0, separator).trim() : null
    const title = separator > 0 ? display.slice(separator + 3).trim() : display.trim()
    entries.push({
      file_path: line.replace(/^(['"])(.*)\1$/, '$2'),
      title: title || null,
      artist,
      duration: pending?.duration ?? null,
    })
    pending = null
  }
  return entries
}

function findByFilename(db, entry) {
  const fileName = basename(entry?.file_path).toLocaleLowerCase()
  if (!fileName) return null
  // SQL limits candidates, then JS verifies the entire basename to avoid
  // treating '_' and '%' as literal characters in a LIKE expression.
  const candidates = db.prepare(
    "SELECT id, file_path, title, artist FROM tracks WHERE file_path NOT LIKE 'ghost://%' AND LOWER(file_path) LIKE ? LIMIT 250"
  ).all('%' + fileName).filter(track => basename(track.file_path).toLocaleLowerCase() === fileName)
  if (candidates.length === 1) return { id: candidates[0].id }
  if (candidates.length < 2 || !entry.title) return null
  const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase().trim()
  const exact = candidates.filter(track =>
    normalize(track.title) === normalize(entry.title) &&
    (!entry.artist || normalize(track.artist) === normalize(entry.artist)))
  return exact.length === 1 ? { id: exact[0].id } : null
}

module.exports = { basename, parseM3U, findByFilename }
