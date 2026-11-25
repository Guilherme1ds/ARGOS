import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import { useI18n } from '../i18n'

export type MapMarker = {
  id: number | string
  latitude: number
  longitude: number
  variant: 'lost' | 'found' | 'returned' | 'picked'
  /** Nome do marcador para leitor de tela e dica ao passar o mouse. */
  title?: string
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
  /** Localização real da pessoa (ponto azul + raio de precisão). Cada objeto novo recentraliza o mapa nela. */
  userPosition?: { latitude: number; longitude: number; accuracy?: number } | null
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

export function MapView({ center, zoom, markers = [], onPick, fitMarkers = false, userPosition = null, className = '', label }: MapViewProps) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const userLayerRef = useRef<L.LayerGroup | null>(null)
  // Depois de centralizar na pessoa, recarregar os casos não tira o mapa de onde ela está.
  const userFocusedRef = useRef(false)
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
    userLayerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
      userFocusedRef.current = false
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
      const leafletMarker = L.marker(point, { icon: markerIcon(marker.variant), keyboard: true, title: marker.title ?? String(marker.id), alt: marker.title }).addTo(layer)
      if (marker.popupHtml) leafletMarker.bindPopup(marker.popupHtml)
      if (marker.onOpen) leafletMarker.on('click', marker.onOpen)
    }
    if (fitMarkers && userFocusedRef.current) return
    if (fitMarkers && points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [32, 32], maxZoom: 18 })
    // No formulário, o ponto vindo de fora (minha localização, rascunho, edição) pode estar fora da tela: leva o mapa até ele.
    // O ponto de um clique já está visível, então o mapa não pula.
    else if (points.length === 1 && (!onPick || !map.getBounds().contains(points[0]))) map.setView(points[0], Math.max(map.getZoom(), 17))
  }, [markers, fitMarkers])

  useEffect(() => {
    const map = mapRef.current
    const layer = userLayerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    if (!userPosition) return
    const point: L.LatLngExpression = [userPosition.latitude, userPosition.longitude]
    const accuracy = userPosition.accuracy ?? 0
    const area =
      accuracy > 0
        ? L.circle(point, { radius: accuracy, color: '#2563eb', weight: 1, opacity: 0.5, fillColor: '#2563eb', fillOpacity: 0.12, interactive: false }).addTo(layer)
        : null
    L.circleMarker(point, { radius: 8, color: '#ffffff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 })
      .bindTooltip(t('Você está aqui'))
      .addTo(layer)
    userFocusedRef.current = true
    // Localização por rede (comum no computador) tem raio grande: enquadra o raio inteiro em vez de um zoom fixo.
    if (area && accuracy > 60) map.fitBounds(area.getBounds(), { maxZoom: 17 })
    else map.setView(point, Math.max(map.getZoom(), 17))
  }, [userPosition])

  return <div ref={containerRef} className={`map-view ${className}`} role="region" aria-label={t(label)} />
}
