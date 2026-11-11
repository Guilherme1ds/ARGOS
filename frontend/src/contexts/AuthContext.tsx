import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, refreshSession, setAccessToken, setUnauthorizedHandler } from '../services/api'
import type { AppLanguage, AppTheme, DateFormat, NotificationPreferences, User } from '../types/api'
import { clearAllItemDrafts } from '../utils/itemDraft'

type RegisterPayload = {
  name: string
  email: string
  /** Obrigatória no cadastro comum; a solicitação de acesso institucional não define senha. */
  password?: string
  requestAccess?: boolean
  reason?: string
  privacyTermsAccepted?: boolean
  privacyTermsVersion?: string
  captchaToken?: string
}

export type UpdateProfilePayload = {
  name?: string
  nickname?: string | null
  avatarUrl?: string | null
  phone?: string | null
  department?: string | null
  bio?: string | null
  preferredContact?: 'in_app' | 'email'
  language?: AppLanguage
  theme?: AppTheme
  timezone?: string
  dateFormat?: DateFormat
  compactMode?: boolean
  highContrast?: boolean
  notificationPreferences?: Partial<NotificationPreferences>
}

/** Resultado do cadastro: por senha, a conta só entra depois de confirmar o e-mail. */
export type RegisterResult = { verificationRequired: boolean; message: string }

type AuthContextValue = {
  user: User | null
  checkingSession: boolean
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  loginWithGoogle: (credential: string, privacyTermsAccepted?: boolean) => Promise<void>
  register: (payload: RegisterPayload) => Promise<RegisterResult>
  resendVerification: (email: string) => Promise<string>
  updateProfile: (payload: UpdateProfilePayload) => Promise<User>
  logout: () => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<string>
  deleteAccount: (password: string) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)
const storedThemeKey = 'argos.theme'
const storedDensityKey = 'argos.density'
const storedContrastKey = 'argos.contrast'

function applyAppearance(user: User | null) {
  const root = document.documentElement
  const theme = user?.theme ?? localStorage.getItem(storedThemeKey) ?? 'system'
  const compactMode = user?.compactMode ?? localStorage.getItem(storedDensityKey) === 'compact'
  const highContrast = user?.highContrast ?? localStorage.getItem(storedContrastKey) === 'high'

  if (theme === 'dark' || theme === 'light') {
    root.dataset.theme = theme
  } else {
    delete root.dataset.theme
  }

  root.dataset.density = compactMode ? 'compact' : 'comfortable'
  root.dataset.contrast = highContrast ? 'high' : 'normal'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [checkingSession, setCheckingSession] = useState(true)

  useEffect(() => {
    applyAppearance(null)
  }, [])

  useEffect(() => {
    applyAppearance(user)
    if (user?.theme) localStorage.setItem(storedThemeKey, user.theme)
    if (user?.compactMode !== undefined) localStorage.setItem(storedDensityKey, user.compactMode ? 'compact' : 'comfortable')
    if (user?.highContrast !== undefined) localStorage.setItem(storedContrastKey, user.highContrast ? 'high' : 'normal')
  }, [user])

  useEffect(() => {
    let active = true
    setUnauthorizedHandler(() => {
      setAccessToken(null)
      setUser(null)
    })

    // refreshSession compartilha a mesma requisição: o StrictMode monta o efeito duas vezes e uma segunda
    // chamada com o cookie já rotacionado seria tratada como reuso, revogando a sessão.
    void refreshSession().then((result) => {
      if (!active) return
      setUser(result.status === 'ok' ? result.session.user : null)
      setCheckingSession(false)
    })

    return () => {
      active = false
      setUnauthorizedHandler(null)
    }
  }, [])

  async function login(email: string, password: string) {
    const response = await api.post('/auth/login', { email, password })
    setAccessToken(response.data.token)
    setUser(response.data.user)
    // Só o rascunho da própria conta continua na aba (ex.: sessão que expirou no meio da publicação).
    clearAllItemDrafts(response.data.user.id)
  }

  async function loginWithGoogle(credential: string, privacyTermsAccepted?: boolean) {
    const response = await api.post('/auth/google', { credential, privacyTermsAccepted })
    setAccessToken(response.data.token)
    setUser(response.data.user)
    clearAllItemDrafts(response.data.user.id)
  }

  async function register(payload: RegisterPayload): Promise<RegisterResult> {
    const response = await api.post('/auth/register', payload)
    // Compatível com servidores antigos que ainda devolviam a sessão no cadastro.
    if (response.data.token) {
      setAccessToken(response.data.token)
      setUser(response.data.user)
    }
    return { verificationRequired: Boolean(response.data.verificationRequired), message: String(response.data.message ?? '') }
  }

  async function resendVerification(email: string) {
    const response = await api.post('/auth/resend-verification', { email })
    return String(response.data.message ?? '')
  }

  async function updateProfile(payload: UpdateProfilePayload) {
    const response = await api.patch('/auth/me', payload)
    setUser(response.data.user)
    return response.data.user
  }

  async function logout() {
    // Computador compartilhado: rascunhos de publicação não ficam para a próxima pessoa. Antes da rede,
    // para valer mesmo se a requisição demorar ou a página for fechada no meio.
    clearAllItemDrafts()
    try {
      await api.post('/auth/logout')
    } finally {
      setAccessToken(null)
      setUser(null)
    }
  }

  async function changePassword(currentPassword: string, newPassword: string) {
    const response = await api.post('/auth/change-password', { currentPassword, newPassword })
    // O servidor revoga todas as sessões e devolve uma nova para este navegador.
    setAccessToken(response.data.token)
    setUser(response.data.user)
    return response.data.message as string
  }

  async function deleteAccount(password: string) {
    await api.delete('/auth/me', { data: { password } })
    setAccessToken(null)
    clearAllItemDrafts()
    // Recarrega do zero: descarta todo o estado da conta removida e evita que a rota protegida
    // redirecione antes (perdendo a confirmação).
    window.location.replace('/login?conta=excluida')
  }

  const value = useMemo(
    () => ({ user, checkingSession, isAuthenticated: Boolean(user), login, loginWithGoogle, register, resendVerification, updateProfile, logout, changePassword, deleteAccount }),
    [checkingSession, user],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider')
  return context
}
