import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import type { Permission } from '../types/api'
import { hasPermission } from '../utils/permissions'
import { useI18n } from '../i18n'

export function ProtectedRoute({ permission }: { permission?: Permission }) {
  const { user, checkingSession } = useAuth()
  const location = useLocation()
  const { t } = useI18n()

  if (checkingSession) return <p className="loading">{t('Verificando sessão...')}</p>
  // Preserva o destino para o LoginPage voltar a ele depois de autenticar.
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  if (permission && !hasPermission(user, permission)) {
    return (
      <section className="panel access-denied">
        <h2>{t('Acesso negado')}</h2>
        <p>{t('Seu perfil não tem permissão para abrir esta área.')}</p>
      </section>
    )
  }

  return <Outlet />
}
