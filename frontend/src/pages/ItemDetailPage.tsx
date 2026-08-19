import { ArrowLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { api, apiAssetUrl, apiError } from '../services/api'
import type { Claim, FeedComment, Item } from '../types/api'
import { approvalLabel, statusLabel } from '../utils/labels'
import { hasPermission } from '../utils/permissions'

type History = { id: number; action: string; details?: string; created_at: string }
type ClaimErrors = Partial<Record<'message' | 'proofDetails', string>>

function validateClaim(claim: { message: string; proofDetails: string }) {
  const errors: ClaimErrors = {}
  if (claim.message.trim().length < 10) errors.message = 'Informe uma mensagem com pelo menos 10 caracteres.'
  if (claim.proofDetails.trim().length < 10) errors.proofDetails = 'Informe provas com pelo menos 10 caracteres.'
  return errors
}

export function ItemDetailPage() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [item, setItem] = useState<Item | null>(null)
  const [history, setHistory] = useState<History[]>([])
  const [claims, setClaims] = useState<Claim[]>([])
  const [comments, setComments] = useState<FeedComment[]>([])
  const [claim, setClaim] = useState({ message: '', proofDetails: '' })
  const [claimErrors, setClaimErrors] = useState<ClaimErrors>({})
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  function canReadClaims(nextItem: Item) {
    return Boolean(user && (user.id === nextItem.owner_id || hasPermission(user, 'claims:read_private')))
  }

  async function load() {
    setLoading(true)
    setError('')
    try {
      const response = await api.get(`/items/${id}`)
      const nextItem = response.data.item as Item
      setItem(nextItem)
      setHistory(response.data.history ?? [])
      const commentsResponse = await api.get(`/items/${id}/comments`)
      setComments(commentsResponse.data.data)
      if (canReadClaims(nextItem)) {
        const claimsResponse = await api.get(`/items/${id}/claims`)
        setClaims(claimsResponse.data.data)
      } else {
        setClaims([])
      }
    } catch (requestError) {
      setError(apiError(requestError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [id, user?.id, user?.role])

  async function submitClaim(event: React.FormEvent) {
    event.preventDefault()
    setMessage('')
    const nextErrors = validateClaim(claim)
    setClaimErrors(nextErrors)
    if (Object.keys(nextErrors).length) return

    try {
      await api.post(`/items/${id}/claim`, claim)
      setClaim({ message: '', proofDetails: '' })
      setMessage('Reivindicação enviada com segurança.')
      await load()
    } catch (requestError) {
      setMessage(apiError(requestError))
    }
  }

  async function markReturned() {
    if (!window.confirm('Confirmar devolução deste item?')) return
    await api.patch(`/items/${id}/return`)
    await load()
  }

  if (loading) return <div className="panel skeleton-detail" />
  if (error) {
    return (
      <section className="stack">
        <button className="ghost light fit" onClick={() => navigate(-1)}><ArrowLeft size={18} /> Voltar</button>
        <p className="message error">{error}</p>
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

  return (
    <section className="detail">
      <article className="panel">
        <button className="ghost light fit" onClick={() => navigate(-1)}><ArrowLeft size={18} /> Voltar</button>
        {item.image_url && <img className="detail-image" src={apiAssetUrl(item.image_url)} alt={item.title} />}
        <span className={`badge ${item.status}`}>{statusLabel[item.status]}</span>
        <h2>{item.title}</h2>
        <p>{item.description}</p>
        <div className="facts">
          <span>{item.category}</span>
          <span>{item.location}</span>
          {item.campus_block && <span>{item.campus_block}</span>}
          {item.approximate_place && <span>{item.approximate_place}</span>}
          <span>{item.event_date}</span>
          <span>{approvalLabel[item.approval_status]}</span>
        </div>
        {user && user.id === item.owner_id && item.status !== 'returned' && <button className="primary" onClick={markReturned}>Aceitar devolução</button>}
      </article>
      <aside className="panel stack">
        <section>
          <h3>Reivindicar item</h3>
          {user ? (
            <form className="stack" onSubmit={submitClaim}>
              <label>
                <span>Mensagem</span>
                <textarea value={claim.message} onChange={(event) => {
                  setClaim({ ...claim, message: event.target.value })
                  setClaimErrors({ ...claimErrors, message: undefined })
                }} aria-invalid={Boolean(claimErrors.message)} />
                {claimErrors.message && <small className="field-error">{claimErrors.message}</small>}
              </label>
              <label>
                <span>Provas</span>
                <textarea value={claim.proofDetails} onChange={(event) => {
                  setClaim({ ...claim, proofDetails: event.target.value })
                  setClaimErrors({ ...claimErrors, proofDetails: undefined })
                }} aria-invalid={Boolean(claimErrors.proofDetails)} />
                {claimErrors.proofDetails && <small className="field-error">{claimErrors.proofDetails}</small>}
              </label>
              <button className="primary">Enviar reivindicação</button>
            </form>
          ) : <p>Entre para reivindicar com comunicação protegida.</p>}
          {message && <p className="message">{message}</p>}
        </section>
        {comments.length > 0 && (
          <section>
            <h3>Comentários</h3>
            <div className="post-comments">
              {comments.map((comment) => (
                <p className="post-comment" key={comment.id}><strong>{comment.author_name}</strong> {comment.body}</p>
              ))}
            </div>
          </section>
        )}
        {claims.length > 0 && (
          <section>
            <h3>Reivindicações recebidas</h3>
            <div className="claim-list">
              {claims.map((entry) => (
                <div className="claim-row" key={entry.id}>
                  <strong>{entry.claimant_name ?? `Usuário ${entry.claimant_id}`}</strong>
                  <p>{entry.message}</p>
                  <small>{entry.proof_details}</small>
                </div>
              ))}
            </div>
          </section>
        )}
        {history.length > 0 && (
          <section>
            <h3>Histórico</h3>
            <div className="timeline">{history.map((entry) => <p key={entry.id}><strong>{entry.action}</strong><br /><small>{entry.created_at}</small></p>)}</div>
          </section>
        )}
      </aside>
    </section>
  )
}
