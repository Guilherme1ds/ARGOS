import { Bell, ClipboardList, Home, LayoutDashboard, LogOut, PlusCircle, Search, ShieldCheck } from 'lucide-react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import logo from '../icon1.png'
import { hasPermission } from '../utils/permissions'

export function Layout() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const isFeed = location.pathname === '/'

  async function handleLogout() {
    await logout()
    navigate('/items')
  }

  if (location.pathname === '/login') {
    return (
      <main className="auth-main">
        <Outlet />
      </main>
    )
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src={logo} alt="ARGOS" />
          <div>
            <strong>ARGOS</strong>
            <span>Achados e perdidos</span>
          </div>
        </div>
        <nav>
          <NavLink to="/" end><Home size={18} /> Início</NavLink>
          <NavLink to="/items"><Search size={18} /> Consulta pública</NavLink>
          {user && <NavLink to="/dashboard"><LayoutDashboard size={18} /> Dashboard</NavLink>}
          {hasPermission(user, 'items:create') && <NavLink to="/items/new"><PlusCircle size={18} /> Publicar item</NavLink>}
          {user && <NavLink to="/my-items"><ClipboardList size={18} /> Meus itens</NavLink>}
          {user && <NavLink to="/notifications"><Bell size={18} /> Notificações</NavLink>}
          {hasPermission(user, 'platform:admin') && <NavLink to="/admin"><ShieldCheck size={18} /> Administração</NavLink>}
        </nav>
        {user ? (
          <button className="ghost" onClick={handleLogout}>
            <LogOut size={18} /> Sair
          </button>
        ) : (
          <button className="primary" onClick={() => navigate('/login')}>Entrar</button>
        )}
      </aside>
      <main className={isFeed ? 'feed-main' : undefined}>
        {!isFeed && (
          <header className="topbar">
            <div>
              <span className="eyebrow">Operação ARGOS</span>
              <h1>Gestão confiável de achados e perdidos</h1>
            </div>
            <div className="user-pill"><Bell size={18} /> {user?.name ?? 'Visitante'}</div>
          </header>
        )}
        <Outlet />
      </main>
    </div>
  )
}
