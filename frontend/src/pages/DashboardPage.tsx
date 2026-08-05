import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../services/api'
import type { DashboardMetrics, Item } from '../types/api'

export function DashboardPage() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null)
  const [recent, setRecent] = useState<Item[]>([])

  useEffect(() => {
    api.get('/dashboard').then((response) => {
      setMetrics(response.data.metrics)
      setRecent(response.data.recent)
    })
  }, [])

  return (
    <section className="stack">
      <div className="metrics">
        {metrics && Object.entries(metrics).map(([key, value]) => <div className="metric" key={key}><span>{key}</span><strong>{value}</strong></div>)}
      </div>
      <div className="panel">
        <h2>Itens recentes</h2>
        <div className="table">
          {recent.map((item) => <Link to={`/items/${item.id}`} key={item.id}>{item.title}<span>{item.status}</span></Link>)}
        </div>
      </div>
    </section>
  )
}
