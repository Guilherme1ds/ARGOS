import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../services/api'
import type { Item } from '../types/api'
import { statusLabel } from '../utils/labels'

export function ItemsPage() {
  const [items, setItems] = useState<Item[]>([])
  const [filters, setFilters] = useState({ q: '', type: '', category: '', location: '', status: '' })

  async function load() {
    const response = await api.get('/items/search', { params: filters })
    setItems(response.data.data)
  }

  useEffect(() => { load() }, [])

  return (
    <section className="stack">
      <div className="toolbar">
        <input placeholder="Buscar por nome, descrição ou categoria" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
        <select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
          <option value="">Tipo</option><option value="lost">Perdido</option><option value="found">Encontrado</option>
        </select>
        <input placeholder="Categoria" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} />
        <input placeholder="Local/bloco" value={filters.location} onChange={(e) => setFilters({ ...filters, location: e.target.value })} />
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">Status</option><option value="lost">Perdido</option><option value="found">Encontrado</option><option value="claimed">Reivindicado</option><option value="returned">Entregue</option>
        </select>
        <button className="primary" onClick={load}><Search size={18} /> Buscar</button>
      </div>
      <div className="grid">
        {items.map((item) => (
          <Link className="item-card" to={`/items/${item.id}`} key={item.id}>
            {item.image_url && <img src={`http://localhost:3333${item.image_url}`} alt="" />}
            <span className={`badge ${item.status}`}>{statusLabel[item.status]}</span>
            <h3>{item.title}</h3>
            <p>{item.description}</p>
            <small>{item.category} · {item.location} · {item.event_date}</small>
          </Link>
        ))}
        {!items.length && <p className="empty">Nenhum item aprovado encontrado.</p>}
      </div>
    </section>
  )
}
