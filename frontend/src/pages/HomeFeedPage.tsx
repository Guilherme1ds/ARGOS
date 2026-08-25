import {
  Bookmark,
  CalendarDays,
  CheckCircle2,
  Copy,
  Flag,
  Info,
  MapPin,
  MessageCircle,
  ShieldCheck,
  Tag,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { api, apiAssetUrl, apiError } from '../services/api'
import type { FeedComment, Item } from '../types/api'
import { copyText } from '../utils/clipboard'
import { statusLabel } from '../utils/labels'
import { validatePublicTextSafety } from '../utils/safety'

const pageSize = 6

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

function authorHandle(item: Item) {
  return item.owner_nickname || item.owner_name || `usuario.${item.id}`
}

function commentHandle(comment: FeedComment) {
  return comment.author_nickname || comment.author_name
}

function normalizeDate(value: string) {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value.includes('T') ? value : `${value.replace(' ', 'T')}Z`
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

function relativeDate(value: string) {
  const date = normalizeDate(value)
  if (!date) return value

  const diffDays = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000))
  if (diffDays < 1) return 'hoje'
  if (diffDays < 7) return `${diffDays} d`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} sem`
  return new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long' }).format(date)
}

function fullDate(value: string) {
  const date = normalizeDate(value)
  if (!date) return value
  return new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }).format(date)
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

function AuthorAvatar({ item, size = 'normal' }: { item: Item; size?: 'normal' | 'small' }) {
  const image = apiAssetUrl(item.owner_avatar_url)
  const handle = authorHandle(item)
  return (
    <span className={`ig-avatar ${size}`}>
      {image ? <img src={image} alt={`Foto de ${handle}`} /> : <span>{initials(handle)}</span>}
    </span>
  )
}

function CommentAvatar({ comment }: { comment: FeedComment }) {
  const image = apiAssetUrl(comment.author_avatar_url)
  const handle = commentHandle(comment)
  return (
    <span className="ig-avatar mini">
      {image ? <img src={image} alt={`Foto de ${handle}`} /> : <span>{initials(handle)}</span>}
    </span>
  )
}

export function HomeFeedPage() {
  const { user } = useAuth()
  const [items, setItems] = useState<Item[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [followed, setFollowed] = useState<Set<number>>(() => new Set())
  const [commentDrafts, setCommentDrafts] = useState<Record<number, string>>({})
  const [commenting, setCommenting] = useState<Set<number>>(() => new Set())
  const [reporting, setReporting] = useState<Set<number>>(() => new Set())
  const [activeItemId, setActiveItemId] = useState<number | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  const activeItem = items.find((item) => item.id === activeItemId) ?? null

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

  async function submitComment(event: FormEvent<HTMLFormElement>, item: Item) {
    event.preventDefault()
    const body = commentDrafts[item.id]?.trim()
    if (!body || !user) return
    const safetyMessage = validatePublicTextSafety(body)
    if (safetyMessage) {
      setMessage('')
      setError(safetyMessage)
      return
    }

    setCommenting((current) => new Set(current).add(item.id))
    setError('')
    try {
      const response = await api.post(`/items/${item.id}/comments`, { body })
      const nextComment = response.data.comment as FeedComment
      setCommentDrafts((current) => ({ ...current, [item.id]: '' }))
      setItems((current) =>
        current.map((entry) => {
          if (entry.id !== item.id) return entry
          return {
            ...entry,
            comments_count: (entry.comments_count ?? 0) + 1,
            latest_comments: [...(entry.latest_comments ?? []), nextComment],
          }
        }),
      )
      setMessage('Pista publicada.')
    } catch (requestError) {
      setError(apiError(requestError))
    } finally {
      setCommenting((current) => {
        const next = new Set(current)
        next.delete(item.id)
        return next
      })
    }
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

  useEffect(() => {
    if (!activeItem) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setActiveItemId(null)
    }

    document.body.classList.add('modal-open')
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.classList.remove('modal-open')
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [activeItem])

  function renderMedia(item: Item, mode: 'feed' | 'modal') {
    return (
      <button className={`ig-media ${mode}`} type="button" onClick={() => setActiveItemId(item.id)}>
        {item.image_url ? (
          <img src={apiAssetUrl(item.image_url)} alt={item.title} />
        ) : (
          <span>{initials(item.title)}</span>
        )}
      </button>
    )
  }

  function renderCaseMeta(item: Item) {
    return (
      <div className="case-meta">
        <span><MapPin size={15} /> {item.location}</span>
        <span><CalendarDays size={15} /> {fullDate(item.created_at || item.event_date)}</span>
        <span><Tag size={15} /> {item.category}</span>
      </div>
    )
  }

  function renderCaseActions(item: Item) {
    const isFollowed = followed.has(item.id)
    return (
      <div className="case-actions">
        <button className={isFollowed ? 'case-action active' : 'case-action'} type="button" onClick={() => void toggleFollow(item)}>
          {isFollowed ? <CheckCircle2 size={19} /> : <Bookmark size={19} />}
          {isFollowed ? 'Acompanhando' : 'Acompanhar caso'}
        </button>
        <button className="case-action" type="button" onClick={() => setActiveItemId(item.id)}>
          <MessageCircle size={19} /> Pistas
        </button>
        <button className="case-action" type="button" onClick={() => void copyItemLink(item)}>
          <Copy size={19} /> Copiar link
        </button>
        <button className="case-action muted" type="button" disabled={reporting.has(item.id)} onClick={() => void reportItem(item)}>
          <Flag size={19} /> Denunciar
        </button>
      </div>
    )
  }

  function renderCommentForm(item: Item, compact = false) {
    const draft = commentDrafts[item.id] ?? ''
    const isCommenting = commenting.has(item.id)

    return (
      <form className={`ig-comment-form ${compact ? 'compact' : ''}`} onSubmit={(event) => void submitComment(event, item)}>
        <input
          aria-label="Adicionar pista pública"
          disabled={!user || isCommenting}
          placeholder={user ? 'Adicionar pista ou pergunta pública...' : 'Entrar para enviar informação'}
          value={draft}
          onChange={(event) => setCommentDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
        />
        <button disabled={!user || !draft.trim() || isCommenting} type="submit">Enviar</button>
      </form>
    )
  }

  function renderPost(item: Item) {
    const handle = authorHandle(item)
    const comments = item.latest_comments ?? []
    const commentsCount = item.comments_count ?? 0

    return (
      <article className="ig-post case-post" key={item.id}>
        <header className="ig-post-head">
          <button className="ig-author" type="button" onClick={() => setActiveItemId(item.id)}>
            <AuthorAvatar item={item} />
            <span>
              <strong>@{handle}</strong>
              <small>{relativeDate(item.created_at || item.event_date)}</small>
            </span>
          </button>
          <span className={`case-status ${item.status}`}>{statusLabel[item.status]}</span>
        </header>

        {renderMedia(item, 'feed')}

        <div className="ig-post-body case-body">
          <div>
            <h2>{item.title}</h2>
            <p>{item.description}</p>
          </div>
          {renderCaseMeta(item)}
          <Link className="case-primary-action" to={actionTarget(item, Boolean(user))}>
            <ShieldCheck size={18} /> {actionLabel(item, Boolean(user))}
          </Link>
          {renderCaseActions(item)}
          <p className="privacy-note case-note">
            Não envie documento completo, telefone ou provas sensíveis nas pistas públicas.
          </p>
          {commentsCount > comments.length && (
            <button className="ig-muted-button" type="button" onClick={() => setActiveItemId(item.id)}>
              Ver todas as {commentsCount} pistas
            </button>
          )}
          {comments.slice(-2).map((comment) => (
            <p className="ig-inline-comment" key={comment.id}>
              <button type="button" onClick={() => setActiveItemId(item.id)}>@{commentHandle(comment)}</button>
              {' '}
              {comment.body}
            </p>
          ))}
          {renderCommentForm(item, true)}
        </div>
      </article>
    )
  }

  return (
    <section className="ig-feed-page">
      {error && <p className="message error">{error}</p>}
      {message && <p className="message success">{message}</p>}

      {loading ? (
        <div className="ig-feed-list">
          {Array.from({ length: 3 }).map((_, index) => <article className="ig-post skeleton-detail" key={index} />)}
        </div>
      ) : items.length ? (
        <div className="ig-feed-list">{items.map(renderPost)}</div>
      ) : (
        <div className="panel feed-empty">
          <h2>Nenhum caso publicado ainda</h2>
          <p>Quando itens forem publicados, eles aparecem aqui em formato de mural.</p>
          <Link className="primary fit" to="/items/new">Publicar item</Link>
        </div>
      )}

      <div ref={sentinelRef} className="feed-sentinel">
        {loadingMore && <span>Carregando mais casos...</span>}
        {!hasMore && items.length > 0 && <span>Você chegou ao fim.</span>}
      </div>

      {activeItem && (
        <div className="ig-modal-backdrop" role="dialog" aria-modal="true" aria-label={`Caso ${activeItem.title}`}>
          <button className="ig-modal-close" type="button" aria-label="Fechar" onClick={() => setActiveItemId(null)}>
            <X size={32} />
          </button>
          <article className="ig-post-modal case-modal">
            <div className="ig-modal-media">{renderMedia(activeItem, 'modal')}</div>
            <aside className="ig-modal-panel">
              <header className="ig-modal-author">
                <AuthorAvatar item={activeItem} />
                <span>
                  <strong>@{authorHandle(activeItem)}</strong>
                  <small>Perfil do publicador</small>
                </span>
                <span className={`case-status ${activeItem.status}`}>{statusLabel[activeItem.status]}</span>
              </header>

              <div className="ig-modal-comments case-detail-scroll">
                <section className="case-detail-main">
                  <h2>{activeItem.title}</h2>
                  <p>{activeItem.description}</p>
                  {renderCaseMeta(activeItem)}
                  <Link className="case-primary-action" to={actionTarget(activeItem, Boolean(user))}>
                    <ShieldCheck size={18} /> {actionLabel(activeItem, Boolean(user))}
                  </Link>
                  <div className="case-safety-box">
                    <Info size={18} />
                    <p>Provas de posse ficam no fluxo privado de reivindicação. Use pistas públicas apenas para perguntas e informações gerais.</p>
                  </div>
                </section>

                <section className="case-public-clues">
                  <h3>Pistas públicas</h3>
                  {(activeItem.latest_comments ?? []).length ? (
                    (activeItem.latest_comments ?? []).map((comment) => (
                      <div className="ig-modal-comment" key={comment.id}>
                        <CommentAvatar comment={comment} />
                        <p>
                          <strong>@{commentHandle(comment)}</strong>
                          {' '}
                          {comment.body}
                          <small>{relativeDate(comment.created_at)}</small>
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="empty">Nenhuma pista pública por enquanto.</p>
                  )}
                </section>
              </div>

              <footer className="ig-modal-footer case-modal-footer">
                {renderCaseActions(activeItem)}
                {renderCommentForm(activeItem)}
              </footer>
            </aside>
          </article>
        </div>
      )}
    </section>
  )
}
