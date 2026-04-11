import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiDelete, apiGet, apiPost, apiPut } from '../utils/api'
import { useAdminEvents } from '../hooks/useAdminEvents'
import { timeAgo } from '../utils/dates'
import ConfirmButton from '../components/ui/ConfirmButton'
import BulkActionBar from '../components/ui/BulkActionBar'
import useSelection from '../hooks/useSelection'

const STATUS_LABELS = {
  active: 'Activa',
  converted: 'Convertida',
  lost: 'Perdida',
  escalated: 'Escalada',
  dormant: 'Dormida',
}

const INBOX_STATE_LABELS = {
  open: 'Abierta',
  pending: 'Pendiente',
  resolved: 'Resuelta',
}

const TAG_CLASSES = {
  intent: 'tag tag-intent',
  sentiment: 'tag tag-sentiment',
  objection: 'tag tag-objection',
  stage: 'tag tag-stage',
  behavior: 'tag tag-behavior',
  quality: 'tag tag-quality',
  custom: 'tag tag-custom',
}

export default function Conversations() {
  const [searchParams] = useSearchParams()
  const [conversations, setConversations] = useState([])
  const [resumeNodes, setResumeNodes] = useState([])
  const [resumeNodeKey, setResumeNodeKey] = useState('')
  const [resumingBot, setResumingBot] = useState(false)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [assignedFilter, setAssignedFilter] = useState('')
  const [inboxStateFilter, setInboxStateFilter] = useState('')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [messages, setMessages] = useState([])
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [team, setTeam] = useState([])
  const [noteDraft, setNoteDraft] = useState('')
  const [messageDraft, setMessageDraft] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [sendingMessage, setSendingMessage] = useState(false)
  const deferredSearch = useDeferredValue(search)
  const conversationsListRef = useRef(null)
  const messagesRef = useRef(null)
  const requestedConversationId = Number(searchParams.get('conversationId') || 0) || null
  const selection = useSelection()

  const selected = useMemo(
    () => conversations.find((item) => item.id === selectedId) || null,
    [conversations, selectedId]
  )
  const visibleConversationIds = useMemo(() => conversations.map((conversation) => conversation.id), [conversations])
  const allConversationsSelected = visibleConversationIds.length > 0 && visibleConversationIds.every((id) => selection.isSelected(id))

  const loadConversations = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({ limit: '50' })
    if (statusFilter) params.set('status', statusFilter)
    if (assignedFilter) params.set('assigned_to', assignedFilter)
    if (inboxStateFilter) params.set('inbox_state', inboxStateFilter)
    if (deferredSearch) params.set('search', deferredSearch)

    apiGet(`/api/conversations?${params.toString()}`)
      .then((response) => {
        const items = [...(response.data || [])].sort((a, b) => {
          const aTime = new Date(a.last_message_at || a.started_at || 0).getTime()
          const bTime = new Date(b.last_message_at || b.started_at || 0).getTime()
          return bTime - aTime
        })
        startTransition(() => {
          setConversations(items)
        })
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [assignedFilter, deferredSearch, inboxStateFilter, statusFilter])

  const loadMessages = useCallback((conversationId) => {
    if (!conversationId) {
      setMessages([])
      return Promise.resolve()
    }

    setLoadingMsgs(true)
    return apiGet(`/api/conversations/${conversationId}/messages`)
      .then((items) => {
        startTransition(() => {
          setMessages(items || [])
        })
      })
      .catch(() => {
        setMessages([])
      })
      .finally(() => setLoadingMsgs(false))
  }, [])

  useEffect(() => {
    loadConversations()
  }, [loadConversations])

  useEffect(() => {
    apiGet('/api/team')
      .then(setTeam)
      .catch(() => setTeam([]))
  }, [])

  useEffect(() => {
    apiGet('/api/funnel/nodes')
      .then((items) => {
        const sorted = [...(Array.isArray(items) ? items : [])]
          .sort((left, right) => Number(left.position || 0) - Number(right.position || 0))
        startTransition(() => {
          setResumeNodes(sorted)
        })
      })
      .catch(() => setResumeNodes([]))
  }, [])

  useEffect(() => {
    if (requestedConversationId && conversations.some((item) => item.id === requestedConversationId) && selectedId !== requestedConversationId) {
      setSelectedId(requestedConversationId)
      return
    }

    if (!selectedId && conversations.length > 0) {
      setSelectedId(conversations[0].id)
      return
    }

    if (selectedId && !conversations.some((item) => item.id === selectedId)) {
      setSelectedId(conversations[0]?.id || null)
    }
  }, [conversations, requestedConversationId, selectedId])

  useEffect(() => {
    if (!selectedId) {
      setMessages([])
      return
    }
    loadMessages(selectedId)
  }, [loadMessages, selectedId])

  useEffect(() => {
    setNoteDraft(selected?.internal_notes || '')
  }, [selected?.id, selected?.internal_notes])

  useEffect(() => {
    setResumeNodeKey('')
  }, [selected?.id])

  useEffect(() => {
    const node = conversationsListRef.current
    if (!node) return
    node.scrollTop = 0
  }, [conversations])

  useEffect(() => {
    const node = messagesRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [messages, selectedId])

  const { connected } = useAdminEvents({
    'conversation:change': (payload) => {
      loadConversations()
      if (payload?.id && payload.id === selectedId) {
        loadMessages(selectedId)
      }
    },
    'message:change': (payload) => {
      loadConversations()
      if (payload?.conversationId && payload.conversationId === selectedId) {
        loadMessages(selectedId)
      }
    },
    'lead:change': loadConversations,
  })

  async function handleAssign(assignedTo) {
    if (!selected) return
    try {
      await apiPut(`/api/conversations/${selected.id}/assign`, {
        assigned_to: assignedTo === 'bot' ? null : assignedTo,
      })
      updateConversationLocally(selected.id, { assigned_to: assignedTo })
    } catch (err) {
      alert(err.message)
    }
  }

  async function handleInboxState(nextState) {
    if (!selected) return
    try {
      await apiPut(`/api/conversations/${selected.id}/inbox-state`, { inbox_state: nextState })
      updateConversationLocally(selected.id, { inbox_state: nextState })
    } catch (err) {
      alert(err.message)
    }
  }

  async function handleSaveNotes() {
    if (!selected) return
    setSavingNote(true)
    try {
      await apiPut(`/api/conversations/${selected.id}/notes`, { internal_notes: noteDraft })
      updateConversationLocally(selected.id, { internal_notes: noteDraft })
    } catch (err) {
      alert(err.message)
    } finally {
      setSavingNote(false)
    }
  }

  async function handleSendMessage(event) {
    event.preventDefault()
    if (!selected || !messageDraft.trim()) return

    setSendingMessage(true)
    try {
      await apiPost(`/api/conversations/${selected.id}/messages`, { content: messageDraft.trim() })
      updateConversationLocally(selected.id, {
        inbox_state: 'pending',
        assigned_to: selected.assigned_to && selected.assigned_to !== 'bot' ? selected.assigned_to : 'bot',
      })
      setMessageDraft('')
      await Promise.all([loadConversations(), loadMessages(selected.id)])
    } catch (err) {
      alert(err.message)
    } finally {
      setSendingMessage(false)
    }
  }

  async function handleResumeBot() {
    if (!selected) return
    setResumingBot(true)
    try {
      await apiPost(`/api/conversations/${selected.id}/resume-bot`, {
        node_key: resumeNodeKey || null,
      })
      await Promise.all([loadConversations(), loadMessages(selected.id)])
    } catch (err) {
      alert(err.message)
    } finally {
      setResumingBot(false)
    }
  }

  function updateConversationLocally(conversationId, patch) {
    setConversations((current) => current.map((item) => (
      item.id === conversationId ? { ...item, ...patch } : item
    )))
  }

  async function handleDeleteConversation(conversationId = selected?.id) {
    if (!conversationId) return
    try {
      await apiDelete(`/api/conversations/${conversationId}`)
      if (selectedId === conversationId) {
        setSelectedId(null)
        setMessages([])
      }
      selection.clear()
      await loadConversations()
    } catch (err) {
      alert(err.message)
    }
  }

  async function handleBulkDeleteConversations() {
    const ids = selection.ids()
    if (ids.length === 0) return
    try {
      await Promise.all(ids.map((id) => apiDelete(`/api/conversations/${id}`)))
      if (selectedId && ids.includes(selectedId)) {
        setSelectedId(null)
        setMessages([])
      }
      selection.clear()
      await loadConversations()
    } catch (err) {
      alert(err.message)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2" style={{ flexWrap: 'wrap' }}>
        <h1 className="page-title">Conversaciones</h1>
        <span className={`live-indicator ${connected ? 'connected' : ''}`}>
          {connected ? 'En vivo' : 'Reconectando'}
        </span>
      </div>

      <div className="flex gap-2 mt-4" style={{ flexWrap: 'wrap' }}>
        <select className="input" style={{ maxWidth: 160 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <select className="input" style={{ maxWidth: 180 }} value={inboxStateFilter} onChange={(e) => setInboxStateFilter(e.target.value)}>
          <option value="">Todo el inbox</option>
          {Object.entries(INBOX_STATE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <select className="input" style={{ maxWidth: 200 }} value={assignedFilter} onChange={(e) => setAssignedFilter(e.target.value)}>
          <option value="">Todos los asignados</option>
          <option value="bot">Bot / sin asignar</option>
          {team.map((member) => (
            <option key={member.id} value={member.username}>
              {member.display_name || member.username}
            </option>
          ))}
        </select>
        <input
          className="input"
          style={{ maxWidth: 260 }}
          placeholder="Buscar lead o taller..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="mt-4">
        <BulkActionBar
          count={selection.count}
          onDelete={handleBulkDeleteConversations}
          onClear={selection.clear}
        />
      </div>

      <div className="conversations-layout mt-4">
        <div ref={conversationsListRef} className="conversations-list">
          {loading ? (
            <p className="text-muted">Cargando...</p>
          ) : conversations.length === 0 ? (
            <p className="text-muted">No hay conversaciones para este filtro.</p>
          ) : (
            <>
              <div className="conversation-list-header">
                <input
                  type="checkbox"
                  className="header-checkbox"
                  checked={allConversationsSelected}
                  onChange={() => selection.toggleAll(visibleConversationIds)}
                />
                <span>Seleccionar visibles</span>
              </div>
              {conversations.map((conversation) => {
                const sortedTags = [...(conversation.tags || [])]
                  .sort((a, b) => (tagPriority(a.category) - tagPriority(b.category)))
                const visibleTags = sortedTags.slice(0, 4)
                const extraCount = Math.max(0, sortedTags.length - 4)

                return (
                  <div key={conversation.id} className="conversation-select-row">
                    <input
                      type="checkbox"
                      className="row-checkbox"
                      checked={selection.isSelected(conversation.id)}
                      onChange={() => selection.toggle(conversation.id)}
                    />
                    <button
                      type="button"
                      className={`conversation-item ${selected?.id === conversation.id ? 'active' : ''}`}
                      onClick={() => setSelectedId(conversation.id)}
                    >
                      <div className="flex justify-between items-center gap-2">
                        <span className="font-semibold">{conversation.lead_name || conversation.lead_phone}</span>
                        <span className="text-xs text-muted">{timeAgo(conversation.last_message_at)}</span>
                      </div>
                      {conversation.workshop_name && (
                        <div className="text-xs text-secondary">{conversation.workshop_name}</div>
                      )}
                      <div className="conversation-item-meta">
                        <span className="text-xs text-muted">Asignado: {conversation.assigned_to || 'bot'}</span>
                        <span className={inboxStateBadgeClass(conversation.inbox_state)}>
                          {INBOX_STATE_LABELS[conversation.inbox_state] || 'Abierta'}
                        </span>
                      </div>
                      <div className="text-sm text-muted truncate" style={{ marginTop: 2 }}>
                        {conversation.last_message || 'Sin mensajes'}
                      </div>
                      {visibleTags.length > 0 && (
                        <div className="flex gap-1" style={{ marginTop: 6, flexWrap: 'wrap' }}>
                          {visibleTags.map((tag) => (
                            <span key={tag.id} className={TAG_CLASSES[tag.category] || 'tag tag-custom'}>{tag.value}</span>
                          ))}
                          {extraCount > 0 && <span className="tag tag--more">+{extraCount}</span>}
                        </div>
                      )}
                    </button>
                  </div>
                )
              })}
            </>
          )}
        </div>

        <div className="conversation-chat">
          {!selected ? (
            <div className="text-muted" style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
              Selecciona una conversación
            </div>
          ) : (
            <>
              <div className="conversation-toolbar">
                <div>
                  <div className="font-semibold">{selected.lead_name || selected.lead_phone}</div>
                  <div className="text-xs text-muted">
                    {selected.workshop_name || 'Sin taller'} · {STATUS_LABELS[selected.status] || selected.status}
                  </div>
                </div>
                <div className="flex gap-2" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <ConfirmButton
                    size="sm"
                    label="Eliminar"
                    confirmLabel="¿Eliminar conversación?"
                    onConfirm={() => handleDeleteConversation(selected.id)}
                  />
                  {['open', 'pending', 'resolved'].map((state) => (
                    <button
                      key={state}
                      type="button"
                      className={`btn btn-sm ${selected.inbox_state === state ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => handleInboxState(state)}
                    >
                      {INBOX_STATE_LABELS[state]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="conversation-panels">
                <div className="card">
                  <div className="card-header">
                    <h2 className="card-title">Operación</h2>
                  </div>
                  <div className="conversation-side-panel">
                    <div className="form-group">
                      <label>Asignado a</label>
                      <select
                        className="input"
                        value={selected.assigned_to || 'bot'}
                        onChange={(e) => handleAssign(e.target.value)}
                      >
                        <option value="bot">Bot / sin asignar</option>
                        {team.map((member) => (
                          <option key={member.id} value={member.username}>
                            {member.display_name || member.username}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group">
                      <label>Reanudar bot</label>
                      <div className="bot-resume-panel">
                        <select
                          className="input"
                          value={resumeNodeKey}
                          onChange={(e) => setResumeNodeKey(e.target.value)}
                        >
                          <option value="">Automático · seguir donde se quedó</option>
                          {resumeNodes.map((node) => (
                            <option key={node.id} value={node.node_key}>
                              {node.name || node.node_key}
                            </option>
                          ))}
                        </select>
                        <div className="text-xs text-muted">
                          Si eliges un nodo, el bot retoma desde ahí y envía el siguiente mensaje de inmediato.
                        </div>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={handleResumeBot}
                          disabled={resumingBot}
                        >
                          {resumingBot ? 'Reanudando...' : 'Reanudar bot'}
                        </button>
                      </div>
                    </div>

                    <div className="form-group">
                      <label>Notas internas</label>
                      <textarea
                        className="input textarea"
                        rows="6"
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        placeholder="Contexto interno, objeciones, próxima acción..."
                      />
                    </div>

                    <div className="flex gap-2">
                      <button type="button" className="btn btn-primary" onClick={handleSaveNotes} disabled={savingNote}>
                        {savingNote ? 'Guardando...' : 'Guardar nota'}
                      </button>
                      <button type="button" className="btn btn-secondary" onClick={() => setNoteDraft(selected.internal_notes || '')}>
                        Descartar
                      </button>
                    </div>
                  </div>
                </div>

                <div className="conversation-thread">
                  {loadingMsgs ? (
                    <div className="text-muted" style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
                      Cargando mensajes...
                    </div>
                  ) : (
                    <div ref={messagesRef} className="chat-messages">
                      {messages.map((message) => (
                        <div key={message.id} className={`chat-bubble ${message.direction === 'outbound' ? 'outbound' : 'inbound'}`}>
                          <div className="chat-bubble-content">{message.content}</div>
                          <div className="chat-bubble-meta">
                            {renderSenderLabel(message, selected)}
                            {' · '}
                            {new Date(message.created_at).toLocaleTimeString('es-BO', {
                              timeZone: 'America/La_Paz',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <form className="conversation-composer" onSubmit={handleSendMessage}>
                    <textarea
                      className="input textarea"
                      rows="3"
                      value={messageDraft}
                      onChange={(e) => setMessageDraft(e.target.value)}
                      placeholder="Escribe una respuesta manual..."
                    />
                    <div className="flex items-center justify-between gap-2" style={{ flexWrap: 'wrap' }}>
                      <span className="text-xs text-muted">
                        Al enviar manualmente, la conversación pasa a pendiente.
                      </span>
                      <button type="submit" className="btn btn-primary" disabled={sendingMessage || !messageDraft.trim()}>
                        {sendingMessage ? 'Enviando...' : 'Enviar mensaje'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function tagPriority(category) {
  if (category === 'quality') return 1
  if (category === 'sentiment') return 2
  if (category === 'intent') return 3
  return 9
}

function inboxStateBadgeClass(value) {
  if (value === 'resolved') return 'badge badge-success'
  if (value === 'pending') return 'badge badge-warning'
  return 'badge badge-info'
}

function renderSenderLabel(message, conversation) {
  if (message.direction === 'inbound') {
    return conversation.lead_name || 'Lead'
  }
  if (message.sender === 'bot') {
    return 'Bot'
  }
  return message.sender || 'Equipo'
}
