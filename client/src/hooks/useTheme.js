import { useState, useEffect, useCallback } from 'react'

function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function getStoredTheme() {
  return localStorage.getItem('bos_theme') || 'system'
}

function resolveTheme(preference) {
  return preference === 'system' ? getSystemTheme() : preference
}

export function useTheme() {
  const [preference, setPreference] = useState(getStoredTheme)
  const theme = resolveTheme(preference)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Listen for system changes when preference is 'system'
  useEffect(() => {
    if (preference !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => setPreference('system') // triggers re-render
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [preference])

  const setTheme = useCallback((value) => {
    localStorage.setItem('bos_theme', value)
    setPreference(value)
  }, [])

  const toggleTheme = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
  }, [theme, setTheme])

  return { theme, preference, setTheme, toggleTheme }
}
