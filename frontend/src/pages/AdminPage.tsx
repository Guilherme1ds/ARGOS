import { Download, ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { api, apiError } from '../services/api'
import type { ApprovalStatus, AuditLog, Item, ItemStatus, User } from '../types/api'
import { approvalLabel, statusLabel } from '../utils/labels'

type AccessRequest = { id: number; name: string; email: string; reason?: string; status: string; created_at: string }

export function AdminPage() {
  const { user: currentUser } = useAuth()
  const [items, setItems] = useState<Item[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [requests, setRequests] = useState<AccessRequest[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [filters, setFilters] = useState({ q: '', approvalStatus: '', status: '' })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [pendingAction, setPendingAction] = useState('')

  async function load() {
    setError('')
    setLoading(true)
    try {
      const itemParams = Object.fromEntries(Object.entries(filters).filter(([, value]) => Boolean(value)))
      const [itemsResponse, usersResponse, requestsResponse, auditResponse] = await Promise.all([
        api.get('/admin/items', { params: itemParams }),
        api.get('/admin/users'),
        api.get('/admin/access-requests'),
        api.get('/audit-logs', { params: { limit: 10 } }),
      ])
      setItems(itemsResponse.data.data)
      setUsers(usersResponse.data.data)
      setRequests(requestsResponse.data.data)
      setAuditLogs(auditResponse.data.data)
    } catch (requestError) {
      setError(apiError(requestError))
    } finally {
      setLoading(false)
    }
  }

  async function runAction(key: string, action: () => Promise<void>, success: string) {
    if (pendingAction) return
    setPendingAction(key)
    setMessage('')
    setError('')
    try {
      await action()
      setMessage(success)
      await load()
    } catch (requestError) {
      setError(apiError(requestError))
    } finally {
      setPendingAction('')
    }
  }

  useEffect(() => { void load() }, [])

  function updateItem(id: number, field: 'approvalStatus' | 'status', value: ApprovalStatus | ItemStatus) {
    return runAction(`item-${id}`, async () => {
      await api.patch(`/admin/items/${id}/status`, { [field]: value })
    }, 'Publicação atualizada.')
  }

  async function reviewAccess(id: number, status: 'approved' | 'rejected') {
    setMessage('')
    try {
      const response = await api.patch(`/admin/access-requests/${id}`, { status, role: 'citizen' })
      if (response.data.temporaryPassword) {
        setMessage(`Conta criada. Senha temporária: ${response.data.temporaryPassword}`)
      }
      await load()
    } catch (requestError) {
      setError(apiError(requestError))
    }
  }

  function blockUser(id: number, name: string) {
    if (!window.confirm(`Bloquear ${name}? As sessões ativas serão encerradas.`)) return
    return runAction(`user-${id}`, async () => {
      await api.patch(`/admin/users/${id}`, { status: 'blocked', spamScore: 10 })
    }, 'Usuário bloqueado e sessões encerradas.')
  }

  async function downloadCsv() {
    setError('')
    try {
      const response = await api.get('/reports/items.csv', { responseType: 'blob' })
      const url = URL.createObjectURL(response.data)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'argos-itens.csv'
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (requestError) {
      setError(apiError(requestError))
    }
  }

  return (
    <section className="stack">
      <div className="admin-header">
        <h2>Administração</h2>
        <button className="primary" onClick={downloadCsv}><Download size={18} /> CSV</button>
      </div>
      {message && <p className="message success" role="status">{message}</p>}
      {error && <p className="message error" role="alert">{error}</p>}
      {loading && <p className="loading" role="status">Carregando dados administrativos...</p>}
      <div className="panel">
        <h3>Publicações</h3>
        <div className="toolbar compact-toolbar">
          <input placeholder="Buscar" aria-label="Buscar publicações" value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} />
          <select aria-label="Filtrar por aprovação" value={filters.approvalStatus} onChange={(event) => setFilters({ ...filters, approvalStatus: event.target.value })}>
            <option value="">Todas as aprovações</option>
            <option value="pending">Pendente</option>
            <option value="approved">Aprovado</option>
            <option value="rejected">Rejeitado</option>
          </select>
          <select aria-label="Filtrar por status" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
            <option value="">Todos os status</option>
            <option value="lost">Perdido</option>
            <option value="found">Encontrado</option>
            <option value="claimed">Em análise</option>
            <option value="returned">Devolvido</option>
          </select>
          <button className="primary" onClick={() => void load()} disabled={loading}>Filtrar</button>
        </div>
        <div className="table">
          {items.map((item) => (
            <div key={item.id}>
              <strong>{item.title}</strong>
              <span>{item.owner_name} · {statusLabel[item.status]} · {approvalLabel[item.approval_status]}</span>
              <select aria-label={`Aprovação de ${item.title}`} disabled={pendingAction === `item-${item.id}`} value={item.approval_status} onChange={(event) => updateItem(item.id, 'approvalStatus', event.target.value as ApprovalStatus)}>
                <option value="pending">Pendente</option><option value="approved">Aprovado</option><option value="rejected">Rejeitado</option>
              </select>
              <select aria-label={`Status de ${item.title}`} disabled={pendingAction === `item-${item.id}`} value={item.status} onChange={(event) => updateItem(item.id, 'status', event.target.value as ItemStatus)}>
                <option value="lost">Perdido</option><option value="found">Encontrado</option><option value="claimed">Em análise</option><option value="returned">Devolvido</option>
              </select>
            </div>
          ))}
          {!items.length && <p className="empty">Nenhuma publicação encontrada.</p>}
        </div>
      </div>
      <div className="panel">
        <h3>Solicitações de acesso</h3>
        <div className="table">
          {requests.map((request) => (
            <div key={request.id}>
              <strong>{request.name}</strong><span>{request.email} · {request.status}</span>
              <button onClick={() => reviewAccess(request.id, 'approved')} aria-label={`Aprovar ${request.name}`}>Aprovar</button>
              <button onClick={() => reviewAccess(request.id, 'rejected')} aria-label={`Rejeitar ${request.name}`}>Rejeitar</button>
            </div>
          ))}
          {!requests.length && <p className="empty">Nenhuma solicitação pendente.</p>}
        </div>
      </div>
      <div className="panel">
        <h3>Usuários e anti-spam</h3>
        <div className="table">
          {users.map((user) => (
            <div key={user.id}>
              <strong>{user.name}</strong><span>{user.email} · {user.role} · {user.status}</span>
              {user.id !== currentUser?.id && user.status !== 'blocked' && (
                <button
                  className="danger"
                  onClick={() => void blockUser(user.id, user.name)}
                  disabled={pendingAction === `user-${user.id}`}
                  aria-label={`Bloquear ${user.name}`}
                >
                  <ShieldAlert size={16} /> Bloquear
                </button>
              )}
            </div>
          ))}
          {!users.length && <p className="empty">Nenhum usuário encontrado.</p>}
        </div>
      </div>
      <div className="panel">
        <h3>Auditoria</h3>
        <div className="table audit-table">
          {auditLogs.map((log) => (
            <div key={log.id}>
              <strong>{log.action}</strong>
              <span>{log.actor_name ?? 'Sistema'} · {log.entity_type} · {log.created_at}</span>
            </div>
          ))}
          {!auditLogs.length && <p className="empty">Nenhum evento de auditoria.</p>}
        </div>
      </div>
    </section>
  )
}
