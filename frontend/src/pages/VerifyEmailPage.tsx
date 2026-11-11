import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { api, apiError, takeLinkToken } from '../services/api'
import { useI18n } from '../i18n'

/**
 * Confirmação de e-mail. O token vem no fragmento do link (#token=...) e sai da URL ao abrir a página.
 * A confirmação exige um clique: leitores de links e pré-carregamento de e-mail não consomem o token.
 */
export function VerifyEmailPage() {
  const { t } = useI18n()
  const { resendVerification } = useAuth()
  const [token] = useState(() => takeLinkToken())
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [resendMessage, setResendMessage] = useState('')

  async function confirm() {
    setStatus('submitting')
    setMessage('')
    try {
      const response = await api.post('/auth/verify-email', { token })
      setStatus('done')
      setMessage(t(response.data.message))
    } catch (error) {
      setStatus('error')
      setMessage(apiError(error))
    }
  }

  async function resend(event: FormEvent) {
    event.preventDefault()
    setResendMessage('')
    try {
      setResendMessage(t(await resendVerification(email)))
    } catch (error) {
      setResendMessage(apiError(error))
    }
  }

  return (
    <section className="auth-page">
      <div className="auth-login-stack">
        <div className="panel auth-card">
          <h2>{t('Confirmar e-mail')}</h2>
          {!token && status === 'idle' && (
            <p className="message error" role="alert">{t('Link incompleto. Abra o link recebido por e-mail ou solicite um novo.')}</p>
          )}
          {token && status !== 'done' && (
            <>
              <p className="privacy-note">{t('Confirme para ativar sua conta. O link vale uma única vez.')}</p>
              <button className="primary" type="button" onClick={() => void confirm()} disabled={status === 'submitting'}>
                {status === 'submitting' ? t('Aguarde...') : t('Confirmar meu e-mail')}
              </button>
            </>
          )}
          {message && (
            <p className={`message ${status === 'done' ? 'success' : 'error'}`} role={status === 'done' ? 'status' : 'alert'}>
              {message}
            </p>
          )}
          {status === 'done' && (
            <Link className="primary button-link" to="/login" replace>
              {t('Ir para o login')}
            </Link>
          )}
          {(status === 'error' || !token) && (
            <form className="stack" onSubmit={resend}>
              <label htmlFor="verify-resend-email">
                <span>{t('E-mail da conta')}</span>
                <input id="verify-resend-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
              </label>
              <button className="ghost light" type="submit">{t('Reenviar e-mail de confirmação')}</button>
              {resendMessage && <p className="message success" role="status">{resendMessage}</p>}
            </form>
          )}
          <small><Link to="/login">{t('Voltar ao login')}</Link></small>
        </div>
      </div>
    </section>
  )
}
