import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const largeSurfaces = [
  ['src/pages/Home.jsx', 'trackFullArtURL(arts[0])', 'trackFullArtURL(track)'],
  ['src/components/ClassicMadeForYou.jsx', 'trackFullArtURL(pick.track)'],
  ['src/pages/Radio.jsx', 'trackFullArtURL(seed)'],
  ['src/pages/Genres.jsx', 'trackFullArtURL(tracks[0])', 'trackFullArtURL(track)'],
  ['src/components/MusicVideoPlayer.jsx', 'trackFullArtURL(currentTrack)'],
]

test('large track-art surfaces request full-size covers', () => {
  for (const [file, ...calls] of largeSurfaces) {
    const source = read(file)
    for (const call of calls) {
      assert.ok(source.includes(call), `${file} should use ${call}`)
    }
    assert.ok(source.includes('|| trackArtURL('), `${file} should retain the thumbnail fallback`)
  }
})

test('small track-list and player-bar covers keep using cached thumbnails', () => {
  const trackList = read('src/components/TrackList.jsx')
  const playerBar = read('src/components/PlayerBar.jsx')
  assert.ok(trackList.includes('trackArtURL(t)'))
  assert.ok(playerBar.includes('trackArtURL(currentTrack)'))
})
