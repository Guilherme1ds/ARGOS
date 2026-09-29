import { AlertCircle, CheckCircle2, Clock, SearchCheck, SearchX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, apiError } from '../services/api'
import type { DashboardMetrics, Item } from '../types/api'
import { approvalLabel, statusLabel } from '../utils/labels'
import { msg, useI18n } from '../i18n'

const metricCards = [
  { key: 'lost', label: msg('Perdidos abertos'), icon: SearchX },
  { key: 'found', label: msg('Encontrados abertos'), icon: SearchCheck },
  { key: 'claimed', label: msg('Em reivindicação'), icon: AlertCircle },
  { key: 'returned', label: msg('Devolvidos'), icon: CheckCircle2 },
  { key: 'pendingApproval', label: msg('Aguardando aprovação'), icon: Clock },
] as const

export function DashboardPage() {
  const { t } = useI18n()
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null)
  const [recent, setRecent] = useState<Item[]>([])
  const [scope, setScope] = useState<'personal' | 'organization'>('personal')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const response = await api.get('/dashboard')
      setMetrics(response.data.metrics)
      setRecent(response.data.recent)
      setScope(response.data.scope)
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
        <button className="primary fit" onClick={load}>{t('Tentar novamente')}</button>
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
                <span><Icon size={18} /> {t(label)}</span>
                <strong>{metrics[key]}</strong>
              </div>
            ))}
      </div>
      <div className="panel">
        <h2>{scope === 'organization' ? t('Itens recentes da organização') : t('Meus itens recentes')}</h2>
        {loading ? (
          <div className="table">
            {Array.from({ length: 4 }).map((_, index) => <div className="skeleton-card" key={index} />)}
          </div>
        ) : recent.length ? (
          <div className="table">
            {recent.map((item) => (
              <Link to={`/items/${item.id}`} key={item.id}>
                {item.title}
                <span>{t(statusLabel[item.status])} · {t(approvalLabel[item.approval_status])}</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="empty">{t('Nenhum item recente.')}</p>
        )}
      </div>
    </section>
  )
}
