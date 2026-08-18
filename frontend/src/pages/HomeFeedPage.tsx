import { Bookmark, Heart, MessageCircle, MoreHorizontal, Send, Search, Share2 } from 'lucide-react'
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Link } from 'react-router-dom'
import { api, apiAssetUrl, apiError } from '../services/api'
import type { Item } from '../types/api'
import { statusLabel } from '../utils/labels'

const pageSize = 6

function initials(title: string) {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('')
}

export function HomeFeedPage() {
  const [items, setItems] = useState<Item[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [liked, setLiked] = useState<Set<number>>(() => new Set())
  const [saved, setSaved] = useState<Set<number>>(() => new Set())
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  async function loadPage(nextPage: number, replace = false) {
    if (nextPage === 1) setLoading(true)
    else setLoadingMore(true)
    setError('')

    try {
      const response = await api.get('/items/search', {
        params: { page: nextPage, limit: pageSize, sort: 'newest' },
      })
      const nextItems = response.data.data as Item[]
      const total = Number(response.data.meta?.total ?? 0)
      setItems((current) => (replace ? nextItems : [...current, ...nextItems]))
      setPage(nextPage)
      setHasMore(nextPage * pageSize < total)
    } catch (requestError) {
      setError(apiError(requestError))
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  function toggle(setter: Dispatch<SetStateAction<Set<number>>>, id: number) {
    setter((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  useEffect(() => {
    void loadPage(1, true)
  }, [])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loading && !loadingMore) {
          void loadPage(page + 1)
        }
      },
      { rootMargin: '420px 0px' },
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, loading, loadingMore, page])

  return (
    <section className="feed-page">
      <header className="feed-header">
        <div>
          <span className="eyebrow">Início</span>
          <h2>Feed ARGOS</h2>
        </div>
        <Link className="ghost light fit" to="/items"><Search size={18} /> Buscar</Link>
      </header>

      {error && <p className="message error">{error}</p>}

      {loading ? (
        <div className="feed-list">
          {Array.from({ length: 3 }).map((_, index) => <article className="feed-post skeleton-detail" key={index} />)}
        </div>
      ) : items.length ? (
        <div className="feed-list">
          {items.map((item) => {
            const isLiked = liked.has(item.id)
            const isSaved = saved.has(item.id)

            return (
              <article className="feed-post" key={item.id}>
                <header className="post-head">
                  <Link className="post-author" to={`/items/${item.id}`}>
                    <span className="avatar">{initials(item.category || item.title)}</span>
                    <span>
                      <strong>argos.{item.category.toLowerCase().replace(/\s+/g, '-')}</strong>
                      <small>{item.location} · {item.event_date}</small>
                    </span>
                  </Link>
                  <button className="icon-button" title="Mais opções" type="button"><MoreHorizontal size={20} /></button>
                </header>

                <Link className="post-media" to={`/items/${item.id}`}>
                  {item.image_url ? (
                    <img src={apiAssetUrl(item.image_url)} alt={item.title} />
                  ) : (
                    <div className="post-placeholder">
                      <span>{initials(item.title)}</span>
                    </div>
                  )}
                </Link>

                <div className="post-actions">
                  <div>
                    <button
                      className={`icon-button ${isLiked ? 'active' : ''}`}
                      title={isLiked ? 'Remover curtida' : 'Curtir'}
                      type="button"
                      onClick={() => toggle(setLiked, item.id)}
                    >
                      <Heart size={22} />
                    </button>
                    <Link className="icon-button" title="Comentar" to={`/items/${item.id}`}><MessageCircle size={22} /></Link>
                    <button className="icon-button" title="Compartilhar" type="button"><Send size={22} /></button>
                  </div>
                  <button
                    className={`icon-button ${isSaved ? 'active' : ''}`}
                    title={isSaved ? 'Remover salvo' : 'Salvar'}
                    type="button"
                    onClick={() => toggle(setSaved, item.id)}
                  >
                    <Bookmark size={22} />
                  </button>
                </div>

                <div className="post-body">
                  <strong>{isLiked ? '1 curtida' : 'Seja o primeiro a curtir'}</strong>
                  <p><Link to={`/items/${item.id}`}>{item.title}</Link> {item.description}</p>
                  <div className="post-tags">
                    <span>{statusLabel[item.status]}</span>
                    <span>{item.type === 'lost' ? 'Perdido' : 'Encontrado'}</span>
                    <span>{item.category}</span>
                  </div>
                  <Link className="post-link" to={`/items/${item.id}`}><Share2 size={16} /> Ver detalhes</Link>
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <div className="panel feed-empty">
          <h2>Nenhuma postagem ainda</h2>
          <p>Quando itens forem aprovados, eles aparecem aqui em formato de feed.</p>
          <Link className="primary fit" to="/items/new">Publicar item</Link>
        </div>
      )}

      <div ref={sentinelRef} className="feed-sentinel">
        {loadingMore && <span>Carregando mais postagens...</span>}
        {!hasMore && items.length > 0 && <span>Você chegou ao fim.</span>}
      </div>
    </section>
  )
}
