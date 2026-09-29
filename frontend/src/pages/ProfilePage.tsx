import { Building2, Camera, Mail, MessageSquare, Phone, Save, UserRound, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useAuth, type UpdateProfilePayload } from '../contexts/AuthContext'
import { api, apiAssetUrl, apiError } from '../services/api'
import { msg, useI18n } from '../i18n'

type ProfileForm = {
  name: string
  nickname: string
  avatarUrl: string
  phone: string
  department: string
  bio: string
  preferredContact: 'in_app' | 'email'
}

const roleLabels: Record<string, string> = {
  user: msg('Usuário'),
  citizen: msg('Cidadão'),
  space_manager: msg('Gestor de espaço'),
  org_admin: msg('Gestor da organização'),
  support: msg('Suporte'),
  admin: msg('Administrador'),
}

const statusLabels: Record<string, string> = {
  pending: msg('Pendente'),
  active: msg('Ativo'),
  blocked: msg('Bloqueado'),
}

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || 'U'
  )
}

export function ProfilePage() {
  const { user, updateProfile } = useAuth()
  const { t } = useI18n()
  const [form, setForm] = useState<ProfileForm>({
    name: '',
    nickname: '',
    avatarUrl: '',
    phone: '',
    department: '',
    bio: '',
    preferredContact: 'in_app',
  })
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!user) return
    setForm({
      name: user.name,
      nickname: user.nickname ?? '',
      avatarUrl: user.avatarUrl ?? '',
      phone: user.phone ?? '',
      department: user.department ?? '',
      bio: user.bio ?? '',
      preferredContact: user.preferredContact ?? 'in_app',
    })
  }, [user])

  useEffect(() => {
    if (!file) {
      setPreviewUrl('')
      return
    }

    const nextPreview = URL.createObjectURL(file)
    setPreviewUrl(nextPreview)
    return () => URL.revokeObjectURL(nextPreview)
  }, [file])

  function updateField<Key extends keyof ProfileForm>(field: Key, value: ProfileForm[Key]) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setMessage('')
    setSaving(true)

    try {
      let avatarUrl = form.avatarUrl
      if (file) {
        const payload = new FormData()
        payload.append('file', file)
        const upload = await api.post('/uploads', payload)
        avatarUrl = upload.data.url
      }

      const payload: UpdateProfilePayload = {
        name: form.name,
        nickname: form.nickname,
        avatarUrl,
        phone: form.phone,
        department: form.department,
        bio: form.bio,
        preferredContact: form.preferredContact,
      }

      await updateProfile(payload)
      setFile(null)
      setMessageType('success')
      setMessage(t('Perfil atualizado com sucesso.'))
    } catch (error) {
      setMessageType('error')
      setMessage(apiError(error))
    } finally {
      setSaving(false)
    }
  }

  if (!user) return null

  const avatarImage = previewUrl || apiAssetUrl(form.avatarUrl)

  return (
    <section className="profile-layout">
      <aside className="panel profile-summary">
        <div className="profile-avatar large">
          {avatarImage ? <img src={avatarImage} alt={t('Foto de {name}', { name: form.name })} /> : <span>{initials(form.name)}</span>}
        </div>
        <div>
          <h2>{form.name}</h2>
          <strong className="profile-handle">@{form.nickname || user.nickname || t('usuario')}</strong>
          <p>{form.bio || t('Complete sua bio para ajudar a equipe a reconhecer seu perfil.')}</p>
        </div>
        <div className="profile-facts">
          <span><Mail size={16} /> {user.email}</span>
          <span><UserRound size={16} /> {roleLabels[user.role] ? t(roleLabels[user.role]) : user.role}</span>
          <span><MessageSquare size={16} /> {statusLabels[user.status] ? t(statusLabels[user.status]) : user.status}</span>
          {form.phone && <span><Phone size={16} /> {form.phone}</span>}
          {form.department && <span><Building2 size={16} /> {form.department}</span>}
        </div>
      </aside>

      <form className="panel form-grid profile-form" onSubmit={submit}>
        <h2>{t('Perfil')}</h2>
        <div className="wide-field avatar-uploader">
          <span className="field-label">{t('Foto do perfil')}</span>
          <div className="avatar-edit-row">
            <div className="profile-avatar">
              {avatarImage ? <img src={avatarImage} alt={t('Prévia da foto do perfil')} /> : <span>{initials(form.name)}</span>}
            </div>
            <div className="avatar-actions">
              <input type="file" aria-label={t('Foto do perfil')} accept="image/png,image/jpeg,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
              {(form.avatarUrl || file) && (
                <button
                  className="ghost light fit"
                  type="button"
                  onClick={() => {
                    setFile(null)
                    updateField('avatarUrl', '')
                  }}
                >
                  <X size={18} /> {t('Remover foto')}
                </button>
              )}
            </div>
          </div>
        </div>

        <label>
          <span>{t('Nome')}</span>
          <input value={form.name} onChange={(event) => updateField('name', event.target.value)} />
        </label>
        <label>
          <span>{t('Nickname')}</span>
          <input
            value={form.nickname}
            onChange={(event) => updateField('nickname', event.target.value.toLowerCase())}
            placeholder="seu.nick"
          />
        </label>
        <label>
          <span>{t('E-mail')}</span>
          <input value={user.email} disabled />
        </label>
        <label>
          <span>{t('Telefone')}</span>
          <input value={form.phone} onChange={(event) => updateField('phone', event.target.value)} placeholder="(00) 00000-0000" />
        </label>
        <label>
          <span>{t('Setor, turma ou unidade')}</span>
          <input value={form.department} onChange={(event) => updateField('department', event.target.value)} />
        </label>
        <label>
          <span>{t('Contato preferido')}</span>
          <select value={form.preferredContact} onChange={(event) => updateField('preferredContact', event.target.value as ProfileForm['preferredContact'])}>
            <option value="in_app">{t('Contato pelo app')}</option>
            <option value="email">{t('E-mail cadastrado')}</option>
          </select>
        </label>
        <label className="wide-field">
          <span>{t('Bio curta')}</span>
          <textarea value={form.bio} maxLength={300} onChange={(event) => updateField('bio', event.target.value)} />
        </label>
        <button className="primary" disabled={saving}>
          <Save size={18} /> {saving ? t('Salvando...') : t('Salvar perfil')}
        </button>
        {message && <p className={`message ${messageType}`}>{message}</p>}
        <p className="privacy-note wide-field">
          {t('Sua foto e seus dados de contato ajudam a acelerar devoluções, mas evite incluir documentos, senhas ou dados sensíveis na bio.')}
        </p>
      </form>
    </section>
  )
}
