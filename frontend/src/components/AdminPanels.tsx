import { Eraser, MessageSquareWarning, Plus, Save, SpellCheck, Trash2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { msg, useI18n } from '../i18n'
import { api, apiError } from '../services/api'
import type { FlaggedMessage, RetentionStatus, SynonymGroup } from '../types/api'
import { formatDateTime } from '../utils/dates'

type Feedback = { onMessage: (text: string) => void; onError: (text: string) => void }

const ruleLabel: Record<string, string> = {
  payment_request: msg('Pedido de pagamento'),
  // Palavra que também é nome de objeto (piranha, macaco) dirigida à pessoa: entregue e enviada para revisão.
  offensive_language: msg('Possível ofensa dirigida à pessoa'),
  contact_info: msg('Dados de contato'),
  user_report: msg('Denunciada por quem recebeu'),
}

/** Mensagens de conversa sinalizadas pelas regras automáticas ou por denúncia. */
export function ChatModerationPanel({ onMessage, onError }: Feedback) {
  const { t } = useI18n()
  const [rows, setRows] = useState<FlaggedMessage[]>([])
  const [busy, setBusy] = useState(0)

  async function load() {
    const response = await api.get('/conversations/moderation/flagged', { params: { limit: 50 } })
    setRows(response.data.data)
  }

  useEffect(() => {
    load().catch((requestError) => onError(apiError(requestError)))
  }, [])

  async function review(row: FlaggedMessage, action: 'remove' | 'dismiss') {
    if (busy) return
    if (action === 'remove' && !window.confirm(t('Remover esta mensagem? A remoção conta para a pausa automática da conta.'))) return
    setBusy(row.id)
    try {
      const response = await api.patch(`/conversations/moderation/messages/${row.id}`, { action })
      onMessage(t(response.data.message))
      await load()
    } catch (requestError) {
      onError(apiError(requestError))
      await load().catch(() => undefined)
    } finally {
      setBusy(0)
    }
  }

  return (
    <div className="panel">
      <h3><MessageSquareWarning size={18} /> {t('Mensagens em revisão')}</h3>
      <p className="privacy-note">{t('Só chegam aqui mensagens sinalizadas por regra automática (ex.: pedido de pagamento) ou denunciadas por quem recebeu. As demais conversas não são lidas pela moderação.')}</p>
      <div className="table report-queue">
        {rows.map((row) => (
          <div key={row.id}>
            <span className="report-summary">
              <strong><Link to={`/items/${row.item_id}`}>{row.item_title}</Link></strong>
              <span className="flagged-body">“{row.body}”</span>
              <span>{row.sender_name} · {formatDateTime(row.created_at)} · {row.moderation_rule ? t(ruleLabel[row.moderation_rule] ?? row.moderation_rule) : t('Sinalizada')}</span>
            </span>
            <span className="actions">
              <button className="danger" type="button" disabled={busy === row.id} onClick={() => void review(row, 'remove')}>{t('Remover')}</button>
              <button className="ghost light" type="button" disabled={busy === row.id} onClick={() => void review(row, 'dismiss')}>{t('Manter')}</button>
            </span>
          </div>
        ))}
        {!rows.length && <p className="empty">{t('Nenhuma mensagem aguardando revisão.')}</p>}
      </div>
    </div>
  )
}

/** Dicionário de sinônimos da busca: cada grupo reúne termos equivalentes. */
export function SynonymsPanel({ onMessage, onError }: Feedback) {
  const { t } = useI18n()
  const [groups, setGroups] = useState<SynonymGroup[]>([])
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [newTerms, setNewTerms] = useState('')
  const [filter, setFilter] = useState('')

  async function load() {
    const response = await api.get('/admin/synonyms')
    setGroups(response.data.data)
    setDrafts({})
  }

  useEffect(() => {
    load().catch((requestError) => onError(apiError(requestError)))
  }, [])

  const split = (value: string) => value.split(',').map((term) => term.trim()).filter(Boolean)

  async function run(action: () => Promise<{ data: { message: string } }>) {
    try {
      const response = await action()
      onMessage(t(response.data.message))
      await load()
    } catch (requestError) {
      onError(apiError(requestError))
    }
  }

  function create(event: FormEvent) {
    event.preventDefault()
    void run(async () => {
      const response = await api.post('/admin/synonyms', { terms: split(newTerms) })
      setNewTerms('')
      return response
    })
  }

  const visible = groups.filter((group) => !filter.trim() || group.terms.some((term) => term.includes(filter.trim().toLowerCase())))

  return (
    <div className="panel">
      <h3><SpellCheck size={18} /> {t('Sinônimos da busca')}</h3>
      <p className="privacy-note">{t('Buscar um termo também encontra os outros do mesmo grupo (ex.: "celular" encontra "smartphone"). Separe os termos por vírgula; acentos e maiúsculas são ignorados.')}</p>
      <form className="toolbar compact-toolbar" onSubmit={create}>
        <input placeholder={t('Ex.: jaleco, avental')} aria-label={t('Novos termos equivalentes')} maxLength={400} value={newTerms} onChange={(event) => setNewTerms(event.target.value)} />
        <button className="primary" type="submit" disabled={split(newTerms).length < 2}><Plus size={18} /> {t('Adicionar grupo')}</button>
        <input type="search" placeholder={t('Filtrar grupos')} aria-label={t('Filtrar grupos de sinônimos')} value={filter} onChange={(event) => setFilter(event.target.value)} />
      </form>
      <div className="table synonym-table">
        {visible.map((group) => (
          <div key={group.id}>
            <input
              aria-label={t('Termos do grupo {id}', { id: group.id })}
              value={drafts[group.id] ?? group.terms.join(', ')}
              onChange={(event) => setDrafts({ ...drafts, [group.id]: event.target.value })}
            />
            <span className="actions">
              <button className="ghost light" type="button" disabled={drafts[group.id] === undefined} onClick={() => void run(() => api.put(`/admin/synonyms/${group.id}`, { terms: split(drafts[group.id]) }))} aria-label={t('Salvar grupo {id}', { id: group.id })}><Save size={16} /></button>
              <button className="ghost light danger-text" type="button" onClick={() => window.confirm(t('Remover este grupo de sinônimos?')) && void run(() => api.delete(`/admin/synonyms/${group.id}`))} aria-label={t('Remover grupo {id}', { id: group.id })}><Trash2 size={16} /></button>
            </span>
          </div>
        ))}
        {!visible.length && <p className="empty">{t('Nenhum grupo de sinônimos.')}</p>}
      </div>
    </div>
  )
}

const reportLabel: Record<string, string> = {
  mailOutbox: msg('Registros de e-mail'),
  passwordResets: msg('Links de senha'),
  emailVerifications: msg('Links de confirmação'),
  accessRequests: msg('Solicitações de acesso'),
  auditLogs: msg('Auditoria'),
  unverifiedAccounts: msg('Contas não confirmadas'),
  claimProofs: msg('Provas de reivindicação'),
  notifications: msg('Notificações lidas'),
  conversations: msg('Conversas encerradas'),
  moderationEvents: msg('Decisões automáticas'),
  expiredInvites: msg('Convites vencidos'),
}

/** Prazos de retenção, execução automática e histórico do que foi eliminado. */
export function RetentionPanel({ onMessage, onError }: Feedback) {
  const { t } = useI18n()
  const [status, setStatus] = useState<RetentionStatus | null>(null)
  const [running, setRunning] = useState(false)

  async function load() {
    const response = await api.get('/admin/retention')
    setStatus(response.data)
  }

  useEffect(() => {
    load().catch((requestError) => onError(apiError(requestError)))
  }, [])

  async function runNow() {
    if (running || !window.confirm(t('Executar agora a rotina de retenção? Os dados vencidos são eliminados ou anonimizados de forma definitiva.'))) return
    setRunning(true)
    try {
      const response = await api.post('/admin/retention/run')
      onMessage(t(response.data.message))
      await load()
    } catch (requestError) {
      onError(apiError(requestError))
    } finally {
      setRunning(false)
    }
  }

  const summarize = (report: Record<string, number>) =>
    Object.entries(report)
      .filter(([, value]) => value > 0)
      .map(([key, value]) => `${t(reportLabel[key] ?? key)}: ${value}`)
      .join(' · ') || t('nada a eliminar')

  return (
    <div className="panel">
      <div className="admin-header">
        <h3><Eraser size={18} /> {t('Retenção de dados (LGPD)')}</h3>
        <button className="ghost light" type="button" onClick={() => void runNow()} disabled={running}>{running ? t('Executando...') : t('Executar agora')}</button>
      </div>
      <p className="privacy-note">
        {status?.lastRun
          ? t('A rotina roda de hora em hora. Última execução: {date} ({trigger}).', { date: formatDateTime(status.lastRun.at), trigger: status.lastRun.trigger === 'manual' ? t('manual') : t('automática') })
          : t('A rotina roda de hora em hora; ainda não há execução registrada.')}
      </p>
      {status && (
        <>
          <table className="data-table">
            <thead><tr><th scope="col">{t('Dado')}</th><th scope="col">{t('Prazo')}</th></tr></thead>
            <tbody>
              {status.rules.map((rule) => (
                <tr key={rule.data}><td>{t(rule.data)}</td><td>{rule.days ? t('{days} dias', { days: rule.days }) : t(rule.note ?? '')}</td></tr>
              ))}
            </tbody>
          </table>
          <h4>{t('Execuções que eliminaram dados')}</h4>
          <div className="table audit-table">
            {status.runs.map((run) => (
              <div key={run.id}>
                <strong>{formatDateTime(run.finished_at)} · {run.trigger === 'manual' ? t('manual por {name}', { name: run.actor_name ?? t('administração') }) : t('automática')}</strong>
                <span>{summarize(run.report)}</span>
              </div>
            ))}
            {!status.runs.length && <p className="empty">{t('Nenhuma execução eliminou dados até agora.')}</p>}
          </div>
        </>
      )}
    </div>
  )
}
