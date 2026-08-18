import { AlertCircle, CheckCircle2, Clock, SearchCheck, SearchX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, apiError } from '../services/api'
import type { DashboardMetrics, Item } from '../types/api'
import { approvalLabel, statusLabel } from '../utils/labels'

const metricCards = [
  { key: 'lost', label: 'Perdidos abertos', icon: SearchX },
  { key: 'found', label: 'Encontrados abertos', icon: SearchCheck },
  { key: 'claimed', label: 'Em reivindicação', icon: AlertCircle },
  { key: 'returned', label: 'Devolvidos', icon: CheckCircle2 },
  { key: 'pendingApproval', label: 'Aguardando aprovação', icon: Clock },
] as const

export function DashboardPage() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null)
  const [recent, setRecent] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const response = await api.get('/dashboard')
      setMetrics(response.data.metrics)
      setRecent(response.data.recent)
    } catch (requestError) {
      setError(apiError(requestError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  if (error) {
    return (
      <section className="stack">
        <p className="message error">{error}</p>
        <button className="primary fit" onClick={load}>Tentar novamente</button>
      </section>
    )
  }

  return (
    <section className="stack">
      <div className="metrics">
        {loading || !metrics
          ? Array.from({ length: 5 }).map((_, index) => <div className="metric skeleton-card" key={index} />)
          : metricCards.map(({ key, label, icon: Icon }) => (
              <div className="metric" key={key}>
                <span><Icon size={18} /> {label}</span>
                <strong>{metrics[key]}</strong>
              </div>
            ))}
      </div>
      <div className="panel">
        <h2>Itens recentes</h2>
        {loading ? (
          <div className="table">
            {Array.from({ length: 4 }).map((_, index) => <div className="skeleton-card" key={index} />)}
          </div>
        ) : recent.length ? (
          <div className="table">
            {recent.map((item) => (
              <Link to={`/items/${item.id}`} key={item.id}>
                {item.title}
                <span>{statusLabel[item.status]} · {approvalLabel[item.approval_status]}</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="empty">Nenhum item recente.</p>
        )}
      </div>
    </section>
  )
}
