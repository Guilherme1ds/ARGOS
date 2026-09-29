import { lazy } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ProtectedRoute } from './components/ProtectedRoute'
import { HomeFeedPage } from './pages/HomeFeedPage'

// A página inicial vai no bundle principal; as demais são carregadas sob demanda.
const AdminPage = lazy(() => import('./pages/AdminPage').then((module) => ({ default: module.AdminPage })))
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })))
const ItemDetailPage = lazy(() => import('./pages/ItemDetailPage').then((module) => ({ default: module.ItemDetailPage })))
const ItemFormPage = lazy(() => import('./pages/ItemFormPage').then((module) => ({ default: module.ItemFormPage })))
const ItemsPage = lazy(() => import('./pages/ItemsPage').then((module) => ({ default: module.ItemsPage })))
const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })))
const MapPage = lazy(() => import('./pages/MapPage').then((module) => ({ default: module.MapPage })))
const MyItemsPage = lazy(() => import('./pages/MyItemsPage').then((module) => ({ default: module.MyItemsPage })))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage').then((module) => ({ default: module.NotFoundPage })))
const NotificationsPage = lazy(() => import('./pages/NotificationsPage').then((module) => ({ default: module.NotificationsPage })))
const PrivacyPage = lazy(() => import('./pages/PrivacyPage').then((module) => ({ default: module.PrivacyPage })))
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((module) => ({ default: module.ProfilePage })))
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage').then((module) => ({ default: module.ResetPasswordPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })))

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomeFeedPage />} />
        <Route path="/items" element={<ItemsPage />} />
        <Route path="/items/:id" element={<ItemDetailPage />} />
        <Route path="/map" element={<MapPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/items/new" element={<ItemFormPage />} />
          <Route path="/items/:id/edit" element={<ItemFormPage />} />
          <Route path="/my-items" element={<MyItemsPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route element={<ProtectedRoute permission="platform:admin" />}>
          <Route path="/admin" element={<AdminPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
