import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, setAccessToken, setUnauthorizedHandler } from '../services/api'
import type { User } from '../types/api'

type RegisterPayload = {
  name: string
  email: string
  password: string
  requestAccess?: boolean
  reason?: string
  privacyTermsAccepted?: boolean
  privacyTermsVersion?: string
}

type AuthContextValue = {
  user: User | null
  checkingSession: boolean
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  register: (payload: RegisterPayload) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [checkingSession, setCheckingSession] = useState(true)

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

  async function logout() {
    try {
      await api.post('/auth/logout')
    } finally {
      setAccessToken(null)
      setUser(null)
    }
  }

  const value = useMemo(
    () => ({ user, checkingSession, isAuthenticated: Boolean(user), login, register, logout }),
    [checkingSession, user],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider')
  return context
}
