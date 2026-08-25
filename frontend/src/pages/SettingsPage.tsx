import { Bell, CalendarDays, Eye, Languages, Mail, Moon, Monitor, Save, Smartphone, Sun, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { apiError } from '../services/api'
import type { AppLanguage, AppTheme, DateFormat, NotificationPreferences } from '../types/api'

type SettingsForm = {
  language: AppLanguage
  theme: AppTheme
  timezone: string
  dateFormat: DateFormat
  compactMode: boolean
  highContrast: boolean
  notificationPreferences: NotificationPreferences
}

const defaultNotifications: NotificationPreferences = {
  emailEnabled: true,
  inAppEnabled: true,
  digestEnabled: false,
}

const themeOptions: Array<{ value: AppTheme; label: string; icon: LucideIcon }> = [
  { value: 'system', label: 'Sistema', icon: Monitor },
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Escuro', icon: Moon },
]

export function SettingsPage() {
  const { user, updateProfile } = useAuth()
  const [form, setForm] = useState<SettingsForm>({
    language: 'pt-BR',
    theme: 'system',
    timezone: 'America/Sao_Paulo',
    dateFormat: 'dd/MM/yyyy',
    compactMode: false,
    highContrast: false,
    notificationPreferences: defaultNotifications,
  })
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!user) return
    setForm({
      language: user.language ?? 'pt-BR',
      theme: user.theme ?? 'system',
      timezone: user.timezone ?? 'America/Sao_Paulo',
      dateFormat: user.dateFormat ?? 'dd/MM/yyyy',
      compactMode: Boolean(user.compactMode),
      highContrast: Boolean(user.highContrast),
      notificationPreferences: user.notificationPreferences ?? defaultNotifications,
    })
  }, [user])

  function updateNotification(field: keyof NotificationPreferences, value: boolean) {
    setForm((current) => ({
      ...current,
      notificationPreferences: {
        ...current.notificationPreferences,
        [field]: value,
      },
    }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setMessage('')
    setSaving(true)

    try {
      await updateProfile(form)
      setMessageType('success')
      setMessage('Configurações salvas com sucesso.')
    } catch (error) {
      setMessageType('error')
      setMessage(apiError(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="stack settings-form" onSubmit={submit}>
      <section className="panel settings-section">
        <div className="section-title">
          <Languages size={20} />
          <div>
            <h2>Preferências</h2>
            <p>Idioma, aparência e leitura do sistema.</p>
          </div>
        </div>

        <div className="settings-list">
          <label className="setting-row">
            <span>
              <strong>Idioma</strong>
              <small>Define o idioma preferido para comunicações e futuras traduções.</small>
            </span>
            <select value={form.language} onChange={(event) => setForm((current) => ({ ...current, language: event.target.value as AppLanguage }))}>
              <option value="pt-BR">Português</option>
              <option value="en-US">English</option>
              <option value="es-ES">Español</option>
            </select>
          </label>

          <div className="setting-row">
            <span>
              <strong>Tema</strong>
              <small>Escolha entre seguir o dispositivo, claro ou escuro.</small>
            </span>
            <div className="segmented setting-segmented" aria-label="Tema">
              {themeOptions.map(({ value, label, icon: Icon }) => (
                <button
                  aria-pressed={form.theme === value}
                  className={form.theme === value ? 'active' : undefined}
                  key={value}
                  onClick={() => setForm((current) => ({ ...current, theme: value }))}
                  type="button"
                >
                  <Icon size={16} /> {label}
                </button>
              ))}
            </div>
          </div>

          <label className="setting-row">
            <span>
              <strong>Fuso horário</strong>
              <small>Usado para datas de publicação, notificações e relatórios.</small>
            </span>
            <select value={form.timezone} onChange={(event) => setForm((current) => ({ ...current, timezone: event.target.value }))}>
              <option value="America/Sao_Paulo">Brasília</option>
              <option value="UTC">UTC</option>
              <option value="America/New_York">Nova York</option>
              <option value="Europe/Lisbon">Lisboa</option>
            </select>
          </label>

          <label className="setting-row">
            <span>
              <strong>Formato de data</strong>
              <small>Controla a preferência visual para datas do ARGOS.</small>
            </span>
            <select value={form.dateFormat} onChange={(event) => setForm((current) => ({ ...current, dateFormat: event.target.value as DateFormat }))}>
              <option value="dd/MM/yyyy">25/08/2026</option>
              <option value="MM/dd/yyyy">08/25/2026</option>
              <option value="yyyy-MM-dd">2026-08-25</option>
            </select>
          </label>

          <label className="toggle-row">
            <span>
              <strong>Modo compacto</strong>
              <small>Reduz espaçamentos para quem usa o sistema muitas vezes ao dia.</small>
            </span>
            <input checked={form.compactMode} onChange={(event) => setForm((current) => ({ ...current, compactMode: event.target.checked }))} type="checkbox" />
          </label>

          <label className="toggle-row">
            <span>
              <strong>Alto contraste</strong>
              <small>Aumenta contraste de bordas e controles para leitura mais firme.</small>
            </span>
            <input checked={form.highContrast} onChange={(event) => setForm((current) => ({ ...current, highContrast: event.target.checked }))} type="checkbox" />
          </label>
        </div>
      </section>

      <section className="panel settings-section">
        <div className="section-title">
          <Bell size={20} />
          <div>
            <h2>Notificações</h2>
            <p>Controle como o ARGOS avisa sobre reivindicações, pistas públicas e atualizações.</p>
          </div>
        </div>

        <div className="settings-list">
          <label className="toggle-row">
            <span>
              <strong><Smartphone size={16} /> Alertas no app</strong>
              <small>Mostra avisos dentro do ARGOS enquanto você acompanha os itens.</small>
            </span>
            <input
              checked={form.notificationPreferences.inAppEnabled}
              onChange={(event) => updateNotification('inAppEnabled', event.target.checked)}
              type="checkbox"
            />
          </label>

          <label className="toggle-row">
            <span>
              <strong><Mail size={16} /> E-mail</strong>
              <small>Permite avisos importantes no e-mail cadastrado.</small>
            </span>
            <input
              checked={form.notificationPreferences.emailEnabled}
              onChange={(event) => updateNotification('emailEnabled', event.target.checked)}
              type="checkbox"
            />
          </label>

          <label className="toggle-row">
            <span>
              <strong><CalendarDays size={16} /> Resumo diário</strong>
              <small>Agrupa movimentos recentes em um único resumo.</small>
            </span>
            <input
              checked={form.notificationPreferences.digestEnabled}
              onChange={(event) => updateNotification('digestEnabled', event.target.checked)}
              type="checkbox"
            />
          </label>

          <div className="settings-note">
            <Eye size={18} />
            <p>Preferências de privacidade e dados sensíveis continuam concentradas no resumo de privacidade do sistema.</p>
          </div>
        </div>
      </section>

      <div className="settings-actions">
        <button className="primary" disabled={saving}>
          <Save size={18} /> {saving ? 'Salvando...' : 'Salvar configurações'}
        </button>
        {message && <p className={`message ${messageType}`}>{message}</p>}
      </div>
    </form>
  )
}
