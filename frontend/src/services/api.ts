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
  body: msg('Pista'),
  reason: msg('Motivo'),
  latitude: msg('Local no mapa'),
  longitude: msg('Local no mapa'),
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
  return Boolean(
    url &&
      [
        '/auth/login',
        '/auth/register',
        '/auth/refresh',
        '/auth/logout',
        '/auth/forgot-password',
        '/auth/reset-password',
        '/auth/google',
        '/auth/verify-email',
        '/auth/resend-verification',
      ].some((path) => url.endsWith(path)),
  )
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

// Mensagens de validação do servidor com número (backend/src/utils/validation-messages.ts): traduzidas por padrão.
const numericValidationMessages: Array<[RegExp, string]> = [
  [/^Use pelo menos (\d+) caracteres\.$/, msg('Use pelo menos {count} caracteres.')],
  [/^Use no máximo (\d+) caracteres\.$/, msg('Use no máximo {count} caracteres.')],
  [/^Selecione pelo menos (\d+) itens\.$/, msg('Selecione pelo menos {count} itens.')],
  [/^Selecione no máximo (\d+) itens\.$/, msg('Selecione no máximo {count} itens.')],
  [/^O valor mínimo é (-?[\d.]+)\.$/, msg('O valor mínimo é {count}.')],
  [/^O valor máximo é (-?[\d.]+)\.$/, msg('O valor máximo é {count}.')],
  [/^Use um valor maior que (-?[\d.]+)\.$/, msg('Use um valor maior que {count}.')],
  [/^Use um valor menor que (-?[\d.]+)\.$/, msg('Use um valor menor que {count}.')],
]

function translateValidation(message: string) {
  for (const [pattern, template] of numericValidationMessages) {
    const match = pattern.exec(message)
    if (match) return t(template, { count: match[1] })
  }
  return t(message)
}

function validationMessage(errors?: ApiValidationErrors) {
  const fieldErrors = errors?.fieldErrors ?? {}
  const firstField = Object.entries(fieldErrors).find(([, messages]) => messages?.length)
  if (firstField) {
    const [field, messages] = firstField
    return `${fieldLabels[field] ? t(fieldLabels[field]) : field}: ${translateValidation(messages[0])}`
  }

  return errors?.formErrors?.[0] && translateValidation(errors.formErrors[0])
}

/** Erro de servidor com o código da requisição, para a pessoa informar ao suporte sem expor detalhes internos. */
function serverFailure(requestId?: unknown) {
  return typeof requestId === 'string' && /^[\w.:-]{1,128}$/.test(requestId)
    ? t('O ARGOS não conseguiu concluir agora. Tente novamente em instantes. Se continuar, informe o código {code} à administração.', { code: requestId.slice(0, 12) })
    : t('O ARGOS não conseguiu concluir agora. Tente novamente em instantes.')
}

export function apiError(error: unknown) {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    const data = error.response?.data as { errors?: ApiValidationErrors; message?: unknown; requestId?: unknown } | undefined
    const validation = validationMessage(data?.errors)
    if (validation) return validation
    // Fora das rotas de login, 401 significa sessão vencida ou encerrada em outro lugar.
    if (status === 401 && !isAuthEndpoint(error.config?.url)) return t('Sua sessão expirou. Entre novamente para continuar.')
    if (status && status >= 500) return serverFailure(data?.requestId ?? error.response?.headers?.['x-request-id'])
    // Mensagens do servidor chegam em português; as conhecidas são traduzidas pelo dicionário.
    if (typeof data?.message === 'string' && data.message) return t(data.message)
    // Resposta sem corpo JSON (ex.: proxy na frente da API).
    if (status === 413) return t('O arquivo ou o conteúdo enviado é grande demais. Use uma foto de até 5 MB.')
    if (status === 429) return t('Muitas tentativas. Tente novamente em instantes.')
    if (status === 404) return t('Não encontramos o que você procurava. Ele pode ter sido removido.')
    if (status === 403) return t('Sua conta não tem permissão para esta ação.')
    if (status) return t('Não foi possível concluir a ação. Revise os dados e tente novamente.')
    // Sem resposta: rede caiu, servidor fora do ar ou tempo esgotado.
    if (import.meta.env.DEV) {
      return apiBaseUrl.startsWith('/')
        ? t('Erro de comunicação. Verifique se o backend está rodando em http://localhost:3333 e reinicie o Vite para ativar o proxy.')
        : t('Erro de comunicação. Verifique se a API está rodando em {url}.', { url: apiBaseUrl })
    }
    return t('Sem conexão com o ARGOS. Verifique sua internet e tente novamente.')
  }
  return t('Erro inesperado.')
}

/** Código estável enviado pela API em `details.code` (ex.: email_unverified, terms_outdated). */
export function apiErrorCode(error: unknown): string | undefined {
  if (!axios.isAxiosError(error)) return undefined
  const code = error.response?.data?.details?.code
  return typeof code === 'string' ? code : undefined
}

/** Lê o token de um link de e-mail (#token=... nos links novos, ?token=... nos antigos) e o remove da barra de endereço. */
let lastLinkToken: { path: string; token: string } | null = null

export function takeLinkToken() {
  const path = window.location.pathname
  const fromHash = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token')
  const fromQuery = new URLSearchParams(window.location.search).get('token')
  const token = fromHash || fromQuery || ''
  if (token) {
    lastLinkToken = { path, token }
    // Tira o token do histórico do navegador e de qualquer cabeçalho Referer posterior.
    window.history.replaceState(window.history.state, '', path)
    return token
  }
  // O StrictMode monta o componente duas vezes: a segunda leitura reaproveita o token já retirado da URL.
  return lastLinkToken?.path === path ? lastLinkToken.token : ''
}
