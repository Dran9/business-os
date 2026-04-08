import { useState, useCallback, useEffect } from 'react'
import { isAuthenticated, setToken, clearToken, apiPost } from '../utils/api'

export function useAuth() {
  const [authed, setAuthed] = useState(isAuthenticated())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Sync across tabs
  useEffect(() => {
    function onStorage(e) {
      if (e.key === 'bos_token') {
        setAuthed(!!e.newValue)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const login = useCallback(async (pin) => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiPost('/api/auth/login', { pin })
      setToken(data.token)
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
    setAuthed(false)
  }, [])

  return { authed, login, logout, loading, error }
}
