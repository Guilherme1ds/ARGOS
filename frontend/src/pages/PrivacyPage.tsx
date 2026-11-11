import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { api, apiError } from '../services/api'
import type { PrivacySummary } from '../types/api'
import { formatDateTime } from '../utils/dates'
import { useI18n } from '../i18n'

export function PrivacyPage() {
  const { t } = useI18n()
  const { user } = useAuth()
  const [summary, setSummary] = useState<PrivacySummary | null>(null)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [accepting, setAccepting] = useState(false)

  async function load() {
    try {
      const response = await api.get('/privacy/summary')
      setSummary(response.data.data)
    } catch (requestError) {
      setError(apiError(requestError))
    }
  }

  useEffect(() => {
    void load()
  }, [user?.id])

  async function acceptCurrent() {
    if (!summary || accepting) return
    setAccepting(true)
    setFeedback('')
    try {
      const response = await api.post('/privacy/consents', { accepted: true, termsVersion: summary.termsVersion })
      setFeedback(t(response.data.message))
      await load()
    } catch (requestError) {
      setFeedback(apiError(requestError))
      await load()
    } finally {
      setAccepting(false)
    }
  }

  if (error) return <p className="message error" role="alert">{error}</p>
  if (!summary) return <div className="panel skeleton-detail" />

  const status = summary.consentStatus

  return (
    <section className="panel privacy-page">
      <h2>{t('Resumo de privacidade')}</h2>
      <p><strong>{t('Controlador:')}</strong> {summary.controller}</p>
      <p><strong>{t('Versão dos termos:')}</strong> {summary.termsVersion}</p>
      {status && (
        <div className={`message ${status.upToDate ? 'success' : 'error'}`} role="status">
          {status.upToDate
            ? t('Você aceitou a versão vigente em {date}.', { date: status.acceptedAt ? formatDateTime(status.acceptedAt) : '' })
            : t('O resumo foi atualizado desde o seu último aceite. Leia o texto e confirme, ou exclua a conta em Configurações.')}
          {!status.upToDate && (
            <div className="actions">
              <button className="primary fit" type="button" onClick={() => void acceptCurrent()} disabled={accepting}>
                {accepting ? t('Aguarde...') : t('Aceitar a versão vigente')}
              </button>
            </div>
          )}
        </div>
      )}
      {feedback && <p className="privacy-note" role="status">{feedback}</p>}
      <h3>{t('Finalidades')}</h3>
      <ul>
        {summary.purposes.map((purpose) => <li key={purpose}>{t(purpose)}</li>)}
      </ul>
      <h3>{t('Busca pública')}</h3>
      <p>{t(summary.publicDataPolicy)}</p>
      {summary.externalProcessors && (
        <>
          <h3>{t('Serviços externos')}</h3>
          <p>{t(summary.externalProcessors)}</p>
        </>
      )}
      <h3>{t('Direitos')}</h3>
      <ul>
        {summary.userRights.map((right) => <li key={right}>{t(right)}</li>)}
      </ul>
      {summary.retention?.length ? (
        <>
          <h3>{t('Por quanto tempo guardamos')}</h3>
          <ul className="retention-list">
            {summary.retention.map((rule) => (
              <li key={rule.data}>
                <strong>{t(rule.data)}:</strong> {rule.days ? t('{days} dias', { days: rule.days }) : t(rule.note ?? '')}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <p className="privacy-note">{t('Este resumo não substitui o aviso de privacidade oficial da instituição.')}</p>
    </section>
  )
}
