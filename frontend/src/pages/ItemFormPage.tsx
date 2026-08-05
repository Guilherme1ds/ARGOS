import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, apiError } from '../services/api'

export function ItemFormPage() {
  const navigate = useNavigate()
  const [message, setMessage] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [form, setForm] = useState({
    type: 'lost',
    title: '',
    description: '',
    category: '',
    location: '',
    campusBlock: '',
    approximatePlace: '',
    eventDate: new Date().toISOString().slice(0, 10),
    contactPreference: 'in_app',
  })

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setMessage('')
    try {
      let imageUrl = ''
      if (file) {
        const payload = new FormData()
        payload.append('file', file)
        const upload = await api.post('/uploads', payload)
        imageUrl = upload.data.url
      }
      await api.post('/items', { ...form, imageUrl })
      navigate('/my-items')
    } catch (error) {
      setMessage(apiError(error))
    }
  }

  return (
    <form className="panel form-grid" onSubmit={submit}>
      <h2>Publicar item</h2>
      <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="lost">Perdido</option><option value="found">Encontrado</option></select>
      <input placeholder="Título" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      <input placeholder="Categoria" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
      <input placeholder="Local" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
      <input placeholder="Bloco do campus" value={form.campusBlock} onChange={(e) => setForm({ ...form, campusBlock: e.target.value })} />
      <input placeholder="Ponto aproximado" value={form.approximatePlace} onChange={(e) => setForm({ ...form, approximatePlace: e.target.value })} />
      <input type="date" value={form.eventDate} onChange={(e) => setForm({ ...form, eventDate: e.target.value })} />
      <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <textarea placeholder="Descrição detalhada" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      <button className="primary">Enviar para aprovação</button>
      {message && <p className="message">{message}</p>}
    </form>
  )
}
