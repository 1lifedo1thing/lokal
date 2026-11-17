const { test } = require('node:test')
const assert = require('node:assert/strict')
const { parseXml, value, didl, escapeXml } = require('../electron/cast/upnpXml')
const { describe, coordinator, soap, timestamp, seconds, UpnpDiscovery } = require('../electron/cast/upnp')
const { UpnpController } = require('../electron/cast/upnpController')
const response = inner => ({ ok: true, status: 200, text: async () => `<s:Envelope xmlns:s="soap"><s:Body>${inner}</s:Body></s:Envelope>` })
const svc = name => ({ url: `http://192.168.1.20/${name}`, type: `urn:schemas-upnp-org:service:${name}:1` })
const device = sonos => ({ id: 'upnp:room', uuid: 'RINCON_20', name: 'Kitchen', host: '192.168.1.20', sonos,
  services: { AVTransport: svc('AVTransport'), RenderingControl: svc('RenderingControl'), ...(sonos ? { GroupRenderingControl: svc('GroupRenderingControl') } : {}) } })
function fixture(sonos = true) {
  const commands = []; const released = []; let uri = ''; let state = 'PLAYING'; let failStop = false
  const fetchImpl = async (url, options) => {
    const action = options.headers.SOAPAction.match(/#([^" ]+)/)[1]
    const doc = parseXml(options.body)
    commands.push({ action, doc, body: options.body })
    if (action === 'Stop' && failStop) throw new Error('receiver offline')
    if (action === 'GetPositionInfo') return response(`<Track>2</Track><TrackURI>${uri}</TrackURI><RelTime>0:00:12</RelTime><TrackDuration>0:03:00</TrackDuration>`)
    if (action === 'GetTransportInfo') return response(`<CurrentTransportState>${state}</CurrentTransportState>`)
    if (/Get.*Volume/.test(action)) return response('<CurrentVolume>37</CurrentVolume>')
    if (/Get.*Mute/.test(action)) return response('<CurrentMute>0</CurrentMute>')
    return response('')
  }
  const media = { prepare: async track => ({ trackId: String(track.id), url: `http://192.168.1.4/media/${track.id}`, duration: 180,
    mime: 'audio/flac', metadata: { title: `A & B <${track.id}>`, artist: 'Artist', albumName: 'Album', images: [{ url: 'http://192.168.1.4/art.jpg' }] } }), release: item => released.push(item) }
  const server = { start: async () => {}, stop: () => {} }
  const controller = new UpnpController({ media, server, fetchImpl })
  return { controller, commands, released, fetchImpl, setUri: u => { uri = u }, setState: s => { state = s }, failStop: () => { failStop = true } }
}
test('SOAP metadata is a string, preserving XML entities through two encoding layers', async () => {
  let body
  const item = { trackId: 'a', url: 'http://host/song?a=1&b=2', mime: 'audio/flac', metadata: { title: 'A & <B>', images: [{ url: 'http://host/a.jpg?a=1&b=2' }] } }
  await soap('http://host/control', 'urn:test', 'SetAVTransportURI', { CurrentURIMetaData: didl(item) }, async (_, o) => { body = o.body; return response('') })
  const nested = parseXml(value(parseXml(body), 'CurrentURIMetaData'))
  assert.equal(value(nested, 'title'), 'A & <B>'); assert.equal(value(nested, 'res'), item.url)
  assert.equal(value(nested, 'albumArtURI'), item.metadata.images[0].url)
})
test('SOAP faults are failures even when HTTP reports success', async () => {
  await assert.rejects(soap('http://host', 'urn:test', 'Play', {}, async () => response('<s:Fault><errorDescription>Transition unavailable</errorDescription></s:Fault>')), /Transition unavailable/)
})
test('XML rejects DTDs and malformed nesting; handles namespaces and CDATA', () => {
  assert.throws(() => parseXml('<!DOCTYPE x><x/>'))
  assert.throws(() => parseXml('<a><b></a>'))
  assert.equal(value(parseXml('<s:a xmlns:s="x"><s:Title><![CDATA[A & B]]></s:Title></s:a>'), 'Title'), 'A & B')
})
test('description honors URLBase and distinguishes group volume from room volume', async () => {
  const d = await describe('http://host/device.xml', async () => response('<URLBase>http://host:1400/</URLBase><device><deviceType>urn:schemas-upnp-org:device:ZonePlayer:1</deviceType><UDN>uuid:RINCON_1</UDN><manufacturer>Sonos</manufacturer><friendlyName>Kitchen</friendlyName><serviceList>' +
    ['AVTransport', 'RenderingControl', 'GroupRenderingControl'].map(n => `<service><serviceType>urn:schemas-upnp-org:service:${n}:1</serviceType><controlURL>${n}</controlURL></service>`).join('') + '</serviceList></device>'))
  assert.equal(d.services.RenderingControl.url, 'http://host:1400/RenderingControl')
  assert.equal(d.services.GroupRenderingControl.url, 'http://host:1400/GroupRenderingControl')
  assert.equal(d.sonos, true)
})
test('Sonos stages a native queue with covers; edits preserve the playing item', async t => {
  const f = fixture(); t.after(() => f.controller.cleanup()); await f.controller.connect(device(true))
  await f.controller.setWindow({ current: { id: 'a' }, upcoming: [{ id: 'b' }, { id: 'c' }], play: true })
  const before = f.commands.filter(c => c.action === 'SetAVTransportURI').length
  assert.equal(f.commands.filter(c => c.action === 'AddURIToQueue').length, 3)
  const queued = value(f.commands.find(c => c.action === 'AddURIToQueue').doc, 'EnqueuedURIMetaData')
  assert.equal(value(parseXml(queued), 'albumArtURI'), 'http://192.168.1.4/art.jpg')
  await f.controller.setWindow({ current: { id: 'a' }, upcoming: [{ id: 'c' }], play: true })
  assert.equal(f.commands.filter(c => c.action === 'SetAVTransportURI').length, before)
  const removed = f.commands.find(c => c.action === 'RemoveTrackRangeFromQueue')
  assert.equal(value(removed.doc, 'StartingIndex'), '2')
  assert.equal(value(removed.doc, 'NumberOfTracks'), '2')
})
test('receiver queue advancement reports its new song and clock', async t => {
  const f = fixture(); t.after(() => f.controller.cleanup()); await f.controller.connect(device(true))
  await f.controller.setWindow({ current: { id: 'a' }, upcoming: [{ id: 'b' }] })
  f.setUri('http://192.168.1.4/media/b'); await f.controller.poll()
  assert.equal(f.controller.status().trackId, 'b'); assert.equal(f.controller.status().position, 12)
})
test('group volume is clamped and receiver-side changes are reflected', async t => {
  const f = fixture(); t.after(() => f.controller.cleanup()); await f.controller.connect(device(true))
  await f.controller.setVolume({ level: 4, muted: true })
  assert.equal(value(f.commands.find(c => c.action === 'SetGroupVolume').doc, 'DesiredVolume'), '100')
  assert(f.commands.some(c => c.action === 'SetGroupMute'))
  await f.controller.readVolume(); assert.equal(f.controller.status().volume.level, .37)
  await assert.rejects(f.controller.setVolume({ level: NaN }), /Invalid volume/)
})
test('generic renderers get SetNextAVTransportURI and ordinary RenderingControl', async t => {
  const f = fixture(false); t.after(() => f.controller.cleanup()); await f.controller.connect(device(false))
  await f.controller.setWindow({ current: { id: 'a' }, upcoming: [{ id: 'b' }] })
  assert(f.commands.some(c => c.action === 'SetNextAVTransportURI'))
  assert(!f.commands.some(c => c.action === 'AddURIToQueue'))
  await f.controller.setVolume({ level: .23 }); assert(f.commands.some(c => c.action === 'SetVolume'))
})
test('unconfirmed Stop keeps remote ownership and refuses local handoff', async t => {
  const f = fixture(); t.after(() => f.controller.cleanup()); await f.controller.connect(device(true)); f.failStop()
  await assert.rejects(f.controller.disconnect(), /offline/); assert.equal(f.controller.status().state, 'connected')
})
test('unrelated external playback relinquishes ownership without stopping that music', async t => {
  const f = fixture(); t.after(() => f.controller.cleanup()); await f.controller.connect(device(true))
  await f.controller.setWindow({ current: { id: 'a' }, upcoming: [] }); const before = f.commands.filter(c => c.action === 'Stop').length
  f.setUri('http://other-controller/music'); let ended; f.controller.on('ended', e => { ended = e }); await f.controller.poll()
  assert.equal(ended.reason, 'stopped'); assert.equal(f.commands.filter(c => c.action === 'Stop').length, before)
})
test('clock handles hours, invalid durations and negative seeks', () => {
  assert.equal(seconds('01:02:03'), 3723); assert.equal(seconds('NOT_IMPLEMENTED'), 0); assert.equal(timestamp(-5), '00:00:00')
})
test('selecting a grouped Sonos room targets its current coordinator without regrouping', async () => {
  const selected = { ...device(true), uuid: 'MEMBER', services: { ...device(true).services, ZoneGroupTopology: svc('ZoneGroupTopology') } }
  const topology = '<ZoneGroups><ZoneGroup Coordinator="MASTER"><ZoneGroupMember UUID="MEMBER" Location="http://192.168.1.20/device.xml"/><ZoneGroupMember UUID="MASTER" Location="http://192.168.1.30/device.xml"/></ZoneGroup></ZoneGroups>'
  const calls = []
  const master = await coordinator(selected, async (url, options) => {
    calls.push({ url, options })
    if (options.method === 'POST') return response(`<ZoneGroupState>${escapeXml(topology)}</ZoneGroupState>`)
    return response('<device><deviceType>urn:schemas-upnp-org:device:ZonePlayer:1</deviceType><manufacturer>Sonos</manufacturer><UDN>uuid:MASTER</UDN><friendlyName>Living room</friendlyName><serviceList><service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>/av</controlURL></service></serviceList></device>')
  })
  assert.equal(master.id, selected.id); assert.equal(master.uuid, 'MASTER'); assert.equal(master.host, '192.168.1.30'); assert.equal(master.kind, 'group')
  assert.equal(calls.filter(c => c.options.method === 'POST').length, 1)
})
