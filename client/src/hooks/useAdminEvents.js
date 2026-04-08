import { useEffect, useRef, useState } from 'react'
import { getToken } from '../utils/api'

export function useAdminEvents(handlers, enabled = true) {
  const handlersRef = useRef(handlers || {})
  const [connected, setConnected] = useState(false)

  handlersRef.current = handlers || {}

  const eventNames = Object.keys(handlers || {}).sort().join('|')

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined

    const token = getToken()
    if (!token) return undefined

    const source = new EventSource(`/api/admin/events?token=${encodeURIComponent(token)}`)
    const subscriptions = Object.keys(handlersRef.current).map((eventName) => {
      const listener = (event) => {
        try {
          const payload = event.data ? JSON.parse(event.data) : {}
          handlersRef.current[eventName]?.(payload)
        } catch {
          handlersRef.current[eventName]?.({})
        }
      }
      source.addEventListener(eventName, listener)
      return { eventName, listener }
    })

    source.onopen = () => setConnected(true)
    source.onerror = () => setConnected(false)

    return () => {
      subscriptions.forEach(({ eventName, listener }) => {
        source.removeEventListener(eventName, listener)
      })
      source.close()
      setConnected(false)
    }
  }, [enabled, eventNames])

  return { connected }
}
