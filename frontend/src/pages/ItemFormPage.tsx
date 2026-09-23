import { ArrowLeft } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, apiAssetUrl, apiError } from '../services/api'
import type { Item } from '../types/api'
import { validatePublicTextSafety } from '../utils/safety'

type FieldErrors = Partial<Record<keyof typeof initialForm | 'file', string>>

function localIsoDate(date = new Date()) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 10)
}

function operationKey() {
  // getRandomValues funciona também fora de contexto seguro (acesso pela rede local via http).
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return `web-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

const initialForm = {
  type: 'lost',
  title: '',
  description: '',
  category: '',
  location: '',
  campusBlock: '',
  approximatePlace: '',
  eventDate: localIsoDate(),
  contactPreference: 'in_app',
}

const categories = [
  'Documentos',
  'Chaves',
  'Eletrônicos',
  'Bolsas e mochilas',
  'Vestuário',
  'Materiais escolares',
  'Outros',
]

const allowedImageTypes = ['image/jpeg', 'image/png', 'image/webp']
// Espelha o MAX_UPLOAD_MB padrão do backend; o servidor continua sendo a validação definitiva.
const maxImageBytes = 5 * 1024 * 1024

const publicFields: Array<keyof typeof initialForm> = ['title', 'description', 'location', 'campusBlock', 'approximatePlace']

function validateFile(file: File | null) {
  if (!file) return undefined
  if (!allowedImageTypes.includes(file.type)) return 'Use uma imagem JPEG, PNG ou WebP.'
  if (file.size > maxImageBytes) return 'A foto deve ter no máximo 5 MB.'
  return undefined
}

function validateForm(form: typeof initialForm) {
  const errors: FieldErrors = {}

  if (form.title.trim().length < 3) errors.title = 'Informe um título com pelo menos 3 caracteres.'
  if (form.category.trim().length < 2) errors.category = 'Informe uma categoria.'
  if (form.location.trim().length < 2) errors.location = 'Informe o local.'
  if (form.description.trim().length < 10) errors.description = 'A descrição precisa ter pelo menos 10 caracteres.'
  if (!form.eventDate) errors.eventDate = 'Informe a data em que o item foi perdido ou encontrado.'
  else if (form.eventDate > localIsoDate()) errors.eventDate = 'A data do ocorrido não pode ser futura.'

  publicFields.forEach((field) => {
    if (errors[field]) return
    const safetyMessage = validatePublicTextSafety(form[field])
    if (safetyMessage) errors[field] = safetyMessage
  })

  return errors
}

function formFromItem(item: Item): typeof initialForm {
  return {
    type: item.type,
    title: item.title,
    description: item.description,
    category: item.category,
    location: item.location,
    campusBlock: item.campus_block ?? '',
    approximatePlace: item.approximate_place ?? '',
    eventDate: item.event_date,
    contactPreference: item.contact_preference ?? 'in_app',
  }
}

export function ItemFormPage() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const [message, setMessage] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [form, setForm] = useState(initialForm)
  const [currentImageUrl, setCurrentImageUrl] = useState('')
  const [removeImage, setRemoveImage] = useState(false)
  const [loading, setLoading] = useState(isEdit)
  const [loadError, setLoadError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const createKey = useRef(operationKey())
  const uploaded = useRef<{ file: File; url: string } | null>(null)

  useEffect(() => {
    if (!id) return
    let active = true
    setLoading(true)
    setLoadError('')
    api
      .get(`/items/${id}`)
      .then((response) => {
        if (!active) return
        if (!response.data.capabilities?.edit) {
          setLoadError('Você não tem permissão para editar este item.')
          return
        }
        const item = response.data.item as Item
        setForm(formFromItem(item))
        setCurrentImageUrl(item.image_url ?? '')
      })
      .catch((requestError) => {
        if (active) setLoadError(apiError(requestError))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [id])

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

  function selectFile(nextFile: File | null) {
    setFile(nextFile)
    setFieldErrors((current) => ({ ...current, file: validateFile(nextFile) }))
    if (nextFile) setRemoveImage(false)
  }

  async function uploadSelectedFile() {
    if (!file) return null
    // Reaproveita o upload se a publicação falhar e o usuário tentar de novo com a mesma foto.
    if (uploaded.current?.file === file) return uploaded.current.url
    const payload = new FormData()
    payload.append('file', file)
    const upload = await api.post('/uploads', payload)
    uploaded.current = { file, url: upload.data.url }
    return upload.data.url as string
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (submitting) return
    setMessage('')

    const nextErrors = validateForm(form)
    const fileError = validateFile(file)
    if (fileError) nextErrors.file = fileError
    setFieldErrors(nextErrors)
    if (Object.keys(nextErrors).length) {
      setMessage('Revise os campos destacados.')
      return
    }

    setSubmitting(true)
    try {
      const newImageUrl = await uploadSelectedFile()
      if (isEdit) {
        const { type: _type, ...editable } = form
        const imageUrl = newImageUrl ?? (removeImage ? '' : currentImageUrl)
        await api.patch(`/items/${id}`, { ...editable, imageUrl })
        navigate(`/items/${id}`, { state: { flash: 'Item atualizado.' } })
      } else {
        const response = await api.post('/items', { ...form, imageUrl: newImageUrl ?? '' }, { headers: { 'Idempotency-Key': createKey.current } })
        navigate(`/items/${response.data.id}`, { state: { flash: 'Item publicado.' } })
      }
    } catch (error) {
      setMessage(apiError(error))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <p className="loading" role="status">Carregando item...</p>

  if (loadError) {
    return (
      <section className="stack">
        <Link className="ghost light fit" to={id ? `/items/${id}` : '/items'}><ArrowLeft size={18} /> Voltar</Link>
        <p className="message error" role="alert">{loadError}</p>
      </section>
    )
  }

  const categoryOptions = form.category && !categories.includes(form.category) ? [form.category, ...categories] : categories
  const existingImage = isEdit && currentImageUrl && !file && !removeImage ? apiAssetUrl(currentImageUrl) : ''

  return (
    <form className="panel form-grid" onSubmit={submit} noValidate aria-busy={submitting}>
      <h2>{isEdit ? 'Editar item' : 'Publicar item'}</h2>
      <label>
        <span>Tipo</span>
        <select value={form.type} onChange={(e) => updateForm('type', e.target.value)} disabled={isEdit}>
          <option value="lost">Perdido</option>
          <option value="found">Encontrado</option>
        </select>
        {isEdit && <small className="privacy-note">O tipo não pode ser alterado após a publicação.</small>}
      </label>
      <label>
        <span>Título</span>
        <input value={form.title} maxLength={120} onChange={(e) => updateForm('title', e.target.value)} aria-invalid={Boolean(fieldErrors.title)} />
        {fieldErrors.title && <small className="field-error">{fieldErrors.title}</small>}
      </label>
      <label>
        <span>Categoria</span>
        <select value={form.category} onChange={(e) => updateForm('category', e.target.value)} aria-invalid={Boolean(fieldErrors.category)}>
          <option value="">Selecione</option>
          {categoryOptions.map((category) => <option value={category} key={category}>{category}</option>)}
        </select>
        {fieldErrors.category && <small className="field-error">{fieldErrors.category}</small>}
      </label>
      <label>
        <span>Campus ou local</span>
        <input value={form.location} maxLength={120} onChange={(e) => updateForm('location', e.target.value)} aria-invalid={Boolean(fieldErrors.location)} />
        {fieldErrors.location && <small className="field-error">{fieldErrors.location}</small>}
      </label>
      <label>
        <span>Bloco, sala ou setor</span>
        <input value={form.campusBlock} maxLength={60} onChange={(e) => updateForm('campusBlock', e.target.value)} aria-invalid={Boolean(fieldErrors.campusBlock)} />
        {fieldErrors.campusBlock && <small className="field-error">{fieldErrors.campusBlock}</small>}
      </label>
      <label>
        <span>Ponto aproximado</span>
        <input value={form.approximatePlace} maxLength={160} onChange={(e) => updateForm('approximatePlace', e.target.value)} aria-invalid={Boolean(fieldErrors.approximatePlace)} />
        {fieldErrors.approximatePlace && <small className="field-error">{fieldErrors.approximatePlace}</small>}
      </label>
      <label>
        <span>Data do ocorrido</span>
        <input
          type="date"
          max={localIsoDate()}
          value={form.eventDate}
          onChange={(e) => updateForm('eventDate', e.target.value)}
          aria-invalid={Boolean(fieldErrors.eventDate)}
        />
        {fieldErrors.eventDate && <small className="field-error">{fieldErrors.eventDate}</small>}
      </label>
      <label>
        <span>Preferência de contato</span>
        <select value={form.contactPreference} onChange={(e) => updateForm('contactPreference', e.target.value)}>
          <option value="in_app">Contato pelo app</option>
          <option value="email">E-mail autorizado</option>
        </select>
      </label>
      <label className="file-field">
        <span>{isEdit && currentImageUrl ? 'Substituir foto do item' : 'Foto do item'}</span>
        <input
          type="file"
          accept={allowedImageTypes.join(',')}
          onChange={(e) => selectFile(e.target.files?.[0] ?? null)}
          aria-invalid={Boolean(fieldErrors.file)}
          aria-describedby="item-photo-hint"
        />
        <small id="item-photo-hint" className="privacy-note">JPEG, PNG ou WebP com até 5 MB.</small>
        {fieldErrors.file && <small className="field-error">{fieldErrors.file}</small>}
      </label>
      {previewUrl && <img className="preview-image" src={previewUrl} alt="Prévia da foto do item" />}
      {existingImage && <img className="preview-image" src={existingImage} alt="Foto atual do item" />}
      {isEdit && currentImageUrl && !file && (
        <label className="check-row">
          <input type="checkbox" checked={removeImage} onChange={(e) => setRemoveImage(e.target.checked)} />
          <span>Remover a foto atual</span>
        </label>
      )}
      <p className="privacy-note">Não inclua telefone, e-mail, documento completo ou provas sensíveis em campos públicos ou fotos.</p>
      <label className="wide-field">
        <span>Descrição detalhada</span>
        <textarea value={form.description} maxLength={2000} onChange={(e) => updateForm('description', e.target.value)} aria-invalid={Boolean(fieldErrors.description)} />
        {fieldErrors.description && <small className="field-error">{fieldErrors.description}</small>}
      </label>
      <button className="primary" disabled={submitting}>
        {submitting ? 'Salvando...' : isEdit ? 'Salvar alterações' : 'Publicar item'}
      </button>
      {isEdit && <Link className="ghost light fit" to={`/items/${id}`}>Cancelar</Link>}
      {message && <p className="message error" role="alert">{message}</p>}
    </form>
  )
}
