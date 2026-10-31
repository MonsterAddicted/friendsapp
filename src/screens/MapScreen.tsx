import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../lib/supabase'
import { useApp, useTick } from '../lib/app'
import { ago } from '../lib/time'
import { Avatar } from '../components/ui'
import { LocationModePicker } from '../components/LocationMode'
import type { Loc } from '../types'

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export function MapScreen() {
  const { members, me } = useApp()
  const [locs, setLocs] = useState<Loc[]>([])
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const fitted = useRef(false)
  useTick()

  const ids = useMemo(() => members.map((m) => m.id), [members])
  const idKey = ids.join(',')

  // Create the map once
  useEffect(() => {
    if (!box.current) return
    const m = L.map(box.current, { zoomControl: false }).setView([51.16, 10.45], 5)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(m)
    layer.current = L.layerGroup().addTo(m)
    map.current = m
    return () => {
      m.remove()
      map.current = null
    }
  }, [])

  // Load locations + listen for changes
  useEffect(() => {
    if (!ids.length) return
    let alive = true
    const load = () =>
      supabase
        .from('locations')
        .select('*')
        .in('user_id', ids)
        .then(({ data }) => alive && setLocs((data as Loc[]) ?? []))
    load()
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
  }, [idKey])

  // Draw markers
  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])
  const shown = useMemo(() => locs.filter((l) => byId.has(l.user_id)), [locs, byId])
  useEffect(() => {
    const m = map.current
    const lg = layer.current
    if (!m || !lg) return
    lg.clearLayers()
    for (const l of shown) {
      const p = byId.get(l.user_id)!
      const html = `<div class="pin-dot" style="background:${esc(p.color)}">${esc(p.emoji)}</div><div class="pin-name">${esc(p.id === me.id ? 'You' : p.display_name)}</div>`
      L.marker([l.lat, l.lng], {
        icon: L.divIcon({ className: 'pin', html, iconSize: [48, 48], iconAnchor: [24, 24] }),
      }).addTo(lg)
    }
    if (!fitted.current && shown.length) {
      fitted.current = true
      if (shown.length === 1) m.setView([shown[0].lat, shown[0].lng], 14)
      else m.fitBounds(L.latLngBounds(shown.map((l) => [l.lat, l.lng] as [number, number])), { padding: [50, 50], maxZoom: 15 })
    }
  }, [shown, byId, me.id])

  function flyTo(l: Loc) {
    map.current?.flyTo([l.lat, l.lng], 15, { duration: 0.6 })
  }

  const notSharing = members.filter((m) => !locs.some((l) => l.user_id === m.id))

  return (
    <div className="map-screen">
      <div className="map" ref={box} />
      <div className="map-panel">
        <div className="card">
          <p className="label">Your location</p>
          <LocationModePicker />
        </div>
        <div className="stack-s">
          <p className="label">On the map</p>
          {shown.length === 0 && <p className="muted">Nobody is sharing their location yet.</p>}
          {[...shown]
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
            .map((l) => {
              const p = byId.get(l.user_id)!
              return (
                <button className="person" key={l.user_id} onClick={() => flyTo(l)}>
                  <Avatar p={p} size={38} />
                  <div className="grow">
                    <div className="name">{p.id === me.id ? 'You' : p.display_name}</div>
                    <div className="sub">Updated {ago(l.updated_at)}</div>
                  </div>
                  <span className="sub">Show ›</span>
                </button>
              )
            })}
          {notSharing.length > 0 && (
            <p className="sub">Not sharing: {notSharing.map((m) => (m.id === me.id ? 'you' : m.display_name)).join(', ')}</p>
          )}
        </div>
      </div>
    </div>
  )
}
