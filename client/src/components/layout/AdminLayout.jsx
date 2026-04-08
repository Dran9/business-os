import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar, { Icon } from './Sidebar'

export default function AdminLayout({ onLogout, theme, onToggleTheme }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="app-layout">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onLogout={onLogout}
        theme={theme}
        onToggleTheme={onToggleTheme}
      />
      <div className="main-content">
        <header className="page-header">
          <button
            type="button"
            className="btn btn-ghost btn-sm mobile-menu-btn"
            onClick={() => setSidebarOpen(true)}
          >
            <Icon name="menu" size={20} />
          </button>
        </header>
        <main className="page-body">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
