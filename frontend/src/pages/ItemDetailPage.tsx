import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { api, apiError } from '../services/api'
import type { Item } from '../types/api'
import { approvalLabel, statusLabel } from '../utils/labels'

type History = { id: number; action: string; details?: string; created_at: string }

export function ItemDetailPage() {
  const { id } = useParams()
  const { user } = useAuth()
  const [item, setItem] = useState<Item | null>(null)
  const [history, setHistory] = useState<History[]>([])
  const [claim, setClaim] = useState({ message: '', proofDetails: '' })
  const [message, setMessage] = useState('')

  async function load() {
    const response = await api.get(`/items/${id}`)
    setItem(response.data.item)
    setHistory(response.data.history)
  }

  useEffect(() => { load() }, [id])

  async function submitClaim(event: React.FormEvent) {
    event.preventDefault()
    try {
      await api.post(`/items/${id}/claim`, claim)
      setMessage('Reivindicação enviada com segurança.')
      load()
    } catch (error) {
      setMessage(apiError(error))
    }
  }

  async function markReturned() {
    await api.patch(`/items/${id}/return`)
    load()
  }

  if (!item) return <p>Carregando...</p>

  return (
    <section className="detail">
      <article className="panel">
        {item.image_url && <img className="detail-image" src={`http://localhost:3333${item.image_url}`} alt="" />}
        <span className={`badge ${item.status}`}>{statusLabel[item.status]}</span>
        <h2>{item.title}</h2>
        <p>{item.description}</p>
        <div className="facts">
          <span>{item.category}</span><span>{item.location}</span><span>{item.campus_block}</span><span>{item.approximate_place}</span>
          <span>{item.event_date}</span><span>{approvalLabel[item.approval_status]}</span>
        </div>
        {user && user.id === item.owner_id && item.status !== 'returned' && <button className="primary" onClick={markReturned}>Aceitar devolução</button>}
      </article>
      <aside className="panel">
        <h3>Reivindicar item</h3>
        {user ? (
          <form className="stack" onSubmit={submitClaim}>
            <textarea placeholder="Mensagem para o responsável" value={claim.message} onChange={(e) => setClaim({ ...claim, message: e.target.value })} />
            <textarea placeholder="Provas: cor, marca, conteúdo, local exato..." value={claim.proofDetails} onChange={(e) => setClaim({ ...claim, proofDetails: e.target.value })} />
            <button className="primary">Enviar reivindicação</button>
          </form>
        ) : <p>Entre para reivindicar com comunicação protegida.</p>}
        {message && <p className="message">{message}</p>}
        <h3>Histórico</h3>
        <div className="timeline">{history.map((entry) => <p key={entry.id}><strong>{entry.action}</strong><br /><small>{entry.created_at}</small></p>)}</div>
      </aside>
    </section>
  )
}
