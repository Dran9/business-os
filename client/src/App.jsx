import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { useTheme } from './hooks/useTheme'
import AdminLayout from './components/layout/AdminLayout'
import Login from './pages/Login'

// Lazy load pages — cada módulo se carga solo cuando se navega a él
const Dashboard     = lazy(() => import('./pages/Dashboard'))
const Contacts      = lazy(() => import('./pages/Contacts'))
const Conversations = lazy(() => import('./pages/Conversations'))
const Funnel        = lazy(() => import('./pages/Funnel'))
const Leads         = lazy(() => import('./pages/Leads'))
const Commands      = lazy(() => import('./pages/Commands'))
const Workshops     = lazy(() => import('./pages/Workshops'))
const Finance       = lazy(() => import('./pages/Finance'))
const Marketing     = lazy(() => import('./pages/Marketing'))
const Insights      = lazy(() => import('./pages/Insights'))
const Settings      = lazy(() => import('./pages/Settings'))

function PageLoader() {
  return <div className="text-muted" style={{ padding: 'var(--space-8)' }}>Cargando...</div>
}

export default function App() {
  const { authed, user, login, logout, loading, error } = useAuth()
  const { theme, toggleTheme } = useTheme()

  if (!authed) {
    return (
      <BrowserRouter>
        <Login onLogin={login} loading={loading} error={error} />
      </BrowserRouter>
    )
  }

  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route element={<AdminLayout onLogout={logout} theme={theme} onToggleTheme={toggleTheme} currentUser={user} />}>
            <Route index element={<Dashboard />} />
            <Route path="contacts" element={<Contacts />} />
            <Route path="conversations" element={<Conversations />} />
            <Route path="funnel" element={<Funnel />} />
            <Route path="leads" element={<Leads />} />
            <Route path="commands" element={<Commands />} />
            <Route path="workshops" element={<Workshops />} />
            <Route path="finance" element={<Finance />} />
            <Route path="marketing" element={<Marketing />} />
            <Route path="insights" element={<Insights />} />
            <Route path="settings" element={<Settings currentUser={user} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
