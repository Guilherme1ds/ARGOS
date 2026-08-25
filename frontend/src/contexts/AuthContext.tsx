import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, setAccessToken, setUnauthorizedHandler } from '../services/api'
import type { AppLanguage, AppTheme, DateFormat, NotificationPreferences, User } from '../types/api'

type RegisterPayload = {
  name: string
  email: string
  password: string
  requestAccess?: boolean
  reason?: string
  privacyTermsAccepted?: boolean
  privacyTermsVersion?: string
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

type AuthContextValue = {
  user: User | null
  checkingSession: boolean
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  register: (payload: RegisterPayload) => Promise<void>
  updateProfile: (payload: UpdateProfilePayload) => Promise<User>
  logout: () => Promise<void>
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

    api
      .post('/auth/refresh')
      .then((response) => {
        if (!active) return
        setAccessToken(response.data.token)
        setUser(response.data.user)
      })
      .catch(() => {
        if (!active) return
        setAccessToken(null)
        setUser(null)
      })
      .finally(() => {
        if (active) setCheckingSession(false)
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
  }

  async function register(payload: RegisterPayload) {
    const response = await api.post('/auth/register', payload)
    if (response.data.token) {
      setAccessToken(response.data.token)
      setUser(response.data.user)
    }
  }

  async function updateProfile(payload: UpdateProfilePayload) {
    const response = await api.patch('/auth/me', payload)
    setUser(response.data.user)
    return response.data.user
  }

  async function logout() {
    try {
      await api.post('/auth/logout')
    } finally {
      setAccessToken(null)
      setUser(null)
    }
  }

  const value = useMemo(
    () => ({ user, checkingSession, isAuthenticated: Boolean(user), login, register, updateProfile, logout }),
    [checkingSession, user],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider')
  return context
}
