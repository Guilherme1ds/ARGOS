import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { apiError } from '../services/api'

export function LoginPage() {
  const { login, register } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'register' | 'access'>('login')
  const [form, setForm] = useState({ name: '', email: '', password: '', reason: '', privacyTermsAccepted: false })
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setMessage('')
    setMessageType('success')
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
      navigate('/dashboard')
    } catch (error) {
      setMessageType('error')
      setMessage(apiError(error))
    }
  }

  return (
    <section className="auth-page">
      <form className="panel auth-card" onSubmit={submit}>
        <h2>{mode === 'login' ? 'Entrar' : mode === 'register' ? 'Criar conta' : 'Solicitar acesso'}</h2>
        {mode !== 'login' && <input placeholder="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
        <input placeholder="E-mail" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input placeholder="Senha" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        {mode === 'access' && (
          <textarea placeholder="Justificativa de acesso" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        )}
        {mode === 'register' && (
          <label className="check-row">
            <input
              type="checkbox"
              checked={form.privacyTermsAccepted}
              onChange={(e) => setForm({ ...form, privacyTermsAccepted: e.target.checked })}
            />
            <span>Li e aceito o resumo de privacidade vigente.</span>
          </label>
        )}
        <button className="primary">{mode === 'login' ? 'Entrar' : 'Enviar'}</button>
        {message && <p className={`message ${messageType}`}>{message}</p>}
        <div className="segmented">
          <button type="button" onClick={() => setMode('login')}>Login</button>
          <button type="button" onClick={() => setMode('register')}>Cadastro</button>
          <button type="button" onClick={() => setMode('access')}>Acesso</button>
        </div>
        <small><Link to="/privacy">Resumo de privacidade</Link></small>
      </form>
    </section>
  )
}
