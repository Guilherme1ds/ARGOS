import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import type { Permission } from '../types/api'
import { canOpenAdmin, hasAnyPermission, hasPermission } from '../utils/permissions'
import { useI18n } from '../i18n'

/**
 * `permission`: exige a permissão global do papel; com `scoped`, também vale a concedida por vínculo de gestão.
 * `admin`: qualquer papel que abra o painel administrativo (moderação, suporte ou administração).
 */
export function ProtectedRoute({ permission, scoped = false, admin = false }: { permission?: Permission; scoped?: boolean; admin?: boolean }) {
  const { user, checkingSession } = useAuth()
  const location = useLocation()
  const { t } = useI18n()

  if (checkingSession) return <p className="loading">{t('Verificando sessão...')}</p>
  // Preserva o destino para o LoginPage voltar a ele depois de autenticar.
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  const allowed = admin ? canOpenAdmin(user) : !permission || (scoped ? hasAnyPermission(user, permission) : hasPermission(user, permission))
  if (!allowed) {
    return (
      <section className="panel access-denied">
        <h2>{t('Acesso negado')}</h2>
        <p>{t('Seu perfil não tem permissão para abrir esta área.')}</p>
      </section>
    )
  }

  return <Outlet />
}
