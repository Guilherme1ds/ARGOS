import axios, { type InternalAxiosRequestConfig } from 'axios'
import { msg, t } from '../i18n'
import type { User } from '../types/api'

const apiBaseUrl = import.meta.env.VITE_API_URL ?? '/api'
const apiPublicUrl = import.meta.env.VITE_API_PUBLIC_URL ?? apiBaseUrl.replace(/\/api(?:\/v1)?\/?$/, '')

let accessToken: string | null = null
type SessionPayload = { token: string; user: User }
/** expired: o servidor recusou a sessão; unavailable: falha transitória (rede, 429, 5xx) que não deve deslogar. */
export type RefreshResult = { status: 'ok'; session: SessionPayload } | { status: 'expired' } | { status: 'unavailable' }
let refreshPromise: Promise<RefreshResult> | null = null
let unauthorizedHandler: (() => void) | null = null

type RetriableRequestConfig = InternalAxiosRequestConfig & { _retry?: boolean }
type ApiValidationErrors = {
  formErrors?: string[]
  fieldErrors?: Record<string, string[]>
}

const fieldLabels: Record<string, string> = {
  name: msg('Nome'),
  nickname: msg('Nickname'),
  email: msg('E-mail'),
  password: msg('Senha'),
  type: msg('Tipo'),
  title: msg('Título'),
  description: msg('Descrição'),
  category: msg('Categoria'),
  location: msg('Local'),
  campusBlock: msg('Bloco do campus'),
  approximatePlace: msg('Ponto aproximado'),
  eventDate: msg('Data'),
  imageUrl: msg('Imagem'),
  contactPreference: msg('Preferência de contato'),
  message: msg('Mensagem'),
  proofDetails: msg('Provas'),
  privacyTermsAccepted: msg('Privacidade'),
  avatarUrl: msg('Foto'),
  phone: msg('Telefone'),
  department: msg('Setor ou turma'),
  bio: msg('Bio'),
  preferredContact: msg('Contato preferido'),
  language: msg('Idioma'),
  theme: msg('Tema'),
  timezone: msg('Fuso horário'),
  dateFormat: msg('Formato de data'),
  compactMode: msg('Modo compacto'),
  highContrast: msg('Alto contraste'),
  notificationPreferences: msg('Notificações'),
  currentPassword: msg('Senha atual'),
  newPassword: msg('Nova senha'),
  token: msg('Link'),
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
  return Boolean(url && ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout', '/auth/forgot-password', '/auth/reset-password', '/auth/google'].some((path) => url.endsWith(path)))
}

async function requestRefresh() {
  try {
    return await api.post<SessionPayload>('/auth/refresh')
  } catch (error) {
    // 409: outra aba ou requisição acabou de rotacionar o cookie; o navegador já recebeu o novo.
    if (!axios.isAxiosError(error) || error.response?.status !== 409) throw error
    await new Promise((resolve) => setTimeout(resolve, 300))
    return api.post<SessionPayload>('/auth/refresh')
  }
}

/** Renova a sessão uma única vez por vez, compartilhando o resultado entre chamadas concorrentes. */
export function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = requestRefresh()
      .then((response): RefreshResult => {
        setAccessToken(response.data.token)
        return { status: 'ok', session: response.data }
      })
      .catch((error): RefreshResult => {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined
        if (status === 401 || status === 403) {
          setAccessToken(null)
          return { status: 'expired' }
        }
        return { status: 'unavailable' }
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
      const result = await refreshSession()
      if (result.status === 'ok') {
        original.headers.Authorization = `Bearer ${result.session.token}`
        return api(original)
      }
      // Falha transitória: mantém a sessão local e deixa a próxima ação tentar renovar de novo.
      if (result.status === 'unavailable') return Promise.reject(error)
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
    return `${fieldLabels[field] ? t(fieldLabels[field]) : field}: ${t(messages[0])}`
  }

  return errors?.formErrors?.[0] && t(errors.formErrors[0])
}

export function apiError(error: unknown) {
  if (axios.isAxiosError(error)) {
    const validation = validationMessage(error.response?.data?.errors)
    if (validation) return validation
    // Mensagens do servidor chegam em português; as conhecidas são traduzidas pelo dicionário.
    if (error.response?.data?.message) return t(error.response.data.message)
    return apiBaseUrl.startsWith('/')
      ? t('Erro de comunicação. Verifique se o backend está rodando em http://localhost:3333 e reinicie o Vite para ativar o proxy.')
      : t('Erro de comunicação. Verifique se a API está rodando em {url}.', { url: apiBaseUrl })
  }
  return t('Erro inesperado.')
}
