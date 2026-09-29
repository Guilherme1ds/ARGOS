import { Bell, ClipboardList, Home, LayoutDashboard, LogOut, Map as MapIcon, PlusCircle, Search, Settings, ShieldCheck, UserRound } from 'lucide-react'
import { Suspense, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { msg, t, useI18n } from '../i18n'
import logo from '../icon1.png'
import { api, apiAssetUrl } from '../services/api'
import { LanguageSwitcher } from './LanguageSwitcher'
import { notificationsChangedEvent } from '../utils/notifications'
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
      eyebrow: msg('Consulta pública'),
      title: msg('Buscar itens perdidos e encontrados'),
      description: msg('Filtre por local, categoria, data e status para encontrar casos publicados no ARGOS.'),
    }
  }

  if (pathname === '/map') {
    return {
      eyebrow: msg('Consulta pública'),
      title: msg('Mapa de casos'),
      description: msg('Veja no mapa do campus onde os itens foram perdidos ou encontrados.'),
    }
  }

  if (pathname === '/items/new') {
    return {
      eyebrow: msg('Publicação segura'),
      title: msg('Publicar item'),
      description: msg('Registre um item perdido ou encontrado com informações suficientes para ajudar na devolução.'),
    }
  }

  if (/^\/items\/\d+\/edit$/.test(pathname)) {
    return {
      eyebrow: msg('Publicação segura'),
      title: msg('Editar item'),
      description: msg('Atualize as informações públicas do caso. O tipo do caso não pode ser alterado.'),
    }
  }

  if (/^\/items\/\d+/.test(pathname)) {
    return {
      eyebrow: msg('Caso ARGOS'),
      title: msg('Detalhes do item'),
      description: msg('Confira dados do caso, envie pistas públicas ou reivindique com provas privadas.'),
    }
  }

  if (pathname === '/dashboard') {
    return {
      eyebrow: msg('Indicadores'),
      title: msg('Painel de operação'),
      description: msg('Acompanhe volumes, status e movimentações recentes dos casos.'),
    }
  }

  if (pathname === '/my-items') {
    return {
      eyebrow: msg('Meus casos'),
      title: msg('Itens que publiquei'),
      description: msg('Gerencie publicações, reivindicações recebidas e devoluções.'),
    }
  }

  if (pathname === '/notifications') {
    return {
      eyebrow: msg('Alertas'),
      title: msg('Notificações'),
      description: msg('Veja pistas, reivindicações e atualizações importantes dos casos acompanhados.'),
    }
  }

  if (pathname === '/profile') {
    return {
      eyebrow: msg('Identificação'),
      title: msg('Perfil'),
      description: msg('Mantenha dados mínimos de confiança para ajudar na comunicação protegida.'),
    }
  }

  if (pathname === '/settings') {
    return {
      eyebrow: msg('Preferências'),
      title: msg('Configurações'),
      description: msg('Ajuste idioma, tema, acessibilidade e notificações do ARGOS.'),
    }
  }

  if (pathname === '/admin') {
    return {
      eyebrow: msg('Administração'),
      title: msg('Moderação e gestão'),
      description: msg('Revise casos, usuários, solicitações de acesso e eventos de auditoria.'),
    }
  }

  if (pathname === '/privacy') {
    return {
      eyebrow: msg('Privacidade'),
      title: msg('Resumo de privacidade'),
      description: msg('Entenda como o ARGOS protege dados pessoais e informações sensíveis.'),
    }
  }

  return {
    eyebrow: msg('Operação ARGOS'),
    title: msg('Achados e perdidos'),
    description: msg('Resolva casos com busca, pistas públicas e reivindicações protegidas.'),
  }
}

function PageFallback() {
  return <p className="loading">{t('Carregando...')}</p>
}

export function Layout() {
  const { user, logout } = useAuth()
  const { t } = useI18n()
  const location = useLocation()
  const navigate = useNavigate()
  const isFeed = location.pathname === '/'
  const header = pageHeader(location.pathname)
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    if (!user) {
      setUnreadCount(0)
      return
    }
    let active = true
    const refresh = () => {
      api
        .get<{ total: number }>('/notifications/unread-count')
        .then((response) => active && setUnreadCount(response.data.total))
        .catch(() => undefined)
    }
    refresh()
    window.addEventListener(notificationsChangedEvent, refresh)
    return () => {
      active = false
      window.removeEventListener(notificationsChangedEvent, refresh)
    }
  }, [user?.id, location.pathname])

  async function handleLogout() {
    await logout()
    navigate('/items')
  }

  if (location.pathname === '/login' || location.pathname === '/reset-password') {
    return (
      <main className="auth-main">
        <LanguageSwitcher className="auth-language" />
        <Suspense fallback={<PageFallback />}>
          <Outlet />
        </Suspense>
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
            <span>{t('Achados e perdidos')}</span>
          </div>
        </div>
        <nav>
          <NavLink to="/" end className={navClass('nav-home')}><Home size={18} /> {t('Início')}</NavLink>
          <NavLink to="/items" className={navClass('nav-search')}><Search size={18} /> {t('Consulta pública')}</NavLink>
          <NavLink to="/map" className={navClass('nav-map')}><MapIcon size={18} /> {t('Mapa')}</NavLink>
          {user && <NavLink to="/dashboard" className={navClass('nav-dashboard')}><LayoutDashboard size={18} /> {t('Dashboard')}</NavLink>}
          {hasPermission(user, 'items:create') && <NavLink to="/items/new" className={navClass('nav-create')}><PlusCircle size={18} /> {t('Publicar item')}</NavLink>}
          {user && <NavLink to="/my-items" className={navClass('nav-my-items')}><ClipboardList size={18} /> {t('Meus itens')}</NavLink>}
          {user && <NavLink to="/notifications" className={navClass('nav-notifications')}><Bell size={18} /> {t('Notificações')}
            {unreadCount > 0 && <span className="nav-count" aria-label={t('{count} não lidas', { count: unreadCount })}>{unreadCount > 99 ? '99+' : unreadCount}</span>}
          </NavLink>}
          {user && <NavLink to="/profile" className={navClass('nav-profile')}><UserRound size={18} /> {t('Perfil')}</NavLink>}
          {user && <NavLink to="/settings" className={navClass('nav-settings')}><Settings size={18} /> {t('Configurações')}</NavLink>}
          {hasPermission(user, 'platform:admin') && <NavLink to="/admin" className={navClass('nav-admin')}><ShieldCheck size={18} /> {t('Administração')}</NavLink>}
          {!user && <NavLink to="/login" className={navClass('nav-login-mobile')}><UserRound size={18} /> {t('Entrar')}</NavLink>}
        </nav>
        <LanguageSwitcher className="sidebar-language" />
        {user ? (
          <button className="ghost sidebar-auth-action" onClick={handleLogout}>
            <LogOut size={18} /> {t('Sair')}
          </button>
        ) : (
          <button className="primary sidebar-auth-action" onClick={() => navigate('/login')}>{t('Entrar')}</button>
        )}
      </aside>
      <main className={isFeed ? 'feed-main' : undefined}>
        {!isFeed && (
          <header className="topbar page-topbar">
            <div>
              <span className="eyebrow">{t(header.eyebrow)}</span>
              <h1>{t(header.title)}</h1>
              <p>{t(header.description)}</p>
            </div>
            <Link className="user-pill" to={user ? '/profile' : '/login'}>
              {user?.avatarUrl ? <img className="pill-avatar" src={apiAssetUrl(user.avatarUrl)} alt="" /> : <UserRound size={18} />}
              {user?.name ?? t('Visitante')}
            </Link>
          </header>
        )}
        <Suspense fallback={<PageFallback />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  )
}
