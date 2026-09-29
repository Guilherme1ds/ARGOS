import { Bell, CalendarDays, Eye, Languages, Mail, Moon, Monitor, Save, Smartphone, Sun, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { PasswordSettings, PrivacySettings, PushSettings } from '../components/AccountSettings'
import { useAuth } from '../contexts/AuthContext'
import { apiError } from '../services/api'
import type { AppLanguage, AppTheme, DateFormat, NotificationPreferences } from '../types/api'
import { msg, useI18n } from '../i18n'

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
  { value: 'system', label: msg('Sistema'), icon: Monitor },
  { value: 'light', label: msg('Claro'), icon: Sun },
  { value: 'dark', label: msg('Escuro'), icon: Moon },
]

export function SettingsPage() {
  const { user, updateProfile } = useAuth()
  const { t } = useI18n()
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
      setMessage(t('Configurações salvas com sucesso.'))
    } catch (error) {
      setMessageType('error')
      setMessage(apiError(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="stack">
      <form className="stack settings-form" onSubmit={submit}>
        <section className="panel settings-section">
          <div className="section-title">
            <Languages size={20} />
            <div>
              <h2>{t('Preferências')}</h2>
              <p>{t('Idioma, aparência e leitura do sistema.')}</p>
            </div>
          </div>

          <div className="settings-list">
            <label className="setting-row">
              <span>
                <strong>{t('Idioma')}</strong>
                <small>{t('Idioma da interface do ARGOS. Também pode ser trocado no menu lateral.')}</small>
              </span>
              <select value={form.language} onChange={(event) => setForm((current) => ({ ...current, language: event.target.value as AppLanguage }))}>
                <option value="pt-BR">Português</option>
                <option value="en-US">English</option>
                <option value="es-ES">Español</option>
              </select>
            </label>

            <div className="setting-row">
              <span>
                <strong>{t('Tema')}</strong>
                <small>{t('Escolha entre seguir o dispositivo, claro ou escuro.')}</small>
              </span>
              <div className="segmented setting-segmented" aria-label={t('Tema')}>
                {themeOptions.map(({ value, label, icon: Icon }) => (
                  <button
                    aria-pressed={form.theme === value}
                    className={form.theme === value ? 'active' : undefined}
                    key={value}
                    onClick={() => setForm((current) => ({ ...current, theme: value }))}
                    type="button"
                  >
                    <Icon size={16} /> {t(label)}
                  </button>
                ))}
              </div>
            </div>

            <label className="setting-row">
              <span>
                <strong>{t('Fuso horário')}</strong>
                <small>{t('Usado para datas de publicação, notificações e relatórios.')}</small>
              </span>
              <select value={form.timezone} onChange={(event) => setForm((current) => ({ ...current, timezone: event.target.value }))}>
                <option value="America/Sao_Paulo">{t('Brasília')}</option>
                <option value="UTC">UTC</option>
                <option value="America/New_York">{t('Nova York')}</option>
                <option value="Europe/Lisbon">{t('Lisboa')}</option>
              </select>
            </label>

            <label className="setting-row">
              <span>
                <strong>{t('Formato de data')}</strong>
                <small>{t('Controla a preferência visual para datas do ARGOS.')}</small>
              </span>
              <select value={form.dateFormat} onChange={(event) => setForm((current) => ({ ...current, dateFormat: event.target.value as DateFormat }))}>
                <option value="dd/MM/yyyy">25/08/2026</option>
                <option value="MM/dd/yyyy">08/25/2026</option>
                <option value="yyyy-MM-dd">2026-08-25</option>
              </select>
            </label>

            <label className="toggle-row">
              <span>
                <strong>{t('Modo compacto')}</strong>
                <small>{t('Reduz espaçamentos para quem usa o sistema muitas vezes ao dia.')}</small>
              </span>
              <input checked={form.compactMode} onChange={(event) => setForm((current) => ({ ...current, compactMode: event.target.checked }))} type="checkbox" />
            </label>

            <label className="toggle-row">
              <span>
                <strong>{t('Alto contraste')}</strong>
                <small>{t('Aumenta contraste de bordas e controles para leitura mais firme.')}</small>
              </span>
              <input checked={form.highContrast} onChange={(event) => setForm((current) => ({ ...current, highContrast: event.target.checked }))} type="checkbox" />
            </label>
          </div>
        </section>

        <section className="panel settings-section">
          <div className="section-title">
            <Bell size={20} />
            <div>
              <h2>{t('Notificações')}</h2>
              <p>{t('Controle como o ARGOS avisa sobre reivindicações, pistas públicas e atualizações.')}</p>
            </div>
          </div>

          <div className="settings-list">
            <label className="toggle-row">
              <span>
                <strong><Smartphone size={16} /> {t('Alertas no app')}</strong>
                <small>{t('Mostra avisos dentro do ARGOS enquanto você acompanha os itens.')}</small>
              </span>
              <input
                checked={form.notificationPreferences.inAppEnabled}
                onChange={(event) => updateNotification('inAppEnabled', event.target.checked)}
                type="checkbox"
              />
            </label>

            <label className="toggle-row">
              <span>
                <strong><Mail size={16} /> {t('E-mail')}</strong>
                <small>{t('Envia por e-mail, na hora, reivindicações, aprovações e remoções de casos.')}</small>
              </span>
              <input
                checked={form.notificationPreferences.emailEnabled}
                onChange={(event) => updateNotification('emailEnabled', event.target.checked)}
                type="checkbox"
              />
            </label>

            <label className="toggle-row">
              <span>
                <strong><CalendarDays size={16} /> {t('Resumo diário')}</strong>
                <small>{t('Troca os e-mails imediatos por um único resumo diário das novidades.')}</small>
              </span>
              <input
                checked={form.notificationPreferences.digestEnabled}
                onChange={(event) => updateNotification('digestEnabled', event.target.checked)}
                type="checkbox"
              />
            </label>

            <div className="settings-note">
              <Eye size={18} />
              <p>{t('Preferências de privacidade e dados sensíveis continuam concentradas no resumo de privacidade do sistema.')}</p>
            </div>
          </div>
        </section>

        <div className="settings-actions">
          <button className="primary" disabled={saving}>
            <Save size={18} /> {saving ? t('Salvando...') : t('Salvar configurações')}
          </button>
          {message && <p className={`message ${messageType}`}>{message}</p>}
        </div>
      </form>
      <PushSettings />
      <PasswordSettings />
      <PrivacySettings />
    </div>
  )
}
