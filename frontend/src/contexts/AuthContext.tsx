import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../services/api'
import type { User } from '../types/api'

type AuthContextValue = {
  user: User | null
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  register: (payload: { name: string; email: string; password: string; requestAccess?: boolean; reason?: string }) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

function readUser() {
  try {
    const raw = localStorage.getItem('argos_user')
    return raw ? (JSON.parse(raw) as User) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => readUser())

  useEffect(() => {
    if (!localStorage.getItem('argos_token')) return
    api.get('/auth/me').then((response) => setUser(response.data.user)).catch(() => setUser(null))
  }, [])

  async function login(email: string, password: string) {
    const response = await api.post('/auth/login', { email, password })
    localStorage.setItem('argos_token', response.data.token)
    localStorage.setItem('argos_user', JSON.stringify(response.data.user))
    setUser(response.data.user)
  }

  async function register(payload: { name: string; email: string; password: string; requestAccess?: boolean; reason?: string }) {
    const response = await api.post('/auth/register', payload)
    if (response.data.token) {
      localStorage.setItem('argos_token', response.data.token)
      localStorage.setItem('argos_user', JSON.stringify(response.data.user))
      setUser(response.data.user)
    }
  }

  function logout() {
    localStorage.removeItem('argos_token')
    localStorage.removeItem('argos_user')
    setUser(null)
  }

  const value = useMemo(() => ({ user, isAuthenticated: Boolean(user), login, register, logout }), [user])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider')
  return context
}
