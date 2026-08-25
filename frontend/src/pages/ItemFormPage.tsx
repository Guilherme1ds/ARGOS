import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, apiError } from '../services/api'
import { validatePublicTextSafety } from '../utils/safety'

type FieldErrors = Partial<Record<keyof typeof initialForm, string>>

const initialForm = {
  type: 'lost',
  title: '',
  description: '',
  category: '',
  location: '',
  campusBlock: '',
  approximatePlace: '',
  contactPreference: 'in_app',
}

const publicFields: Array<keyof typeof initialForm> = ['title', 'description', 'location', 'campusBlock', 'approximatePlace']

function validateForm(form: typeof initialForm) {
  const errors: FieldErrors = {}

  if (form.title.trim().length < 3) errors.title = 'Informe um título com pelo menos 3 caracteres.'
  if (form.category.trim().length < 2) errors.category = 'Informe uma categoria.'
  if (form.location.trim().length < 2) errors.location = 'Informe o local.'
  if (form.description.trim().length < 10) errors.description = 'A descrição precisa ter pelo menos 10 caracteres.'

  publicFields.forEach((field) => {
    if (errors[field]) return
    const safetyMessage = validatePublicTextSafety(form[field])
    if (safetyMessage) errors[field] = safetyMessage
  })

  return errors
}

export function ItemFormPage() {
  const navigate = useNavigate()
  const [message, setMessage] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [form, setForm] = useState(initialForm)
  const postingDateLabel = new Intl.DateTimeFormat('pt-BR').format(new Date())

  useEffect(() => {
    if (!file) {
      setPreviewUrl('')
      return
    }
    const nextPreview = URL.createObjectURL(file)
    setPreviewUrl(nextPreview)
    return () => URL.revokeObjectURL(nextPreview)
  }, [file])

  function updateForm(field: keyof typeof initialForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }))
    setFieldErrors((current) => ({ ...current, [field]: undefined }))
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setMessage('')

    const nextErrors = validateForm(form)
    setFieldErrors(nextErrors)
    if (Object.keys(nextErrors).length) {
      setMessage('Revise os campos destacados.')
      return
    }

    try {
      let imageUrl = ''
      if (file) {
        const payload = new FormData()
        payload.append('file', file)
        const upload = await api.post('/uploads', payload)
        imageUrl = upload.data.url
      }
      await api.post('/items', { ...form, imageUrl })
      navigate('/')
    } catch (error) {
      setMessage(apiError(error))
    }
  }

  return (
    <form className="panel form-grid" onSubmit={submit}>
      <h2>Publicar item</h2>
      <label>
        <span>Tipo</span>
        <select value={form.type} onChange={(e) => updateForm('type', e.target.value)}>
          <option value="lost">Perdido</option>
          <option value="found">Encontrado</option>
        </select>
      </label>
      <label>
        <span>Título</span>
        <input value={form.title} onChange={(e) => updateForm('title', e.target.value)} aria-invalid={Boolean(fieldErrors.title)} />
        {fieldErrors.title && <small className="field-error">{fieldErrors.title}</small>}
      </label>
      <label>
        <span>Categoria</span>
        <input value={form.category} onChange={(e) => updateForm('category', e.target.value)} aria-invalid={Boolean(fieldErrors.category)} />
        {fieldErrors.category && <small className="field-error">{fieldErrors.category}</small>}
      </label>
      <label>
        <span>Local</span>
        <input value={form.location} onChange={(e) => updateForm('location', e.target.value)} aria-invalid={Boolean(fieldErrors.location)} />
        {fieldErrors.location && <small className="field-error">{fieldErrors.location}</small>}
      </label>
      <label>
        <span>Bloco do campus</span>
        <input value={form.campusBlock} onChange={(e) => updateForm('campusBlock', e.target.value)} />
      </label>
      <label>
        <span>Ponto aproximado</span>
        <input value={form.approximatePlace} onChange={(e) => updateForm('approximatePlace', e.target.value)} />
      </label>
      <div className="readonly-field" aria-label="Data da publicação">
        <span>Data da publicação</span>
        <strong>{postingDateLabel}</strong>
      </div>
      <label>
        <span>Preferência de contato</span>
        <select value={form.contactPreference} onChange={(e) => updateForm('contactPreference', e.target.value)}>
          <option value="in_app">Contato pelo app</option>
          <option value="email">E-mail autorizado</option>
        </select>
      </label>
      <label className="file-field">
        <span>Foto do item</span>
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      {previewUrl && <img className="preview-image" src={previewUrl} alt="Prévia da foto do item" />}
      <p className="privacy-note">Não inclua telefone, e-mail, documento completo ou provas sensíveis em campos públicos ou fotos.</p>
      <label className="wide-field">
        <span>Descrição detalhada</span>
        <textarea value={form.description} onChange={(e) => updateForm('description', e.target.value)} aria-invalid={Boolean(fieldErrors.description)} />
        {fieldErrors.description && <small className="field-error">{fieldErrors.description}</small>}
      </label>
      <button className="primary">Publicar item</button>
      {message && <p className="message error">{message}</p>}
    </form>
  )
}
