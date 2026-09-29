import React, { useCallback, type ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { I18nProvider } from './i18n'
import type { AppLanguage } from './types/api'
import './styles.css'

// Com login, o idioma vem da conta e cada troca é salva no perfil.
function AccountI18nProvider({ children }: { children: ReactNode }) {
  const { user, updateProfile } = useAuth()
  const persist = useCallback((language: AppLanguage) => (user ? updateProfile({ language }) : undefined), [user, updateProfile])
  return (
    <I18nProvider accountLanguage={user?.language} onPersist={persist}>
      {children}
    </I18nProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AccountI18nProvider>
          <App />
        </AccountI18nProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
