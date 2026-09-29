import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, apiError } from '../services/api'
import { useI18n } from '../i18n'

export function ResetPasswordPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const [form, setForm] = useState({ password: '', confirmPassword: '' })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (form.password !== form.confirmPassword) {
      setError(t('A confirmação não confere com a nova senha.'))
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const response = await api.post('/auth/reset-password', { token, password: form.password })
      navigate('/login', { replace: true, state: { flash: t(response.data.message) } })
    } catch (requestError) {
      setError(apiError(requestError))
      setSubmitting(false)
    }
  }

  return (
    <section className="auth-page">
      <div className="auth-login-stack">
        <form className="panel auth-card" onSubmit={submit}>
          <h2>{t('Criar nova senha')}</h2>
          {!token ? (
            <p className="message error" role="alert">{t('Link incompleto. Abra o link recebido por e-mail ou solicite um novo.')}</p>
          ) : (
            <>
              <label htmlFor="reset-password">
                <span>{t('Nova senha (mínimo 8 caracteres)')}</span>
                <input id="reset-password" type="password" autoComplete="new-password" minLength={8} required autoFocus value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
              </label>
              <label htmlFor="reset-confirm">
                <span>{t('Confirmar nova senha')}</span>
                <input id="reset-confirm" type="password" autoComplete="new-password" minLength={8} required value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} />
              </label>
              <button className="primary" disabled={submitting}>{submitting ? t('Salvando...') : t('Salvar nova senha')}</button>
            </>
          )}
          {error && <p className="message error" role="alert">{error}</p>}
          <small><Link to="/login">{t('Voltar ao login')}</Link></small>
        </form>
      </div>
    </section>
  )
}
