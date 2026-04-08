import { useState, useCallback, useEffect } from 'react'
import { isAuthenticated, setToken, clearToken, apiPost, apiGet, setStoredUser, getStoredUser } from '../utils/api'

export function useAuth() {
  const [authed, setAuthed] = useState(isAuthenticated())
  const [user, setUser] = useState(getStoredUser())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Sync across tabs
  useEffect(() => {
    function onStorage(e) {
      if (e.key === 'bos_token') {
        setAuthed(!!e.newValue)
      }
      if (e.key === 'bos_user') {
        setUser(e.newValue ? JSON.parse(e.newValue) : null)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    if (!authed || user) return
    apiGet('/api/auth/me')
      .then((data) => {
        setUser(data.user)
        setStoredUser(data.user)
      })
      .catch(() => {})
  }, [authed, user])

  const login = useCallback(async ({ username, pin }) => {
    setLoading(true)
    setError(null)
    try {
      const payload = { pin }
      if (username) payload.username = username
      const data = await apiPost('/api/auth/login', payload)
      setToken(data.token)
      setStoredUser(data.user)
      setUser(data.user)
      setAuthed(true)
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  const logout = useCallback(() => {
    clearToken()
    setUser(null)
    setAuthed(false)
  }, [])

  return { authed, user, login, logout, loading, error }
}
