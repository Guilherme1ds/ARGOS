import { Download, Flag, Mail, ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { api, apiError } from '../services/api'
import type { ApprovalStatus, AuditLog, Item, ItemStatus, User } from '../types/api'
import { formatDateTime } from '../utils/dates'
import { approvalLabel, statusLabel } from '../utils/labels'
import { t as translateNow, useI18n } from '../i18n'

function reportReason(report: AuditLog) {
  try {
    return (JSON.parse(report.metadata ?? '{}') as { reason?: string }).reason ?? translateNow('Sem motivo informado')
  } catch {
    return translateNow('Sem motivo informado')
  }
}

type AccessRequest = { id: number; name: string; email: string; reason?: string; status: string; created_at: string }

export function AdminPage() {
  const { user: currentUser } = useAuth()
  const { t } = useI18n()
  const [items, setItems] = useState<Item[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [requests, setRequests] = useState<AccessRequest[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [reports, setReports] = useState<AuditLog[]>([])
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
      const [itemsResponse, usersResponse, requestsResponse, auditResponse, reportsResponse] = await Promise.all([
        api.get('/admin/items', { params: itemParams }),
        api.get('/admin/users'),
        api.get('/admin/access-requests'),
        api.get('/audit-logs', { params: { limit: 10 } }),
        api.get('/audit-logs', { params: { action: 'item.reported', limit: 20 } }),
      ])
      setItems(itemsResponse.data.data)
      setUsers(usersResponse.data.data)
      setRequests(requestsResponse.data.data)
      setAuditLogs(auditResponse.data.data)
      setReports(reportsResponse.data.data)
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
    }, t('Publicação atualizada.'))
  }

  async function reviewAccess(id: number, status: 'approved' | 'rejected') {
    setMessage('')
    try {
      const response = await api.patch(`/admin/access-requests/${id}`, { status, role: 'citizen' })
      if (response.data.temporaryPassword) {
        setMessage(t('Conta criada. Senha temporária: {password}', { password: response.data.temporaryPassword }))
      }
      await load()
    } catch (requestError) {
      setError(apiError(requestError))
    }
  }

  function blockUser(id: number, name: string) {
    if (!window.confirm(t('Bloquear {name}? As sessões ativas serão encerradas.', { name }))) return
    return runAction(`user-${id}`, async () => {
      await api.patch(`/admin/users/${id}`, { status: 'blocked', spamScore: 10 })
    }, t('Usuário bloqueado e sessões encerradas.'))
  }

  async function testMail() {
    if (pendingAction) return
    setPendingAction('mail')
    setMessage('')
    setError('')
    try {
      const response = await api.post('/admin/mail-test')
      setMessage(t(response.data.message))
    } catch (requestError) {
      setError(apiError(requestError))
    } finally {
      setPendingAction('')
    }
  }

  async function downloadCsv() {
    setError('')
    try {
      const response = await api.get('/reports/items.csv', { responseType: 'blob' })
      const url = URL.createObjectURL(response.data)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'argos-itens.csv'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      // Revogar na mesma hora cancela o download em alguns navegadores (Chrome).
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch (requestError) {
      setError(apiError(requestError))
    }
  }

  return (
    <section className="stack">
      <div className="admin-header">
        <h2>{t('Administração')}</h2>
        <div className="actions">
          <button className="ghost light" onClick={() => void testMail()} disabled={pendingAction === 'mail'}><Mail size={18} /> {t('Testar e-mail')}</button>
          <button className="primary" onClick={downloadCsv}><Download size={18} /> CSV</button>
        </div>
      </div>
      {message && <p className="message success" role="status">{message}</p>}
      {error && <p className="message error" role="alert">{error}</p>}
      {loading && <p className="loading" role="status">{t('Carregando dados administrativos...')}</p>}
      <div className="panel">
        <h3>{t('Publicações')}</h3>
        <div className="toolbar compact-toolbar">
          <input placeholder={t('Buscar')} aria-label={t('Buscar publicações')} value={filters.q} onChange={(event) => setFilters({ ...filters, q: event.target.value })} />
          <select aria-label={t('Filtrar por aprovação')} value={filters.approvalStatus} onChange={(event) => setFilters({ ...filters, approvalStatus: event.target.value })}>
            <option value="">{t('Todas as aprovações')}</option>
            <option value="pending">{t('Pendente')}</option>
            <option value="approved">{t('Aprovado')}</option>
            <option value="rejected">{t('Rejeitado')}</option>
          </select>
          <select aria-label={t('Filtrar por status')} value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
            <option value="">{t('Todos os status')}</option>
            <option value="lost">{t('Perdido')}</option>
            <option value="found">{t('Encontrado')}</option>
            <option value="claimed">{t('Em análise')}</option>
            <option value="returned">{t('Devolvido')}</option>
          </select>
          <button className="primary" onClick={() => void load()} disabled={loading}>{t('Filtrar')}</button>
        </div>
        <div className="table">
          {items.map((item) => (
            <div key={item.id}>
              <strong>{item.title}</strong>
              <span>{item.owner_name} · {t(statusLabel[item.status])} · {t(approvalLabel[item.approval_status])}</span>
              <select aria-label={t('Aprovação de {title}', { title: item.title })} disabled={pendingAction === `item-${item.id}`} value={item.approval_status} onChange={(event) => updateItem(item.id, 'approvalStatus', event.target.value as ApprovalStatus)}>
                <option value="pending">{t('Pendente')}</option><option value="approved">{t('Aprovado')}</option><option value="rejected">{t('Rejeitado')}</option>
              </select>
              <select aria-label={t('Status de {title}', { title: item.title })} disabled={pendingAction === `item-${item.id}`} value={item.status} onChange={(event) => updateItem(item.id, 'status', event.target.value as ItemStatus)}>
                <option value="lost">{t('Perdido')}</option><option value="found">{t('Encontrado')}</option><option value="claimed">{t('Em análise')}</option><option value="returned">{t('Devolvido')}</option>
              </select>
            </div>
          ))}
          {!items.length && <p className="empty">{t('Nenhuma publicação encontrada.')}</p>}
        </div>
      </div>
      <div className="panel">
        <h3>{t('Solicitações de acesso')}</h3>
        <div className="table">
          {requests.map((request) => (
            <div key={request.id}>
              <strong>{request.name}</strong><span>{request.email} · {request.status}</span>
              <button onClick={() => reviewAccess(request.id, 'approved')} aria-label={t('Aprovar {name}', { name: request.name })}>{t('Aprovar')}</button>
              <button onClick={() => reviewAccess(request.id, 'rejected')} aria-label={t('Rejeitar {name}', { name: request.name })}>{t('Rejeitar')}</button>
            </div>
          ))}
          {!requests.length && <p className="empty">{t('Nenhuma solicitação pendente.')}</p>}
        </div>
      </div>
      <div className="panel">
        <h3>{t('Usuários e anti-spam')}</h3>
        <div className="table">
          {users.map((user) => (
            <div key={user.id}>
              <strong>{user.name}</strong><span>{user.email} · {user.role} · {user.status}</span>
              {user.id !== currentUser?.id && user.status !== 'blocked' && (
                <button
                  className="danger"
                  onClick={() => void blockUser(user.id, user.name)}
                  disabled={pendingAction === `user-${user.id}`}
                  aria-label={t('Bloquear {name}', { name: user.name })}
                >
                  <ShieldAlert size={16} /> {t('Bloquear')}
                </button>
              )}
            </div>
          ))}
          {!users.length && <p className="empty">{t('Nenhum usuário encontrado.')}</p>}
        </div>
      </div>
      <div className="panel">
        <h3><Flag size={18} /> {t('Denúncias recentes')}</h3>
        <div className="table audit-table">
          {reports.map((report) => (
            <Link to={`/items/${report.entity_id}`} key={report.id}>
              <strong>{t('Caso #{id}', { id: report.entity_id ?? '' })} · {reportReason(report)}</strong>
              <span>{report.actor_name ? t(report.actor_name) : t('Usuário removido')} · {formatDateTime(report.created_at)}</span>
            </Link>
          ))}
          {!reports.length && <p className="empty">{t('Nenhuma denúncia recebida.')}</p>}
        </div>
      </div>
      <div className="panel">
        <h3>{t('Auditoria')}</h3>
        <div className="table audit-table">
          {auditLogs.map((log) => (
            <div key={log.id}>
              <strong>{log.action}</strong>
              <span>{log.actor_name ? t(log.actor_name) : t('Sistema')} · {log.entity_type} · {formatDateTime(log.created_at)}</span>
            </div>
          ))}
          {!auditLogs.length && <p className="empty">{t('Nenhum evento de auditoria.')}</p>}
        </div>
      </div>
    </section>
  )
}
