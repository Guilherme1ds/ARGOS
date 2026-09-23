import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { apiError } from '../services/api'

export function LoginPage() {
  const { login, register } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mode, setMode] = useState<'login' | 'register' | 'access'>('login')
  const [form, setForm] = useState({ name: '', email: '', password: '', reason: '', privacyTermsAccepted: false })
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (submitting) return
    setMessage('')
    setMessageType('success')
    setSubmitting(true)
    try {
      if (mode === 'login') await login(form.email, form.password)
      if (mode === 'register') {
        await register({
          name: form.name,
          email: form.email,
          password: form.password,
          privacyTermsAccepted: form.privacyTermsAccepted,
          privacyTermsVersion: '2026-08-18',
        })
      }
      if (mode === 'access') {
        await register({ name: form.name, email: form.email, password: form.password, requestAccess: true, reason: form.reason })
        setMessage('Solicitação enviada para aprovação.')
        return
      }
      const next = new URLSearchParams(location.search).get('next')
      const safeNext = next?.startsWith('/') && !next.startsWith('//') ? next : '/dashboard'
      navigate(safeNext)
    } catch (error) {
      setMessageType('error')
      setMessage(apiError(error))
    } finally {
      setSubmitting(false)
    }
  }

  function switchMode(next: typeof mode) {
    setMode(next)
    setMessage('')
  }

  return (
    <section className="auth-page">
      <div className="auth-login-stack">
        <form className="panel auth-card" onSubmit={submit}>
          <h2>{mode === 'login' ? 'Entrar' : mode === 'register' ? 'Criar conta' : 'Solicitar acesso'}</h2>
          {mode !== 'login' && (
            <label htmlFor="auth-name">
              <span>Nome</span>
              <input id="auth-name" autoComplete="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
          )}
          <label htmlFor="auth-email">
            <span>E-mail</span>
            <input id="auth-email" type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label htmlFor="auth-password">
            <span>Senha</span>
            <input id="auth-password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'login' ? undefined : 8} required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </label>
          {mode === 'access' && (
            <label htmlFor="auth-reason">
              <span>Justificativa de acesso</span>
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
              <span>Li e aceito o resumo de privacidade vigente.</span>
            </label>
          )}
          <button className="primary" disabled={submitting}>{submitting ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Enviar'}</button>
          {message && <p className={`message ${messageType}`} role={messageType === 'error' ? 'alert' : 'status'} aria-live={messageType === 'success' ? 'polite' : undefined}>{message}</p>}
          <div className="segmented" role="group" aria-label="Tipo de acesso">
            <button type="button" aria-pressed={mode === 'login'} onClick={() => switchMode('login')}>Login</button>
            <button type="button" aria-pressed={mode === 'register'} onClick={() => switchMode('register')}>Cadastro</button>
            <button type="button" aria-pressed={mode === 'access'} onClick={() => switchMode('access')}>Acesso</button>
          </div>
          <small><Link to="/privacy">Resumo de privacidade</Link></small>
        </form>
      </div>
    </section>
  )
}
