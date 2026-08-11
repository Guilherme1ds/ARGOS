import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { apiError } from '../services/api'

export function LoginPage() {
  const { login, register } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'register' | 'access'>('login')
  const [form, setForm] = useState({ name: '', email: '', password: '', reason: '' })
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setMessage('')
    setMessageType('success')
    try {
      if (mode === 'login') await login(form.email, form.password)
      if (mode === 'register') await register({ name: form.name, email: form.email, password: form.password })
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
        {mode === 'access' && <textarea placeholder="Justificativa de acesso" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />}
        <button className="primary">{mode === 'login' ? 'Entrar' : 'Enviar'}</button>
        {message && <p className={`message ${messageType}`}>{message}</p>}
        <div className="segmented">
          <button type="button" onClick={() => setMode('login')}>Login</button>
          <button type="button" onClick={() => setMode('register')}>Cadastro</button>
          <button type="button" onClick={() => setMode('access')}>Acesso</button>
        </div>
        <small>Admin padrão: admin@argos.local / Admin@123</small>
      </form>
    </section>
  )
}
