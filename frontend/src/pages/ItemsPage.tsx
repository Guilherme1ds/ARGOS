import { Search, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, apiAssetUrl, apiError } from '../services/api'
import type { Item } from '../types/api'
import { statusLabel } from '../utils/labels'

const initialFilters = {
  q: '',
  type: '',
  category: '',
  location: '',
  status: '',
  from: '',
  to: '',
  hasImage: '',
  sort: 'newest',
}

export function ItemsPage() {
  const [items, setItems] = useState<Item[]>([])
  const [filters, setFilters] = useState(initialFilters)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const activeFilters = Object.entries(filters).filter(([key, value]) => key !== 'sort' && Boolean(value))

  async function load() {
    setLoading(true)
    setError('')
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => Boolean(value)))
      const response = await api.get('/items/search', { params })
      setItems(response.data.data)
    } catch (requestError) {
      setError(apiError(requestError))
    } finally {
      setLoading(false)
    }
  }

  function clearFilters() {
    setFilters(initialFilters)
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <section className="stack">
      <div className="toolbar search-toolbar">
        <input placeholder="Buscar por nome, descrição ou categoria" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
        <select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
          <option value="">Tipo</option><option value="lost">Perdido</option><option value="found">Encontrado</option>
        </select>
        <input placeholder="Categoria" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} />
        <input placeholder="Local/bloco" value={filters.location} onChange={(e) => setFilters({ ...filters, location: e.target.value })} />
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">Status</option><option value="lost">Perdido</option><option value="found">Encontrado</option><option value="claimed">Reivindicado</option><option value="returned">Entregue</option>
        </select>
        <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        <select value={filters.hasImage} onChange={(e) => setFilters({ ...filters, hasImage: e.target.value })}>
          <option value="">Foto</option><option value="true">Com foto</option><option value="false">Sem foto</option>
        </select>
        <select value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })}>
          <option value="newest">Mais recentes</option>
          <option value="oldest">Mais antigos</option>
          <option value="event_date_desc">Data do evento: recentes</option>
          <option value="event_date_asc">Data do evento: antigos</option>
        </select>
        <button className="primary" onClick={load} disabled={loading}><Search size={18} /> Buscar</button>
        <button className="ghost light" onClick={clearFilters} type="button"><X size={18} /> Limpar</button>
      </div>
      {activeFilters.length > 0 && (
        <div className="filter-chips">
          {activeFilters.map(([key, value]) => <span key={key}>{key}: {value}</span>)}
        </div>
      )}
      {error && <p className="message error">{error}</p>}
      {loading ? (
        <div className="grid">
          {Array.from({ length: 6 }).map((_, index) => <div className="item-card skeleton-card" key={index} />)}
        </div>
      ) : (
        <div className="grid">
          {items.map((item) => (
            <Link className="item-card" to={`/items/${item.id}`} key={item.id}>
              {item.image_url && <img src={apiAssetUrl(item.image_url)} alt={item.title} />}
              <span className={`badge ${item.status}`}>{statusLabel[item.status]}</span>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              <small>{item.category} · {item.location} · {item.event_date}</small>
            </Link>
          ))}
          {!items.length && <p className="empty">Nenhum item aprovado encontrado. Amplie os filtros ou tente outra busca.</p>}
        </div>
      )}
    </section>
  )
}
