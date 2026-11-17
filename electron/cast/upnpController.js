const { EventEmitter } = require('events')
const { coordinator, soap, AV, RC, GROUP_RC, seconds, timestamp } = require('./upnp')
const { didl, value } = require('./upnpXml')

// Owns network I/O, queue preparation and clock polling in Electron's main
// process. Minimizing the renderer never parks the receiver's queue worker.
class UpnpController extends EventEmitter {
  constructor({ media, server, fetchImpl = fetch, log = () => {} }) {
    super(); this.media = media; this.server = server; this.fetch = fetchImpl; this.log = log
    this.state = 'idle'; this.entries = []; this.prepared = new Map(); this.revision = 0; this.epoch = 0; this.serial = Promise.resolve()
    this.position = 0; this.playerState = 'IDLE'; this.volume = { level: 1, muted: false }
  }
  status() {
    return { state: this.state, device: this.device, receiver: this.device?.sonos ? 'sonos' : 'dlna', trackId: this.current?.trackId || null,
      playerState: this.playerState, position: this.position, positionAt: this.positionAt, duration: this.current?.duration || 0, volume: this.volume, error: this.error || null }
  }
  publish() { this.emit('status', this.status()) }
  av(action, args = {}) { const s = this.device.services.AVTransport; return soap(s.url, s.type || AV, action, { InstanceID: 0, ...args }, this.fetch) }
  rc(action, args = {}) {
    const s = this.device?.sonos && this.device.services.GroupRenderingControl || this.device?.services.RenderingControl
    if (!s) throw new Error('This receiver does not expose volume control')
    const group = s === this.device.services.GroupRenderingControl
    return soap(s.url, s.type || (group ? GROUP_RC : RC), group ? action.replace(/^(Get|Set)/, '$1Group') : action,
      { InstanceID: 0, ...(group ? {} : { Channel: 'Master' }), ...args }, this.fetch)
  }
  enqueue(work) { const next = this.serial.then(work); this.serial = next.catch(() => {}); return next }
  async connect(device) {
    this.device = await coordinator(device, this.fetch)
    await this.server.start()
    this.state = 'connected'; this.epoch++; this.error = null
    try { await this.readVolume() } catch {}
    this.pollTimer = setInterval(() => { if (!this.polling && !this.syncing) this.poll().catch(error => this.failedPoll(error)) }, 1500)
    this.pollTimer.unref?.(); this.publish(); return { joined: false }
  }
  async prepare(track) {
    const id = String(track.id)
    if (this.prepared.has(id)) return this.prepared.get(id)
    const epoch = this.epoch
    let expired = false; let timer
    const work = this.media.prepare(track, { deviceHost: this.device.host, receiver: this.device.sonos ? 'sonos' : 'dlna' })
      .then(item => { if (expired) this.media.release(item); return item })
    let item
    try {
      item = await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => { expired = true; reject(new Error('Receiver source preparation timed out')) }, 20000) })])
    } finally { clearTimeout(timer) }
    if (epoch !== this.epoch) { this.media.release(item); throw new Error('Output changed while preparing audio') }
    this.prepared.set(id, item); return item
  }
  setWindow(window) {
    if (!window?.current) return Promise.resolve()
    const revision = ++this.revision
    return this.enqueue(async () => {
      if (revision !== this.revision || this.state !== 'connected') return
      this.syncing = true
      try { await this.apply(window, revision) }
      catch (error) {
        if (revision === this.revision) { this.error = error.message; this.publish(); this.emit('trackError', { trackId: window.current.id, message: error.message }) }
        throw error
      }
      finally { this.syncing = false }
    })
  }
  async apply(want, revision) {
    const epoch = this.epoch
    const fresh = () => revision === this.revision && epoch === this.epoch
    const item = await this.prepare(want.current)
    if (!fresh()) return
    const changed = !this.current || this.current.trackId !== item.trackId || want.reload
    if (changed) {
      const held = !want.reload && this.entries.findIndex(e => e.url === item.url)
      if (this.device.sonos && held !== false && held >= 0 && this.queueOwned) {
        await this.av('Seek', { Unit: 'TRACK_NR', Target: held + 1 })
      } else if (this.device.sonos) {
        await this.av('Stop')
        if (!fresh()) return
        await this.av('RemoveAllTracksFromQueue')
        this.entries = []
        await this.add(item)
        await this.av('SetAVTransportURI', { CurrentURI: `x-rincon-queue:${this.device.uuid}#0`, CurrentURIMetaData: '' })
        this.queueOwned = true
        await this.av('Seek', { Unit: 'TRACK_NR', Target: 1 })
      } else {
        await this.av('SetAVTransportURI', { CurrentURI: item.url, CurrentURIMetaData: didl(item) })
        this.entries = [item]
      }
      if (!fresh()) return
      this.current = item; this.position = Number(want.position) || 0; this.positionAt = Date.now()
      if (this.position > 0) await this.av('Seek', { Unit: 'REL_TIME', Target: timestamp(this.position) })
      if (want.play !== false) await this.av('Play', { Speed: 1 })
      this.playerState = want.play === false ? 'PAUSED' : 'PLAYING'
      this.finishedFor = null; this.publish()
    }
    const repeat = want.repeat === 'one'
    if (this.device.sonos) await this.av('SetPlayMode', { NewPlayMode: repeat ? 'REPEAT_ONE' : 'NORMAL' })
    const upcoming = repeat ? [] : (want.upcoming || []).slice(0, 4)
    const ready = []
    for (const track of upcoming) {
      try { const next = await this.prepare(track); if (!fresh()) return; ready.push(next) }
      catch (error) { this.log(`UPnP queue preparation: ${error.message}`); break }
    }
    if (!fresh()) return
    if (this.device.sonos) {
      let here = this.entries.findIndex(e => e.url === this.current.url)
      if (here < 0) return
      if (here > 0) {
        await this.av('RemoveTrackRangeFromQueue', { UpdateID: 0, StartingIndex: 1, NumberOfTracks: here })
        this.entries.splice(0, here)
        here = 0
      }
      let kept = 0
      const ahead = this.entries.slice(here + 1)
      while (kept < ahead.length && kept < ready.length && ahead[kept].url === ready[kept].url) kept++
      if (ahead.length > kept) {
        await this.av('RemoveTrackRangeFromQueue', { UpdateID: 0, StartingIndex: here + kept + 2, NumberOfTracks: ahead.length - kept })
        this.entries.splice(here + kept + 1)
      }
      for (const next of ready.slice(kept)) { if (!fresh()) return; await this.add(next) }
    } else {
      const next = repeat ? item : ready[0]
      if (this.nextUrl !== (next?.url || '')) {
        try {
          await this.av('SetNextAVTransportURI', { NextURI: next?.url || '', NextURIMetaData: next ? didl(next) : '' })
          this.nextUrl = next?.url || ''; this.entries = [item, ...(next ? [next] : [])]
          this.nextSupported = true
        } catch { this.nextSupported = false; this.entries = [item] }
      }
    }
    this.repeat = repeat
    const retained = new Set(this.entries.map(e => e.trackId))
    for (const [id, prepared] of this.prepared) if (!retained.has(id) && id !== item.trackId) { this.media.release(prepared); this.prepared.delete(id) }
    this.error = null; this.publish()
  }
  async add(item) {
    await this.av('AddURIToQueue', { EnqueuedURI: item.url, EnqueuedURIMetaData: didl(item), DesiredFirstTrackNumberEnqueued: 0, EnqueueAsNext: 0 })
    this.entries.push(item)
  }
  async readVolume() {
    const v = await this.rc('GetVolume')
    const level = Number(value(v, this.device.services.GroupRenderingControl ? 'CurrentVolume' : 'CurrentVolume'))
    if (Number.isFinite(level)) this.volume.level = Math.max(0, Math.min(1, level / 100))
    const m = await this.rc('GetMute'); this.volume.muted = value(m, 'CurrentMute') === '1'
  }
  async poll() {
    if (!this.current || this.state !== 'connected') return
    this.polling = true
    const epoch = this.epoch
    try {
      const [position, transport] = await Promise.all([this.av('GetPositionInfo'), this.av('GetTransportInfo')])
      if (epoch !== this.epoch || this.syncing) return
      this.failures = 0
      const uri = value(position, 'TrackURI')
      const item = this.entries.find(e => e.url === uri)
      if (uri && !item) {
        // Another controller took ownership. Never overwrite its queue.
        this.end('stopped'); return
      }
      const state = value(transport, 'CurrentTransportState')
      const previous = this.playerState
      if (item) this.current = item
      this.position = seconds(value(position, 'RelTime')); this.positionAt = Date.now()
      this.playerState = state === 'PLAYING' ? 'PLAYING' : state === 'TRANSITIONING' ? 'BUFFERING' : state === 'PAUSED_PLAYBACK' ? 'PAUSED' : 'IDLE'
      await this.readVolume().catch(() => {})
      if (epoch !== this.epoch) return
      this.publish()
      // STOP alone is not completion: require a last-seconds observation.
      if (state === 'STOPPED' && previous === 'PLAYING' && this.lastDuration > 0 && this.lastPosition >= this.lastDuration - 3 && !this.stopping && this.finishedFor !== this.current.trackId) {
        this.finishedFor = this.current.trackId; this.emit('finished')
      }
      this.lastPosition = this.position; this.lastDuration = seconds(value(position, 'TrackDuration')) || this.current.duration
    } finally { this.polling = false }
  }
  failedPoll(error) {
    if (this.state !== 'connected') return
    this.error = `Receiver unreachable: ${error.message}`; this.publish()
    if ((this.failures = (this.failures || 0) + 1) >= 4) this.end('lost')
  }
  async play() { await this.av('Play', { Speed: 1 }); this.playerState = 'PLAYING'; this.publish() }
  async pause() { await this.av('Pause'); this.playerState = 'PAUSED'; this.publish() }
  async seek(position) { await this.av('Seek', { Unit: 'REL_TIME', Target: timestamp(position) }); this.position = Number(position); this.positionAt = Date.now(); this.publish() }
  async setVolume({ level, muted }) {
    if (level != null) { const n = Number(level); if (!Number.isFinite(n)) throw new Error('Invalid volume'); await this.rc('SetVolume', { DesiredVolume: Math.round(Math.max(0, Math.min(1, n)) * 100) }); this.volume.level = Math.max(0, Math.min(1, n)) }
    if (muted != null) { await this.rc('SetMute', { DesiredMute: muted ? 1 : 0 }); this.volume.muted = !!muted }
    this.publish()
  }
  async disconnect({ stopReceiver = true } = {}) {
    const last = this.status(); this.stopping = true
    this.revision++
    await this.serial
    // A failed Stop must not authorize local autoplay or a second receiver.
    try { if (stopReceiver && this.device) await this.av('Stop') }
    catch (error) { this.stopping = false; throw error }
    this.cleanup(); this.state = 'idle'; this.publish(); return last
  }
  end(reason) { const last = this.status(); this.cleanup(); this.state = 'idle'; this.publish(); this.emit('ended', { reason, last }) }
  cleanup() { this.epoch++; this.revision++; clearInterval(this.pollTimer); this.current = null; this.entries = []; for (const p of this.prepared.values()) this.media.release(p); this.prepared.clear(); this.server.stop(); this.device = null }
  sendCustom() { return false }
  sendUpNext() { return false }
  sendVideo() { return false }
}
module.exports = { UpnpController }
