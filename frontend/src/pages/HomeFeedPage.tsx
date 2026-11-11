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
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { FloatingFeedback } from '../components/FloatingFeedback'
import { useAuth } from '../contexts/AuthContext'
import { api, apiAssetUrl, apiError } from '../services/api'
import { fetchFollowedIds } from '../services/following'
import type { FeedComment, Item } from '../types/api'
import { copyText } from '../utils/clipboard'
import { statusLabel } from '../utils/labels'
import { validatePublicTextSafety } from '../utils/safety'
import { formatDate, relativeDate } from '../utils/dates'
import { useDialogFocus } from '../utils/useDialogFocus'
import { t as translateNow, useI18n } from '../i18n'

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

function actionLabel(item: Item, authenticated: boolean) {
  if (item.status === 'returned') return translateNow('Caso resolvido')
  if (!authenticated) return item.type === 'found' ? translateNow('Entrar para reivindicar') : translateNow('Entrar para enviar informação')
  return item.type === 'found' ? translateNow('Reivindicar item') : translateNow('Tenho informação')
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
      {image ? <img src={image} alt={translateNow('Foto de {name}', { name: handle })} /> : <span>{initials(handle)}</span>}
    </span>
  )
}

function CommentAvatar({ comment }: { comment: FeedComment }) {
  const image = apiAssetUrl(comment.author_avatar_url)
  const handle = commentHandle(comment)
  return (
    <span className="ig-avatar mini">
      {image ? <img src={image} alt={translateNow('Foto de {name}', { name: handle })} /> : <span>{initials(handle)}</span>}
    </span>
  )
}

export function HomeFeedPage() {
  const { user } = useAuth()
  const { t } = useI18n()
  const [items, setItems] = useState<Item[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  // Falha ao carregar o mural (lista) é diferente de falha numa ação (aviso flutuante perto de onde a pessoa está).
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [followed, setFollowed] = useState<Set<number>>(() => new Set())
  const [commentDrafts, setCommentDrafts] = useState<Record<number, string>>({})
  const [commenting, setCommenting] = useState<Set<number>>(() => new Set())
  const [reporting, setReporting] = useState<Set<number>>(() => new Set())
  const [activeItemId, setActiveItemId] = useState<number | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const modalRef = useRef<HTMLDivElement | null>(null)

  const activeItem = items.find((item) => item.id === activeItemId) ?? null
  useDialogFocus(Boolean(activeItem), modalRef)

  const clearFeedback = useCallback(() => {
    setError('')
    setMessage('')
  }, [])

  function showError(text: string) {
    setMessage('')
    setError(text)
  }

  function showMessage(text: string) {
    setError('')
    setMessage(text)
  }

  async function loadPage(nextPage: number, replace = false) {
    if (nextPage === 1) setLoading(true)
    else setLoadingMore(true)
    setLoadError('')

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
      setLoadError(apiError(requestError))
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  function itemUrl(item: Item) {
    return `${window.location.origin}/items/${item.id}`
  }

  async function copyItemLink(item: Item) {
    const copied = await copyText(itemUrl(item))
    if (copied) showMessage(t('Link do caso copiado.'))
    else showError(t('Não foi possível copiar o link neste navegador.'))
  }

  async function toggleFollow(item: Item) {
    if (!user) {
      showError(t('Entre para acompanhar este caso.'))
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
      showMessage(nextFollowed ? t('Caso adicionado aos acompanhamentos.') : t('Caso removido dos acompanhamentos.'))
    } catch (requestError) {
      setFollowed((current) => {
        const next = new Set(current)
        if (nextFollowed) next.delete(item.id)
        else next.add(item.id)
        return next
      })
      showError(apiError(requestError))
    }
  }

  async function reportItem(item: Item) {
    if (!user) {
      showError(t('Entre para sinalizar um caso suspeito.'))
      return
    }
    if (!window.confirm(t('Sinalizar este caso para análise da moderação?'))) return

    setReporting((current) => new Set(current).add(item.id))
    try {
      const response = await api.post(`/items/${item.id}/report`, { reason: 'Conteúdo suspeito ou inadequado.' })
      // A API diz se a denúncia é nova ou se a pessoa já tinha sinalizado este caso.
      showMessage(t(response.data?.message || 'Sinalização enviada para análise.'))
    } catch (requestError) {
      showError(apiError(requestError))
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
      showError(safetyMessage)
      return
    }

    setCommenting((current) => new Set(current).add(item.id))
    clearFeedback()
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
      showMessage(t('Pista publicada.'))
    } catch (requestError) {
      showError(apiError(requestError))
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

  // "Acompanhar" mostra o estado real da conta; ao trocar de sessão, o estado da pessoa anterior some.
  useEffect(() => {
    let active = true
    setFollowed(new Set())
    if (!user) return
    fetchFollowedIds()
      .then((ids) => active && setFollowed(ids))
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [user?.id])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loading && !loadingMore && !loadError) {
          void loadPage(page + 1)
        }
      },
      { rootMargin: '420px 0px' },
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, loading, loadingMore, page, loadError])

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
          <>
            {/* Sem foto: as iniciais são decorativas; o nome do botão é o título do caso. */}
            <span aria-hidden="true">{initials(item.title)}</span>
            <span className="sr-only">{item.title}</span>
          </>
        )}
      </button>
    )
  }

  function renderCaseMeta(item: Item) {
    return (
      <div className="case-meta">
        <span><MapPin size={15} /> {item.location}</span>
        <span><CalendarDays size={15} /> {formatDate(item.created_at || item.event_date)}</span>
        <span><Tag size={15} /> {item.category}</span>
      </div>
    )
  }

  function renderCaseActions(item: Item) {
    const isFollowed = followed.has(item.id)
    return (
      <div className="case-actions">
        <button className={isFollowed ? 'case-action active' : 'case-action'} type="button" aria-pressed={isFollowed} onClick={() => void toggleFollow(item)}>
          {isFollowed ? <CheckCircle2 size={19} /> : <Bookmark size={19} />}
          {isFollowed ? t('Acompanhando') : t('Acompanhar caso')}
        </button>
        <button className="case-action" type="button" onClick={() => setActiveItemId(item.id)}>
          <MessageCircle size={19} /> {t('Pistas')}
        </button>
        <button className="case-action" type="button" onClick={() => void copyItemLink(item)}>
          <Copy size={19} /> {t('Copiar link')}
        </button>
        <button className="case-action muted" type="button" disabled={reporting.has(item.id)} onClick={() => void reportItem(item)}>
          <Flag size={19} /> {t('Denunciar')}
        </button>
      </div>
    )
  }

  function renderCommentForm(item: Item, compact = false) {
    const draft = commentDrafts[item.id] ?? ''
    const isCommenting = commenting.has(item.id)

    if (!user) {
      return (
        <p className={`ig-comment-form ${compact ? 'compact' : ''}`}>
          <Link to={`/login?next=/items/${item.id}`}>{t('Entre para enviar uma pista pública')}</Link>
        </p>
      )
    }

    return (
      <form className={`ig-comment-form ${compact ? 'compact' : ''}`} onSubmit={(event) => void submitComment(event, item)}>
        <input
          aria-label={t('Adicionar pista pública')}
          disabled={isCommenting}
          maxLength={500}
          placeholder={t('Adicionar pista ou pergunta pública...')}
          value={draft}
          onChange={(event) => setCommentDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
        />
        <button disabled={!draft.trim() || isCommenting} type="submit">{isCommenting ? t('Enviando...') : t('Enviar')}</button>
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
          <span className={`case-status ${item.status}`}>{t(statusLabel[item.status])}</span>
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
            {t('Não envie documento completo, telefone ou provas sensíveis nas pistas públicas.')}
          </p>
          {/* O mural traz só as duas pistas mais recentes; a lista completa fica na página do caso. */}
          {commentsCount > comments.length && (
            <Link className="ig-muted-button" to={`/items/${item.id}`}>
              {t('Ver todas as {count} pistas', { count: commentsCount })}
            </Link>
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
      <h1 className="sr-only">{t('Mural de achados e perdidos')}</h1>

      {loading ? (
        <div className="ig-feed-list" role="status" aria-label={t('Carregando casos')}>
          {Array.from({ length: 3 }).map((_, index) => <article className="ig-post skeleton-detail" key={index} />)}
        </div>
      ) : items.length ? (
        <div className="ig-feed-list">{items.map(renderPost)}</div>
      ) : loadError ? (
        <div className="panel feed-empty" role="alert">
          <h2>{t('Não foi possível carregar os casos')}</h2>
          <p>{loadError}</p>
          <button className="primary fit" type="button" onClick={() => void loadPage(1, true)}>{t('Tentar novamente')}</button>
        </div>
      ) : (
        <div className="panel feed-empty">
          <h2>{t('Nenhum caso publicado ainda')}</h2>
          <p>{t('Quando itens forem publicados, eles aparecem aqui em formato de mural.')}</p>
          <Link className="primary fit" to="/items/new">{t('Publicar item')}</Link>
        </div>
      )}

      <div ref={sentinelRef} className="feed-sentinel">
        {loadingMore && <span role="status">{t('Carregando mais casos...')}</span>}
        {loadError && items.length > 0 && (
          <span className="feed-retry" role="alert">
            {loadError}{' '}
            <button className="ghost light fit" type="button" onClick={() => void loadPage(page + 1)}>{t('Tentar novamente')}</button>
          </span>
        )}
        {!hasMore && items.length > 0 && <span>{t('Você chegou ao fim.')}</span>}
      </div>

      <FloatingFeedback feedback={error ? { type: 'error', text: error } : message ? { type: 'success', text: message } : null} onClose={clearFeedback} />

      {activeItem && (
        <div className="ig-modal-backdrop" role="dialog" aria-modal="true" aria-label={t('Caso {title}', { title: activeItem.title })} ref={modalRef}>
          <button className="ig-modal-close" type="button" aria-label={t('Fechar')} onClick={() => setActiveItemId(null)}>
            <X size={32} />
          </button>
          <article className="ig-post-modal case-modal">
            <div className="ig-modal-media">{renderMedia(activeItem, 'modal')}</div>
            <aside className="ig-modal-panel">
              <header className="ig-modal-author">
                <AuthorAvatar item={activeItem} />
                <span>
                  <strong>@{authorHandle(activeItem)}</strong>
                  <small>{t('Perfil do publicador')}</small>
                </span>
                <span className={`case-status ${activeItem.status}`}>{t(statusLabel[activeItem.status])}</span>
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
                    <p>{t('Provas de posse ficam no fluxo privado de reivindicação. Use pistas públicas apenas para perguntas e informações gerais.')}</p>
                  </div>
                </section>

                <section className="case-public-clues">
                  <h3>{t('Pistas públicas')}</h3>
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
                    <p className="empty">{t('Nenhuma pista pública por enquanto.')}</p>
                  )}
                  {(activeItem.comments_count ?? 0) > (activeItem.latest_comments ?? []).length && (
                    <Link className="ig-muted-button" to={`/items/${activeItem.id}`}>
                      {t('Ver todas as {count} pistas', { count: activeItem.comments_count ?? 0 })}
                    </Link>
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
