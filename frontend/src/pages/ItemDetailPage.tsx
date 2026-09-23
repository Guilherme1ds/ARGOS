import { ArrowLeft, CalendarDays, CheckCircle2, Info, MapPin, Pencil, ShieldCheck, Tag, Trash2, UserRound } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { api, apiAssetUrl, apiError } from '../services/api'
import type { Claim, FeedComment, Item, ItemMatch } from '../types/api'
import { approvalLabel, statusLabel } from '../utils/labels'
import { hasPermission } from '../utils/permissions'
import { validatePublicTextSafety } from '../utils/safety'

type History = { id: number; action: string; details?: string; created_at: string }
type Capabilities = { edit?: boolean; delete?: boolean; return?: boolean; readClaims?: boolean; claim?: boolean }
type ClaimErrors = Partial<Record<'message' | 'proofDetails', string>>

function validateClaim(claim: { message: string; proofDetails: string }) {
  const errors: ClaimErrors = {}
  if (claim.message.trim().length < 10) errors.message = 'Informe uma mensagem com pelo menos 10 caracteres.'
  if (claim.proofDetails.trim().length < 10) errors.proofDetails = 'Informe provas ou detalhes com pelo menos 10 caracteres.'
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

function displayDate(value: string) {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value.includes('T') ? value : `${value.replace(' ', 'T')}Z`
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }).format(date)
}

function actionTitle(item: Item) {
  if (item.status === 'returned') return 'Caso devolvido'
  return item.type === 'found' ? 'Reivindicar item' : 'Tenho informação'
}

function guestActionLabel(item: Item) {
  return item.type === 'found' ? 'Entrar para reivindicar' : 'Entrar para enviar informação'
}

export function ItemDetailPage() {
  const { id } = useParams()
  const { user, checkingSession } = useAuth()
  const loadSequence = useRef(0)
  const navigate = useNavigate()
  const location = useLocation()
  const flash = (location.state as { flash?: string } | null)?.flash ?? ''
  const [item, setItem] = useState<Item | null>(null)
  const [capabilities, setCapabilities] = useState<Capabilities>({})
  const [busyAction, setBusyAction] = useState<'claim' | 'return' | 'delete' | null>(null)
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
      setCapabilities(response.data.capabilities ?? {})
      setHistory(response.data.history ?? [])
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
      setMessage(item?.type === 'found' ? 'Reivindicação enviada com segurança.' : 'Informação enviada com segurança.')
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
      navigate('/my-items', { replace: true, state: { flash: 'Item excluído.' } })
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
      setMessage('Pista pública enviada.')
    } catch (requestError) {
      setMessageType('error')
      setMessage(apiError(requestError))
    } finally {
      setSubmittingClue(false)
    }
  }

  async function markReturned() {
    if (item?.type === 'found' && !selectedClaimId) {
      setMessageType('error')
      setMessage('Selecione a reivindicação do proprietário antes de confirmar a devolução.')
      return
    }
    if (busyAction || !window.confirm('Confirmar devolução deste item?')) return
    setMessage('')
    setBusyAction('return')
    try {
      await api.patch(`/items/${id}/return`, selectedClaimId ? { claimId: Number(selectedClaimId) } : {})
      await load({ silent: true })
      setMessageType('success')
      setMessage('Devolução registrada.')
    } catch (requestError) {
      setMessageType('error')
      setMessage(apiError(requestError))
    } finally {
      setBusyAction(null)
    }
  }

  if (loading) return <div className="panel skeleton-detail" role="status" aria-label="Carregando item" />

  if (error) {
    return (
      <section className="stack">
        <button className="ghost light fit" onClick={() => navigate(-1)}><ArrowLeft size={18} /> Voltar</button>
        <p className="message error" role="alert">{error}</p>
      </section>
    )
  }

  if (!item) {
    return (
      <section className="stack">
        <button className="ghost light fit" onClick={() => navigate('/items')}><ArrowLeft size={18} /> Voltar</button>
        <p className="empty">Item não encontrado.</p>
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
          <ArrowLeft size={18} /> Voltar
        </button>
        {(capabilities.edit || capabilities.delete) && (
          <div className="case-owner-actions">
            {capabilities.edit && (
              <Link className="ghost light fit" to={`/items/${item.id}/edit`}><Pencil size={16} /> Editar</Link>
            )}
            {capabilities.delete && !confirmingDelete && (
              <button className="ghost light fit danger-text" type="button" onClick={() => setConfirmingDelete(true)}>
                <Trash2 size={16} /> Excluir
              </button>
            )}
          </div>
        )}
      </div>
      {confirmingDelete && (
        <div className="panel confirm-panel" role="alertdialog" aria-labelledby="delete-item-title" aria-describedby="delete-item-description">
          <h3 id="delete-item-title">Excluir este item?</h3>
          <p id="delete-item-description">O caso, as pistas públicas e as reivindicações vinculadas serão removidos. Esta ação não pode ser desfeita.</p>
          <div className="confirm-actions">
            <button className="danger" type="button" onClick={() => void deleteItem()} disabled={busyAction === 'delete'} autoFocus>
              {busyAction === 'delete' ? 'Excluindo...' : 'Excluir definitivamente'}
            </button>
            <button className="ghost light" type="button" onClick={() => setConfirmingDelete(false)} disabled={busyAction === 'delete'}>Cancelar</button>
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
              <span className={`case-status ${item.status}`}>{statusLabel[item.status]}</span>
              <h2>{item.title}</h2>
              <p>{item.description}</p>
            </div>

            <div className="case-meta detail-meta">
              <span><Tag size={15} /> {item.category}</span>
              <span><MapPin size={15} /> {item.location}</span>
              {item.campus_block && <span>{item.campus_block}</span>}
              {item.approximate_place && <span>{item.approximate_place}</span>}
              <span><CalendarDays size={15} /> {displayDate(item.event_date)}</span>
              <span>{approvalLabel[item.approval_status]}</span>
            </div>

            <div className="case-publisher">
              <span className="profile-avatar mini-avatar">
                {ownerAvatar ? <img src={ownerAvatar} alt={`Foto de ${handle}`} /> : <span>{initials(handle)}</span>}
              </span>
              <div>
                <strong>@{handle}</strong>
                <small>Publicador do caso</small>
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
                <p>Este caso já foi marcado como devolvido.</p>
              </div>
            ) : canReturn ? (
              <div className="stack">
                {(item.type === 'found' || pendingClaims.length > 0) && (
                  <label>
                    <span>{item.type === 'found' ? 'Reivindicação do proprietário' : 'Reivindicação vinculada à devolução'}</span>
                    <select value={selectedClaimId} onChange={(event) => setSelectedClaimId(event.target.value)}>
                      <option value="">{item.type === 'found' ? 'Selecione uma reivindicação' : 'Nenhuma, recuperei por outro meio'}</option>
                      {pendingClaims.map((entry) => (
                        <option value={entry.id} key={entry.id}>{entry.claimant_name ?? `Usuário ${entry.claimant_id}`}</option>
                      ))}
                    </select>
                  </label>
                )}
                {item.type === 'found' && !pendingClaims.length && (
                  <p className="privacy-note">A devolução ficará disponível quando houver uma reivindicação pendente.</p>
                )}
                <button
                  className="primary"
                  type="button"
                  disabled={(item.type === 'found' && !selectedClaimId) || busyAction === 'return'}
                  onClick={() => void markReturned()}
                >
                  {busyAction === 'return' ? 'Registrando...' : 'Confirmar devolução'}
                </button>
              </div>
            ) : user ? (
              <form className="stack" onSubmit={submitClaim}>
                <label>
                  <span>Mensagem para o responsável</span>
                  <textarea
                    value={claim.message}
                    onChange={(event) => {
                      setClaim({ ...claim, message: event.target.value })
                      setClaimErrors({ ...claimErrors, message: undefined })
                    }}
                    aria-invalid={Boolean(claimErrors.message)}
                    placeholder={item.type === 'found' ? 'Explique por que acredita que o item é seu.' : 'Conte onde viu o item ou como pode ajudar.'}
                  />
                  {claimErrors.message && <small className="field-error">{claimErrors.message}</small>}
                </label>
                <label>
                  <span>{item.type === 'found' ? 'Provas privadas de posse' : 'Detalhes privados'}</span>
                  <textarea
                    value={claim.proofDetails}
                    onChange={(event) => {
                      setClaim({ ...claim, proofDetails: event.target.value })
                      setClaimErrors({ ...claimErrors, proofDetails: undefined })
                    }}
                    aria-invalid={Boolean(claimErrors.proofDetails)}
                    placeholder="Informe detalhes que não devem ficar públicos."
                  />
                  {claimErrors.proofDetails && <small className="field-error">{claimErrors.proofDetails}</small>}
                </label>
                <button className="primary" disabled={busyAction === 'claim'}>
                  <ShieldCheck size={18} /> {busyAction === 'claim' ? 'Enviando...' : 'Enviar com segurança'}
                </button>
              </form>
            ) : (
              <div className="stack">
                <p>
                  {item.type === 'found'
                    ? 'Entre para reivindicar com provas privadas e comunicação protegida.'
                    : 'Entre para enviar informação com comunicação protegida.'}
                </p>
                <Link className="primary" to={`/login?next=/items/${item.id}`}><UserRound size={18} /> {guestActionLabel(item)}</Link>
              </div>
            )}
            {message && (
              <p className={`message ${messageType}`} role={messageType === 'error' ? 'alert' : 'status'}>{message}</p>
            )}
            <div className="case-safety-box">
              <Info size={18} />
              <p>Provas de posse ficam privadas. Use pistas públicas apenas para informações gerais.</p>
            </div>
          </section>

          <section className="panel case-clues-panel">
            <h3>Pistas públicas</h3>
            <p className="privacy-note">Não publique telefone, documento completo ou provas sensíveis.</p>
            {user ? (
              <form className="ig-comment-form" onSubmit={submitClue}>
                <input
                  value={clueDraft}
                  onChange={(event) => setClueDraft(event.target.value)}
                  aria-label="Pista ou pergunta pública"
                  maxLength={500}
                  placeholder="Adicionar pista ou pergunta pública..."
                  disabled={submittingClue}
                />
                <button type="submit" disabled={!clueDraft.trim() || submittingClue}>Enviar</button>
              </form>
            ) : (
              <Link className="ghost light fit" to={`/login?next=/items/${item.id}`}>Entrar para enviar informação</Link>
            )}
            <div className="post-comments">
              {comments.map((comment) => (
                <p className="post-comment" key={comment.id}>
                  <strong>@{comment.author_nickname ?? comment.author_name}</strong> {comment.body}
                </p>
              ))}
              {!comments.length && <p className="empty">Nenhuma pista pública por enquanto.</p>}
            </div>
          </section>

          {claims.length > 0 && (
            <section className="panel">
              <h3>Reivindicações recebidas</h3>
              <div className="claim-list">
                {claims.map((entry) => (
                  <div className="claim-row" key={entry.id}>
                    <strong>{entry.claimant_name ?? `Usuário ${entry.claimant_id}`}</strong>
                    <p>{entry.message}</p>
                    <small>{entry.proof_details}</small>
                    <span className={`badge ${entry.status}`}>{entry.status === 'pending' ? 'Pendente' : entry.status === 'approved' ? 'Aprovada' : 'Rejeitada'}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {matches.length > 0 && (
            <section className="panel">
              <h3>Possíveis correspondências</h3>
              <div className="claim-list">
                {matches.map((match) => (
                  <Link className="claim-row" to={`/items/${match.id}`} key={match.id}>
                    <strong>{match.title} · {match.score}%</strong>
                    <p>{match.location} · {displayDate(match.event_date)}</p>
                    <small>{match.reasons.join(', ')}</small>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {history.length > 0 && (
            <section className="panel">
              <h3>Histórico</h3>
              <div className="timeline">
                {history.map((entry) => (
                  <p key={entry.id}><strong>{entry.action}</strong><br /><small>{entry.created_at}</small></p>
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>
    </section>
  )
}
