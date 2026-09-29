import {
  Bookmark,
  BookmarkPlus,
  Bell,
  BellOff,
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
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { api, apiAssetUrl, apiError } from '../services/api'
import type { Item, SavedSearch } from '../types/api'
import { copyText } from '../utils/clipboard'
import { statusLabel } from '../utils/labels'
import { formatDate, relativeDate } from '../utils/dates'
import { msg, t as translateNow, useI18n } from '../i18n'

const pageSize = 48

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
  q: msg('Busca'),
  type: msg('Tipo'),
  category: msg('Categoria'),
  location: msg('Local'),
  status: msg('Status'),
  from: msg('De'),
  to: msg('Até'),
  hasImage: msg('Foto'),
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

function actionLabel(item: Item, authenticated: boolean) {
  if (item.status === 'returned') return translateNow('Caso resolvido')
  if (!authenticated) return item.type === 'found' ? translateNow('Entrar para reivindicar') : translateNow('Entrar para enviar informação')
  return item.type === 'found' ? translateNow('Reivindicar item') : translateNow('Tenho informação')
}

function actionTarget(item: Item, authenticated: boolean) {
  if (item.status === 'returned' || authenticated) return `/items/${item.id}`
  return `/login?next=/items/${item.id}`
}

function contactLabel(item: Item) {
  if (!item.contact_preference) return translateNow('Contato protegido')
  return item.contact_preference === 'email' ? translateNow('E-mail protegido') : translateNow('Chat interno')
}

function typeLabel(value: string) {
  if (value === 'lost') return translateNow('Perdido')
  if (value === 'found') return translateNow('Encontrado')
  return value
}

function filterValueLabel(key: string, value: string) {
  if (key === 'type') return typeLabel(value)
  if (key === 'status') return value in statusLabel ? translateNow(statusLabel[value as keyof typeof statusLabel]) : value
  if (key === 'hasImage') return value === 'true' ? translateNow('Com foto') : translateNow('Sem foto')
  return value
}

function ownerHandle(item: Item) {
  return item.owner_nickname || item.owner_name || `usuario.${item.id}`
}

export function ItemsPage() {
  const { user } = useAuth()
  const { t } = useI18n()
  const [items, setItems] = useState<Item[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [filters, setFilters] = useState(initialFilters)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [followed, setFollowed] = useState<Set<number>>(() => new Set())
  const [reporting, setReporting] = useState<Set<number>>(() => new Set())
  const [activeItemId, setActiveItemId] = useState<number | null>(null)
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([])
  const [selectedSavedSearchId, setSelectedSavedSearchId] = useState('')

  const activeFilters = Object.entries(filters).filter(([key, value]) => key !== 'sort' && Boolean(value))
  const activeItem = items.find((item) => item.id === activeItemId) ?? null
  const loadSequence = useRef(0)
  const lastSearchParams = useRef<Record<string, string>>({})

  const stats = useMemo(() => ({
    total,
    lost: items.filter((item) => item.type === 'lost').length,
    found: items.filter((item) => item.type === 'found').length,
    returned: items.filter((item) => item.status === 'returned').length,
  }), [items, total])

  async function load(nextFilters = filters) {
    // Filtros aplicados em sequência rápida: só a resposta da última busca atualiza a lista.
    const sequence = ++loadSequence.current
    setLoading(true)
    setError('')
    try {
      const params = Object.fromEntries(Object.entries(nextFilters).filter(([, value]) => Boolean(value)))
      lastSearchParams.current = params
      const response = await api.get('/items/search', { params: { ...params, limit: pageSize } })
      if (sequence === loadSequence.current) {
        setItems(response.data.data)
        setPage(1)
        setTotal(response.data.meta?.total ?? response.data.data.length)
      }
    } catch (requestError) {
      if (sequence === loadSequence.current) setError(apiError(requestError))
    } finally {
      if (sequence === loadSequence.current) setLoading(false)
    }
  }

  async function loadMore() {
    const sequence = loadSequence.current
    setLoadingMore(true)
    try {
      const response = await api.get('/items/search', { params: { ...lastSearchParams.current, limit: pageSize, page: page + 1 } })
      // Filtros trocados durante o carregamento invalidam esta página.
      if (sequence !== loadSequence.current) return
      setItems((current) => {
        const known = new Set(current.map((item) => item.id))
        return [...current, ...(response.data.data as Item[]).filter((item) => !known.has(item.id))]
      })
      setPage(page + 1)
      setTotal(response.data.meta?.total ?? total)
    } catch (requestError) {
      setError(apiError(requestError))
    } finally {
      setLoadingMore(false)
    }
  }

  async function loadSavedSearches() {
    if (!user) {
      setSavedSearches([])
      return
    }
    try {
      const response = await api.get('/saved-searches')
      setSavedSearches(response.data.data)
    } catch (requestError) {
      setError(apiError(requestError))
    }
  }

  async function saveCurrentSearch() {
    if (!user) return
    const name = window.prompt(t('Nome da pesquisa salva:'), filters.q || filters.category || t('Minha pesquisa'))?.trim()
    if (!name) return
    const query = Object.fromEntries(Object.entries(filters).filter(([, value]) => Boolean(value)))
    try {
      await api.post('/saved-searches', { name, query })
      setMessage(t('Pesquisa salva. Você receberá notificações sobre novos resultados.'))
      await loadSavedSearches()
    } catch (requestError) {
      setError(apiError(requestError))
    }
  }

  function applySavedSearch(id: string) {
    setSelectedSavedSearchId(id)
    const saved = savedSearches.find((entry) => String(entry.id) === id)
    if (!saved) return
    const query = Object.fromEntries(
      Object.entries(saved.query).map(([key, value]) => [key, typeof value === 'boolean' ? String(value) : value]),
    )
    const nextFilters = { ...initialFilters, ...query }
    setFilters(nextFilters)
    void load(nextFilters)
  }

  async function removeSavedSearch() {
    if (!selectedSavedSearchId || !window.confirm(t('Remover esta pesquisa salva?'))) return
    try {
      await api.delete(`/saved-searches/${selectedSavedSearchId}`)
      setSelectedSavedSearchId('')
      setMessage(t('Pesquisa salva removida.'))
      await loadSavedSearches()
    } catch (requestError) {
      setError(apiError(requestError))
    }
  }

  async function toggleSavedSearch() {
    const saved = savedSearches.find((entry) => String(entry.id) === selectedSavedSearchId)
    if (!saved) return
    try {
      await api.patch(`/saved-searches/${saved.id}`, { enabled: !saved.enabled })
      setMessage(saved.enabled ? t('Notificações da pesquisa pausadas.') : t('Notificações da pesquisa ativadas.'))
      await loadSavedSearches()
    } catch (requestError) {
      setError(apiError(requestError))
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
    if (copied) setMessage(t('Link do caso copiado.'))
    else setError(t('Não foi possível copiar o link neste navegador.'))
  }

  async function toggleFollow(item: Item) {
    if (!user) {
      setError(t('Entre para acompanhar este caso.'))
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
      setMessage(nextFollowed ? t('Caso adicionado aos acompanhamentos.') : t('Caso removido dos acompanhamentos.'))
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
      setError(t('Entre para sinalizar um caso suspeito.'))
      return
    }
    if (!window.confirm(t('Sinalizar este caso para análise da moderação?'))) return

    setReporting((current) => new Set(current).add(item.id))
    try {
      await api.post(`/items/${item.id}/report`, { reason: 'Conteúdo suspeito ou inadequado.' })
      setMessage(t('Sinalização enviada para análise.'))
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
    void loadSavedSearches()
  }, [user?.id])

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
          <span className={`case-status ${item.status}`}>{t(statusLabel[item.status])}</span>
        </div>
        <span className="market-card-action">{actionLabel(item, Boolean(user))}</span>
        <strong>{item.title}</strong>
        <small>{item.category}</small>
        <span className="market-card-location"><MapPin size={14} /> {item.location}</span>
        <span className="market-card-date">{formatDate(item.event_date, 'short')}</span>
      </button>
    )
  }

  return (
    <section className="market-page">
      <header className="market-heading">
        <div>
          <span className="eyebrow">{t('Consulta visual ARGOS')}</span>
          <h2>{t('Grade de casos')}</h2>
          <p>{t('Escaneie casos aprovados em grade, abra detalhes rapidamente e siga para a ação segura do ARGOS.')}</p>
        </div>
        <div className="market-view-switch" aria-label={t('Layouts disponíveis')}>
          <Link to="/"><MessageCircle size={17} /> {t('Feed')}</Link>
          <span><LayoutGrid size={17} /> {t('Grade')}</span>
        </div>
      </header>

      <div className="market-search-panel">
        <div className="toolbar search-toolbar market-toolbar">
          <input placeholder={t('Buscar por título, descrição ou categoria')} aria-label={t('Buscar por título, descrição ou categoria')} type="search" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
          <select aria-label={t('Tipo')} value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
            <option value="">{t('Tipo')}</option><option value="lost">{t('Perdido')}</option><option value="found">{t('Encontrado')}</option>
          </select>
          <input placeholder={t('Categoria')} aria-label={t('Categoria')} value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} />
          <input placeholder={t('Local/bloco')} aria-label={t('Local ou bloco')} value={filters.location} onChange={(e) => setFilters({ ...filters, location: e.target.value })} />
          <select aria-label={t('Status')} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            <option value="">{t('Status')}</option><option value="lost">{t('Perdido')}</option><option value="found">{t('Encontrado')}</option><option value="claimed">{t('Em análise')}</option><option value="returned">{t('Devolvido')}</option>
          </select>
          <input type="date" aria-label={t('Data inicial')} value={filters.from} max={filters.to || undefined} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
          <input type="date" aria-label={t('Data final')} value={filters.to} min={filters.from || undefined} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
          <select aria-label={t('Foto')} value={filters.hasImage} onChange={(e) => setFilters({ ...filters, hasImage: e.target.value })}>
            <option value="">{t('Foto')}</option><option value="true">{t('Com foto')}</option><option value="false">{t('Sem foto')}</option>
          </select>
          <select aria-label={t('Ordenação')} value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })}>
            <option value="newest">{t('Mais recentes')}</option>
            <option value="oldest">{t('Mais antigos')}</option>
            <option value="event_date_desc">{t('Data do caso: recentes')}</option>
            <option value="event_date_asc">{t('Data do caso: antigos')}</option>
          </select>
          <button className="primary" onClick={() => void load()} disabled={loading}><Search size={18} /> {t('Buscar')}</button>
          {user && <button className="ghost light" onClick={() => void saveCurrentSearch()} type="button"><BookmarkPlus size={18} /> {t('Salvar busca')}</button>}
          <button className="ghost light" onClick={clearFilters} type="button"><X size={18} /> {t('Limpar')}</button>
        </div>

        {user && savedSearches.length > 0 && (
          <div className="saved-search-bar">
            <Bookmark size={17} />
            <select aria-label={t('Pesquisas salvas')} value={selectedSavedSearchId} onChange={(event) => applySavedSearch(event.target.value)}>
              <option value="">{t('Pesquisas salvas')}</option>
              {savedSearches.map((entry) => (
                <option value={entry.id} key={entry.id}>{entry.name}{entry.enabled ? '' : ' (pausada)'}</option>
              ))}
            </select>
            <button
              className="icon-button"
              type="button"
              aria-label={t('Ativar ou pausar notificações')}
              title={t('Ativar ou pausar notificações')}
              disabled={!selectedSavedSearchId}
              onClick={() => void toggleSavedSearch()}
            >
              {savedSearches.find((entry) => String(entry.id) === selectedSavedSearchId)?.enabled === false ? <BellOff size={17} /> : <Bell size={17} />}
            </button>
            <button className="icon-button" type="button" aria-label={t('Remover pesquisa salva')} title={t('Remover pesquisa salva')} disabled={!selectedSavedSearchId} onClick={() => void removeSavedSearch()}>
              <Trash2 size={17} />
            </button>
          </div>
        )}

        <div className="market-summary">
          <button type="button" onClick={() => applyFilterPatch({ type: '', status: '' })}><strong>{stats.total}</strong><span>{t('casos')}</span></button>
          <button type="button" onClick={() => applyFilterPatch({ type: 'lost', status: '' })}><strong>{stats.lost}</strong><span>{t('perdidos')}</span></button>
          <button type="button" onClick={() => applyFilterPatch({ type: 'found', status: '' })}><strong>{stats.found}</strong><span>{t('encontrados')}</span></button>
          <button type="button" onClick={() => applyFilterPatch({ status: 'returned' })}><strong>{stats.returned}</strong><span>{t('devolvidos')}</span></button>
        </div>
      </div>

      {activeFilters.length > 0 && (
        <div className="filter-chips">
          {activeFilters.map(([key, value]) => <span key={key}>{filterLabels[key] ? t(filterLabels[key]) : key}: {filterValueLabel(key, value)}</span>)}
        </div>
      )}

      {error && <p className="message error">{error}</p>}
      {message && <p className="message success">{message}</p>}

      {loading ? (
        <div className="market-grid">
          {Array.from({ length: 12 }).map((_, index) => <div className="market-card skeleton-card" key={index} />)}
        </div>
      ) : items.length ? (
        <>
          <div className="market-grid">{items.map(renderCard)}</div>
          {items.length < total && (
            <div className="load-more">
              <button className="ghost light" type="button" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? t('Carregando...') : t('Carregar mais ({shown} de {total})', { shown: items.length, total })}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="panel feed-empty">
          <h2>{t('Nenhum item aprovado encontrado')}</h2>
          <p>{t('Amplie os filtros ou tente outra busca. Se você perdeu ou encontrou algo, publique um caso.')}</p>
          <Link className="primary fit" to="/items/new">{t('Publicar item')}</Link>
        </div>
      )}

      {activeItem && (
        <div className="market-modal-backdrop" role="dialog" aria-modal="true" aria-label={t('Detalhes de {title}', { title: activeItem.title })}>
          <button className="market-modal-close" type="button" aria-label={t('Fechar')} onClick={() => setActiveItemId(null)}>
            <X size={28} />
          </button>

          <article className="market-modal">
            <section
              className="market-modal-gallery"
              style={activeItem.image_url ? { backgroundImage: `linear-gradient(90deg, rgba(10, 14, 24, 0.86), rgba(10, 14, 24, 0.55)), url("${apiAssetUrl(activeItem.image_url)}")` } : undefined}
            >
              <button className="market-gallery-nav previous" type="button" aria-label={t('Item anterior')} disabled={items[items.findIndex((item) => item.id === activeItem.id) - 1] === undefined} onClick={() => moveActive(-1)}>
                <ChevronLeft size={30} />
              </button>
              {renderMedia(activeItem, 'modal')}
              <button className="market-gallery-nav next" type="button" aria-label={t('Próximo item')} disabled={items[items.findIndex((item) => item.id === activeItem.id) + 1] === undefined} onClick={() => moveActive(1)}>
                <ChevronRight size={30} />
              </button>
            </section>

            <aside className="market-detail-panel">
              <div className="market-detail-top">
                <span className={`case-status ${activeItem.status}`}>{t(statusLabel[activeItem.status])}</span>
                <h2>{activeItem.title}</h2>
                <p>{t('{type} · publicado {when} em {place}', { type: typeLabel(activeItem.type), when: relativeDate(activeItem.created_at || activeItem.event_date, 'short'), place: activeItem.location })}</p>
              </div>

              <div className="market-detail-actions">
                <Link className="primary" to={actionTarget(activeItem, Boolean(user))}><ShieldCheck size={18} /> {actionLabel(activeItem, Boolean(user))}</Link>
                <button className={followed.has(activeItem.id) ? 'ghost light active' : 'ghost light'} type="button" onClick={() => void toggleFollow(activeItem)}>
                  {followed.has(activeItem.id) ? <CheckCircle2 size={18} /> : <Bookmark size={18} />}
                  {followed.has(activeItem.id) ? t('Acompanhando') : t('Acompanhar caso')}
                </button>
                <button className="ghost light" type="button" onClick={() => void copyItemLink(activeItem)}><Copy size={18} /> {t('Copiar link')}</button>
              </div>

              <section className="market-detail-section">
                <h3>{t('Detalhes')}</h3>
                <dl className="market-detail-list">
                  <div><dt>{t('Categoria')}</dt><dd><Tag size={15} /> {activeItem.category}</dd></div>
                  <div><dt>{t('Data do caso')}</dt><dd><CalendarDays size={15} /> {formatDate(activeItem.event_date, 'short')}</dd></div>
                  <div><dt>{t('Responsável')}</dt><dd>@{ownerHandle(activeItem)}</dd></div>
                  <div><dt>{t('Contato')}</dt><dd>{contactLabel(activeItem)}</dd></div>
                </dl>
                <p>{activeItem.description}</p>
              </section>

              <section className="market-detail-section">
                <h3>{t('Local aproximado')}</h3>
                <div className="market-map-preview">
                  <MapPin size={28} />
                  <strong>{activeItem.location}</strong>
                </div>
                <small>
                  {[activeItem.campus_block, activeItem.approximate_place].filter(Boolean).join(' · ') || t('A localização é aproximada para preservar segurança.')}
                </small>
              </section>

              <section className="market-detail-section">
                <h3>{t('Segurança')}</h3>
                <div className="case-safety-box">
                  <Info size={18} />
                  <p>{t('Provas de posse e dados de contato não aparecem publicamente. Use o botão principal para falar pelo fluxo protegido.')}</p>
                </div>
              </section>

              <section className="market-detail-section">
                <h3>{t('Pistas recentes')}</h3>
                {(activeItem.latest_comments ?? []).length ? (
                  <div className="market-clue-list">
                    {(activeItem.latest_comments ?? []).slice(-3).map((comment) => (
                      <p key={comment.id}><strong>@{comment.author_nickname ?? comment.author_name}</strong> {comment.body}</p>
                    ))}
                  </div>
                ) : (
                  <p className="empty">{t('Nenhuma pista pública por enquanto.')}</p>
                )}
              </section>

              <section className="market-detail-section">
                <h3>{t('Pesquisas relacionadas')}</h3>
                <div className="market-related">
                  {[activeItem.category, activeItem.location, activeItem.campus_block, activeItem.approximate_place, typeLabel(activeItem.type)]
                    .filter(Boolean)
                    .map((term) => <button type="button" key={term} onClick={() => applyFilterPatch({ q: term ?? '' })}><Search size={15} /> {term}</button>)}
                </div>
              </section>

              <div className="market-secondary-actions">
                <button className="ghost light" type="button" disabled={reporting.has(activeItem.id)} onClick={() => void reportItem(activeItem)}>
                  <Flag size={18} /> {t('Denunciar')}
                </button>
                <Link className="ghost light" to={`/items/${activeItem.id}`}><ExternalLink size={18} /> {t('Abrir caso completo')}</Link>
              </div>
            </aside>
          </article>
        </div>
      )}
    </section>
  )
}
