import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../lib/supabase'
import { niceError, useApp, useTick } from '../lib/app'
import { ago, day } from '../lib/time'
import { t } from '../lib/i18n'
import { Avatar, Section, Sheet } from '../components/ui'
import { LocationModePicker } from '../components/LocationMode'
import { KINDS } from './Meetups'
import { useSpots } from './Spots'
import type { Loc, MeetupKind } from '../types'

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

interface PastMeetup {
  id: string
  title: string
  kind: MeetupKind
  lat: number
  lng: number
  starts_at: string
}

function batteryText(l: Loc): string | null {
  if (l.battery == null) return null
  return `${l.charging ? '⚡' : l.battery <= 15 ? '🪫' : '🔋'} ${l.battery}%`
}

export function MapScreen() {
  const { members, me, group, sos } = useApp()
  const { spots } = useSpots()
  const [view, setView] = useState<'friends' | 'ours'>('friends')
  const [locs, setLocs] = useState<Loc[]>([])
  const [past, setPast] = useState<PastMeetup[]>([])
  const [askSos, setAskSos] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const fitted = useRef('')
  useTick()

  const ids = useMemo(() => members.map((m) => m.id), [members])
  const idKey = ids.join(',')

  // Create the map once
  useEffect(() => {
    if (!box.current) return
    const m = L.map(box.current, { zoomControl: false }).setView([51.16, 10.45], 5)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m)
    layer.current = L.layerGroup().addTo(m)
    map.current = m
    return () => {
      m.remove()
      map.current = null
    }
  }, [])

  // Friends' locations, live
  useEffect(() => {
    if (!ids.length) return
    let alive = true
    supabase
      .from('locations')
      .select('*')
      .in('user_id', ids)
      .then(({ data }) => alive && setLocs((data as Loc[]) ?? []))
    const ch = supabase
      .channel('locations-' + idKey.slice(0, 40))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'locations' }, (p) => {
        const row = (p.new && 'user_id' in p.new ? p.new : p.old) as Loc
        if (!ids.includes(row.user_id)) return
        if (p.eventType === 'DELETE') setLocs((prev) => prev.filter((l) => l.user_id !== row.user_id))
        else setLocs((prev) => [...prev.filter((l) => l.user_id !== row.user_id), row])
      })
      .subscribe()
    return () => {
      alive = false
      supabase.removeChannel(ch)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey])

  // Past meetups with a pin ("Our map")
  useEffect(() => {
    if (view !== 'ours') return
    supabase
      .from('meetups')
      .select('id, title, kind, lat, lng, starts_at')
      .eq('group_id', group.id)
      .eq('cancelled', false)
      .not('lat', 'is', null)
      .lt('starts_at', new Date().toISOString())
      .order('starts_at', { ascending: false })
      .limit(300)
      .then(({ data }) => setPast((data as PastMeetup[]) ?? []))
  }, [view, group.id])

  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])
  const shown = useMemo(() => locs.filter((l) => byId.has(l.user_id)), [locs, byId])
  const sosPins = useMemo(() => sos.alerts.filter((a) => a.lat != null && a.lng != null), [sos.alerts])

  // Draw markers
  useEffect(() => {
    const m = map.current
    const lg = layer.current
    if (!m || !lg) return
    lg.clearLayers()
    const points: [number, number][] = []

    if (view === 'friends') {
      for (const l of shown) {
        const p = byId.get(l.user_id)!
        const bat = batteryText(l)
        const html = `<div class="pin-dot" style="background:${esc(p.color)}">${esc(p.emoji)}</div><div class="pin-name">${esc(p.id === me.id ? t('You') : p.display_name)}${bat ? ` <span class="pin-bat">${esc(bat)}</span>` : ''}</div>`
        L.marker([l.lat, l.lng], { icon: L.divIcon({ className: 'pin', html, iconSize: [48, 48], iconAnchor: [24, 24] }) }).addTo(lg)
        points.push([l.lat, l.lng])
      }
    } else {
      for (const s of spots) {
        if (s.lat == null || s.lng == null) continue
        L.marker([s.lat, s.lng], { icon: L.divIcon({ className: 'pin', html: `<div class="pin-spot">${esc(s.emoji)}</div><div class="pin-name">${esc(s.name)}</div>`, iconSize: [40, 40], iconAnchor: [20, 20] }) }).addTo(lg)
        points.push([s.lat, s.lng])
      }
      for (const x of past) {
        L.marker([x.lat, x.lng], { icon: L.divIcon({ className: 'pin', html: `<div class="pin-past">${esc(KINDS[x.kind].emoji)}</div>`, iconSize: [34, 34], iconAnchor: [17, 17] }) })
          .bindPopup(`<b>${esc(x.title)}</b><br>${esc(day(x.starts_at))}`)
          .addTo(lg)
        points.push([x.lat, x.lng])
      }
    }

    // SOS always on top
    for (const a of sosPins) {
      const p = byId.get(a.user_id)
      const html = `<div class="pin-sos">🆘</div><div class="pin-name sos">${esc(a.user_id === me.id ? t('You') : p?.display_name ?? '?')}</div>`
      L.marker([a.lat!, a.lng!], { icon: L.divIcon({ className: 'pin', html, iconSize: [52, 52], iconAnchor: [26, 26] }), zIndexOffset: 1000 }).addTo(lg)
    }

    // Zoom to fit once per view (and whenever a new SOS appears)
    const key = view + '|' + sosPins.map((a) => a.id).join(',')
    if (fitted.current !== key && (points.length || sosPins.length)) {
      fitted.current = key
      if (sosPins.length) m.setView([sosPins[0].lat!, sosPins[0].lng!], 15)
      else if (points.length === 1) m.setView(points[0], 14)
      else m.fitBounds(L.latLngBounds(points), { padding: [50, 50], maxZoom: 15 })
    }
  }, [shown, byId, me.id, view, spots, past, sosPins])

  function flyTo(lat: number, lng: number) {
    map.current?.flyTo([lat, lng], 15, { duration: 0.6 })
  }

  const notSharing = members.filter((m) => !locs.some((l) => l.user_id === m.id))

  return (
    <div className="map-screen">
      <div className="map-wrap">
        <div className="map" ref={box} />
        <div className="map-toggle seg two">
          <button className={view === 'friends' ? 'on' : ''} onClick={() => setView('friends')}>
            {t('Friends')}
          </button>
          <button className={view === 'ours' ? 'on' : ''} onClick={() => setView('ours')}>
            {t('Our map')}
          </button>
        </div>
        {!sos.mine && (
          <button className="sos-btn" onClick={() => setAskSos(true)} aria-label={t('Send SOS')}>
            SOS
          </button>
        )}
      </div>
      <div className="map-panel">
        {sosPins.map((a) => (
          <button className="person sos" key={a.id} onClick={() => flyTo(a.lat!, a.lng!)}>
            <Avatar p={byId.get(a.user_id)} size={38} />
            <span className="grow">
              <span className="name block">🆘 {a.user_id === me.id ? t('You') : byId.get(a.user_id)?.display_name}</span>
              <span className="sub block">{t('Updated {ago}', { ago: ago(a.updated_at) })}</span>
            </span>
            <span className="sub">{t('Show')} ›</span>
          </button>
        ))}

        {view === 'friends' ? (
          <>
            <Section title={t('Your location')}>
              <div className="card">
                <LocationModePicker />
              </div>
            </Section>
            <Section title={t('On the map')}>
              {shown.length === 0 && <p className="muted">{t('Nobody is sharing their location yet.')}</p>}
              <div className="list">
                {[...shown]
                  .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
                  .map((l) => {
                    const p = byId.get(l.user_id)!
                    const bat = batteryText(l)
                    return (
                      <button className="person" key={l.user_id} onClick={() => flyTo(l.lat, l.lng)}>
                        <Avatar p={p} size={38} dot />
                        <span className="grow">
                          <span className="name block">{p.id === me.id ? t('You') : p.display_name}</span>
                          <span className="sub block">
                            {t('Updated {ago}', { ago: ago(l.updated_at) })}
                            {bat && <span className={'battery' + (l.battery! <= 15 && !l.charging ? ' low' : '')}> · {bat}</span>}
                          </span>
                        </span>
                        <span className="sub">{t('Show')} ›</span>
                      </button>
                    )
                  })}
              </div>
              {notSharing.length > 0 && <p className="sub">{t('Not sharing: {names}', { names: notSharing.map((m) => (m.id === me.id ? t('you') : m.display_name)).join(', ') })}</p>}
            </Section>
          </>
        ) : (
          <Section title={t('Our map')}>
            <p className="sub">{t('Every meetup with a pin, plus your favourite spots ⭐')}</p>
            {past.length === 0 && spots.length === 0 && <p className="muted">{t('Nothing yet. Pin the place when you make a meetup and it shows up here.')}</p>}
            <div className="list">
              {spots
                .filter((s) => s.lat != null)
                .map((s) => (
                  <button className="person" key={s.id} onClick={() => flyTo(s.lat!, s.lng!)}>
                    <span className="kind-badge small">{s.emoji}</span>
                    <span className="grow name">{s.name}</span>
                    <span className="sub">{t('Show')} ›</span>
                  </button>
                ))}
              {past.slice(0, 30).map((x) => (
                <button className="person" key={x.id} onClick={() => flyTo(x.lat, x.lng)}>
                  <span className="kind-badge small">{KINDS[x.kind].emoji}</span>
                  <span className="grow">
                    <span className="name block">{x.title}</span>
                    <span className="sub block">{day(x.starts_at)}</span>
                  </span>
                  <span className="sub">{t('Show')} ›</span>
                </button>
              ))}
            </div>
          </Section>
        )}
      </div>
      {askSos && <SosSheet onClose={() => setAskSos(false)} />}
    </div>
  )
}

function SosSheet({ onClose }: { onClose: () => void }) {
  const { group, sos } = useApp()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function send() {
    setBusy(true)
    setError('')
    try {
      await sos.send()
      onClose()
    } catch (e) {
      setBusy(false)
      setError(niceError(e as { message?: string; code?: string }))
    }
  }

  return (
    <Sheet title={'🆘 ' + t('Send SOS?')} onClose={onClose}>
      <div className="stack">
        <p className="sub">{t('Everyone in "{group}" gets an urgent notification and sees where you are, until you tap "I\'m OK". Works even if your location sharing is off.', { group: group.name })}</p>
        <p className="sub">{t('In a real emergency, call 112 first.')}</p>
        <button className="btn danger block big-btn" disabled={busy} onClick={send}>
          {busy ? t('Sending…') : t('Send SOS now')}
        </button>
        <a className="btn ghost block" href="tel:112">
          📞 {t('Call 112')}
        </a>
        {error && <p className="error">{error}</p>}
      </div>
    </Sheet>
  )
}
