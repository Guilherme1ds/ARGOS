import { Bell, ClipboardList, LayoutDashboard, LogOut, PlusCircle, Search, ShieldCheck } from 'lucide-react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <strong>ARGOS</strong>
          <span>Achados e perdidos</span>
        </div>
        <nav>
          <NavLink to="/items"><Search size={18} /> Consulta pública</NavLink>
          <NavLink to="/dashboard"><LayoutDashboard size={18} /> Dashboard</NavLink>
          <NavLink to="/items/new"><PlusCircle size={18} /> Publicar item</NavLink>
          <NavLink to="/my-items"><ClipboardList size={18} /> Meus itens</NavLink>
          {user?.role === 'admin' && <NavLink to="/admin"><ShieldCheck size={18} /> Admin</NavLink>}
        </nav>
        {user ? (
          <button className="ghost" onClick={() => { logout(); navigate('/items') }}>
            <LogOut size={18} /> Sair
          </button>
        ) : (
          <button className="primary" onClick={() => navigate('/login')}>Entrar</button>
        )}
      </aside>
      <main>
        <header className="topbar">
          <div>
            <span className="eyebrow">SENAI-inspired workflow</span>
            <h1>Controle confiável de achados e perdidos</h1>
          </div>
          <div className="user-pill"><Bell size={18} /> {user?.name ?? 'Visitante'}</div>
        </header>
        <Outlet />
      </main>
      <button className="support" title="Assistente de suporte futuro">?</button>
    </div>
  )
}
