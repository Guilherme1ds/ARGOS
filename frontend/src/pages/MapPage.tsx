import { MapPin } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { MapView, type MapMarker } from '../components/MapView'
import { msg, useI18n } from '../i18n'
import { api, apiError } from '../services/api'
import { useAppConfig } from '../services/config'
import type { MapItem } from '../types/api'
import { formatDate } from '../utils/dates'
import { statusLabel } from '../utils/labels'

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}

export function MapPage() {
  const { t, language } = useI18n()
  const config = useAppConfig()
  const [items, setItems] = useState<MapItem[]>([])
  const [type, setType] = useState<'' | 'lost' | 'found'>('')
  const [includeReturned, setIncludeReturned] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    api
      .get('/items/map', { params: { type: type || undefined, includeReturned: includeReturned ? 'true' : undefined } })
      .then((response) => active && setItems(response.data.data))
      .catch((requestError) => active && setError(apiError(requestError)))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [type, includeReturned])

  const markers = useMemo<MapMarker[]>(
    () =>
      items.map((item) => ({
        id: item.id,
        latitude: item.latitude,
        longitude: item.longitude,
        variant: item.status === 'returned' ? 'returned' : item.type,
        popupHtml: `<strong>${escapeHtml(item.title)}</strong><br>${escapeHtml(t(statusLabel[item.status]))} · ${escapeHtml(item.location)}<br><a href="/items/${item.id}">${escapeHtml(t('Abrir caso completo'))}</a>`,
      })),
    // O idioma entra nas dependências para refazer os balões traduzidos.
    [items, language],
  )

  return (
    <section className="stack">
      <div className="map-toolbar panel">
        <select aria-label={t('Tipo')} value={type} onChange={(event) => setType(event.target.value as typeof type)}>
          <option value="">{t('Perdidos e encontrados')}</option>
          <option value="lost">{t('Perdido')}</option>
          <option value="found">{t('Encontrado')}</option>
        </select>
        <label className="check-row">
          <input type="checkbox" checked={includeReturned} onChange={(event) => setIncludeReturned(event.target.checked)} />
          <span>{t('Mostrar casos devolvidos')}</span>
        </label>
        <div className="map-legend" aria-hidden="true">
          <span><i className="map-dot lost" /> {t('Perdido')}</span>
          <span><i className="map-dot found" /> {t('Encontrado')}</span>
          <span><i className="map-dot returned" /> {t('Devolvido')}</span>
        </div>
      </div>
      {error && <p className="message error" role="alert">{error}</p>}
      <div className="map-layout">
        {config ? (
          <MapView center={config.map.center} zoom={config.map.zoom} markers={markers} fitMarkers className="map-large" label={msg('Mapa de casos')} />
        ) : (
          <div className="map-view map-large skeleton-card" />
        )}
        <aside className="panel map-list">
          <h3>{t('{count} casos no mapa', { count: items.length })}</h3>
          {loading ? (
            <p className="loading">{t('Carregando...')}</p>
          ) : items.length ? (
            items.map((item) => (
              <Link className="claim-row" to={`/items/${item.id}`} key={item.id}>
                <strong>{item.title}</strong>
                <p><MapPin size={14} /> {item.location} · {formatDate(item.event_date, 'short')}</p>
                <small>{t(statusLabel[item.status])}</small>
              </Link>
            ))
          ) : (
            <p className="empty">{t('Nenhum caso marcado no mapa ainda. Ao publicar, toque no mapa para indicar o local.')}</p>
          )}
        </aside>
      </div>
    </section>
  )
}
