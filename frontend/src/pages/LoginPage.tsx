import axios from 'axios'
import { useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { GoogleSignInButton } from '../components/GoogleSignInButton'
import { TurnstileWidget, type TurnstileHandle } from '../components/TurnstileWidget'
import { useAuth } from '../contexts/AuthContext'
import { useI18n } from '../i18n'
import { api, apiError } from '../services/api'
import { useAppConfig } from '../services/config'

const termsVersion = '2026-08-18'

export function LoginPage() {
  const { login, register, loginWithGoogle } = useAuth()
  const { t } = useI18n()
  const config = useAppConfig()
  const navigate = useNavigate()
  const location = useLocation()
  const [mode, setMode] = useState<'login' | 'register' | 'access' | 'forgot'>('login')
  const [form, setForm] = useState({ name: '', email: '', password: '', reason: '', privacyTermsAccepted: false })
  const [message, setMessage] = useState(
    (location.state as { flash?: string } | null)?.flash ??
      (new URLSearchParams(location.search).get('conta') === 'excluida' ? t('Conta excluída. Seus dados pessoais foram removidos.') : ''),
  )
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')
  const [submitting, setSubmitting] = useState(false)
  const [captchaToken, setCaptchaToken] = useState('')
  // Conta nova pelo Google: guarda a credencial até a pessoa aceitar os termos de privacidade.
  const [pendingGoogleCredential, setPendingGoogleCredential] = useState('')
  const turnstileRef = useRef<TurnstileHandle | null>(null)

  const needsCaptcha = Boolean(config?.turnstileSiteKey) && (mode === 'register' || mode === 'access' || mode === 'forgot') && !pendingGoogleCredential
  const googleClientId = config?.googleClientId

  function goToNext() {
    const next = new URLSearchParams(location.search).get('next')
    navigate(next?.startsWith('/') && !next.startsWith('//') ? next : '/dashboard')
  }

  async function signInWithGoogle(credential: string, privacyTermsAccepted?: boolean) {
    setMessage('')
    setSubmitting(true)
    try {
      await loginWithGoogle(credential, privacyTermsAccepted)
      goToNext()
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.data?.details?.code === 'terms_required') {
        setPendingGoogleCredential(credential)
        setMode('register')
        setMessageType('success')
        setMessage(t('Primeiro acesso com Google: aceite o resumo de privacidade para criar sua conta.'))
      } else {
        setMessageType('error')
        setMessage(apiError(error))
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (submitting) return
    if (pendingGoogleCredential) {
      await signInWithGoogle(pendingGoogleCredential, form.privacyTermsAccepted)
      return
    }
    if (needsCaptcha && !captchaToken) {
      setMessageType('error')
      setMessage(t('Confirme que você não é um robô.'))
      return
    }
    setMessage('')
    setMessageType('success')
    setSubmitting(true)
    try {
      if (mode === 'forgot') {
        const response = await api.post('/auth/forgot-password', { email: form.email, captchaToken: captchaToken || undefined })
        setMessage(t(response.data.message))
        return
      }
      if (mode === 'login') await login(form.email, form.password)
      if (mode === 'register') {
        await register({
          name: form.name,
          email: form.email,
          password: form.password,
          privacyTermsAccepted: form.privacyTermsAccepted,
          privacyTermsVersion: termsVersion,
          captchaToken: captchaToken || undefined,
        })
      }
      if (mode === 'access') {
        await register({ name: form.name, email: form.email, password: form.password, requestAccess: true, reason: form.reason, captchaToken: captchaToken || undefined })
        setMessage(t('Solicitação enviada para aprovação.'))
        return
      }
      goToNext()
    } catch (error) {
      setMessageType('error')
      setMessage(apiError(error))
    } finally {
      setSubmitting(false)
      // Cada token do Turnstile vale para uma única verificação.
      if (needsCaptcha) turnstileRef.current?.reset()
    }
  }

  function switchMode(next: typeof mode) {
    setMode(next)
    setMessage('')
    setPendingGoogleCredential('')
  }

  const showCredentialFields = !pendingGoogleCredential

  return (
    <section className="auth-page">
      <div className="auth-login-stack">
        <form className="panel auth-card" onSubmit={submit}>
          <h2>{mode === 'login' ? t('Entrar') : mode === 'register' ? t('Criar conta') : mode === 'forgot' ? t('Recuperar senha') : t('Solicitar acesso')}</h2>
          {mode === 'forgot' && <p className="privacy-note">{t('Informe o e-mail da conta. Enviaremos um link válido por 1 hora para criar uma nova senha.')}</p>}
          {showCredentialFields && (mode === 'register' || mode === 'access') && (
            <label htmlFor="auth-name">
              <span>{t('Nome')}</span>
              <input id="auth-name" autoComplete="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
          )}
          {showCredentialFields && (
            <label htmlFor="auth-email">
              <span>{t('E-mail')}</span>
              <input id="auth-email" type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </label>
          )}
          {showCredentialFields && mode !== 'forgot' && (
            <label htmlFor="auth-password">
              <span>{t('Senha')}</span>
              <input id="auth-password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'login' ? undefined : 8} required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </label>
          )}
          {mode === 'login' && (
            <button type="button" className="link-button" onClick={() => switchMode('forgot')}>{t('Esqueci minha senha')}</button>
          )}
          {mode === 'access' && (
            <label htmlFor="auth-reason">
              <span>{t('Justificativa de acesso')}</span>
              <textarea id="auth-reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </label>
          )}
          {mode === 'register' && (
            <label className="check-row">
              <input
                type="checkbox"
                required
                checked={form.privacyTermsAccepted}
                onChange={(e) => setForm({ ...form, privacyTermsAccepted: e.target.checked })}
              />
              <span>{t('Li e aceito o resumo de privacidade vigente.')}</span>
            </label>
          )}
          {needsCaptcha && config?.turnstileSiteKey && <TurnstileWidget ref={turnstileRef} siteKey={config.turnstileSiteKey} onToken={setCaptchaToken} />}
          <button className="primary" disabled={submitting}>
            {submitting
              ? t('Aguarde...')
              : pendingGoogleCredential
                ? t('Criar conta com Google')
                : mode === 'login'
                  ? t('Entrar')
                  : mode === 'forgot'
                    ? t('Enviar link')
                    : t('Enviar')}
          </button>
          {message && <p className={`message ${messageType}`} role={messageType === 'error' ? 'alert' : 'status'} aria-live={messageType === 'success' ? 'polite' : undefined}>{message}</p>}
          {googleClientId && (mode === 'login' || mode === 'register') && !pendingGoogleCredential && (
            <>
              <span className="auth-divider">{t('ou')}</span>
              <GoogleSignInButton clientId={googleClientId} onCredential={(credential) => void signInWithGoogle(credential, mode === 'register' ? form.privacyTermsAccepted : undefined)} />
            </>
          )}
          <div className="segmented" role="group" aria-label={t('Tipo de acesso')}>
            <button type="button" aria-pressed={mode === 'login' || mode === 'forgot'} onClick={() => switchMode('login')}>{t('Login')}</button>
            <button type="button" aria-pressed={mode === 'register'} onClick={() => switchMode('register')}>{t('Cadastro')}</button>
            <button type="button" aria-pressed={mode === 'access'} onClick={() => switchMode('access')}>{t('Acesso')}</button>
          </div>
          <small><Link to="/privacy">{t('Resumo de privacidade')}</Link></small>
        </form>
      </div>
    </section>
  )
}
