import { ArrowLeft, Bookmark, Languages, CalendarDays, CheckCircle2, Clock, Flag, Info, MapPin, Pencil, ShieldCheck, Tag, Trash2, UserRound, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { api, apiAssetUrl, apiError } from '../services/api'
import type { Claim, ClaimStatus, FeedComment, Item, ItemMatch } from '../types/api'
import { approvalLabel, claimStatusLabel, historyActionLabel, statusLabel } from '../utils/labels'
import { hasPermission } from '../utils/permissions'
import { validatePublicTextSafety } from '../utils/safety'
import { formatDate, formatDateTime } from '../utils/dates'
import { msg, t as translateNow, useI18n } from '../i18n'
import { MapView } from '../components/MapView'
import { useAppConfig } from '../services/config'

type History = { id: number; action: string; details?: string; created_at: string }
type Capabilities = { edit?: boolean; delete?: boolean; return?: boolean; readClaims?: boolean; claim?: boolean }
type ClaimErrors = Partial<Record<'message' | 'proofDetails', string>>
type BusyAction = 'claim' | 'return' | 'delete' | 'withdraw' | 'reject' | 'follow' | 'report'

function validateClaim(claim: { message: string; proofDetails: string }) {
  const errors: ClaimErrors = {}
  if (claim.message.trim().length < 10) errors.message = translateNow('Informe uma mensagem com pelo menos 10 caracteres.')
  if (claim.proofDetails.trim().length < 10) errors.proofDetails = translateNow('Informe provas ou detalhes com pelo menos 10 caracteres.')
  return errors
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

function authorHandle(item: Item) {
  return item.owner_nickname || item.owner_name || `usuario.${item.id}`
}

function actionTitle(item: Item) {
  if (item.status === 'returned') return translateNow('Caso devolvido')
  return item.type === 'found' ? translateNow('Reivindicar item') : translateNow('Tenho informação')
}

function guestActionLabel(item: Item) {
  return item.type === 'found' ? translateNow('Entrar para reivindicar') : translateNow('Entrar para enviar informação')
}

export function ItemDetailPage() {
  const { id } = useParams()
  const { user, checkingSession } = useAuth()
  const { t } = useI18n()
  const loadSequence = useRef(0)
  const navigate = useNavigate()
  const location = useLocation()
  const flash = (location.state as { flash?: string } | null)?.flash ?? ''
  const [item, setItem] = useState<Item | null>(null)
  const [capabilities, setCapabilities] = useState<Capabilities>({})
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null)
  const [myClaim, setMyClaim] = useState<{ id: number; status: ClaimStatus } | null>(null)
  const [following, setFollowing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [history, setHistory] = useState<History[]>([])
  const [claims, setClaims] = useState<Claim[]>([])
  const [matches, setMatches] = useState<ItemMatch[]>([])
  const [selectedClaimId, setSelectedClaimId] = useState('')
  const [comments, setComments] = useState<FeedComment[]>([])
  const [claim, setClaim] = useState({ message: '', proofDetails: '' })
  const [claimErrors, setClaimErrors] = useState<ClaimErrors>({})
  const [clueDraft, setClueDraft] = useState('')
  const [submittingClue, setSubmittingClue] = useState(false)
  const [message, setMessage] = useState(flash)
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const config = useAppConfig()
  const { language } = useI18n()
  const [translation, setTranslation] = useState<{ title: string; description: string; language: string } | null>(null)
  const [showTranslation, setShowTranslation] = useState(false)
  const [translating, setTranslating] = useState(false)

  function canReadClaims(nextItem: Item) {
    return Boolean(user && (user.id === nextItem.owner_id || hasPermission(user, 'claims:read_private')))
  }

  async function load({ silent = false } = {}) {
    // Descarta respostas de carregamentos anteriores (troca rápida de item ou de sessão).
    const sequence = ++loadSequence.current
    const isCurrent = () => sequence === loadSequence.current
    if (!silent) setLoading(true)
    setError('')
    setSelectedClaimId('')
    try {
      const response = await api.get(`/items/${id}`)
      if (!isCurrent()) return
      const nextItem = response.data.item as Item
      setItem(nextItem)
      setTranslation(null)
      setShowTranslation(false)
      setCapabilities(response.data.capabilities ?? {})
      setHistory(response.data.history ?? [])
      setMyClaim(response.data.myClaim ?? null)
      setFollowing(Boolean(response.data.following))
      const readsClaims = canReadClaims(nextItem)
      const [commentsResponse, claimsResponse, matchesResponse] = await Promise.all([
        api.get(`/items/${id}/comments`),
        readsClaims ? api.get(`/items/${id}/claims`) : null,
        readsClaims ? api.get(`/items/${id}/matches`).catch(() => null) : null,
      ])
      if (!isCurrent()) return
      setComments(commentsResponse.data.data)
      setClaims(claimsResponse?.data.data ?? [])
      setMatches(matchesResponse?.data.data ?? [])
    } catch (requestError) {
      if (isCurrent()) setError(apiError(requestError))
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }

  useEffect(() => {
    // Aguarda a restauração da sessão para não carregar o item duas vezes (anônimo e autenticado).
    if (checkingSession) return
    void load()
  }, [id, user?.id, user?.role, checkingSession])

  useEffect(() => {
    // Consome a mensagem de navegação para que não reapareça ao recarregar ou voltar.
    if (flash) navigate(location.pathname, { replace: true, state: null })
  }, [flash, location.pathname, navigate])

  async function submitClaim(event: React.FormEvent) {
    event.preventDefault()
    setMessage('')
    setMessageType('success')
    const nextErrors = validateClaim(claim)
    setClaimErrors(nextErrors)
    if (Object.keys(nextErrors).length || busyAction) return

    setBusyAction('claim')
    try {
      await api.post(`/items/${id}/claim`, claim)
      setClaim({ message: '', proofDetails: '' })
      await load({ silent: true })
      setMessage(item?.type === 'found' ? t('Reivindicação enviada com segurança.') : t('Informação enviada com segurança.'))
    } catch (requestError) {
      setMessageType('error')
      setMessage(apiError(requestError))
    } finally {
      setBusyAction(null)
    }
  }

  async function deleteItem() {
    if (busyAction) return
    setBusyAction('delete')
    setMessage('')
    try {
      await api.delete(`/items/${id}`)
      navigate('/my-items', { replace: true, state: { flash: t('Item excluído.') } })
    } catch (requestError) {
      setMessageType('error')
      setMessage(apiError(requestError))
      setConfirmingDelete(false)
    } finally {
      setBusyAction(null)
    }
  }

  async function submitClue(event: React.FormEvent) {
    event.preventDefault()
    const body = clueDraft.trim()
    if (!body || !user) return
    const safetyMessage = validatePublicTextSafety(body)
    if (safetyMessage) {
      setMessageType('error')
      setMessage(safetyMessage)
      return
    }

    setSubmittingClue(true)
    setMessageType('success')
    setMessage('')
    try {
      const response = await api.post(`/items/${id}/comments`, { body })
      setComments((current) => [...current, response.data.comment])
      setClueDraft('')
      setMessage(t('Pista pública enviada.'))
    } catch (requestError) {
      setMessageType('error')
      setMessage(apiError(requestError))
    } finally {
      setSubmittingClue(false)
    }
  }

  async function runAction(action: BusyAction, request: () => Promise<unknown>, success: string) {
    if (busyAction) return
    setBusyAction(action)
    setMessage('')
    try {
      await request()
      await load({ silent: true })
      setMessageType('success')
      setMessage(success)
    } catch (requestError) {
      setMessageType('error')
      setMessage(apiError(requestError))
    } finally {
      setBusyAction(null)
    }
  }

  function withdrawClaim() {
    if (!window.confirm(t('Cancelar sua reivindicação? Você poderá enviar outra depois.'))) return
    void runAction('withdraw', () => api.delete(`/items/${id}/claim`), t('Reivindicação cancelada.'))
  }

  function rejectClaim(claimId: number) {
    if (!window.confirm(t('Recusar esta reivindicação? A pessoa será avisada.'))) return
    void runAction('reject', () => api.patch(`/items/${id}/claims/${claimId}/reject`), t('Reivindicação recusada.'))
  }

  function toggleFollow() {
    const next = !following
    void runAction(
      'follow',
      () => (next ? api.post(`/items/${id}/follow`) : api.delete(`/items/${id}/follow`)),
      next ? t('Caso adicionado aos acompanhamentos.') : t('Caso removido dos acompanhamentos.'),
    )
  }

  function reportItem() {
    const reason = window.prompt(t('Por que este caso deve ser revisado pela moderação?'), t('Conteúdo suspeito ou inadequado.'))?.trim()
    if (!reason) return
    if (reason.length < 4) {
      setMessageType('error')
      setMessage(t('Descreva o motivo com pelo menos 4 caracteres.'))
      return
    }
    void runAction('report', () => api.post(`/items/${id}/report`, { reason }), t('Sinalização enviada para análise.'))
  }

  async function deleteComment(commentId: number) {
    if (!window.confirm(t('Remover esta pista pública?'))) return
    try {
      await api.delete(`/items/${id}/comments/${commentId}`)
      setComments((current) => current.filter((comment) => comment.id !== commentId))
      setMessageType('success')
      setMessage(t('Pista removida.'))
    } catch (requestError) {
      setMessageType('error')
      setMessage(apiError(requestError))
    }
  }

  // O conteúdo é escrito por quem publicou; a tradução automática vai para o idioma escolhido na interface.
  async function translateContent() {
    if (translation?.language === language) {
      setShowTranslation((current) => !current)
      return
    }
    setTranslating(true)
    try {
      const response = await api.post(`/items/${id}/translate`, { language })
      setTranslation(response.data.translation)
      setShowTranslation(true)
    } catch (requestError) {
      setMessageType('error')
      setMessage(apiError(requestError))
    } finally {
      setTranslating(false)
    }
  }

  async function markReturned() {
    if (item?.type === 'found' && !selectedClaimId) {
      setMessageType('error')
      setMessage(t('Selecione a reivindicação do proprietário antes de confirmar a devolução.'))
      return
    }
    if (busyAction || !window.confirm(t('Confirmar devolução deste item?'))) return
    setMessage('')
    setBusyAction('return')
    try {
      await api.patch(`/items/${id}/return`, selectedClaimId ? { claimId: Number(selectedClaimId) } : {})
      await load({ silent: true })
      setMessageType('success')
      setMessage(t('Devolução registrada.'))
    } catch (requestError) {
      setMessageType('error')
      setMessage(apiError(requestError))
    } finally {
      setBusyAction(null)
    }
  }

  if (loading) return <div className="panel skeleton-detail" role="status" aria-label={t('Carregando item')} />

  if (error) {
    return (
      <section className="stack">
        <button className="ghost light fit" onClick={() => navigate(-1)}><ArrowLeft size={18} /> {t('Voltar')}</button>
        <p className="message error" role="alert">{error}</p>
      </section>
    )
  }

  if (!item) {
    return (
      <section className="stack">
        <button className="ghost light fit" onClick={() => navigate('/items')}><ArrowLeft size={18} /> {t('Voltar')}</button>
        <p className="empty">{t('Item não encontrado.')}</p>
      </section>
    )
  }

  const handle = authorHandle(item)
  const ownerAvatar = apiAssetUrl(item.owner_avatar_url)
  const canReturn = Boolean(user && (user.id === item.owner_id || hasPermission(user, 'items:return')))
  const isReturned = item.status === 'returned'
  const pendingClaims = claims.filter((entry) => entry.status === 'pending' || entry.status === 'approved')

  return (
    <section className="case-detail-page">
      <div className="case-detail-toolbar">
        <button className="ghost light fit" onClick={() => navigate(-1)}>
          <ArrowLeft size={18} /> {t('Voltar')}
        </button>
        <div className="case-owner-actions">
          {user && (
            <button className={following ? 'ghost light fit active' : 'ghost light fit'} type="button" onClick={toggleFollow} disabled={busyAction === 'follow'}>
              {following ? <CheckCircle2 size={16} /> : <Bookmark size={16} />} {following ? t('Acompanhando') : t('Acompanhar')}
            </button>
          )}
          {user && user.id !== item.owner_id && (
            <button className="ghost light fit" type="button" onClick={reportItem} disabled={busyAction === 'report'}>
              <Flag size={16} /> {t('Denunciar')}
            </button>
          )}
        </div>
        {(capabilities.edit || capabilities.delete) && (
          <div className="case-owner-actions">
            {capabilities.edit && (
              <Link className="ghost light fit" to={`/items/${item.id}/edit`}><Pencil size={16} /> {t('Editar')}</Link>
            )}
            {capabilities.delete && !confirmingDelete && (
              <button className="ghost light fit danger-text" type="button" onClick={() => setConfirmingDelete(true)}>
                <Trash2 size={16} /> {t('Excluir')}
              </button>
            )}
          </div>
        )}
      </div>
      {confirmingDelete && (
        <div className="panel confirm-panel" role="alertdialog" aria-labelledby="delete-item-title" aria-describedby="delete-item-description">
          <h3 id="delete-item-title">{t('Excluir este item?')}</h3>
          <p id="delete-item-description">{t('O caso, as pistas públicas e as reivindicações vinculadas serão removidos. Esta ação não pode ser desfeita.')}</p>
          <div className="confirm-actions">
            <button className="danger" type="button" onClick={() => void deleteItem()} disabled={busyAction === 'delete'} autoFocus>
              {busyAction === 'delete' ? t('Excluindo...') : t('Excluir definitivamente')}
            </button>
            <button className="ghost light" type="button" onClick={() => setConfirmingDelete(false)} disabled={busyAction === 'delete'}>{t('Cancelar')}</button>
          </div>
        </div>
      )}

      <div className="case-detail-grid">
        <article className="case-detail-card">
          <div className="case-detail-media">
            {item.image_url ? (
              <img src={apiAssetUrl(item.image_url)} alt={item.title} />
            ) : (
              <span>{initials(item.title)}</span>
            )}
          </div>

          <div className="case-detail-content">
            <div className="case-detail-heading">
              <span className={`case-status ${item.status}`}>{t(statusLabel[item.status])}</span>
              <h2>{showTranslation && translation ? translation.title : item.title}</h2>
              <p>{showTranslation && translation ? translation.description : item.description}</p>
              {config?.translation && (
                <button className="link-button" type="button" onClick={() => void translateContent()} disabled={translating}>
                  <Languages size={15} />{' '}
                  {translating
                    ? t('Traduzindo...')
                    : showTranslation && translation?.language === language
                      ? t('Ver texto original')
                      : t('Traduzir publicação')}
                </button>
              )}
              {showTranslation && translation && <small className="privacy-note">{t('Tradução automática.')}</small>}
            </div>

            <div className="case-meta detail-meta">
              <span><Tag size={15} /> {item.category}</span>
              <span><MapPin size={15} /> {item.location}</span>
              {item.campus_block && <span>{item.campus_block}</span>}
              {item.approximate_place && <span>{item.approximate_place}</span>}
              <span><CalendarDays size={15} /> {formatDate(item.event_date)}</span>
              <span>{t(approvalLabel[item.approval_status])}</span>
            </div>

            <div className="case-publisher">
              <span className="profile-avatar mini-avatar">
                {ownerAvatar ? <img src={ownerAvatar} alt={t('Foto de {name}', { name: handle })} /> : <span>{initials(handle)}</span>}
              </span>
              <div>
                <strong>@{handle}</strong>
                <small>{t('Publicador do caso')}</small>
              </div>
            </div>
          </div>
        </article>

        <aside className="case-detail-side">
          <section className="panel case-action-panel">
            <h3>{actionTitle(item)}</h3>
            {isReturned ? (
              <div className="case-safety-box success-box">
                <CheckCircle2 size={18} />
                <p>{t('Este caso já foi marcado como devolvido.')}</p>
              </div>
            ) : canReturn ? (
              <div className="stack">
                {(item.type === 'found' || pendingClaims.length > 0) && (
                  <label>
                    <span>{item.type === 'found' ? t('Reivindicação do proprietário') : t('Reivindicação vinculada à devolução')}</span>
                    <select value={selectedClaimId} onChange={(event) => setSelectedClaimId(event.target.value)}>
                      <option value="">{item.type === 'found' ? t('Selecione uma reivindicação') : t('Nenhuma, recuperei por outro meio')}</option>
                      {pendingClaims.map((entry) => (
                        <option value={entry.id} key={entry.id}>{entry.claimant_name ?? t('Usuário {id}', { id: entry.claimant_id })}</option>
                      ))}
                    </select>
                  </label>
                )}
                {item.type === 'found' && !pendingClaims.length && (
                  <p className="privacy-note">{t('A devolução ficará disponível quando houver uma reivindicação pendente.')}</p>
                )}
                <button
                  className="primary"
                  type="button"
                  disabled={(item.type === 'found' && !selectedClaimId) || busyAction === 'return'}
                  onClick={() => void markReturned()}
                >
                  {busyAction === 'return' ? t('Registrando...') : t('Confirmar devolução')}
                </button>
              </div>
            ) : user && myClaim ? (
              <div className="stack">
                <div className="case-safety-box">
                  <Clock size={18} />
                  <p>
                    {item.type === 'found'
                      ? myClaim.status === 'approved'
                        ? t('Sua reivindicação foi enviada e está aprovada. Você será avisado nas notificações.')
                        : t('Sua reivindicação foi enviada e está em análise pelo responsável. Você será avisado nas notificações.')
                      : t('Sua informação foi enviada e está em análise pelo responsável. Você será avisado nas notificações.')}
                  </p>
                </div>
                <button className="ghost light" type="button" onClick={withdrawClaim} disabled={busyAction === 'withdraw'}>
                  <X size={18} /> {busyAction === 'withdraw' ? t('Cancelando...') : t('Cancelar envio')}
                </button>
              </div>
            ) : user ? (
              <form className="stack" onSubmit={submitClaim}>
                <label>
                  <span>{t('Mensagem para o responsável')}</span>
                  <textarea
                    value={claim.message}
                    onChange={(event) => {
                      setClaim({ ...claim, message: event.target.value })
                      setClaimErrors({ ...claimErrors, message: undefined })
                    }}
                    aria-invalid={Boolean(claimErrors.message)}
                    placeholder={item.type === 'found' ? t('Explique por que acredita que o item é seu.') : t('Conte onde viu o item ou como pode ajudar.')}
                  />
                  {claimErrors.message && <small className="field-error">{claimErrors.message}</small>}
                </label>
                <label>
                  <span>{item.type === 'found' ? t('Provas privadas de posse') : t('Detalhes privados')}</span>
                  <textarea
                    value={claim.proofDetails}
                    onChange={(event) => {
                      setClaim({ ...claim, proofDetails: event.target.value })
                      setClaimErrors({ ...claimErrors, proofDetails: undefined })
                    }}
                    aria-invalid={Boolean(claimErrors.proofDetails)}
                    placeholder={t('Informe detalhes que não devem ficar públicos.')}
                  />
                  {claimErrors.proofDetails && <small className="field-error">{claimErrors.proofDetails}</small>}
                </label>
                <button className="primary" disabled={busyAction === 'claim'}>
                  <ShieldCheck size={18} /> {busyAction === 'claim' ? t('Enviando...') : t('Enviar com segurança')}
                </button>
              </form>
            ) : (
              <div className="stack">
                <p>
                  {item.type === 'found'
                    ? t('Entre para reivindicar com provas privadas e comunicação protegida.')
                    : t('Entre para enviar informação com comunicação protegida.')}
                </p>
                <Link className="primary" to={`/login?next=/items/${item.id}`}><UserRound size={18} /> {guestActionLabel(item)}</Link>
              </div>
            )}
            {message && (
              <p className={`message ${messageType}`} role={messageType === 'error' ? 'alert' : 'status'}>{message}</p>
            )}
            <div className="case-safety-box">
              <Info size={18} />
              <p>{t('Provas de posse ficam privadas. Use pistas públicas apenas para informações gerais.')}</p>
            </div>
          </section>

          {config && item.latitude != null && item.longitude != null && (
            <section className="panel">
              <h3>{t('Local no mapa')}</h3>
              <MapView
                center={[item.latitude, item.longitude]}
                zoom={17}
                markers={[{ id: item.id, latitude: item.latitude, longitude: item.longitude, variant: item.status === 'returned' ? 'returned' : item.type }]}
                label={msg('Local do caso no mapa')}
              />
              <small className="privacy-note">{t('Posição aproximada informada por quem publicou.')}</small>
            </section>
          )}

          <section className="panel case-clues-panel">
            <h3>{t('Pistas públicas')}</h3>
            <p className="privacy-note">{t('Não publique telefone, documento completo ou provas sensíveis.')}</p>
            {user ? (
              <form className="ig-comment-form" onSubmit={submitClue}>
                <input
                  value={clueDraft}
                  onChange={(event) => setClueDraft(event.target.value)}
                  aria-label={t('Pista ou pergunta pública')}
                  maxLength={500}
                  placeholder={t('Adicionar pista ou pergunta pública...')}
                  disabled={submittingClue}
                />
                <button type="submit" disabled={!clueDraft.trim() || submittingClue}>{t('Enviar')}</button>
              </form>
            ) : (
              <Link className="ghost light fit" to={`/login?next=/items/${item.id}`}>{t('Entrar para enviar informação')}</Link>
            )}
            <div className="post-comments">
              {comments.map((comment) => (
                <p className="post-comment" key={comment.id}>
                  <strong>@{comment.author_nickname ?? comment.author_name}</strong> {comment.body}
                  {user && (comment.user_id === user.id || hasPermission(user, 'items:moderate')) && (
                    <button className="comment-delete" type="button" aria-label={t('Remover pista')} title={t('Remover pista')} onClick={() => void deleteComment(comment.id)}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </p>
              ))}
              {!comments.length && <p className="empty">{t('Nenhuma pista pública por enquanto.')}</p>}
            </div>
          </section>

          {claims.length > 0 && (
            <section className="panel">
              <h3>{t('Reivindicações recebidas')}</h3>
              <div className="claim-list">
                {claims.map((entry) => (
                  <div className="claim-row" key={entry.id}>
                    <strong>{entry.claimant_name ?? t('Usuário {id}', { id: entry.claimant_id })}</strong>
                    <p>{entry.message}</p>
                    <small>{entry.proof_details}</small>
                    <span className={`badge ${entry.status}`}>{t(claimStatusLabel[entry.status])}</span>
                    {!isReturned && (entry.status === 'pending' || entry.status === 'approved') && (
                      <button className="ghost light fit" type="button" onClick={() => rejectClaim(entry.id)} disabled={busyAction === 'reject'}>
                        <X size={16} /> {t('Recusar')}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {matches.length > 0 && (
            <section className="panel">
              <h3>{t('Possíveis correspondências')}</h3>
              <div className="claim-list">
                {matches.map((match) => (
                  <Link className="claim-row" to={`/items/${match.id}`} key={match.id}>
                    <strong>{match.title} · {match.score}%</strong>
                    <p>{match.location} · {formatDate(match.event_date)}</p>
                    <small>{match.reasons.map((reason) => t(reason)).join(', ')}</small>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {history.length > 0 && (
            <section className="panel">
              <h3>{t('Histórico')}</h3>
              <div className="timeline">
                {history.map((entry) => (
                  <p key={entry.id}><strong>{historyActionLabel[entry.action] ? t(historyActionLabel[entry.action]) : entry.action}</strong><br /><small>{formatDateTime(entry.created_at)}</small></p>
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>
    </section>
  )
}
