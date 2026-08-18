import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import type { Permission } from '../types/api'
import { hasPermission } from '../utils/permissions'

export function ProtectedRoute({ permission }: { permission?: Permission }) {
  const { user, checkingSession } = useAuth()

  if (checkingSession) return <p className="loading">Verificando sessão...</p>
  if (!user) return <Navigate to="/login" replace />
  if (permission && !hasPermission(user, permission)) {
    return (
      <section className="panel access-denied">
        <h2>Acesso negado</h2>
        <p>Seu perfil não tem permissão para abrir esta área.</p>
      </section>
    )
  }

  return <Outlet />
}
