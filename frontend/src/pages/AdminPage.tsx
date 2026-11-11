import { Download, Flag, Mail, ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { api, apiError } from '../services/api'
import type { AdminUser, ApprovalStatus, AuditLog, Item, ItemReport, ItemStatus, ReportStatus } from '../types/api'
import { formatDateTime } from '../utils/dates'
import { approvalLabel, statusLabel } from '../utils/labels'
import { msg, useI18n } from '../i18n'

type AccessRequest = { id: number; name: string; email: string; reason?: string | null; status: 'pending' | 'approved' | 'rejected'; created_at: string; reviewed_at?: string | null }
type ReportFilter = 'active' | 'all' | ReportStatus

const reportStatusLabel: Record<ReportStatus, string> = {
  open: msg('Aberta'),
  in_review: msg('Em análise'),
  resolved: msg('Resolvida'),
  dismissed: msg('Descartada'),
}

const reportFilters: Array<{ value: ReportFilter; label: string }> = [
  { value: 'active', label: msg('Abertas e em análise') },
  { value: 'open', label: msg('Aberta') },
  { value: 'in_review', label: msg('Em análise') },
  { value: 'resolved', label: msg('Resolvida') },
  { value: 'dismissed', label: msg('Descartada') },
  { value: 'all', label: msg('Todas') },
]

const accessStatusLabel: Record<AccessRequest['status'], string> = {
  pending: msg('Pendente'),
  approved: msg('Aprovada'),
  rejected: msg('Rejeitada'),
}

const roleLabel: Record<string, string> = {
  user: msg('Usuário'),
  citizen: msg('Cidadão'),
  space_manager: msg('Gestor de espaço'),
  org_admin: msg('Gestor da organização'),
  support: msg('Suporte'),
  admin: msg('Administrador'),
}

const userStatusLabel: Record<string, string> = {
  pending: msg('Pendente'),
  active: msg('Ativo'),
  blocked: msg('Bloqueado'),
}

const reportPageSize = 20
const restrictionScore = 5

export function AdminPage() {
  const { user: currentUser } = useAuth()
  const { t } = useI18n()
  const [items, setItems] = useState<Item[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [requests, setRequests] = useState<AccessRequest[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [reports, setReports] = useState<ItemReport[]>([])
  const [reportMeta, setReportMeta] = useState({ page: 1, total: 0 })
  const [reportFilter, setReportFilter] = useState<ReportFilter>('active')
  const [filters, setFilters] = useState({ q: '', approvalStatus: '', status: '' })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [pendingAction, setPendingAction] = useState('')

  async function loadReports(page = reportMeta.page, status = reportFilter) {
    const response = await api.get('/admin/reports', { params: { status, page, limit: reportPageSize } })
    setReports(response.data.data)
    setReportMeta({ page: response.data.meta.page, total: response.data.meta.total })
  }

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
        loadReports(),
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
      // Conflito de concorrência: recarrega para mostrar o estado atual.
      await loadReports().catch(() => undefined)
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

  async function reviewAccess(request: AccessRequest, status: 'approved' | 'rejected') {
    if (pendingAction) return
    if (status === 'rejected' && !window.confirm(t('Rejeitar a solicitação de {name}?', { name: request.name }))) return
    setPendingAction(`access-${request.id}`)
    setMessage('')
    setError('')
    try {
      const response = await api.patch(`/admin/access-requests/${request.id}`, { status, role: 'citizen' })
      await load()
      // A senha temporária aparece uma única vez: a administração a entrega por um canal institucional.
      if (response.data.temporaryPassword) {
        setMessage(t('Conta criada. Senha temporária: {password}. Entregue por um canal institucional; a pessoa também pode criar a própria senha em “Esqueci minha senha”.', { password: response.data.temporaryPassword }))
      } else {
        setMessage(status === 'approved' ? t('Solicitação aprovada. A conta já existia e não foi alterada.') : t('Solicitação rejeitada.'))
      }
    } catch (requestError) {
      // Recarrega antes de mostrar o erro: load() limpa a mensagem de erro anterior.
      const text = apiError(requestError)
      await load()
      setError(text)
    } finally {
      setPendingAction('')
    }
  }

  function unblockUser(target: AdminUser) {
    if (!window.confirm(t('Desbloquear {name}? A conta volta a entrar; uma restrição de publicação continua até ser removida.', { name: target.name }))) return
    return runAction(`user-${target.id}`, async () => {
      await api.patch(`/admin/users/${target.id}`, { status: 'active' })
    }, t('Usuário desbloqueado.'))
  }

  function blockUser(id: number, name: string) {
    if (!window.confirm(t('Bloquear {name}? As sessões ativas serão encerradas.', { name }))) return
    return runAction(`user-${id}`, async () => {
      await api.patch(`/admin/users/${id}`, { status: 'blocked', spamScore: 10 })
    }, t('Usuário bloqueado e sessões encerradas.'))
  }

  function setRestriction(target: AdminUser, restricted: boolean) {
    return runAction(`user-${target.id}`, async () => {
      await api.patch(`/admin/users/${target.id}`, { spamScore: restricted ? restrictionScore : 0 })
    }, restricted ? t('Publicações restringidas para {name}.', { name: target.name }) : t('Restrição removida de {name}.', { name: target.name }))
  }

  function updateReport(report: ItemReport, body: Record<string, unknown>, success: string) {
    return runAction(`report-${report.id}`, async () => {
      await api.patch(`/admin/reports/${report.id}`, { ...body, expectedStatus: report.status })
    }, success)
  }

  function resolveReport(report: ItemReport, status: 'resolved' | 'dismissed') {
    const note = window.prompt(status === 'resolved' ? t('O que foi feito? (opcional)') : t('Motivo do descarte (opcional)'))
    if (note === null) return
    return updateReport(report, { status, resolutionNote: note.trim() || undefined }, status === 'resolved' ? t('Denúncia resolvida.') : t('Denúncia descartada.'))
  }

  async function changeReportFilter(next: ReportFilter) {
    setReportFilter(next)
    try {
      await loadReports(1, next)
    } catch (requestError) {
      setError(apiError(requestError))
    }
  }

  async function changeReportPage(page: number) {
    try {
      await loadReports(page)
    } catch (requestError) {
      setError(apiError(requestError))
    }
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
    if (pendingAction) return
    setPendingAction('csv')
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
    } finally {
      setPendingAction('')
    }
  }

  const reportPages = Math.max(1, Math.ceil(reportMeta.total / reportPageSize))

  return (
    <section className="stack">
      <div className="admin-header">
        <h2>{t('Administração')}</h2>
        <div className="actions">
          <button className="ghost light" onClick={() => void testMail()} disabled={pendingAction === 'mail'}><Mail size={18} /> {t('Testar e-mail')}</button>
          <button className="primary" onClick={() => void downloadCsv()} disabled={pendingAction === 'csv'}><Download size={18} /> {pendingAction === 'csv' ? t('Gerando...') : t('Exportar CSV')}</button>
        </div>
      </div>
      {message && <p className="message success" role="status">{message}</p>}
      {error && <p className="message error" role="alert">{error}</p>}
      {loading && <p className="loading" role="status">{t('Carregando dados administrativos...')}</p>}
      <div className="panel">
        <h3><Flag size={18} /> {t('Fila de denúncias')}</h3>
        <div className="toolbar compact-toolbar">
          <select aria-label={t('Filtrar denúncias por estado')} value={reportFilter} onChange={(event) => void changeReportFilter(event.target.value as ReportFilter)}>
            {reportFilters.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}
          </select>
          <span className="privacy-note">{t('{count} denúncias', { count: reportMeta.total })}</span>
        </div>
        <div className="table report-queue">
          {reports.map((report) => (
            <div key={report.id} data-testid={`report-${report.id}`}>
              <span className="report-summary">
                <strong>
                  {report.item_id ? <Link to={`/items/${report.item_id}`}>{report.item_title}</Link> : t('{title} (caso removido)', { title: report.item_title })}
                </strong>
                <span>{t(report.reason)}</span>
                <span>
                  {report.reporter_name ? t(report.reporter_name) : t('Usuário removido')} · {formatDateTime(report.created_at)}
                  {report.assignee_name && <> · {t('Responsável: {name}', { name: report.assignee_name })}</>}
                </span>
                {report.resolution_note && <span>{t('Resolução: {note}', { note: report.resolution_note })}</span>}
              </span>
              <span className={`badge report-${report.status}`}>{t(reportStatusLabel[report.status])}</span>
              <span className="actions">
                {report.status === 'open' && (
                  <button className="ghost light" disabled={pendingAction === `report-${report.id}`} onClick={() => void updateReport(report, { assignee: 'me' }, t('Denúncia assumida.'))}>{t('Assumir')}</button>
                )}
                {(report.status === 'open' || report.status === 'in_review') && (
                  <>
                    <button className="ghost light" disabled={pendingAction === `report-${report.id}`} onClick={() => void resolveReport(report, 'resolved')}>{t('Resolver')}</button>
                    <button className="ghost light" disabled={pendingAction === `report-${report.id}`} onClick={() => void resolveReport(report, 'dismissed')}>{t('Descartar')}</button>
                  </>
                )}
                {(report.status === 'resolved' || report.status === 'dismissed') && (
                  <button className="ghost light" disabled={pendingAction === `report-${report.id}`} onClick={() => void updateReport(report, { status: 'open', assignee: null }, t('Denúncia reaberta.'))}>{t('Reabrir')}</button>
                )}
              </span>
            </div>
          ))}
          {!reports.length && <p className="empty">{t('Nenhuma denúncia nesta fila.')}</p>}
        </div>
        {reportPages > 1 && (
          <div className="pager" role="navigation" aria-label={t('Páginas de denúncias')}>
            <button className="ghost light" disabled={reportMeta.page <= 1} onClick={() => void changeReportPage(reportMeta.page - 1)}>{t('Anterior')}</button>
            <span>{t('Página {page} de {pages}', { page: reportMeta.page, pages: reportPages })}</span>
            <button className="ghost light" disabled={reportMeta.page >= reportPages} onClick={() => void changeReportPage(reportMeta.page + 1)}>{t('Próxima')}</button>
          </div>
        )}
      </div>
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
              <strong>{request.name}</strong>
              <span>
                {request.email} · {t(accessStatusLabel[request.status] ?? request.status)} · {formatDateTime(request.reviewed_at || request.created_at)}
                {request.reason && <> · {request.reason}</>}
              </span>
              {request.status === 'pending' ? (
                <span className="actions">
                  <button className="primary" disabled={pendingAction === `access-${request.id}`} onClick={() => void reviewAccess(request, 'approved')} aria-label={t('Aprovar {name}', { name: request.name })}>{t('Aprovar')}</button>
                  <button className="ghost light" disabled={pendingAction === `access-${request.id}`} onClick={() => void reviewAccess(request, 'rejected')} aria-label={t('Rejeitar {name}', { name: request.name })}>{t('Rejeitar')}</button>
                </span>
              ) : (
                <span className={`badge access-${request.status}`}>{t(accessStatusLabel[request.status] ?? request.status)}</span>
              )}
            </div>
          ))}
          {!requests.length && <p className="empty">{t('Nenhuma solicitação de acesso.')}</p>}
        </div>
      </div>
      <div className="panel">
        <h3>{t('Usuários e restrições manuais')}</h3>
        <p className="privacy-note">
          {t('A restrição anti-spam é aplicada manualmente pela administração; não há detecção automática. Contas restritas não publicam novos itens. Toda alteração fica na auditoria.')}
        </p>
        <div className="table">
          {users.map((user) => (
            <div key={user.id}>
              <strong>{user.name}</strong>
              <span>
                {user.email} · {t(roleLabel[user.role] ?? user.role)} · {t(userStatusLabel[user.status] ?? user.status)}
                {!user.email_verified_at && <> · {t('e-mail não confirmado')}</>}
                {user.publishing_restricted && <> · {t('publicação restrita')}</>}
              </span>
              {user.id !== currentUser?.id && user.status !== 'blocked' && (
                <button
                  className="ghost light"
                  onClick={() => void setRestriction(user, !user.publishing_restricted)}
                  disabled={pendingAction === `user-${user.id}`}
                  aria-label={user.publishing_restricted ? t('Remover restrição de {name}', { name: user.name }) : t('Restringir publicações de {name}', { name: user.name })}
                >
                  {user.publishing_restricted ? t('Remover restrição') : t('Restringir publicações')}
                </button>
              )}
              {user.id !== currentUser?.id && user.status === 'blocked' && (
                <button
                  className="ghost light"
                  onClick={() => void unblockUser(user)}
                  disabled={pendingAction === `user-${user.id}`}
                  aria-label={t('Desbloquear {name}', { name: user.name })}
                >
                  {t('Desbloquear')}
                </button>
              )}
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
