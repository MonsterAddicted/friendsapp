import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export interface MapPerson {
  id: string
  lat: number
  lng: number
  emoji: string
  color: string
  name: string
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** Small map: shows a meetup pin and people. With onPick, tapping the map moves the pin. */
export function MiniMap({
  pin,
  people = [],
  onPick,
  height = 220,
}: {
  pin?: { lat: number; lng: number } | null
  people?: MapPerson[]
  onPick?: (p: { lat: number; lng: number }) => void
  height?: number
}) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const pickRef = useRef(onPick)
  pickRef.current = onPick
  const fitted = useRef(false)

  useEffect(() => {
    if (!box.current) return
    const m = L.map(box.current, { zoomControl: false }).setView([51.16, 10.45], 5)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m)
    layer.current = L.layerGroup().addTo(m)
    m.on('click', (e: L.LeafletMouseEvent) => pickRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }))
    map.current = m
    return () => {
      m.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    const m = map.current
    const lg = layer.current
    if (!m || !lg) return
    lg.clearLayers()
    const pts: [number, number][] = []
    if (pin) {
      L.marker([pin.lat, pin.lng], {
        icon: L.divIcon({ className: 'pin', html: '<div class="pin-goal">📍</div>', iconSize: [40, 40], iconAnchor: [20, 36] }),
      }).addTo(lg)
      pts.push([pin.lat, pin.lng])
    }
    for (const p of people) {
      const html = `<div class="pin-dot small" style="background:${esc(p.color)}">${esc(p.emoji)}</div><div class="pin-name">${esc(p.name)}</div>`
      L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'pin', html, iconSize: [36, 36], iconAnchor: [18, 18] }) }).addTo(lg)
      pts.push([p.lat, p.lng])
    }
    if (!pts.length) return
    if (!fitted.current) {
      // First time: zoom to show everything
      if (pts.length === 1) m.setView(pts[0], 15)
      else m.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 16 })
      fitted.current = true
    } else if (onPick && pin) {
      // Picking: follow the pin without changing zoom
      m.panTo([pin.lat, pin.lng])
    }
  }, [pin, people, onPick])

  return <div className="mini-map" ref={box} style={{ height }} />
}
