import {
  Bookmark,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Flag,
  Info,
  LayoutGrid,
  MapPin,
  MessageCircle,
  Search,
  ShieldCheck,
  Tag,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { api, apiAssetUrl, apiError } from '../services/api'
import type { Item } from '../types/api'
import { copyText } from '../utils/clipboard'
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

const filterLabels: Record<string, string> = {
  q: 'Busca',
  type: 'Tipo',
  category: 'Categoria',
  location: 'Local',
  status: 'Status',
  from: 'De',
  to: 'Até',
  hasImage: 'Foto',
}

function initials(value: string) {
  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase())
      .join('') || 'A'
  )
}

function normalizeDate(value: string) {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value.includes('T') ? value : `${value.replace(' ', 'T')}Z`
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

function displayDate(value: string) {
  const date = normalizeDate(value)
  if (!date) return value
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

function relativeDate(value: string) {
  const date = normalizeDate(value)
  if (!date) return value

  const diffDays = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000))
  if (diffDays < 1) return 'hoje'
  if (diffDays < 7) return `${diffDays} d`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} sem`
  return displayDate(value)
}

function actionLabel(item: Item, authenticated: boolean) {
  if (item.status === 'returned') return 'Caso resolvido'
  if (!authenticated) return item.type === 'found' ? 'Entrar para reivindicar' : 'Entrar para enviar informação'
  return item.type === 'found' ? 'Reivindicar item' : 'Tenho informação'
}

function actionTarget(item: Item, authenticated: boolean) {
  if (item.status === 'returned' || authenticated) return `/items/${item.id}`
  return `/login?next=/items/${item.id}`
}

function contactLabel(item: Item) {
  if (!item.contact_preference) return 'Contato protegido'
  return item.contact_preference === 'email' ? 'E-mail protegido' : 'Chat interno'
}

function typeLabel(value: string) {
  if (value === 'lost') return 'Perdido'
  if (value === 'found') return 'Encontrado'
  return value
}

function filterValueLabel(key: string, value: string) {
  if (key === 'type') return typeLabel(value)
  if (key === 'status') return statusLabel[value as keyof typeof statusLabel] ?? value
  if (key === 'hasImage') return value === 'true' ? 'Com foto' : 'Sem foto'
  return value
}

function ownerHandle(item: Item) {
  return item.owner_nickname || item.owner_name || `usuario.${item.id}`
}

export function ItemsPage() {
  const { user } = useAuth()
  const [items, setItems] = useState<Item[]>([])
  const [filters, setFilters] = useState(initialFilters)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [followed, setFollowed] = useState<Set<number>>(() => new Set())
  const [reporting, setReporting] = useState<Set<number>>(() => new Set())
  const [activeItemId, setActiveItemId] = useState<number | null>(null)

  const activeFilters = Object.entries(filters).filter(([key, value]) => key !== 'sort' && Boolean(value))
  const activeItem = items.find((item) => item.id === activeItemId) ?? null

  const stats = useMemo(() => ({
    total: items.length,
    lost: items.filter((item) => item.type === 'lost').length,
    found: items.filter((item) => item.type === 'found').length,
    returned: items.filter((item) => item.status === 'returned').length,
  }), [items])

  async function load(nextFilters = filters) {
    setLoading(true)
    setError('')
    try {
      const params = Object.fromEntries(Object.entries(nextFilters).filter(([, value]) => Boolean(value)))
      const response = await api.get('/items/search', { params: { ...params, limit: 48 } })
      setItems(response.data.data)
    } catch (requestError) {
      setError(apiError(requestError))
    } finally {
      setLoading(false)
    }
  }

  function clearFilters() {
    setFilters(initialFilters)
    void load(initialFilters)
  }

  function applyFilterPatch(patch: Partial<typeof initialFilters>) {
    const nextFilters = { ...filters, ...patch }
    setFilters(nextFilters)
    void load(nextFilters)
  }

  function itemUrl(item: Item) {
    return `${window.location.origin}/items/${item.id}`
  }

  async function copyItemLink(item: Item) {
    setError('')
    const copied = await copyText(itemUrl(item))
    if (copied) setMessage('Link do caso copiado.')
    else setError('Não foi possível copiar o link neste navegador.')
  }

  async function toggleFollow(item: Item) {
    if (!user) {
      setError('Entre para acompanhar este caso.')
      return
    }

    const nextFollowed = !followed.has(item.id)
    setFollowed((current) => {
      const next = new Set(current)
      if (nextFollowed) next.add(item.id)
      else next.delete(item.id)
      return next
    })

    try {
      if (nextFollowed) await api.post(`/items/${item.id}/follow`)
      else await api.delete(`/items/${item.id}/follow`)
      setMessage(nextFollowed ? 'Caso adicionado aos acompanhamentos.' : 'Caso removido dos acompanhamentos.')
    } catch (requestError) {
      setFollowed((current) => {
        const next = new Set(current)
        if (nextFollowed) next.delete(item.id)
        else next.add(item.id)
        return next
      })
      setError(apiError(requestError))
    }
  }

  async function reportItem(item: Item) {
    if (!user) {
      setError('Entre para sinalizar um caso suspeito.')
      return
    }
    if (!window.confirm('Sinalizar este caso para análise da moderação?')) return

    setReporting((current) => new Set(current).add(item.id))
    try {
      await api.post(`/items/${item.id}/report`, { reason: 'Conteúdo suspeito ou inadequado.' })
      setMessage('Sinalização enviada para análise.')
    } catch (requestError) {
      setError(apiError(requestError))
    } finally {
      setReporting((current) => {
        const next = new Set(current)
        next.delete(item.id)
        return next
      })
    }
  }

  function moveActive(direction: -1 | 1) {
    if (!activeItem) return
    const currentIndex = items.findIndex((item) => item.id === activeItem.id)
    const nextItem = items[currentIndex + direction]
    if (nextItem) setActiveItemId(nextItem.id)
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    if (!activeItem) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setActiveItemId(null)
      if (event.key === 'ArrowLeft') moveActive(-1)
      if (event.key === 'ArrowRight') moveActive(1)
    }

    document.body.classList.add('modal-open')
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.classList.remove('modal-open')
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [activeItem, items])

  function renderMedia(item: Item, mode: 'card' | 'modal') {
    const image = apiAssetUrl(item.image_url)
    return (
      <div className={`market-media ${mode}`}>
        {image ? <img src={image} alt={item.title} /> : <span>{initials(item.title)}</span>}
      </div>
    )
  }

  function renderCard(item: Item) {
    return (
      <button className="market-card" type="button" key={item.id} onClick={() => setActiveItemId(item.id)}>
        <div className="market-card-media">
          {renderMedia(item, 'card')}
          <span className={`case-status ${item.status}`}>{statusLabel[item.status]}</span>
        </div>
        <span className="market-card-action">{actionLabel(item, Boolean(user))}</span>
        <strong>{item.title}</strong>
        <small>{item.category}</small>
        <span className="market-card-location"><MapPin size={14} /> {item.location}</span>
        <span className="market-card-date">{displayDate(item.event_date)}</span>
      </button>
    )
  }

  return (
    <section className="market-page">
      <header className="market-heading">
        <div>
          <span className="eyebrow">Consulta visual ARGOS</span>
          <h2>Grade de casos</h2>
          <p>Escaneie casos aprovados em grade, abra detalhes rapidamente e siga para a ação segura do ARGOS.</p>
        </div>
        <div className="market-view-switch" aria-label="Layouts disponíveis">
          <Link to="/"><MessageCircle size={17} /> Feed</Link>
          <span><LayoutGrid size={17} /> Grade</span>
        </div>
      </header>

      <div className="market-search-panel">
        <div className="toolbar search-toolbar market-toolbar">
          <input placeholder="Buscar por título, descrição ou categoria" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
          <select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
            <option value="">Tipo</option><option value="lost">Perdido</option><option value="found">Encontrado</option>
          </select>
          <input placeholder="Categoria" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} />
          <input placeholder="Local/bloco" value={filters.location} onChange={(e) => setFilters({ ...filters, location: e.target.value })} />
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            <option value="">Status</option><option value="lost">Perdido</option><option value="found">Encontrado</option><option value="claimed">Em análise</option><option value="returned">Devolvido</option>
          </select>
          <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
          <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
          <select value={filters.hasImage} onChange={(e) => setFilters({ ...filters, hasImage: e.target.value })}>
            <option value="">Foto</option><option value="true">Com foto</option><option value="false">Sem foto</option>
          </select>
          <select value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })}>
            <option value="newest">Mais recentes</option>
            <option value="oldest">Mais antigos</option>
            <option value="event_date_desc">Data do caso: recentes</option>
            <option value="event_date_asc">Data do caso: antigos</option>
          </select>
          <button className="primary" onClick={() => void load()} disabled={loading}><Search size={18} /> Buscar</button>
          <button className="ghost light" onClick={clearFilters} type="button"><X size={18} /> Limpar</button>
        </div>

        <div className="market-summary">
          <button type="button" onClick={() => applyFilterPatch({ type: '', status: '' })}><strong>{stats.total}</strong><span>casos</span></button>
          <button type="button" onClick={() => applyFilterPatch({ type: 'lost', status: '' })}><strong>{stats.lost}</strong><span>perdidos</span></button>
          <button type="button" onClick={() => applyFilterPatch({ type: 'found', status: '' })}><strong>{stats.found}</strong><span>encontrados</span></button>
          <button type="button" onClick={() => applyFilterPatch({ status: 'returned' })}><strong>{stats.returned}</strong><span>devolvidos</span></button>
        </div>
      </div>

      {activeFilters.length > 0 && (
        <div className="filter-chips">
          {activeFilters.map(([key, value]) => <span key={key}>{filterLabels[key] ?? key}: {filterValueLabel(key, value)}</span>)}
        </div>
      )}

      {error && <p className="message error">{error}</p>}
      {message && <p className="message success">{message}</p>}

      {loading ? (
        <div className="market-grid">
          {Array.from({ length: 12 }).map((_, index) => <div className="market-card skeleton-card" key={index} />)}
        </div>
      ) : items.length ? (
        <div className="market-grid">{items.map(renderCard)}</div>
      ) : (
        <div className="panel feed-empty">
          <h2>Nenhum item aprovado encontrado</h2>
          <p>Amplie os filtros ou tente outra busca. Se você perdeu ou encontrou algo, publique um caso.</p>
          <Link className="primary fit" to="/items/new">Publicar item</Link>
        </div>
      )}

      {activeItem && (
        <div className="market-modal-backdrop" role="dialog" aria-modal="true" aria-label={`Detalhes de ${activeItem.title}`}>
          <button className="market-modal-close" type="button" aria-label="Fechar" onClick={() => setActiveItemId(null)}>
            <X size={28} />
          </button>

          <article className="market-modal">
            <section
              className="market-modal-gallery"
              style={activeItem.image_url ? { backgroundImage: `linear-gradient(90deg, rgba(10, 14, 24, 0.86), rgba(10, 14, 24, 0.55)), url("${apiAssetUrl(activeItem.image_url)}")` } : undefined}
            >
              <button className="market-gallery-nav previous" type="button" aria-label="Item anterior" disabled={items[items.findIndex((item) => item.id === activeItem.id) - 1] === undefined} onClick={() => moveActive(-1)}>
                <ChevronLeft size={30} />
              </button>
              {renderMedia(activeItem, 'modal')}
              <button className="market-gallery-nav next" type="button" aria-label="Próximo item" disabled={items[items.findIndex((item) => item.id === activeItem.id) + 1] === undefined} onClick={() => moveActive(1)}>
                <ChevronRight size={30} />
              </button>
            </section>

            <aside className="market-detail-panel">
              <div className="market-detail-top">
                <span className={`case-status ${activeItem.status}`}>{statusLabel[activeItem.status]}</span>
                <h2>{activeItem.title}</h2>
                <p>{typeLabel(activeItem.type)} · publicado {relativeDate(activeItem.created_at || activeItem.event_date)} em {activeItem.location}</p>
              </div>

              <div className="market-detail-actions">
                <Link className="primary" to={actionTarget(activeItem, Boolean(user))}><ShieldCheck size={18} /> {actionLabel(activeItem, Boolean(user))}</Link>
                <button className={followed.has(activeItem.id) ? 'ghost light active' : 'ghost light'} type="button" onClick={() => void toggleFollow(activeItem)}>
                  {followed.has(activeItem.id) ? <CheckCircle2 size={18} /> : <Bookmark size={18} />}
                  {followed.has(activeItem.id) ? 'Acompanhando' : 'Acompanhar caso'}
                </button>
                <button className="ghost light" type="button" onClick={() => void copyItemLink(activeItem)}><Copy size={18} /> Copiar link</button>
              </div>

              <section className="market-detail-section">
                <h3>Detalhes</h3>
                <dl className="market-detail-list">
                  <div><dt>Categoria</dt><dd><Tag size={15} /> {activeItem.category}</dd></div>
                  <div><dt>Data do caso</dt><dd><CalendarDays size={15} /> {displayDate(activeItem.event_date)}</dd></div>
                  <div><dt>Responsável</dt><dd>@{ownerHandle(activeItem)}</dd></div>
                  <div><dt>Contato</dt><dd>{contactLabel(activeItem)}</dd></div>
                </dl>
                <p>{activeItem.description}</p>
              </section>

              <section className="market-detail-section">
                <h3>Local aproximado</h3>
                <div className="market-map-preview">
                  <MapPin size={28} />
                  <strong>{activeItem.location}</strong>
                </div>
                <small>
                  {[activeItem.campus_block, activeItem.approximate_place].filter(Boolean).join(' · ') || 'A localização é aproximada para preservar segurança.'}
                </small>
              </section>

              <section className="market-detail-section">
                <h3>Segurança</h3>
                <div className="case-safety-box">
                  <Info size={18} />
                  <p>Provas de posse e dados de contato não aparecem publicamente. Use o botão principal para falar pelo fluxo protegido.</p>
                </div>
              </section>

              <section className="market-detail-section">
                <h3>Pistas recentes</h3>
                {(activeItem.latest_comments ?? []).length ? (
                  <div className="market-clue-list">
                    {(activeItem.latest_comments ?? []).slice(-3).map((comment) => (
                      <p key={comment.id}><strong>@{comment.author_nickname ?? comment.author_name}</strong> {comment.body}</p>
                    ))}
                  </div>
                ) : (
                  <p className="empty">Nenhuma pista pública por enquanto.</p>
                )}
              </section>

              <section className="market-detail-section">
                <h3>Pesquisas relacionadas</h3>
                <div className="market-related">
                  {[activeItem.category, activeItem.location, activeItem.campus_block, activeItem.approximate_place, typeLabel(activeItem.type)]
                    .filter(Boolean)
                    .map((term) => <button type="button" key={term} onClick={() => applyFilterPatch({ q: term ?? '' })}><Search size={15} /> {term}</button>)}
                </div>
              </section>

              <div className="market-secondary-actions">
                <button className="ghost light" type="button" disabled={reporting.has(activeItem.id)} onClick={() => void reportItem(activeItem)}>
                  <Flag size={18} /> Denunciar
                </button>
                <Link className="ghost light" to={`/items/${activeItem.id}`}><ExternalLink size={18} /> Abrir caso completo</Link>
              </div>
            </aside>
          </article>
        </div>
      )}
    </section>
  )
}
