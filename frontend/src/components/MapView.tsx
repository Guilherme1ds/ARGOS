import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import { useI18n } from '../i18n'

export type MapMarker = {
  id: number | string
  latitude: number
  longitude: number
  variant: 'lost' | 'found' | 'returned' | 'picked'
  popupHtml?: string
  onOpen?: () => void
}

type MapViewProps = {
  center: [number, number]
  zoom: number
  markers?: MapMarker[]
  /** Com onPick, clicar no mapa escolhe um ponto (usado no formulário). */
  onPick?: (latitude: number, longitude: number) => void
  /** Ajusta o enquadramento para mostrar todos os marcadores. */
  fitMarkers?: boolean
  className?: string
  label: string
}

// Ícones em CSS: os PNGs padrão do Leaflet quebram no bundle do Vite.
function markerIcon(variant: MapMarker['variant']) {
  return L.divIcon({
    className: `map-pin map-pin-${variant}`,
    html: '<span></span>',
    iconSize: [26, 26],
    iconAnchor: [13, 26],
    popupAnchor: [0, -24],
  })
}

export function MapView({ center, zoom, markers = [], onPick, fitMarkers = false, className = '', label }: MapViewProps) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const pickRef = useRef(onPick)
  pickRef.current = onPick

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, { center, zoom, scrollWheelZoom: false })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map)
    map.on('click', (event: L.LeafletMouseEvent) => pickRef.current?.(event.latlng.lat, event.latlng.lng))
    // Rolar a página não deve dar zoom sem querer; o zoom com a roda liga depois do primeiro clique.
    map.once('focus', () => map.scrollWheelZoom.enable())
    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    const points: L.LatLngExpression[] = []
    for (const marker of markers) {
      const point: L.LatLngExpression = [marker.latitude, marker.longitude]
      points.push(point)
      const leafletMarker = L.marker(point, { icon: markerIcon(marker.variant), keyboard: true, title: String(marker.id) }).addTo(layer)
      if (marker.popupHtml) leafletMarker.bindPopup(marker.popupHtml)
      if (marker.onOpen) leafletMarker.on('click', marker.onOpen)
    }
    if (fitMarkers && points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [32, 32], maxZoom: 18 })
    else if (points.length === 1 && !onPick) map.setView(points[0], Math.max(map.getZoom(), 17))
  }, [markers, fitMarkers])

  return <div ref={containerRef} className={`map-view ${className}`} role="region" aria-label={t(label)} />
}
