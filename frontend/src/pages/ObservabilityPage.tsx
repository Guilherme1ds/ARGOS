import { Activity, AlertOctagon, AlertTriangle, CheckCircle2, Database, Mail, RefreshCw, Route } from 'lucide-react'
import { useEffect, useState } from 'react'
import { MiniChart } from '../components/MiniChart'
import { useI18n } from '../i18n'
import { api, apiError } from '../services/api'
import type { ObservabilityOverview, SystemAlert } from '../types/api'
import { formatDateTime, relativeDate } from '../utils/dates'

const refreshMs = 30_000

function uptime(seconds: number) {
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}min` : `${minutes}min`
}

function AlertStatus({ alert }: { alert: SystemAlert }) {
  const { t } = useI18n()
  if (alert.status === 'resolved') return <span className="status-pill good"><CheckCircle2 size={14} /> {t('Resolvido')}</span>
  return alert.severity === 'critical'
    ? <span className="status-pill critical"><AlertOctagon size={14} /> {t('Crítico')}</span>
    : <span className="status-pill warning"><AlertTriangle size={14} /> {t('Atenção')}</span>
}

export function ObservabilityPage() {
  const { t } = useI18n()
  const [data, setData] = useState<ObservabilityOverview | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const response = await api.get('/observability')
      setData(response.data)
      setError('')
    } catch (requestError) {
      setError(apiError(requestError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => document.visibilityState === 'visible' && void load(), refreshMs)
    return () => window.clearInterval(timer)
  }, [])

  const firing = data?.alerts.filter((alert) => alert.status === 'firing') ?? []
  const window5 = data?.traffic.last5m

  return (
    <section className="stack">
      <div className="admin-header">
        <p className="privacy-note">
          {data ? t('{service} · {environment} · versão {version} · esquema {schema} · atualizado a cada 30 s', {
            service: data.service.name,
            environment: data.service.environment,
            version: data.service.version,
            schema: data.service.schemaVersion ?? '?',
          }) : t('Carregando...')}
        </p>
        <button className="ghost light" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={16} /> {t('Atualizar')}</button>
      </div>
      {error && <p className="message error" role="alert">{error}</p>}

      {data && (
        <>
          <div className={`panel alert-banner ${firing.length ? 'firing' : 'ok'}`} role="status">
            {firing.length ? <AlertOctagon size={20} /> : <CheckCircle2 size={20} />}
            <strong>{firing.length ? t('{count} alertas ativos', { count: firing.length }) : t('Nenhum alerta ativo')}</strong>
            <span>{firing.map((alert) => alert.title).join(' · ')}</span>
          </div>

          <div className="kpi-row">
            <div className="stat-tile"><span>{t('Requisições (5 min)')}</span><strong>{window5?.requests ?? 0}</strong></div>
            <div className="stat-tile">
              <span>{t('Taxa de erros 5xx (5 min)')}</span>
              <strong>{window5?.errorRatePercent ?? 0}%</strong>
              <small>{t('limite {value}%', { value: data.thresholds.errorRatePercent })}</small>
            </div>
            <div className="stat-tile">
              <span>{t('Latência p95 (5 min)')}</span>
              <strong>{window5?.p95Ms ?? 0} ms</strong>
              <small>{t('limite {value} ms', { value: data.thresholds.latencyP95Ms })}</small>
            </div>
            <div className="stat-tile"><span>{t('No ar há')}</span><strong>{uptime(data.process.uptimeSeconds)}</strong><small>{t('desde {date}', { date: formatDateTime(data.process.startedAt) })}</small></div>
            <div className="stat-tile"><span>{t('Memória')}</span><strong>{data.process.memoryRssMb} MB</strong><small>{t('atraso do processo {value} ms', { value: data.process.eventLoopDelayP99Ms })}</small></div>
          </div>

          <div className="chart-grid">
            <div className="panel"><MiniChart kind="column" integer title={t('Requisições por minuto')} points={data.traffic.series.map((point) => ({ at: point.at, value: point.requests }))} format={(value) => String(Math.round(value))} /></div>
            <div className="panel"><MiniChart kind="line" integer title={t('Latência p95 por minuto (ms)')} points={data.traffic.series.map((point) => ({ at: point.at, value: point.requests ? point.p95Ms : null }))} format={(value) => `${Math.round(value)} ms`} /></div>
            <div className="panel"><MiniChart kind="column" integer title={t('Erros 5xx por minuto')} emptyText={t('Nenhum erro 5xx na última hora.')} points={data.traffic.series.map((point) => ({ at: point.at, value: point.errors }))} format={(value) => String(Math.round(value))} /></div>
          </div>

          <div className="chart-grid">
            <div className="panel">
              <h2 className="section-title"><Database size={18} /> {t('Dependências')}</h2>
              <ul className="dependency-list">
                <li><Database size={16} /> {t('Banco de dados')}: {data.dependencies.database === 'ok' ? <span className="status-pill good"><CheckCircle2 size={14} /> {t('Disponível')}</span> : <span className="status-pill critical"><AlertOctagon size={14} /> {t('Indisponível')}</span>}</li>
                <li><Mail size={16} /> {t('E-mail (SMTP)')}: {data.dependencies.mail === 'configured' ? t('configurado') : t('não configurado')}</li>
                <li><Activity size={16} /> {t('Exportação de rastreamento (OTLP)')}: {data.dependencies.tracingExport === 'enabled' ? t('ligada ({count} spans enviados)', { count: data.tracing.exported }) : t('desligada')}</li>
                <li><Activity size={16} /> {t('Métricas Prometheus (/metrics)')}: {data.dependencies.metricsEndpoint === 'enabled' ? t('ligadas') : t('desligadas')}</li>
              </ul>
              {data.business && (
                <p className="privacy-note">
                  {t('Denúncias abertas: {reports} · mensagens em revisão: {flagged} · casos aguardando aprovação: {pending} · e-mails na fila: {mail}', {
                    reports: Number(data.business.openReports ?? 0),
                    flagged: Number(data.business.flaggedMessages ?? 0),
                    pending: Number(data.business.pendingApproval ?? 0),
                    mail: Number((data.business.mail as Record<string, number> | undefined)?.pending ?? 0),
                  })}
                </p>
              )}
            </div>
            <div className="panel">
              <h2 className="section-title"><Route size={18} /> {t('Rotas mais usadas')}</h2>
              <table className="data-table">
                <thead><tr><th scope="col">{t('Rota')}</th><th scope="col">{t('Chamadas')}</th><th scope="col">{t('Erros')}</th><th scope="col">{t('Média')}</th></tr></thead>
                <tbody>
                  {data.traffic.routes.map((route) => (
                    <tr key={route.route}><td><code>{route.route}</code></td><td>{route.count}</td><td>{route.errors}</td><td>{route.avgMs} ms</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <h2 className="section-title"><AlertTriangle size={18} /> {t('Alertas automáticos')}</h2>
            <p className="privacy-note">{t('As regras rodam a cada minuto. Um alerta novo avisa a administração no app e por e-mail; quando a regra volta ao normal, ele é marcado como resolvido.')}</p>
            <div className="table">
              {data.alerts.map((alert) => (
                <div key={alert.id}>
                  <strong>{t(alert.title)}</strong>
                  <span>{alert.detail} · {t('desde {date}', { date: formatDateTime(alert.fired_at) })}{alert.resolved_at && <> · {t('resolvido {when}', { when: relativeDate(alert.resolved_at) })}</>}</span>
                  <AlertStatus alert={alert} />
                </div>
              ))}
              {!data.alerts.length && <p className="empty">{t('Nenhum alerta registrado.')}</p>}
            </div>
          </div>

          {data.recentProblems.length > 0 && (
            <div className="panel">
              <h2 className="section-title">{t('Avisos e erros recentes do servidor')}</h2>
              <table className="data-table">
                <thead><tr><th scope="col">{t('Quando')}</th><th scope="col">{t('Evento')}</th><th scope="col">{t('Rastreamento')}</th></tr></thead>
                <tbody>
                  {data.recentProblems.map((problem, index) => (
                    <tr key={`${problem.ts}-${index}`}><td>{formatDateTime(problem.ts)}</td><td>{problem.event}{problem.message ? `: ${problem.message}` : ''}</td><td><code>{problem.traceId?.slice(0, 16) ?? '-'}</code></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}
