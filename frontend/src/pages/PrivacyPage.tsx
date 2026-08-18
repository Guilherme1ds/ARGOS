import { useEffect, useState } from 'react'
import { api, apiError } from '../services/api'

type PrivacySummary = {
  termsVersion: string
  controller: string
  purposes: string[]
  publicDataPolicy: string
  userRights: string[]
}

export function PrivacyPage() {
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
      <h2>Resumo de privacidade</h2>
      <p><strong>Controlador:</strong> {summary.controller}</p>
      <p><strong>Versão dos termos:</strong> {summary.termsVersion}</p>
      <h3>Finalidades</h3>
      <ul>
        {summary.purposes.map((purpose) => <li key={purpose}>{purpose}</li>)}
      </ul>
      <h3>Busca pública</h3>
      <p>{summary.publicDataPolicy}</p>
      <h3>Direitos</h3>
      <ul>
        {summary.userRights.map((right) => <li key={right}>{right}</li>)}
      </ul>
    </section>
  )
}
