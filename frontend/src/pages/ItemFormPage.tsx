import { ArrowLeft, Crosshair, MapPinOff, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, apiAssetUrl, apiError } from '../services/api'
import type { Item, ItemSuggestion } from '../types/api'
import { validatePublicTextSafety } from '../utils/safety'
import { msg, t as translateNow, useI18n } from '../i18n'
import { MapView } from '../components/MapView'
import { useAppConfig } from '../services/config'

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
  msg('Documentos'),
  msg('Chaves'),
  msg('Eletrônicos'),
  msg('Bolsas e mochilas'),
  msg('Vestuário'),
  msg('Materiais escolares'),
  msg('Outros'),
]

const allowedImageTypes = ['image/jpeg', 'image/png', 'image/webp']
// Espelha o MAX_UPLOAD_MB padrão do backend; o servidor continua sendo a validação definitiva.
const maxImageBytes = 5 * 1024 * 1024

const publicFields: Array<keyof typeof initialForm> = ['title', 'description', 'location', 'campusBlock', 'approximatePlace']

function validateFile(file: File | null) {
  if (!file) return undefined
  if (!allowedImageTypes.includes(file.type)) return translateNow('Use uma imagem JPEG, PNG ou WebP.')
  if (file.size > maxImageBytes) return translateNow('A foto deve ter no máximo 5 MB.')
  return undefined
}

function validateForm(form: typeof initialForm) {
  const errors: FieldErrors = {}

  if (form.title.trim().length < 3) errors.title = translateNow('Informe um título com pelo menos 3 caracteres.')
  if (form.category.trim().length < 2) errors.category = translateNow('Informe uma categoria.')
  if (form.location.trim().length < 2) errors.location = translateNow('Informe o local.')
  if (form.description.trim().length < 10) errors.description = translateNow('A descrição precisa ter pelo menos 10 caracteres.')
  if (!form.eventDate) errors.eventDate = translateNow('Informe a data em que o item foi perdido ou encontrado.')
  else if (form.eventDate > localIsoDate()) errors.eventDate = translateNow('A data do ocorrido não pode ser futura.')

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
  const { t } = useI18n()
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
  const config = useAppConfig()
  const [position, setPosition] = useState<{ latitude: number; longitude: number } | null>(null)
  const [locating, setLocating] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [aiMessage, setAiMessage] = useState('')
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
          setLoadError(t('Você não tem permissão para editar este item.'))
          return
        }
        const item = response.data.item as Item
        setForm(formFromItem(item))
        setPosition(item.latitude != null && item.longitude != null ? { latitude: item.latitude, longitude: item.longitude } : null)
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

  function locateMe() {
    if (!navigator.geolocation) {
      setMessage(t('Este navegador não informa a localização.'))
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (current) => {
        setPosition({ latitude: current.coords.latitude, longitude: current.coords.longitude })
        setLocating(false)
      },
      () => {
        setMessage(t('Não foi possível obter sua localização. Toque no mapa para marcar o local.'))
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    )
  }

  // A IA analisa a foto já enviada (e sanitizada) pelo ARGOS e preenche título, categoria e descrição.
  async function suggestWithAi() {
    if (suggesting) return
    const fileError = validateFile(file)
    if (fileError) {
      setFieldErrors((current) => ({ ...current, file: fileError }))
      return
    }
    setSuggesting(true)
    setAiMessage('')
    setMessage('')
    try {
      const imageUrl = (await uploadSelectedFile()) ?? (removeImage ? '' : currentImageUrl)
      if (!imageUrl) {
        setAiMessage(t('Escolha uma foto do item para receber sugestões.'))
        return
      }
      const response = await api.post<{ suggestion: ItemSuggestion }>('/ai/describe-item', { imageUrl })
      const suggestion = response.data.suggestion
      const features = suggestion.distinctiveFeatures.length ? `\n${t('Detalhes visíveis')}: ${suggestion.distinctiveFeatures.join(', ')}.` : ''
      setForm((current) => ({
        ...current,
        title: suggestion.title,
        category: suggestion.category,
        description: `${suggestion.description}${features}`.slice(0, 2000),
      }))
      setFieldErrors((current) => ({ ...current, title: undefined, category: undefined, description: undefined }))
      setAiMessage(t('Sugestões da IA aplicadas. Revise antes de publicar.'))
    } catch (error) {
      setAiMessage(apiError(error))
    } finally {
      setSuggesting(false)
    }
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
      setMessage(t('Revise os campos destacados.'))
      return
    }

    setSubmitting(true)
    try {
      const newImageUrl = await uploadSelectedFile()
      if (isEdit) {
        const { type: _type, ...editable } = form
        const imageUrl = newImageUrl ?? (removeImage ? '' : currentImageUrl)
        await api.patch(`/items/${id}`, { ...editable, imageUrl, latitude: position?.latitude ?? null, longitude: position?.longitude ?? null })
        navigate(`/items/${id}`, { state: { flash: t('Item atualizado.') } })
      } else {
        const coordinates = position ? { latitude: position.latitude, longitude: position.longitude } : {}
        const response = await api.post('/items', { ...form, ...coordinates, imageUrl: newImageUrl ?? '' }, { headers: { 'Idempotency-Key': createKey.current } })
        navigate(`/items/${response.data.id}`, { state: { flash: t('Item publicado.') } })
      }
    } catch (error) {
      setMessage(apiError(error))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <p className="loading" role="status">{t('Carregando item...')}</p>

  if (loadError) {
    return (
      <section className="stack">
        <Link className="ghost light fit" to={id ? `/items/${id}` : '/items'}><ArrowLeft size={18} /> {t('Voltar')}</Link>
        <p className="message error" role="alert">{loadError}</p>
      </section>
    )
  }

  const categoryOptions = form.category && !categories.includes(form.category) ? [form.category, ...categories] : categories
  const existingImage = isEdit && currentImageUrl && !file && !removeImage ? apiAssetUrl(currentImageUrl) : ''

  return (
    <form className="panel form-grid" onSubmit={submit} noValidate aria-busy={submitting}>
      <h2>{isEdit ? t('Editar item') : t('Publicar item')}</h2>
      <label>
        <span>{t('Tipo')}</span>
        <select value={form.type} onChange={(e) => updateForm('type', e.target.value)} disabled={isEdit}>
          <option value="lost">{t('Perdido')}</option>
          <option value="found">{t('Encontrado')}</option>
        </select>
        {isEdit && <small className="privacy-note">{t('O tipo não pode ser alterado após a publicação.')}</small>}
      </label>
      <label>
        <span>{t('Título')}</span>
        <input value={form.title} maxLength={120} onChange={(e) => updateForm('title', e.target.value)} aria-invalid={Boolean(fieldErrors.title)} />
        {fieldErrors.title && <small className="field-error">{fieldErrors.title}</small>}
      </label>
      <label>
        <span>{t('Categoria')}</span>
        <select value={form.category} onChange={(e) => updateForm('category', e.target.value)} aria-invalid={Boolean(fieldErrors.category)}>
          <option value="">{t('Selecione')}</option>
          {categoryOptions.map((category) => <option value={category} key={category}>{t(category)}</option>)}
        </select>
        {fieldErrors.category && <small className="field-error">{fieldErrors.category}</small>}
      </label>
      <label>
        <span>{t('Campus ou local')}</span>
        <input value={form.location} maxLength={120} onChange={(e) => updateForm('location', e.target.value)} aria-invalid={Boolean(fieldErrors.location)} />
        {fieldErrors.location && <small className="field-error">{fieldErrors.location}</small>}
      </label>
      <label>
        <span>{t('Bloco, sala ou setor')}</span>
        <input value={form.campusBlock} maxLength={60} onChange={(e) => updateForm('campusBlock', e.target.value)} aria-invalid={Boolean(fieldErrors.campusBlock)} />
        {fieldErrors.campusBlock && <small className="field-error">{fieldErrors.campusBlock}</small>}
      </label>
      <label>
        <span>{t('Ponto aproximado')}</span>
        <input value={form.approximatePlace} maxLength={160} onChange={(e) => updateForm('approximatePlace', e.target.value)} aria-invalid={Boolean(fieldErrors.approximatePlace)} />
        {fieldErrors.approximatePlace && <small className="field-error">{fieldErrors.approximatePlace}</small>}
      </label>
      <label>
        <span>{t('Data do ocorrido')}</span>
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
        <span>{t('Preferência de contato')}</span>
        <select value={form.contactPreference} onChange={(e) => updateForm('contactPreference', e.target.value)}>
          <option value="in_app">{t('Contato pelo app')}</option>
          <option value="email">{t('E-mail autorizado')}</option>
        </select>
      </label>
      <label className="file-field">
        <span>{isEdit && currentImageUrl ? t('Substituir foto do item') : t('Foto do item')}</span>
        <input
          type="file"
          accept={allowedImageTypes.join(',')}
          onChange={(e) => selectFile(e.target.files?.[0] ?? null)}
          aria-invalid={Boolean(fieldErrors.file)}
          aria-describedby="item-photo-hint"
        />
        <small id="item-photo-hint" className="privacy-note">{t('JPEG, PNG ou WebP com até 5 MB.')}</small>
        {fieldErrors.file && <small className="field-error">{fieldErrors.file}</small>}
      </label>
      {previewUrl && <img className="preview-image" src={previewUrl} alt={t('Prévia da foto do item')} />}
      {existingImage && <img className="preview-image" src={existingImage} alt={t('Foto atual do item')} />}
      {config?.ai && (file || existingImage) && (
        <div className="ai-suggest wide-field">
          <button className="ghost light fit" type="button" onClick={() => void suggestWithAi()} disabled={suggesting}>
            <Sparkles size={18} /> {suggesting ? t('Analisando a foto...') : t('Sugerir título e descrição com IA')}
          </button>
          {aiMessage && <small className="privacy-note" role="status">{aiMessage}</small>}
        </div>
      )}
      {isEdit && currentImageUrl && !file && (
        <label className="check-row">
          <input type="checkbox" checked={removeImage} onChange={(e) => setRemoveImage(e.target.checked)} />
          <span>{t('Remover a foto atual')}</span>
        </label>
      )}
      <p className="privacy-note">{t('Não inclua telefone, e-mail, documento completo ou provas sensíveis em campos públicos ou fotos.')}</p>
      {config && (
        <div className="map-picker wide-field">
          <span className="field-label">{t('Local no mapa (opcional)')}</span>
          <small className="privacy-note">{t('Toque no mapa para marcar onde o item foi perdido ou encontrado. A posição pública é aproximada.')}</small>
          <MapView
            center={position ? [position.latitude, position.longitude] : config.map.center}
            zoom={config.map.zoom}
            markers={position ? [{ id: 'picked', latitude: position.latitude, longitude: position.longitude, variant: 'picked' }] : []}
            onPick={(latitude, longitude) => setPosition({ latitude, longitude })}
            label={msg('Escolher local no mapa')}
          />
          <div className="map-picker-actions">
            <button className="ghost light fit" type="button" onClick={locateMe} disabled={locating}>
              <Crosshair size={16} /> {locating ? t('Localizando...') : t('Usar minha localização')}
            </button>
            {position && (
              <button className="ghost light fit" type="button" onClick={() => setPosition(null)}>
                <MapPinOff size={16} /> {t('Remover marcação')}
              </button>
            )}
          </div>
        </div>
      )}
      <label className="wide-field">
        <span>{t('Descrição detalhada')}</span>
        <textarea value={form.description} maxLength={2000} onChange={(e) => updateForm('description', e.target.value)} aria-invalid={Boolean(fieldErrors.description)} />
        {fieldErrors.description && <small className="field-error">{fieldErrors.description}</small>}
      </label>
      <button className="primary" disabled={submitting}>
        {submitting ? t('Salvando...') : isEdit ? t('Salvar alterações') : t('Publicar item')}
      </button>
      {isEdit && <Link className="ghost light fit" to={`/items/${id}`}>{t('Cancelar')}</Link>}
      {message && <p className="message error" role="alert">{message}</p>}
    </form>
  )
}
