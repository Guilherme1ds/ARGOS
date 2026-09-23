import { RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api, apiError } from '../services/api'
import type { ApprovalStatus, Item, ItemStatus } from '../types/api'
import { approvalLabel, statusLabel } from '../utils/labels'

export function MyItemsPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [flash] = useState((location.state as { flash?: string } | null)?.flash ?? '')
  const [items, setItems] = useState<Item[]>([])
  const [status, setStatus] = useState<ItemStatus | ''>('')
  const [approvalStatus, setApprovalStatus] = useState<ApprovalStatus | ''>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const response = await api.get('/items')
      setItems(response.data.data)
    } catch (requestError) {
      setError(apiError(requestError))
    } finally {
      setLoading(false)
    }
  }

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (status && item.status !== status) return false
      if (approvalStatus && item.approval_status !== approvalStatus) return false
      return true
    })
  }, [approvalStatus, items, status])

  useEffect(() => {
    void load()
    if (flash) navigate(location.pathname, { replace: true, state: null })
  }, [])

  return (
    <section className="stack">
      <div className="admin-header">
        <h2>Meus itens</h2>
        <button className="ghost light" onClick={load} disabled={loading}><RefreshCw size={18} /> Atualizar</button>
      </div>
      <div className="toolbar compact-toolbar">
        <select aria-label="Filtrar por status" value={status} onChange={(event) => setStatus(event.target.value as ItemStatus | '')}>
          <option value="">Todos os status</option>
          <option value="lost">Perdido</option>
          <option value="found">Encontrado</option>
          <option value="claimed">Em análise</option>
          <option value="returned">Devolvido</option>
        </select>
        <select aria-label="Filtrar por aprovação" value={approvalStatus} onChange={(event) => setApprovalStatus(event.target.value as ApprovalStatus | '')}>
          <option value="">Todas as aprovações</option>
          <option value="pending">Pendente</option>
          <option value="approved">Aprovado</option>
          <option value="rejected">Rejeitado</option>
        </select>
      </div>
      {flash && <p className="message success" role="status">{flash}</p>}
      {error && <p className="message error" role="alert">{error}</p>}
      <div className="panel">
        {loading ? (
          <div className="table" role="status" aria-label="Carregando itens">
            {Array.from({ length: 4 }).map((_, index) => <div className="skeleton-card" key={index} />)}
          </div>
        ) : filteredItems.length ? (
          <div className="table">
            {filteredItems.map((item) => (
              <Link to={`/items/${item.id}`} key={item.id}>
                {item.title}
                <span>{statusLabel[item.status]} · {approvalLabel[item.approval_status]}</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="empty">Nenhum item encontrado para os filtros atuais.</p>
        )}
      </div>
    </section>
  )
}
