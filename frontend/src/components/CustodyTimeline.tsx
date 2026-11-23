import { Boxes, ShieldCheck, ShieldX } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useI18n } from '../i18n'
import { api, apiError } from '../services/api'
import type { Claim, CustodyChain, CustodyEventType, PublicSpace } from '../types/api'
import { formatDateTime } from '../utils/dates'
import { custodyEventLabel, custodyStateLabel } from '../utils/labels'

type Props = {
  itemId: number
  itemType: 'lost' | 'found'
  openClaims: Claim[]
  /** Chamado depois de registrar um evento (a entrega muda o status do caso). */
  onChanged: () => void
}

/** Trilha de custódia do caso com verificação de integridade e, para gestores, o registro do próximo evento. */
export function CustodyTimeline({ itemId, itemType, openClaims, onChanged }: Props) {
  const { t } = useI18n()
  const [chain, setChain] = useState<CustodyChain | null>(null)
  const [spaces, setSpaces] = useState<PublicSpace[]>([])
  const [form, setForm] = useState({ type: '' as CustodyEventType | '', spaceId: '', storageLocation: '', notes: '', claimId: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function load() {
    const response = await api.get(`/custody/items/${itemId}`)
    const next = response.data as CustodyChain
    setChain(next)
    setForm((current) => ({ ...current, type: next.nextEvents.includes(current.type as CustodyEventType) ? current.type : next.nextEvents[0] ?? '' }))
  }

  useEffect(() => {
    load().catch((requestError) => setError(apiError(requestError)))
  }, [itemId])

  useEffect(() => {
    if (!chain?.nextEvents.length) return
    api.get('/spaces').then((response) => setSpaces(response.data.data)).catch(() => undefined)
  }, [chain?.nextEvents.length])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!form.type || busy) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await api.post(`/custody/items/${itemId}/events`, {
        type: form.type,
        spaceId: form.spaceId ? Number(form.spaceId) : undefined,
        storageLocation: form.storageLocation.trim() || undefined,
        notes: form.notes.trim() || undefined,
        claimId: form.claimId ? Number(form.claimId) : undefined,
      })
      setForm({ type: '', spaceId: '', storageLocation: '', notes: '', claimId: '' })
      await load()
      setMessage(t('Evento de custódia registrado.'))
      onChanged()
    } catch (requestError) {
      setError(apiError(requestError))
    } finally {
      setBusy(false)
    }
  }

  if (!chain) return error ? <section className="panel"><h3>{t('Custódia')}</h3><p className="message error" role="alert">{error}</p></section> : null

  const needsSpace = form.type === 'transferred' || (form.type === 'received' && chain.state === 'none')
  const receivingSpaces = spaces.filter((space) => form.type !== 'transferred' || space.id !== chain.currentSpaceId)

  return (
    <section className="panel custody-panel">
      <h3><Boxes size={18} /> {t('Custódia')}</h3>
      <p className="custody-state">
        <span className={`badge custody-${chain.state}`}>{t(custodyStateLabel[chain.state])}</span>
        {chain.data.length > 0 && (
          chain.chain.valid ? (
            <small className="custody-integrity ok"><ShieldCheck size={14} /> {t('Trilha íntegra ({count} registros)', { count: chain.data.length })}</small>
          ) : (
            <small className="custody-integrity broken"><ShieldX size={14} /> {t('Trilha com inconsistência no registro {sequence}. Avise a administração.', { sequence: chain.chain.brokenAt ?? '?' })}</small>
          )
        )}
      </p>
      {chain.data.length ? (
        <ol className="timeline custody-timeline">
          {chain.data.map((entry) => (
            <li key={entry.id}>
              <strong>{t(custodyEventLabel[entry.type])}</strong>
              {entry.spaceName && <span> · {entry.spaceName}</span>}
              {entry.storageLocation && <span> · {entry.storageLocation}</span>}
              {entry.notes && <p>{entry.notes}</p>}
              <small>
                {formatDateTime(entry.occurredAt)}
                {entry.actorName && <> · {entry.actorName}</>}
                <span className="custody-hash" title={t('Código de integridade')}> · #{entry.hash.slice(0, 10)}</span>
              </small>
            </li>
          ))}
        </ol>
      ) : (
        <p className="privacy-note">{t('O item ainda não foi entregue a um espaço institucional.')}</p>
      )}

      {chain.nextEvents.length > 0 && (
        <form className="stack custody-form" onSubmit={submit}>
          <label>
            <span>{t('Registrar')}</span>
            <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as CustodyEventType })}>
              {chain.nextEvents.map((type) => <option key={type} value={type}>{t(custodyEventLabel[type])}</option>)}
            </select>
          </label>
          {needsSpace && (
            <label>
              <span>{form.type === 'transferred' ? t('Espaço de destino') : t('Espaço que recebeu')}</span>
              <select value={form.spaceId} onChange={(event) => setForm({ ...form, spaceId: event.target.value })} required={form.type === 'transferred' || !chain.item.spaceId}>
                <option value="">{form.type === 'received' && chain.item.spaceId ? t('Espaço indicado no caso') : t('Selecione o espaço')}</option>
                {receivingSpaces.map((space) => <option key={space.id} value={space.id}>{space.name} · {space.organizationName}</option>)}
              </select>
            </label>
          )}
          {form.type === 'stored' && (
            <label><span>{t('Onde foi guardado')}</span><input required maxLength={120} placeholder={t('Ex.: armário 2, prateleira B')} value={form.storageLocation} onChange={(event) => setForm({ ...form, storageLocation: event.target.value })} /></label>
          )}
          {form.type === 'handed_over' && itemType === 'found' && chain.item.status !== 'returned' && (
            <label>
              <span>{t('Reivindicação de quem retirou')}</span>
              <select required value={form.claimId} onChange={(event) => setForm({ ...form, claimId: event.target.value })}>
                <option value="">{t('Selecione uma reivindicação')}</option>
                {openClaims.map((claim) => <option key={claim.id} value={claim.id}>{claim.claimant_name ?? t('Usuário {id}', { id: claim.claimant_id })}</option>)}
              </select>
            </label>
          )}
          <label>
            <span>{form.type === 'disposed' ? t('Destinação e motivo') : t('Observação (opcional)')}</span>
            <textarea maxLength={500} rows={2} required={form.type === 'disposed'} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </label>
          <p className="privacy-note">{t('Cada registro é definitivo: não pode ser editado nem apagado. Não escreva telefone, e-mail ou documento.')}</p>
          <button className="primary" type="submit" disabled={busy || !form.type}>{busy ? t('Registrando...') : t('Registrar evento')}</button>
        </form>
      )}
      {message && <p className="message success" role="status">{message}</p>}
      {error && <p className="message error" role="alert">{error}</p>}
    </section>
  )
}
