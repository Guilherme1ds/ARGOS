import { Bell, ClipboardList, Home, LayoutDashboard, LogOut, PlusCircle, Search, Settings, ShieldCheck, UserRound } from 'lucide-react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import logo from '../icon1.png'
import { apiAssetUrl } from '../services/api'
import { hasPermission } from '../utils/permissions'

type PageHeader = {
  eyebrow: string
  title: string
  description: string
}

function navClass(name: string) {
  return ({ isActive }: { isActive: boolean }) => `${name}${isActive ? ' active' : ''}`
}

function pageHeader(pathname: string): PageHeader {
  if (pathname === '/items') {
    return {
      eyebrow: 'Consulta pública',
      title: 'Buscar itens perdidos e encontrados',
      description: 'Filtre por local, categoria, data e status para encontrar casos publicados no ARGOS.',
    }
  }

  if (pathname === '/items/new') {
    return {
      eyebrow: 'Publicação segura',
      title: 'Publicar item',
      description: 'Registre um item perdido ou encontrado com informações suficientes para ajudar na devolução.',
    }
  }

  if (/^\/items\/\d+/.test(pathname)) {
    return {
      eyebrow: 'Caso ARGOS',
      title: 'Detalhes do item',
      description: 'Confira dados do caso, envie pistas públicas ou reivindique com provas privadas.',
    }
  }

  if (pathname === '/dashboard') {
    return {
      eyebrow: 'Indicadores',
      title: 'Painel de operação',
      description: 'Acompanhe volumes, status e movimentações recentes dos casos.',
    }
  }

  if (pathname === '/my-items') {
    return {
      eyebrow: 'Meus casos',
      title: 'Itens que publiquei',
      description: 'Gerencie publicações, reivindicações recebidas e devoluções.',
    }
  }

  if (pathname === '/notifications') {
    return {
      eyebrow: 'Alertas',
      title: 'Notificações',
      description: 'Veja pistas, reivindicações e atualizações importantes dos casos acompanhados.',
    }
  }

  if (pathname === '/profile') {
    return {
      eyebrow: 'Identificação',
      title: 'Perfil',
      description: 'Mantenha dados mínimos de confiança para ajudar na comunicação protegida.',
    }
  }

  if (pathname === '/settings') {
    return {
      eyebrow: 'Preferências',
      title: 'Configurações',
      description: 'Ajuste idioma, tema, acessibilidade e notificações do ARGOS.',
    }
  }

  if (pathname === '/admin') {
    return {
      eyebrow: 'Administração',
      title: 'Moderação e gestão',
      description: 'Revise casos, usuários, solicitações de acesso e eventos de auditoria.',
    }
  }

  if (pathname === '/privacy') {
    return {
      eyebrow: 'Privacidade',
      title: 'Resumo de privacidade',
      description: 'Entenda como o ARGOS protege dados pessoais e informações sensíveis.',
    }
  }

  return {
    eyebrow: 'Operação ARGOS',
    title: 'Achados e perdidos',
    description: 'Resolva casos com busca, pistas públicas e reivindicações protegidas.',
  }
}

export function Layout() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const isFeed = location.pathname === '/'
  const header = pageHeader(location.pathname)

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
    <div className={`shell ${isFeed ? 'ig-shell' : ''}`}>
      <aside className={`sidebar ${isFeed ? 'ig-sidebar' : ''}`}>
        <div className="brand">
          <img src={logo} alt="ARGOS" />
          <div>
            <strong>ARGOS</strong>
            <span>Achados e perdidos</span>
          </div>
        </div>
        <nav>
          <NavLink to="/" end className={navClass('nav-home')}><Home size={18} /> Início</NavLink>
          <NavLink to="/items" className={navClass('nav-search')}><Search size={18} /> Consulta pública</NavLink>
          {user && <NavLink to="/dashboard" className={navClass('nav-dashboard')}><LayoutDashboard size={18} /> Dashboard</NavLink>}
          {hasPermission(user, 'items:create') && <NavLink to="/items/new" className={navClass('nav-create')}><PlusCircle size={18} /> Publicar item</NavLink>}
          {user && <NavLink to="/my-items" className={navClass('nav-my-items')}><ClipboardList size={18} /> Meus itens</NavLink>}
          {user && <NavLink to="/notifications" className={navClass('nav-notifications')}><Bell size={18} /> Notificações</NavLink>}
          {user && <NavLink to="/profile" className={navClass('nav-profile')}><UserRound size={18} /> Perfil</NavLink>}
          {user && <NavLink to="/settings" className={navClass('nav-settings')}><Settings size={18} /> Configurações</NavLink>}
          {hasPermission(user, 'platform:admin') && <NavLink to="/admin" className={navClass('nav-admin')}><ShieldCheck size={18} /> Administração</NavLink>}
          {!user && <NavLink to="/login" className={navClass('nav-login-mobile')}><UserRound size={18} /> Entrar</NavLink>}
        </nav>
        {user ? (
          <button className="ghost sidebar-auth-action" onClick={handleLogout}>
            <LogOut size={18} /> Sair
          </button>
        ) : (
          <button className="primary sidebar-auth-action" onClick={() => navigate('/login')}>Entrar</button>
        )}
      </aside>
      <main className={isFeed ? 'feed-main' : undefined}>
        {!isFeed && (
          <header className="topbar page-topbar">
            <div>
              <span className="eyebrow">{header.eyebrow}</span>
              <h1>{header.title}</h1>
              <p>{header.description}</p>
            </div>
            <Link className="user-pill" to={user ? '/profile' : '/login'}>
              {user?.avatarUrl ? <img className="pill-avatar" src={apiAssetUrl(user.avatarUrl)} alt="" /> : <UserRound size={18} />}
              {user?.name ?? 'Visitante'}
            </Link>
          </header>
        )}
        <Outlet />
      </main>
    </div>
  )
}
