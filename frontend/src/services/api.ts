import axios, { type InternalAxiosRequestConfig } from 'axios'

const apiBaseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3333/api'
const apiPublicUrl =
  import.meta.env.VITE_API_PUBLIC_URL ?? apiBaseUrl.replace(/\/api(?:\/v1)?\/?$/, '') ?? 'http://localhost:3333'

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
  if (/^https?:\/\//i.test(url)) return url
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
    return `Erro de comunicação. Verifique se a API está rodando em ${apiBaseUrl}.`
  }
  return 'Erro inesperado.'
}
