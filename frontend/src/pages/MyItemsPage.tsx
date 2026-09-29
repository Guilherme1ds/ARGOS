import { RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { api, apiError } from '../services/api'
import type { ApprovalStatus, Item, ItemStatus, MyClaim } from '../types/api'
import { formatDateTime } from '../utils/dates'
import { approvalLabel, claimStatusLabel, statusLabel } from '../utils/labels'
import { msg, useI18n } from '../i18n'

type Tab = 'published' | 'following' | 'claims'

const tabs: Array<{ value: Tab; label: string }> = [
  { value: 'published', label: msg('Publicados') },
  { value: 'following', label: msg('Acompanhando') },
  { value: 'claims', label: msg('Minhas reivindicações') },
]

function isTab(value: string | null): value is Tab {
  return tabs.some((tab) => tab.value === value)
}

export function MyItemsPage() {
  const { t } = useI18n()
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const tab: Tab = isTab(tabParam) ? tabParam : 'published'
  const [flash] = useState((location.state as { flash?: string } | null)?.flash ?? '')
  const [items, setItems] = useState<Item[]>([])
  const [following, setFollowing] = useState<Item[]>([])
  const [claims, setClaims] = useState<MyClaim[]>([])
  const [status, setStatus] = useState<ItemStatus | ''>('')
  const [approvalStatus, setApprovalStatus] = useState<ApprovalStatus | ''>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [published, followed, myClaims] = await Promise.all([
        api.get('/items'),
        api.get('/items/following', { params: { limit: 50 } }),
        api.get('/items/my-claims', { params: { limit: 50 } }),
      ])
      setItems(published.data.data)
      setFollowing(followed.data.data)
      setClaims(myClaims.data.data)
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
    if (flash) navigate(location.pathname + location.search, { replace: true, state: null })
  }, [])

  function selectTab(next: Tab) {
    setSearchParams(next === 'published' ? {} : { tab: next }, { replace: true })
  }

  const counts: Record<Tab, number> = { published: items.length, following: following.length, claims: claims.length }

  return (
    <section className="stack">
      <div className="admin-header">
        <h2>{t('Meus itens')}</h2>
        <button className="ghost light" onClick={load} disabled={loading}><RefreshCw size={18} /> {t('Atualizar')}</button>
      </div>
      <div className="segmented" role="tablist" aria-label={t('Seções de Meus itens')}>
        {tabs.map((entry) => (
          <button type="button" role="tab" key={entry.value} aria-selected={tab === entry.value} aria-pressed={tab === entry.value} onClick={() => selectTab(entry.value)}>
            {t(entry.label)}{!loading && ` (${counts[entry.value]})`}
          </button>
        ))}
      </div>
      {tab === 'published' && (
        <div className="toolbar compact-toolbar">
          <select aria-label={t('Filtrar por status')} value={status} onChange={(event) => setStatus(event.target.value as ItemStatus | '')}>
            <option value="">{t('Todos os status')}</option>
            <option value="lost">{t('Perdido')}</option>
            <option value="found">{t('Encontrado')}</option>
            <option value="claimed">{t('Em análise')}</option>
            <option value="returned">{t('Devolvido')}</option>
          </select>
          <select aria-label={t('Filtrar por aprovação')} value={approvalStatus} onChange={(event) => setApprovalStatus(event.target.value as ApprovalStatus | '')}>
            <option value="">{t('Todas as aprovações')}</option>
            <option value="pending">{t('Pendente')}</option>
            <option value="approved">{t('Aprovado')}</option>
            <option value="rejected">{t('Rejeitado')}</option>
          </select>
        </div>
      )}
      {flash && <p className="message success" role="status">{flash}</p>}
      {error && <p className="message error" role="alert">{error}</p>}
      <div className="panel" role="tabpanel">
        {loading ? (
          <div className="table" role="status" aria-label={t('Carregando itens')}>
            {Array.from({ length: 4 }).map((_, index) => <div className="skeleton-card" key={index} />)}
          </div>
        ) : tab === 'published' ? (
          filteredItems.length ? (
            <div className="table">
              {filteredItems.map((item) => (
                <Link to={`/items/${item.id}`} key={item.id}>
                  {item.title}
                  <span>{t(statusLabel[item.status])} · {t(approvalLabel[item.approval_status])}</span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="empty">
              {items.length ? t('Nenhum item encontrado para os filtros atuais.') : <>{t('Você ainda não publicou itens.')} <Link to="/items/new">{t('Publicar item')}</Link></>}
            </p>
          )
        ) : tab === 'following' ? (
          following.length ? (
            <div className="table">
              {following.map((item) => (
                <Link to={`/items/${item.id}`} key={item.id}>
                  {item.title}
                  <span>{t(statusLabel[item.status])} · {item.location}</span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="empty">{t('Você não acompanha nenhum caso. Use “Acompanhar” na página de um caso para receber novidades.')}</p>
          )
        ) : claims.length ? (
          <div className="table">
            {claims.map((claim) => (
              <Link to={`/items/${claim.item_id}`} key={claim.id}>
                {claim.item_title}
                <span>{t(claimStatusLabel[claim.status])} · {t('caso {status}', { status: t(statusLabel[claim.item_status]).toLowerCase() })} · {formatDateTime(claim.created_at)}</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="empty">{t('Você ainda não enviou reivindicações.')}</p>
        )}
      </div>
    </section>
  )
}
