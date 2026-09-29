import { useEffect, useState } from 'react'
import { api, apiError } from '../services/api'
import { useI18n } from '../i18n'

type PrivacySummary = {
  termsVersion: string
  controller: string
  purposes: string[]
  publicDataPolicy: string
  userRights: string[]
}

export function PrivacyPage() {
  const { t } = useI18n()
  const [summary, setSummary] = useState<PrivacySummary | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .get('/privacy/summary')
      .then((response) => setSummary(response.data.data))
      .catch((requestError) => setError(apiError(requestError)))
  }, [])

  if (error) return <p className="message error">{error}</p>
  if (!summary) return <div className="panel skeleton-detail" />

  return (
    <section className="panel privacy-page">
      <h2>{t('Resumo de privacidade')}</h2>
      <p><strong>{t('Controlador:')}</strong> {summary.controller}</p>
      <p><strong>{t('Versão dos termos:')}</strong> {summary.termsVersion}</p>
      <h3>{t('Finalidades')}</h3>
      <ul>
        {summary.purposes.map((purpose) => <li key={purpose}>{t(purpose)}</li>)}
      </ul>
      <h3>{t('Busca pública')}</h3>
      <p>{t(summary.publicDataPolicy)}</p>
      <h3>{t('Direitos')}</h3>
      <ul>
        {summary.userRights.map((right) => <li key={right}>{t(right)}</li>)}
      </ul>
    </section>
  )
}
