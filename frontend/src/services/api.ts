import axios, { type InternalAxiosRequestConfig } from 'axios'

const apiBaseUrl = import.meta.env.VITE_API_URL ?? '/api'
const apiPublicUrl = import.meta.env.VITE_API_PUBLIC_URL ?? apiBaseUrl.replace(/\/api(?:\/v1)?\/?$/, '')

let accessToken: string | null = null
let refreshPromise: Promise<string | null> | null = null
let unauthorizedHandler: (() => void) | null = null

type RetriableRequestConfig = InternalAxiosRequestConfig & { _retry?: boolean }
type ApiValidationErrors = {
  formErrors?: string[]
  fieldErrors?: Record<string, string[]>
}

const fieldLabels: Record<string, string> = {
  name: 'Nome',
  nickname: 'Nickname',
  email: 'E-mail',
  password: 'Senha',
  type: 'Tipo',
  title: 'Título',
  description: 'Descrição',
  category: 'Categoria',
  location: 'Local',
  campusBlock: 'Bloco do campus',
  approximatePlace: 'Ponto aproximado',
  eventDate: 'Data',
  imageUrl: 'Imagem',
  contactPreference: 'Preferência de contato',
  message: 'Mensagem',
  proofDetails: 'Provas',
  privacyTermsAccepted: 'Privacidade',
  avatarUrl: 'Foto',
  phone: 'Telefone',
  department: 'Setor ou turma',
  bio: 'Bio',
  preferredContact: 'Contato preferido',
  language: 'Idioma',
  theme: 'Tema',
  timezone: 'Fuso horario',
  dateFormat: 'Formato de data',
  compactMode: 'Modo compacto',
  highContrast: 'Alto contraste',
  notificationPreferences: 'Notificacoes',
}

export const api = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true,
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
})

export function setAccessToken(token: string | null) {
  accessToken = token
}

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler
}

function isAuthEndpoint(url?: string) {
  return Boolean(url && ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout'].some((path) => url.endsWith(path)))
}

async function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = api
      .post('/auth/refresh')
      .then((response) => {
        setAccessToken(response.data.token)
        return response.data.token as string
      })
      .catch(() => {
        setAccessToken(null)
        return null
      })
      .finally(() => {
        refreshPromise = null
      })
  }

  return refreshPromise
}

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`
  if (config.data instanceof FormData) delete config.headers['Content-Type']
  return config
})

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config as RetriableRequestConfig | undefined
    if (error.response?.status === 401 && original && !original._retry && !isAuthEndpoint(original.url)) {
      original._retry = true
      const token = await refreshAccessToken()
      if (token) {
        original.headers.Authorization = `Bearer ${token}`
        return api(original)
      }
    }

    if (error.response?.status === 401) {
      setAccessToken(null)
      unauthorizedHandler?.()
    }
    return Promise.reject(error)
  },
)

export function apiAssetUrl(url?: string | null) {
  if (!url) return ''
  if (/^https?:\/\//i.test(url)) {
    try {
      const asset = new URL(url)
      const apiOrigin = new URL(apiPublicUrl || window.location.origin, window.location.origin).origin
      return asset.origin === apiOrigin && asset.pathname.startsWith('/uploads/') ? asset.toString() : ''
    } catch {
      return ''
    }
  }
  if (!/^\/uploads\/[\w.-]+$/.test(url)) return ''
  return `${apiPublicUrl.replace(/\/$/, '')}${url.startsWith('/') ? url : `/${url}`}`
}

function validationMessage(errors?: ApiValidationErrors) {
  const fieldErrors = errors?.fieldErrors ?? {}
  const firstField = Object.entries(fieldErrors).find(([, messages]) => messages?.length)
  if (firstField) {
    const [field, messages] = firstField
    return `${fieldLabels[field] ?? field}: ${messages[0]}`
  }

  return errors?.formErrors?.[0]
}

export function apiError(error: unknown) {
  if (axios.isAxiosError(error)) {
    const validation = validationMessage(error.response?.data?.errors)
    if (validation) return validation
    if (error.response?.data?.message) return error.response.data.message
    const apiHint = apiBaseUrl.startsWith('/')
      ? 'o backend esta rodando em http://localhost:3333 e reinicie o Vite para ativar o proxy.'
      : `a API esta rodando em ${apiBaseUrl}.`
    return `Erro de comunicacao. Verifique se ${apiHint}`
  }
  return 'Erro inesperado.'
}
