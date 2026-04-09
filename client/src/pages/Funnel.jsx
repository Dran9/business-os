import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiDelete, apiGet, apiPost, apiPut } from '../utils/api'
import { useAdminEvents } from '../hooks/useAdminEvents'
import { formatDate, timeAgo } from '../utils/dates'
import ConfirmButton from '../components/ui/ConfirmButton'

const TYPE_LABELS = {
  message: 'Mensaje',
  open_question_ai: 'Pregunta AI',
  open_question_detect: 'Pregunta detect',
  options: 'Opciones',
  action: 'Acción',
}

const TYPE_ICONS = {
  message: '💬',
  open_question_ai: '🧠',
  open_question_detect: '🔎',
  options: '↳',
  action: '⚙️',
}

const SESSION_STATUS_LABELS = {
  active: 'Activa',
  escalated: 'Escalada',
  completed: 'Completada',
  abandoned: 'Abandonada',
}

const EMPTY_FORM = {
  node_key: '',
  name: '',
  type: 'message',
  message_text: '',
  ai_system_prompt: '',
  keywords: [],
  keywordDraft: '',
  options: [],
  next_node_key: '',
  keyword_match_next: '',
  keyword_nomatch_next: '',
  action_type: '',
  position: 0,
  active: true,
}

function normalizeNodeForm(node) {
  if (!node) return EMPTY_FORM
  return {
    node_key: node.node_key || '',
    name: node.name || '',
    type: node.type || 'message',
    message_text: node.message_text || '',
    ai_system_prompt: node.ai_system_prompt || '',
    keywords: Array.isArray(node.keywords) ? node.keywords : [],
    keywordDraft: '',
    options: Array.isArray(node.options) ? node.options : [],
    next_node_key: node.next_node_key || '',
    keyword_match_next: node.keyword_match_next || '',
    keyword_nomatch_next: node.keyword_nomatch_next || '',
    action_type: node.action_type || '',
    position: Number(node.position || 0),
    active: node.active !== false,
  }
}

function truncateText(value, max = 80) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

function badgeClassForSession(status) {
  if (status === 'escalated') return 'badge badge-danger'
  if (status === 'active') return 'badge badge-info'
  if (status === 'completed') return 'badge badge-success'
  return 'badge'
}

function nextNodeOptions(nodes, currentKey) {
  return nodes
    .filter((node) => node.node_key !== currentKey)
    .map((node) => ({ value: node.node_key, label: `${node.node_key} · ${node.name}` }))
}

function sessionLeadLabel(session) {
  return session.lead_name || session.lead_phone || 'Lead sin identificar'
}

export default function Funnel() {
  const [activeTab, setActiveTab] = useState('flow')
  const [nodes, setNodes] = useState([])
  const [sessions, setSessions] = useState([])
  const [loadingNodes, setLoadingNodes] = useState(true)
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [savingNode, setSavingNode] = useState(false)
  const [selectedNode, setSelectedNode] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [selectedSessionId, setSelectedSessionId] = useState(null)
  const [selectedSession, setSelectedSession] = useState(null)
  const [loadingSessionDetail, setLoadingSessionDetail] = useState(false)
  const [sessionSearch, setSessionSearch] = useState('')
  const deferredSessionSearch = useDeferredValue(sessionSearch)

  const loadNodes = useCallback(() => {
    setLoadingNodes(true)
    return apiGet('/api/funnel/nodes')
      .then((items) => {
        startTransition(() => {
          setNodes(Array.isArray(items) ? items : [])
        })
      })
      .catch(() => {
        setNodes([])
      })
      .finally(() => setLoadingNodes(false))
  }, [])

  const loadSessions = useCallback(() => {
    setLoadingSessions(true)
    return apiGet('/api/funnel/sessions')
      .then((items) => {
        startTransition(() => {
          setSessions(Array.isArray(items) ? items : [])
        })
      })
      .catch(() => {
        setSessions([])
      })
      .finally(() => setLoadingSessions(false))
  }, [])

  const loadSessionDetail = useCallback((sessionId) => {
    if (!sessionId) {
      setSelectedSession(null)
      return Promise.resolve()
    }

    setLoadingSessionDetail(true)
    return apiGet(`/api/funnel/sessions/${sessionId}`)
      .then((item) => {
        startTransition(() => {
          setSelectedSession(item)
        })
      })
      .catch(() => {
        setSelectedSession(null)
      })
      .finally(() => setLoadingSessionDetail(false))
  }, [])

  useEffect(() => {
    loadNodes()
    loadSessions()
  }, [loadNodes, loadSessions])

  useEffect(() => {
    if (!selectedSessionId && sessions.length > 0) {
      setSelectedSessionId(sessions[0].id)
      return
    }

    if (selectedSessionId && !sessions.some((session) => session.id === selectedSessionId)) {
      setSelectedSessionId(sessions[0]?.id || null)
    }
  }, [sessions, selectedSessionId])

  useEffect(() => {
    loadSessionDetail(selectedSessionId)
  }, [loadSessionDetail, selectedSessionId])

  const { connected } = useAdminEvents({
    funnel_session_update: (payload) => {
      loadSessions()
      if (payload?.id && payload.id === selectedSessionId) {
        loadSessionDetail(selectedSessionId)
      }
    },
    'conversation:change': () => {
      if (activeTab === 'sessions') loadSessions()
    },
  })

  const filteredSessions = useMemo(() => {
    const term = deferredSessionSearch.trim().toLowerCase()
    if (!term) return sessions
    return sessions.filter((session) => (
      `${sessionLeadLabel(session)} ${session.current_node_key} ${session.current_node_name || ''}`
        .toLowerCase()
        .includes(term)
    ))
  }, [deferredSessionSearch, sessions])

  function handleNewNode() {
    const nextPosition = nodes.length > 0 ? Math.max(...nodes.map((node) => Number(node.position || 0))) + 10 : 0
    setSelectedNode(null)
    setForm({ ...EMPTY_FORM, position: nextPosition })
  }

  function handleEditNode(node) {
    setSelectedNode(node)
    setForm(normalizeNodeForm(node))
  }

  function handleCloseForm() {
    setSelectedNode(null)
    setForm(EMPTY_FORM)
  }

  function handleFieldChange(event) {
    const { name, value, type, checked } = event.target
    setForm((current) => ({
      ...current,
      [name]: type === 'checkbox' ? checked : value,
    }))
  }

  function handleOptionChange(index, field, value) {
    setForm((current) => ({
      ...current,
      options: current.options.map((option, optionIndex) => (
        optionIndex === index ? { ...option, [field]: value } : option
      )),
    }))
  }

  function handleAddOption() {
    setForm((current) => ({
      ...current,
      options: [...current.options, { label: '', next_node_key: '' }],
    }))
  }

  function handleRemoveOption(index) {
    setForm((current) => ({
      ...current,
      options: current.options.filter((_, optionIndex) => optionIndex !== index),
    }))
  }

  function handleAddKeyword() {
    const keyword = form.keywordDraft.trim()
    if (!keyword) return
    setForm((current) => ({
      ...current,
      keywords: [...current.keywords, keyword],
      keywordDraft: '',
    }))
  }

  function handleRemoveKeyword(keywordToRemove) {
    setForm((current) => ({
      ...current,
      keywords: current.keywords.filter((keyword) => keyword !== keywordToRemove),
    }))
  }

  async function handleSaveNode(event) {
    event.preventDefault()
    setSavingNode(true)
    try {
      const payload = {
        node_key: form.node_key.trim(),
        name: form.name.trim(),
        type: form.type,
        message_text: form.message_text,
        ai_system_prompt: form.type === 'open_question_ai' ? form.ai_system_prompt : null,
        keywords: form.type === 'open_question_detect' ? form.keywords : null,
        options: form.type === 'options' ? form.options : null,
        next_node_key: ['message', 'action', 'open_question_ai'].includes(form.type) ? (form.next_node_key || null) : null,
        keyword_match_next: form.type === 'open_question_detect' ? (form.keyword_match_next || null) : null,
        keyword_nomatch_next: form.type === 'open_question_detect' ? (form.keyword_nomatch_next || null) : null,
        action_type: form.type === 'action' ? (form.action_type || null) : null,
        position: Number(form.position || 0),
        active: form.active,
      }

      if (selectedNode?.id) {
        await apiPut(`/api/funnel/nodes/${selectedNode.id}`, payload)
      } else {
        await apiPost('/api/funnel/nodes', payload)
      }

      await loadNodes()
      handleCloseForm()
    } catch (err) {
      alert(err.message)
    } finally {
      setSavingNode(false)
    }
  }

  async function handleDeleteNode(node) {
    try {
      await apiDelete(`/api/funnel/nodes/${node.id}`)
      await loadNodes()
      if (selectedNode?.id === node.id) {
        handleCloseForm()
      }
    } catch (err) {
      alert(err.message)
    }
  }

  const nodeChoices = useMemo(
    () => nextNodeOptions(nodes, selectedNode?.node_key || form.node_key),
    [form.node_key, nodes, selectedNode?.node_key]
  )

  return (
    <div>
      <div className="flex items-center justify-between gap-2" style={{ flexWrap: 'wrap' }}>
        <h1 className="page-title">Embudo</h1>
        <div className="flex items-center gap-2">
          <span className={`live-indicator ${connected ? 'connected' : ''}`}>
            {connected ? 'En vivo' : 'Reconectando'}
          </span>
          <button type="button" className="btn btn-primary" onClick={handleNewNode}>
            Nuevo nodo
          </button>
        </div>
      </div>

      <div className="quick-filter-row mt-4">
        <button
          type="button"
          className={`view-chip ${activeTab === 'flow' ? 'active' : ''}`}
          onClick={() => setActiveTab('flow')}
        >
          Flujo
        </button>
        <button
          type="button"
          className={`view-chip ${activeTab === 'sessions' ? 'active' : ''}`}
          onClick={() => setActiveTab('sessions')}
        >
          Sesiones activas
        </button>
      </div>

      {activeTab === 'flow' ? (
        <div className="funnel-builder-layout mt-4">
          <div className="funnel-node-list">
            {loadingNodes ? (
              <p className="text-muted">Cargando nodos...</p>
            ) : nodes.length === 0 ? (
              <div className="card text-muted">No hay nodos cargados todavía.</div>
            ) : nodes.map((node) => (
              <div key={node.id} className="funnel-node-card">
                <div className="funnel-node-head">
                  <div>
                    <div className="funnel-node-kicker">{node.node_key}</div>
                    <div className="font-semibold">{node.name}</div>
                  </div>
                  <span className="badge badge-info">
                    {TYPE_ICONS[node.type] || '•'} {TYPE_LABELS[node.type] || node.type}
                  </span>
                </div>

                <div className="funnel-node-preview">
                  {truncateText(node.message_text || 'Sin texto configurado')}
                </div>

                <div className="funnel-branch-row">
                  {Array.isArray(node.options) && node.options.length > 0 && node.options.map((option) => (
                    <span key={`${node.id}-${option.label}`} className="tag tag-custom">
                      {option.label} → {option.next_node_key}
                    </span>
                  ))}
                  {node.keyword_match_next ? (
                    <span className="tag tag-stage">
                      Match → {node.keyword_match_next}
                    </span>
                  ) : null}
                  {node.keyword_nomatch_next ? (
                    <span className="tag tag-objection">
                      No match → {node.keyword_nomatch_next}
                    </span>
                  ) : null}
                  {!node.options?.length && !node.keyword_match_next && node.next_node_key ? (
                    <span className="tag tag-custom">
                      Sigue → {node.next_node_key}
                    </span>
                  ) : null}
                </div>

                <div className="funnel-node-actions">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleEditNode(node)}>
                    Editar
                  </button>
                  <ConfirmButton label="Eliminar" confirmLabel="¿Eliminar?" onConfirm={() => handleDeleteNode(node)} />
                </div>
              </div>
            ))}
          </div>

          <div className="funnel-editor-panel">
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">{selectedNode ? 'Editar nodo' : 'Nuevo nodo'}</h2>
              </div>

              <form onSubmit={handleSaveNode}>
                <div className="funnel-form-grid">
                  <div className="form-group">
                    <label>node_key</label>
                    <input
                      className="input"
                      name="node_key"
                      value={form.node_key}
                      onChange={handleFieldChange}
                      placeholder="nodo_13"
                      disabled={Boolean(selectedNode)}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label>Nombre</label>
                    <input
                      className="input"
                      name="name"
                      value={form.name}
                      onChange={handleFieldChange}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label>Tipo</label>
                    <select className="input" name="type" value={form.type} onChange={handleFieldChange}>
                      {Object.entries(TYPE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Posición</label>
                    <input
                      className="input"
                      name="position"
                      type="number"
                      value={form.position}
                      onChange={handleFieldChange}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>message_text</label>
                  <textarea
                    className="input textarea"
                    rows="6"
                    name="message_text"
                    value={form.message_text}
                    onChange={handleFieldChange}
                    placeholder="Texto que enviará el bot"
                  />
                </div>

                {form.type === 'open_question_ai' ? (
                  <div className="form-group">
                    <label>ai_system_prompt</label>
                    <textarea
                      className="input textarea"
                      rows="6"
                      name="ai_system_prompt"
                      value={form.ai_system_prompt}
                      onChange={handleFieldChange}
                    />
                  </div>
                ) : null}

                {form.type === 'open_question_detect' ? (
                  <div className="funnel-detect-grid">
                    <div className="form-group">
                      <label>Keywords</label>
                      <div className="funnel-keyword-input">
                        <input
                          className="input"
                          value={form.keywordDraft}
                          onChange={(event) => setForm((current) => ({ ...current, keywordDraft: event.target.value }))}
                          placeholder="Agregar keyword"
                        />
                        <button type="button" className="btn btn-secondary" onClick={handleAddKeyword}>
                          Agregar
                        </button>
                      </div>
                      <div className="funnel-chip-wrap">
                        {form.keywords.map((keyword) => (
                          <button
                            key={keyword}
                            type="button"
                            className="tag tag-custom removable-tag"
                            onClick={() => handleRemoveKeyword(keyword)}
                          >
                            {keyword} ×
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="form-group">
                      <label>Si hay match</label>
                      <select className="input" name="keyword_match_next" value={form.keyword_match_next} onChange={handleFieldChange}>
                        <option value="">Sin siguiente nodo</option>
                        {nodeChoices.map((option) => (
                          <option key={`match-${option.value}`} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group">
                      <label>Si no hay match</label>
                      <select className="input" name="keyword_nomatch_next" value={form.keyword_nomatch_next} onChange={handleFieldChange}>
                        <option value="">Sin siguiente nodo</option>
                        {nodeChoices.map((option) => (
                          <option key={`nomatch-${option.value}`} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                ) : null}

                {form.type === 'options' ? (
                  <div className="form-group">
                    <div className="flex items-center justify-between gap-2">
                      <label>Opciones</label>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={handleAddOption}>
                        Agregar opción
                      </button>
                    </div>
                    <div className="funnel-option-list">
                      {form.options.map((option, index) => (
                        <div key={`option-${index}`} className="funnel-option-row">
                          <input
                            className="input"
                            value={option.label || ''}
                            onChange={(event) => handleOptionChange(index, 'label', event.target.value)}
                            placeholder="Label"
                          />
                          <select
                            className="input"
                            value={option.next_node_key || ''}
                            onChange={(event) => handleOptionChange(index, 'next_node_key', event.target.value)}
                          >
                            <option value="">Sin siguiente nodo</option>
                            {nodeChoices.map((nodeOption) => (
                              <option key={`option-next-${nodeOption.value}`} value={nodeOption.value}>
                                {nodeOption.label}
                              </option>
                            ))}
                          </select>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleRemoveOption(index)}>
                            Quitar
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {['message', 'action', 'open_question_ai'].includes(form.type) ? (
                  <div className="form-group">
                    <label>Siguiente nodo</label>
                    <select className="input" name="next_node_key" value={form.next_node_key} onChange={handleFieldChange}>
                      <option value="">Sin siguiente nodo</option>
                      {nodeChoices.map((option) => (
                        <option key={`next-${option.value}`} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                ) : null}

                {form.type === 'action' ? (
                  <div className="form-group">
                    <label>action_type</label>
                    <input
                      className="input"
                      name="action_type"
                      value={form.action_type}
                      onChange={handleFieldChange}
                      placeholder="send_qr, process_payment_proof, escalate..."
                    />
                  </div>
                ) : null}

                <div className="funnel-toggle-row">
                  <label className="funnel-checkbox">
                    <input
                      type="checkbox"
                      name="active"
                      checked={form.active}
                      onChange={handleFieldChange}
                    />
                    <span>Nodo activo</span>
                  </label>
                </div>

                <div className="flex gap-2">
                  <button type="submit" className="btn btn-primary" disabled={savingNode}>
                    {savingNode ? 'Guardando...' : 'Guardar'}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={handleCloseForm}>
                    Cancelar
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
            <input
              className="input"
              style={{ maxWidth: 280 }}
              placeholder="Buscar lead, teléfono o nodo..."
              value={sessionSearch}
              onChange={(event) => setSessionSearch(event.target.value)}
            />
          </div>

          <div className="crm-layout mt-4">
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">Sesiones activas</h2>
              </div>
              {loadingSessions ? (
                <p className="text-muted">Cargando sesiones...</p>
              ) : filteredSessions.length === 0 ? (
                <p className="text-muted">No hay sesiones activas o escaladas.</p>
              ) : (
                <div className="table-container">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Lead</th>
                        <th>Nodo actual</th>
                        <th>Tiempo</th>
                        <th>Estado</th>
                        <th>Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSessions.map((session) => (
                        <tr
                          key={session.id}
                          className={selectedSessionId === session.id ? 'table-row-selected' : ''}
                          onClick={() => setSelectedSessionId(session.id)}
                          style={{ cursor: 'pointer' }}
                        >
                          <td>
                            <div className="font-semibold">{sessionLeadLabel(session)}</div>
                            <div className="text-xs text-muted">{session.lead_phone || session.channel}</div>
                          </td>
                          <td>
                            <div className="font-semibold">{session.current_node_name || session.current_node_key}</div>
                            <div className="text-xs text-muted">{session.current_node_key}</div>
                          </td>
                          <td>{session.current_node_entered_at ? timeAgo(session.current_node_entered_at) : '—'}</td>
                          <td>
                            <span className={badgeClassForSession(session.status)}>
                              {SESSION_STATUS_LABELS[session.status] || session.status}
                            </span>
                          </td>
                          <td>
                            <Link className="btn btn-ghost btn-sm" to={`/conversations?conversationId=${session.conversation_id}`}>
                              Ver conversación
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="crm-detail">
              {loadingSessionDetail ? (
                <div className="card text-muted">Cargando detalle...</div>
              ) : selectedSession ? (
                <>
                  <div className="card">
                    <div className="card-header">
                      <h2 className="card-title">{sessionLeadLabel(selectedSession)}</h2>
                    </div>

                    <div className="lead-summary-grid">
                      <SessionMeta label="Nodo actual" value={selectedSession.current_node_name || selectedSession.current_node_key} />
                      <SessionMeta label="Estado" value={SESSION_STATUS_LABELS[selectedSession.status] || selectedSession.status} />
                      <SessionMeta label="Canal" value={selectedSession.channel || 'telegram'} />
                      <SessionMeta label="Último update" value={selectedSession.updated_at ? formatDate(selectedSession.updated_at) : '—'} />
                    </div>

                    <div className="mt-4">
                      <div className="text-sm font-semibold">Historial de nodos</div>
                      <div className="timeline-list mt-4">
                        {(selectedSession.history || []).length === 0 ? (
                          <div className="text-muted">Sin historial.</div>
                        ) : selectedSession.history.map((item, index) => (
                          <div key={`${item.node_key}-${index}`} className="timeline-item">
                            <div className="timeline-dot" />
                            <div className="timeline-body">
                              <div className="timeline-head">
                                <span className="font-semibold">{item.name || item.node_key}</span>
                                <span className="text-xs text-muted">
                                  {item.entered_at ? timeAgo(item.entered_at) : '—'}
                                </span>
                              </div>
                              <div className="text-sm text-secondary">
                                {item.node_key} · {TYPE_LABELS[item.type] || item.type}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="card mt-4">
                    <div className="card-header">
                      <h2 className="card-title">Conversación</h2>
                    </div>
                    <div className="chat-messages funnel-session-messages">
                      {(selectedSession.messages || []).map((message) => (
                        <div
                          key={message.id}
                          className={`chat-bubble ${message.direction === 'outbound' ? 'outbound' : 'inbound'}`}
                        >
                          <div className="chat-bubble-content">{message.content || `[${message.content_type}]`}</div>
                          <div className="chat-bubble-meta">
                            {message.direction === 'outbound' ? 'Bot' : 'Lead'} · {timeAgo(message.created_at)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="card text-muted">Selecciona una sesión</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SessionMeta({ label, value }) {
  return (
    <div className="lead-meta-card">
      <div className="text-xs text-muted">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  )
}
