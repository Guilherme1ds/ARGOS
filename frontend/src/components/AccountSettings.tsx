import { BellRing, Download, KeyRound, ShieldAlert, Trash2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { api, apiError } from '../services/api'
import { useAppConfig } from '../services/config'
import { currentPushSubscription, disablePush, enablePush, pushSupported } from '../utils/push'
import { useI18n } from '../i18n'

type Feedback = { type: 'success' | 'error'; text: string } | null

function FeedbackMessage({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null
  return <p className={`message ${feedback.type}`} role={feedback.type === 'error' ? 'alert' : 'status'}>{feedback.text}</p>
}

export function PasswordSettings() {
  const { changePassword } = useAuth()
  const { t } = useI18n()
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (form.newPassword !== form.confirmPassword) {
      setFeedback({ type: 'error', text: t('A confirmação não confere com a nova senha.') })
      return
    }
    setSaving(true)
    setFeedback(null)
    try {
      const message = await changePassword(form.currentPassword, form.newPassword)
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
      setFeedback({ type: 'success', text: t(message) })
    } catch (error) {
      setFeedback({ type: 'error', text: apiError(error) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="panel settings-section" onSubmit={submit}>
      <div className="section-title">
        <KeyRound size={20} />
        <div>
          <h2>{t('Segurança')}</h2>
          <p>{t('Troque sua senha. As sessões abertas em outros dispositivos serão encerradas.')}</p>
        </div>
      </div>
      <div className="settings-list">
        <label>
          <span>{t('Senha atual')}</span>
          <input type="password" autoComplete="current-password" required value={form.currentPassword} onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} />
        </label>
        <label>
          <span>{t('Nova senha (mínimo 8 caracteres)')}</span>
          <input type="password" autoComplete="new-password" minLength={8} required value={form.newPassword} onChange={(event) => setForm({ ...form, newPassword: event.target.value })} />
        </label>
        <label>
          <span>{t('Confirmar nova senha')}</span>
          <input type="password" autoComplete="new-password" minLength={8} required value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} />
        </label>
      </div>
      <div className="settings-actions">
        <button className="primary" disabled={saving}><KeyRound size={18} /> {saving ? t('Alterando...') : t('Alterar senha')}</button>
        <FeedbackMessage feedback={feedback} />
      </div>
    </form>
  )
}

export function PrivacySettings() {
  const { user, deleteAccount } = useAuth()
  const { t } = useI18n()
  const [exporting, setExporting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [password, setPassword] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const isAdmin = Boolean(user?.permissions?.includes('platform:admin'))

  async function exportData() {
    setExporting(true)
    setFeedback(null)
    try {
      const response = await api.get('/privacy/export')
      const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `argos-meus-dados-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      // Revogar na mesma hora cancela o download em alguns navegadores (Chrome).
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
      setFeedback({ type: 'success', text: t('Arquivo com seus dados gerado.') })
    } catch (error) {
      setFeedback({ type: 'error', text: apiError(error) })
    } finally {
      setExporting(false)
    }
  }

  async function submitDelete(event: FormEvent) {
    event.preventDefault()
    setDeleting(true)
    setFeedback(null)
    try {
      await deleteAccount(password)
    } catch (error) {
      setFeedback({ type: 'error', text: apiError(error) })
      setDeleting(false)
    }
  }

  return (
    <section className="panel settings-section">
      <div className="section-title">
        <ShieldAlert size={20} />
        <div>
          <h2>{t('Privacidade e conta')}</h2>
          <p>{t('Baixe uma cópia dos seus dados ou exclua sua conta (LGPD).')}</p>
        </div>
      </div>
      <div className="settings-list">
        <div className="setting-row">
          <span>
            <strong>{t('Exportar meus dados')}</strong>
            <small>{t('Perfil, itens, reivindicações, pistas, acompanhamentos e notificações em um arquivo JSON.')}</small>
          </span>
          <button className="ghost light fit" type="button" onClick={() => void exportData()} disabled={exporting}>
            <Download size={18} /> {exporting ? t('Gerando...') : t('Baixar')}
          </button>
        </div>
        <div className="setting-row">
          <span>
            <strong>{t('Excluir conta')}</strong>
            <small>
              {isAdmin
                ? t('Contas de administrador não podem ser excluídas por aqui.')
                : t('Remove seus dados pessoais, casos em aberto, pistas e acompanhamentos. Casos já devolvidos ficam no histórico sem identificação.')}
            </small>
          </span>
          {!confirmingDelete && (
            <button className="ghost light fit danger-text" type="button" onClick={() => setConfirmingDelete(true)} disabled={isAdmin}>
              <Trash2 size={18} /> {t('Excluir')}
            </button>
          )}
        </div>
        {confirmingDelete && (
          <form className="confirm-panel stack" onSubmit={submitDelete} role="alertdialog" aria-labelledby="delete-account-title">
            <h3 id="delete-account-title">{t('Excluir sua conta definitivamente?')}</h3>
            <p>{t('Esta ação não pode ser desfeita. Digite sua senha para confirmar.')}</p>
            <label>
              <span>{t('Senha')}</span>
              <input type="password" autoComplete="current-password" required autoFocus value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            <div className="confirm-actions">
              <button className="danger" disabled={deleting}>{deleting ? t('Excluindo...') : t('Excluir minha conta')}</button>
              <button className="ghost light" type="button" onClick={() => { setConfirmingDelete(false); setPassword('') }} disabled={deleting}>{t('Cancelar')}</button>
            </div>
          </form>
        )}
      </div>
      <FeedbackMessage feedback={feedback} />
    </section>
  )
}

export function PushSettings() {
  const { t } = useI18n()
  const config = useAppConfig()
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const supported = pushSupported()

  useEffect(() => {
    if (!supported) return
    void currentPushSubscription().then((subscription) => setEnabled(Boolean(subscription) && Notification.permission === 'granted'))
  }, [supported])

  async function toggle() {
    if (!config?.push.publicKey || busy) return
    setBusy(true)
    setFeedback(null)
    try {
      if (enabled) {
        await disablePush()
        setEnabled(false)
        setFeedback({ type: 'success', text: t('Notificações no navegador desativadas.') })
      } else {
        await enablePush(config.push.publicKey)
        setEnabled(true)
        setFeedback({ type: 'success', text: t('Notificações no navegador ativadas.') })
      }
    } catch (error) {
      const denied = error instanceof Error && error.message === 'permission-denied'
      setFeedback({ type: 'error', text: denied ? t('Permissão negada. Libere as notificações do site nas configurações do navegador.') : apiError(error) })
    } finally {
      setBusy(false)
    }
  }

  async function sendTest() {
    try {
      await api.post('/push/test')
      setFeedback({ type: 'success', text: t('Notificação de teste enviada.') })
    } catch (error) {
      setFeedback({ type: 'error', text: apiError(error) })
    }
  }

  return (
    <section className="panel settings-section">
      <div className="section-title">
        <BellRing size={20} />
        <div>
          <h2>{t('Notificações no navegador')}</h2>
          <p>{t('Receba avisos de reivindicações e pistas mesmo com o ARGOS fechado.')}</p>
        </div>
      </div>
      {supported ? (
        <div className="settings-actions">
          <button className={enabled ? 'ghost light' : 'primary'} type="button" onClick={() => void toggle()} disabled={busy || !config}>
            <BellRing size={18} /> {busy ? t('Aguarde...') : enabled ? t('Desativar neste navegador') : t('Ativar neste navegador')}
          </button>
          {enabled && (
            <button className="ghost light" type="button" onClick={() => void sendTest()}>{t('Enviar teste')}</button>
          )}
        </div>
      ) : (
        <p className="privacy-note">{t('Este navegador ou endereço não permite notificações. Use um navegador atualizado em https ou localhost.')}</p>
      )}
      <FeedbackMessage feedback={feedback} />
    </section>
  )
}
