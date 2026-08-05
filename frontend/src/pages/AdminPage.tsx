import { Download, ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../services/api'
import type { ApprovalStatus, Item, ItemStatus, User } from '../types/api'
import { approvalLabel, statusLabel } from '../utils/labels'

type AccessRequest = { id: number; name: string; email: string; reason?: string; status: string; created_at: string }

export function AdminPage() {
  const [items, setItems] = useState<Item[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [requests, setRequests] = useState<AccessRequest[]>([])

  async function load() {
    const [itemsResponse, usersResponse, requestsResponse] = await Promise.all([
      api.get('/admin/items'),
      api.get('/admin/users'),
      api.get('/admin/access-requests'),
    ])
    setItems(itemsResponse.data.data)
    setUsers(usersResponse.data.data)
    setRequests(requestsResponse.data.data)
  }

  useEffect(() => { load() }, [])

  async function updateItem(id: number, field: 'approvalStatus' | 'status', value: ApprovalStatus | ItemStatus) {
    await api.patch(`/admin/items/${id}/status`, { [field]: value })
    load()
  }

  async function reviewAccess(id: number, status: 'approved' | 'rejected') {
    await api.patch(`/admin/access-requests/${id}`, { status, temporaryPassword: 'Argos@123' })
    load()
  }

  async function blockUser(id: number) {
    await api.patch(`/admin/users/${id}`, { status: 'blocked', spamScore: 10 })
    load()
  }

  async function downloadCsv() {
    const response = await api.get('/reports/items.csv', { responseType: 'blob' })
    const url = URL.createObjectURL(response.data)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'argos-itens.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="stack">
      <div className="admin-header">
        <h2>Administração</h2>
        <button className="primary" onClick={downloadCsv}><Download size={18} /> CSV</button>
      </div>
      <div className="panel">
        <h3>Publicações</h3>
        <div className="table">
          {items.map((item) => (
            <div key={item.id}>
              <strong>{item.title}</strong>
              <span>{item.owner_name} · {statusLabel[item.status]} · {approvalLabel[item.approval_status]}</span>
              <select value={item.approval_status} onChange={(e) => updateItem(item.id, 'approvalStatus', e.target.value as ApprovalStatus)}>
                <option value="pending">Pendente</option><option value="approved">Aprovado</option><option value="rejected">Rejeitado</option>
              </select>
              <select value={item.status} onChange={(e) => updateItem(item.id, 'status', e.target.value as ItemStatus)}>
                <option value="lost">Perdido</option><option value="found">Encontrado</option><option value="claimed">Reivindicado</option><option value="returned">Entregue</option>
              </select>
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <h3>Solicitações de acesso</h3>
        <div className="table">
          {requests.map((request) => (
            <div key={request.id}>
              <strong>{request.name}</strong><span>{request.email} · {request.status}</span>
              <button onClick={() => reviewAccess(request.id, 'approved')}>Aprovar</button>
              <button onClick={() => reviewAccess(request.id, 'rejected')}>Rejeitar</button>
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <h3>Usuários e anti-spam</h3>
        <div className="table">
          {users.map((user) => (
            <div key={user.id}>
              <strong>{user.name}</strong><span>{user.email} · {user.role} · {user.status}</span>
              <button className="danger" onClick={() => blockUser(user.id)}><ShieldAlert size={16} /> Bloquear</button>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
