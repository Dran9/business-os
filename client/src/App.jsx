import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { useTheme } from './hooks/useTheme'
import AdminLayout from './components/layout/AdminLayout'
import Login from './pages/Login'

const LAZY_RETRY_KEY = 'bos:lazy-retry'

function lazyWithRetry(importer) {
  return lazy(async () => {
    try {
      const loaded = await importer()
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem(LAZY_RETRY_KEY)
      }
      return loaded
    } catch (error) {
      if (typeof window !== 'undefined') {
        const alreadyRetried = sessionStorage.getItem(LAZY_RETRY_KEY) === '1'
        if (!alreadyRetried) {
          sessionStorage.setItem(LAZY_RETRY_KEY, '1')
          window.location.reload()
          return new Promise(() => {})
        }
      }
      throw error
    }
  })
}

// Lazy load pages — cada módulo se carga solo cuando se navega a él
const Dashboard     = lazyWithRetry(() => import('./pages/Dashboard'))
const Contacts      = lazyWithRetry(() => import('./pages/Contacts'))
const Conversations = lazyWithRetry(() => import('./pages/Conversations'))
const Funnel        = lazyWithRetry(() => import('./pages/Funnel'))
const Leads         = lazyWithRetry(() => import('./pages/Leads'))
const Commands      = lazyWithRetry(() => import('./pages/Commands'))
const AI            = lazyWithRetry(() => import('./pages/AI'))
const AttendanceHub = lazyWithRetry(() => import('./pages/AttendanceHub'))
const Workshops     = lazyWithRetry(() => import('./pages/Workshops'))
const WorkshopAttendance = lazyWithRetry(() => import('./pages/WorkshopAttendance'))
const Finance       = lazyWithRetry(() => import('./pages/Finance'))
const Marketing     = lazyWithRetry(() => import('./pages/Marketing'))
const Insights      = lazyWithRetry(() => import('./pages/Insights'))
const Settings      = lazyWithRetry(() => import('./pages/Settings'))

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
            <Route path="ai" element={<AI />} />
            <Route path="asistencia" element={<AttendanceHub />} />
            <Route path="workshops" element={<Workshops />} />
            <Route path="taller/:tallerId/asistencia" element={<WorkshopAttendance />} />
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
