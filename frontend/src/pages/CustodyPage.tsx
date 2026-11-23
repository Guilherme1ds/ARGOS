import { AlertTriangle, Boxes, Search } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { msg, useI18n } from '../i18n'
import { UploadImage } from '../components/UploadImage'
import { api, apiAssetUrl, apiError } from '../services/api'
import type { CustodyPanelRow } from '../types/api'
import { formatDate, relativeDate } from '../utils/dates'
import { custodyEventLabel, custodyStateLabel } from '../utils/labels'

type SpaceOption = { id: number; name: string; organizationName: string }
type State = 'in_custody' | 'in_transit' | 'awaiting' | 'overdue' | 'handed_over' | 'disposed' | 'all'
type Meta = {
  total: number
  page: number
  overdueDays: number
  summary: Record<'inCustody' | 'inTransit' | 'awaiting' | 'handedOver' | 'disposed' | 'overdue', number>
  spaces: SpaceOption[]
}

const tabs: Array<{ value: State; label: string; summary: keyof Meta['summary'] | null }> = [
  { value: 'in_custody', label: msg('Sob custódia'), summary: 'inCustody' },
  { value: 'awaiting', label: msg('Aguardando entrega no espaço'), summary: 'awaiting' },
  { value: 'in_transit', label: msg('Em trânsito'), summary: 'inTransit' },
  { value: 'overdue', label: msg('Guardados há muito tempo'), summary: 'overdue' },
  { value: 'handed_over', label: msg('Entregues'), summary: 'handedOver' },
  { value: 'disposed', label: msg('Destinação final'), summary: 'disposed' },
  { value: 'all', label: msg('Todos'), summary: null },
]

const pageSize = 20

export function CustodyPage() {
  const { t } = useI18n()
  const [state, setState] = useState<State>('in_custody')
  const [spaceId, setSpaceId] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<CustodyPanelRow[]>([])
  const [meta, setMeta] = useState<Meta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load(next: { state?: State; spaceId?: string; page?: number } = {}) {
    const nextState = next.state ?? state
    const nextSpace = next.spaceId ?? spaceId
    const nextPage = next.page ?? 1
    setLoading(true)
    setError('')
    try {
      const response = await api.get('/custody', { params: { state: nextState, spaceId: nextSpace || undefined, q: q.trim() || undefined, page: nextPage, limit: pageSize } })
      setRows(response.data.data)
      setMeta(response.data.meta)
      setPage(nextPage)
    } catch (requestError) {
      setError(apiError(requestError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  function changeState(next: State) {
    setState(next)
    void load({ state: next })
  }

  function search(event: FormEvent) {
    event.preventDefault()
    void load()
  }

  const pages = meta ? Math.max(1, Math.ceil(meta.total / pageSize)) : 1

  return (
    <section className="stack">
      <div className="custody-summary" role="tablist" aria-label={t('Situação dos itens')}>
        {tabs.map((tab) => (
          <button key={tab.value} type="button" role="tab" aria-selected={state === tab.value} className={state === tab.value ? 'active' : ''} onClick={() => changeState(tab.value)}>
            {tab.summary && <strong>{meta?.summary[tab.summary] ?? 0}</strong>}
            <span>{t(tab.label)}</span>
          </button>
        ))}
      </div>

      <form className="toolbar compact-toolbar" role="search" onSubmit={search}>
        <input type="search" placeholder={t('Buscar item')} aria-label={t('Buscar item')} maxLength={120} value={q} onChange={(event) => setQ(event.target.value)} />
        {meta && meta.spaces.length > 1 && (
          <select aria-label={t('Espaço')} value={spaceId} onChange={(event) => { setSpaceId(event.target.value); void load({ spaceId: event.target.value }) }}>
            <option value="">{t('Todos os meus espaços')}</option>
            {meta.spaces.map((space) => <option key={space.id} value={space.id}>{space.name} · {space.organizationName}</option>)}
          </select>
        )}
        <button className="primary" type="submit" disabled={loading}><Search size={18} /> {t('Buscar')}</button>
      </form>

      {error && <p className="message error" role="alert">{error}</p>}
      {state === 'overdue' && meta && <p className="privacy-note">{t('Itens guardados há mais de {days} dias sem destino. Avalie contato com quem perdeu, doação ou descarte.', { days: meta.overdueDays })}</p>}

      <div className="panel">
        <h2 className="section-title"><Boxes size={18} /> {t('Itens')}</h2>
        {loading ? (
          <p className="loading" role="status">{t('Carregando custódia...')}</p>
        ) : (
          <div className="table custody-table">
            {rows.map((row) => (
              <div key={row.id}>
                <span className="custody-thumb" aria-hidden="true">{apiAssetUrl(row.image_url) ? <UploadImage url={row.image_url} /> : row.title.slice(0, 1)}</span>
                <span className="report-summary">
                  <strong><Link to={`/items/${row.id}`}>{row.title}</Link></strong>
                  <span>
                    {row.space_name ?? t('Sem espaço')}
                    {row.storage_location && <> · {row.storage_location}</>}
                    {row.last_event && row.last_event_at && <> · {t(custodyEventLabel[row.last_event])} {relativeDate(row.last_event_at)}</>}
                  </span>
                  <span>
                    {row.category}
                    {row.custody_since && <> · {t('sob custódia desde {date}', { date: formatDate(row.custody_since) })}</>}
                    {row.open_claims > 0 && <> · {t('{count} reivindicações abertas', { count: row.open_claims })}</>}
                  </span>
                </span>
                <span className={`badge custody-${row.state}`}>
                  {row.overdue && <AlertTriangle size={14} aria-label={t('Guardado há muito tempo')} />} {row.state === 'none' ? t('Aguardando entrega') : t(custodyStateLabel[row.state])}
                </span>
              </div>
            ))}
            {!rows.length && <p className="empty">{t('Nenhum item nesta situação.')}</p>}
          </div>
        )}
        {pages > 1 && (
          <div className="pager" role="navigation" aria-label={t('Páginas de custódia')}>
            <button className="ghost light" disabled={page <= 1} onClick={() => void load({ page: page - 1 })}>{t('Anterior')}</button>
            <span>{t('Página {page} de {pages}', { page, pages })}</span>
            <button className="ghost light" disabled={page >= pages} onClick={() => void load({ page: page + 1 })}>{t('Próxima')}</button>
          </div>
        )}
      </div>
    </section>
  )
}
