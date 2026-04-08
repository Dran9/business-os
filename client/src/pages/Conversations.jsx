import { useState, useEffect, useCallback } from 'react'
import { apiGet, apiPut } from '../utils/api'
import { timeAgo } from '../utils/dates'

const STATUS_LABELS = {
  active: 'Activa', converted: 'Convertida', lost: 'Perdida',
  escalated: 'Escalada', dormant: 'Dormida',
}

const TAG_CLASSES = {
  intent: 'tag tag-intent', sentiment: 'tag tag-sentiment',
  objection: 'tag tag-objection', stage: 'tag tag-stage',
  behavior: 'tag tag-behavior', quality: 'tag tag-quality',
  custom: 'tag tag-custom',
}

export default function Conversations() {
  const [conversations, setConversations] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState(null)
  const [messages, setMessages] = useState([])
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [team, setTeam] = useState([])

  const load = useCallback(() => {
    setLoading(true)
    let url = '/api/conversations?limit=50'
    if (filter) url += `&status=${filter}`
    apiGet(url)
      .then(r => setConversations(r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [filter])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    apiGet('/api/team')
      .then(setTeam)
      .catch(() => setTeam([]))
  }, [])

  async function selectConversation(conv) {
    setSelected(conv)
    setLoadingMsgs(true)
    try {
      const msgs = await apiGet(`/api/conversations/${conv.id}/messages`)
      setMessages(msgs)
    } catch {
      setMessages([])
    } finally {
      setLoadingMsgs(false)
    }
  }

  return (
    <div>
      <h1 className="page-title">Conversaciones</h1>

      <div className="flex gap-2 mt-4">
        {['', 'active', 'escalated', 'converted', 'lost'].map(s => (
          <button
            key={s}
            type="button"
            className={`btn btn-sm ${filter === s ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilter(s)}
          >
            {s ? STATUS_LABELS[s] : 'Todas'}
          </button>
        ))}
      </div>

      <div className="conversations-layout mt-4">
        {/* Lista */}
        <div className="conversations-list">
          {loading ? (
            <p className="text-muted">Cargando...</p>
          ) : conversations.length === 0 ? (
            <p className="text-muted">No hay conversaciones aún.</p>
          ) : conversations.map(c => (
            <div
              key={c.id}
              className={`conversation-item ${selected?.id === c.id ? 'active' : ''}`}
              onClick={() => selectConversation(c)}
            >
              <div className="flex justify-between items-center">
                <span className="font-semibold">{c.lead_name || c.lead_phone}</span>
                <span className="text-xs text-muted">{timeAgo(c.last_message_at)}</span>
              </div>
              {c.workshop_name && (
                <div className="text-xs text-secondary">{c.workshop_name}</div>
              )}
              <div className="text-xs text-muted" style={{ marginTop: 2 }}>
                Asignado a: {c.assigned_to || 'bot'}
              </div>
              <div className="text-sm text-muted truncate" style={{ marginTop: 2 }}>
                {c.last_message || 'Sin mensajes'}
              </div>
              {c.tags && c.tags.length > 0 && (
                <div className="flex gap-1" style={{ marginTop: 4, flexWrap: 'wrap' }}>
                  {c.tags.map((t, i) => (
                    <span key={i} className={TAG_CLASSES[t.category] || 'tag tag-custom'}>{t.value}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Chat */}
        <div className="conversation-chat">
          {!selected ? (
            <div className="text-muted" style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
              Selecciona una conversación
            </div>
          ) : loadingMsgs ? (
            <div className="text-muted" style={{ padding: 'var(--space-8)', textAlign: 'center' }}>Cargando mensajes...</div>
          ) : (
            <div className="chat-messages">
              <div className="card" style={{ marginBottom: 'var(--space-3)' }}>
                <div className="flex items-center justify-between gap-2" style={{ flexWrap: 'wrap' }}>
                  <div>
                    <div className="font-semibold">Asignación</div>
                    <div className="text-xs text-muted">Define quién maneja esta conversación</div>
                  </div>
                  <select
                    className="input"
                    style={{ maxWidth: 240 }}
                    value={selected.assigned_to || 'bot'}
                    onChange={async (e) => {
                      const assignedTo = e.target.value
                      try {
                        await apiPut(`/api/conversations/${selected.id}/assign`, { assigned_to: assignedTo === 'bot' ? null : assignedTo })
                        setSelected((current) => current ? { ...current, assigned_to: assignedTo } : current)
                        setConversations((current) => current.map((item) => item.id === selected.id ? { ...item, assigned_to: assignedTo } : item))
                      } catch (err) {
                        alert(err.message)
                      }
                    }}
                  >
                    <option value="bot">Bot / sin asignar</option>
                    {team.map((member) => (
                      <option key={member.id} value={member.username}>
                        {member.display_name || member.username}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {messages.map(m => (
                <div key={m.id} className={`chat-bubble ${m.direction === 'outbound' ? 'outbound' : 'inbound'}`}>
                  <div className="chat-bubble-content">{m.content}</div>
                  <div className="chat-bubble-meta">
                    {m.sender === 'bot' ? 'Bot' : selected.lead_name || 'Lead'}
                    {' · '}
                    {new Date(m.created_at).toLocaleTimeString('es-BO', { timeZone: 'America/La_Paz', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
