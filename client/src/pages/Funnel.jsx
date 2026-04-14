import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Link } from 'react-router-dom'
import { apiDelete, apiGet, apiPost, apiPut, getStoredUser } from '../utils/api'
import { useAdminEvents } from '../hooks/useAdminEvents'
import { formatDate, timeAgo } from '../utils/dates'

// ── Tipos y metadata ──────────────────────────────────────────────────────
const NODE_TYPES = [
  { value: 'message',              label: 'Mensaje',   icon: 'message-circle', help: 'El bot habla y sigue solo, sin esperar respuesta.' },
  { value: 'open_question_ai',     label: 'IA',        icon: 'brain',          help: 'El bot pregunta y la IA procesa la respuesta libre.' },
  { value: 'capture_data',         label: 'Dato',      icon: 'contact-round',  help: 'El bot pide un dato puntual, espera la respuesta y la guarda en el lead.' },
  { value: 'open_question_detect', label: 'Detección', icon: 'split',          help: 'El bot busca palabras clave y enruta según lo que detecte.' },
  { value: 'options',              label: 'Botones',   icon: 'list-todo',      help: 'El cliente elige entre botones. Máximo 3 opciones.' },
  { value: 'action',               label: 'Acción',    icon: 'zap',            help: 'El sistema hace algo automático, sin pedir input al cliente.' },
]

const TYPE_LABEL = Object.fromEntries(NODE_TYPES.map((t) => [t.value, t.label]))
const TYPE_ICON  = Object.fromEntries(NODE_TYPES.map((t) => [t.value, t.icon]))

const ACTION_TYPES = [
  {
    value: 'check_workshop_capacity',
    label: 'Verificar cupos del taller',
    help: 'Revisa si quedan lugares en el próximo taller activo. Si hay cupos → sigue al paso configurado. Si está lleno → se desvía automáticamente a nodo_09_sin_cupos.',
    icon: 'users',
  },
  {
    value: 'send_qr',
    label: 'Enviar QR de pago',
    help: 'Busca el QR que corresponde al monto del lead y lo envía como imagen. Configurá los QR en Configuración del taller.',
    icon: 'qr-code',
  },
  {
    value: 'process_payment_proof',
    label: 'Procesar comprobante (OCR)',
    help: 'Analiza la foto que mandó el cliente con Google Vision. Cruza monto, cuenta y fecha contra los datos del lead. Si falla → nodo_10_espera_pago.',
    icon: 'scan-line',
  },
  {
    value: 'escalate',
    label: 'Escalar a atención humana',
    help: 'Detiene el bot, marca la conversación como escalada y envía notificación Pushinator a tu celular. El cliente recibe un aviso automático.',
    icon: 'bell-ring',
  },
]

const ACTION_LABEL = Object.fromEntries(ACTION_TYPES.map((a) => [a.value, a.label]))

const CAPTURE_FIELDS = [
  {
    value: 'last_name',
    label: 'Apellido',
    help: 'Guarda exactamente el apellido que responde el cliente, sin intentar separarlo.',
  },
  {
    value: 'first_name',
    label: 'Nombre',
    help: 'Guarda exactamente el nombre que responde el cliente, sin inferir apellidos.',
  },
]

const CAPTURE_FIELD_LABEL = Object.fromEntries(CAPTURE_FIELDS.map((field) => [field.value, field.label]))

const SYSTEM_NODE_DEPENDENCIES = {
  check_workshop_capacity: ['nodo_09_sin_cupos'],
  process_payment_proof: ['nodo_10_espera_pago'],
}
const MAX_SEND_DELAY_SECONDS = 120

const SESSION_STATUS_LABELS = {
  active: 'Activa',
  escalated: 'Escalada',
  completed: 'Completada',
  abandoned: 'Abandonada',
}

// ── Helpers ───────────────────────────────────────────────────────────────
function sessionLeadLabel(session) {
  return session.lead_name || session.lead_phone || 'Lead sin identificar'
}

function badgeClassForSession(status) {
  if (status === 'escalated') return 'badge badge-danger'
  if (status === 'active') return 'badge badge-info'
  if (status === 'completed') return 'badge badge-success'
  return 'badge'
}

function truncateText(value, max = 80) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

function normalizeKeywords(value) {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    return value.split(',').map((k) => k.trim()).filter(Boolean)
  }
  return []
}

function keywordsToText(value) {
  if (typeof value === 'string') return value
  return normalizeKeywords(value).join(', ')
}

function clampSendDelaySeconds(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.min(MAX_SEND_DELAY_SECONDS, Math.round(numeric)))
}

function normalizeOptions(value) {
  if (!Array.isArray(value)) return []
  return value.map((opt) => ({
    label: opt?.label || '',
    next_node_key: opt?.next_node_key || '',
  }))
}

function normalizeNode(raw) {
  return {
    ...raw,
    name: raw.name || '',
    message_text: raw.message_text || '',
    ai_system_prompt: raw.ai_system_prompt || '',
    keywords: normalizeKeywords(raw.keywords),
    keywords_input: keywordsToText(raw.keywords_input ?? raw.keywords),
    options: normalizeOptions(raw.options),
    next_node_key: raw.next_node_key || '',
    keyword_match_next: raw.keyword_match_next || '',
    keyword_nomatch_next: raw.keyword_nomatch_next || '',
    capture_field: raw.capture_field || '',
    action_type: raw.action_type || '',
    position: Number(raw.position || 0),
    send_delay_seconds: clampSendDelaySeconds(raw.send_delay_seconds),
    active: raw.active !== false,
  }
}

function buildPayload(node) {
  const base = {
    node_key: node.node_key,
    name: (node.name || '').trim(),
    type: node.type,
    message_text: node.message_text || '',
    ai_system_prompt: null,
    keywords: null,
    options: null,
    next_node_key: null,
    keyword_match_next: null,
    keyword_nomatch_next: null,
    capture_field: null,
    action_type: null,
    position: Number(node.position || 0),
    send_delay_seconds: clampSendDelaySeconds(node.send_delay_seconds),
    active: node.active !== false,
  }
  if (node.type === 'open_question_ai') {
    base.ai_system_prompt = node.ai_system_prompt || ''
    base.next_node_key = node.next_node_key || null
  } else if (node.type === 'capture_data') {
    base.capture_field = node.capture_field || null
    base.next_node_key = node.next_node_key || null
  } else if (node.type === 'open_question_detect') {
    base.keywords = normalizeKeywords(node.keywords_input ?? node.keywords)
    base.keyword_match_next = node.keyword_match_next || null
    base.keyword_nomatch_next = node.keyword_nomatch_next || null
  } else if (node.type === 'options') {
    base.options = (node.options || []).filter((o) => (o.label || '').trim())
  } else if (node.type === 'action') {
    base.action_type = node.action_type || null
    base.next_node_key = node.next_node_key || null
  } else {
    base.next_node_key = node.next_node_key || null
  }
  return base
}

function generateNodeKey(existing) {
  const keys = new Set((existing || []).map((n) => n.node_key))
  let i = existing.length + 1
  while (keys.has(`nodo_${String(i).padStart(2, '0')}`)) i += 1
  return `nodo_${String(i).padStart(2, '0')}`
}

// ── Ícono inline (no dep) ─────────────────────────────────────────────────
const ICONS = {
  'message-circle': <><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></>,
  'brain': <><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2z"/></>,
  'contact-round': <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M19 8v6"/><path d="M16 11h6"/></>,
  'split': <><path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.17-2.83L3 3"/><path d="m21 3-7.83 7.83A4 4 0 0 0 12 13.67"/></>,
  'list-todo': <><rect x="3" y="5" width="6" height="6" rx="1"/><path d="m3 17 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/></>,
  'zap': <><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></>,
  'trash-2': <><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></>,
  'plus': <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>,
  'x': <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
  'check': <><polyline points="20 6 9 17 4 12"/></>,
  'chevron-down': <><polyline points="6 9 12 15 18 9"/></>,
  'arrow-up': <><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></>,
  'arrow-down': <><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></>,
  'save': <><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></>,
  'bold': <><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></>,
  'italic': <><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></>,
  'strikethrough': <><path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" y1="12" x2="20" y2="12"/></>,
  'lock': <><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>,
  'alert-triangle': <><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,
  'users': <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
  'qr-code': <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3z"/><path d="M20 14h1"/><path d="M14 20h3"/><path d="M20 17v4"/></>,
  'scan-line': <><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></>,
  'bell-ring': <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="M4 2C2.8 3.7 2 5.7 2 8"/><path d="M22 8c0-2.3-.8-4.3-2-6"/></>,
  'copy': <><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>,
  'clock-3': <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>,
}

function IconConfirmButton({ onConfirm }) {
  function handleClick() {
    const confirmed = window.confirm('¿Eliminar este paso del embudo? Se borra de inmediato.')
    if (!confirmed) return
    onConfirm()
  }

  return (
    <button
      type="button"
      className="fnl-icon-btn danger"
      title="Eliminar paso"
      onClick={handleClick}
    >
      <Icon name="trash-2" />
    </button>
  )
}

function Icon({ name, size = 14 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      {ICONS[name] || null}
    </svg>
  )
}

// ══════════════════════════════════════════════════════════════════════════
//   MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════
export default function Funnel() {
  const [activeTab, setActiveTab] = useState('flow')

  // Flow state
  const [nodes, setNodes] = useState([])
  const [loadingNodes, setLoadingNodes] = useState(true)
  const [dirtyIds, setDirtyIds] = useState(() => new Set())
  const [savingAll, setSavingAll] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveToast, setSaveToast] = useState('')
  const [activePillId, setActivePillId] = useState(null)

  // Sessions state
  const [sessions, setSessions] = useState([])
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [selectedSessionId, setSelectedSessionId] = useState(null)
  const [selectedSession, setSelectedSession] = useState(null)
  const [loadingSessionDetail, setLoadingSessionDetail] = useState(false)
  const [sessionSearch, setSessionSearch] = useState('')
  const deferredSessionSearch = useDeferredValue(sessionSearch)
  const [funnelPaused, setFunnelPaused] = useState(false)
  const [loadingControl, setLoadingControl] = useState(true)
  const [savingControl, setSavingControl] = useState(false)
  const [controlError, setControlError] = useState('')
  const [controlToast, setControlToast] = useState('')
  const [currentUser, setCurrentUser] = useState(() => getStoredUser())

  const canManageControl = ['owner', 'admin'].includes(currentUser?.role)

  // ── Load nodes/sessions ────────────────────────────────────────────────
  const loadNodes = useCallback(() => {
    setLoadingNodes(true)
    return apiGet('/api/funnel/nodes')
      .then((items) => {
        startTransition(() => {
          const normalized = (Array.isArray(items) ? items : []).map(normalizeNode)
          setNodes(normalized)
          setDirtyIds(new Set())
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

  const loadFunnelControl = useCallback(({ silent = false } = {}) => {
    if (!silent) setLoadingControl(true)
    return apiGet('/api/funnel/control')
      .then((control) => {
        const paused = control?.funnel_paused === true
        setFunnelPaused(paused)
        setControlError('')
      })
      .catch((err) => {
        if (!silent) {
          setControlError(err.message || 'No se pudo cargar el estado de pausa global')
        }
      })
      .finally(() => {
        if (!silent) setLoadingControl(false)
      })
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
    loadFunnelControl()
  }, [loadNodes, loadSessions, loadFunnelControl])

  useEffect(() => {
    if (!selectedSessionId && sessions.length > 0) {
      setSelectedSessionId(sessions[0].id)
      return
    }
    if (selectedSessionId && !sessions.some((s) => s.id === selectedSessionId)) {
      setSelectedSessionId(sessions[0]?.id || null)
    }
  }, [sessions, selectedSessionId])

  useEffect(() => {
    loadSessionDetail(selectedSessionId)
  }, [loadSessionDetail, selectedSessionId])

  useEffect(() => {
    const onUserUpdated = (event) => {
      setCurrentUser(event.detail || getStoredUser())
    }
    window.addEventListener('bos-user-updated', onUserUpdated)
    return () => window.removeEventListener('bos-user-updated', onUserUpdated)
  }, [])

  const handleToggleFunnelPause = useCallback(async () => {
    if (loadingControl || savingControl) return
    if (!canManageControl) {
      setControlError('Tu rol no tiene permiso para pausar/reanudar el embudo global')
      return
    }
    setControlError('')
    setControlToast('')
    setSavingControl(true)

    try {
      const targetPaused = !funnelPaused
      const updated = await apiPut('/api/funnel/control', { funnel_paused: targetPaused })
      const nextPaused = updated?.funnel_paused === true
      setFunnelPaused(nextPaused)
      setControlToast(
        nextPaused
          ? 'Embudo en pausa global: los mensajes entran y se registran, sin respuestas automáticas.'
          : 'Embudo activo: las respuestas automáticas volvieron a estar habilitadas.'
      )
      setTimeout(() => setControlToast(''), 3200)
    } catch (err) {
      setControlError(err.message || 'No se pudo actualizar la pausa global')
    } finally {
      setSavingControl(false)
    }
  }, [canManageControl, funnelPaused, loadingControl, savingControl])

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
    'funnel:control': (payload) => {
      if (typeof payload?.funnel_paused === 'boolean') {
        setFunnelPaused(payload.funnel_paused)
        setControlError('')
        return
      }
      loadFunnelControl({ silent: true })
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

  // ── Editor helpers ─────────────────────────────────────────────────────
  const markDirty = useCallback((id) => {
    setDirtyIds((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }, [])

  const updateNode = useCallback((id, patch) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)))
    markDirty(id)
  }, [markDirty])

  const handleAddNode = useCallback(async () => {
    setSaveError('')
    const nextPosition = nodes.length > 0
      ? Math.max(...nodes.map((n) => Number(n.position || 0))) + 10
      : 10
    const nodeKey = generateNodeKey(nodes)
    const payload = {
      node_key: nodeKey,
      name: 'Nuevo paso',
      type: 'message',
      message_text: '',
      position: nextPosition,
      active: true,
    }
    try {
      const created = await apiPost('/api/funnel/nodes', payload)
      const normalized = normalizeNode(created)
      setNodes((prev) => [...prev, normalized])
      setActivePillId(normalized.id)
      // Scroll into view after render
      setTimeout(() => {
        const el = document.getElementById(`fnl-card-${normalized.id}`)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 50)
    } catch (err) {
      setSaveError(err.message || 'No se pudo crear el paso')
    }
  }, [nodes])

  const handleDuplicateNode = useCallback(async (node) => {
    setSaveError('')
    const duplicateKey = generateNodeKey(nodes)
    const fallbackName = node.name || node.node_key || 'Paso'
    const payload = {
      ...buildPayload({
        ...node,
        node_key: duplicateKey,
        name: `${fallbackName} (copia)`,
        position: Number(node.position || 0) + 1,
      }),
      node_key: duplicateKey,
    }

    try {
      const created = await apiPost('/api/funnel/nodes', payload)
      const normalized = normalizeNode(created)
      setNodes((prev) => {
        const next = [...prev, normalized]
        next.sort((a, b) => Number(a.position || 0) - Number(b.position || 0) || Number(a.id || 0) - Number(b.id || 0))
        return next
      })
      setActivePillId(normalized.id)
      setTimeout(() => {
        const el = document.getElementById(`fnl-card-${normalized.id}`)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 50)
    } catch (err) {
      setSaveError(err.message || 'No se pudo duplicar el paso')
    }
  }, [nodes])

  const handleDeleteNode = useCallback(async (node) => {
    setSaveError('')
    try {
      const result = await apiDelete(`/api/funnel/nodes/${node.id}`)
      const remaining = nodes.filter((n) => n.id !== node.id)
      setNodes(remaining)
      if (activePillId === node.id) {
        setActivePillId(remaining[0]?.id || null)
      }
      setDirtyIds((prev) => {
        const next = new Set(prev)
        next.delete(node.id)
        return next
      })
      if (result?.rerouted_sessions || result?.abandoned_sessions || result?.detached_references) {
        setSaveToast([
          result.detached_references ? `${result.detached_references} referencia(s) ajustada(s)` : null,
          result.rerouted_sessions ? `${result.rerouted_sessions} sesión(es) redirigida(s)` : null,
          result.abandoned_sessions ? `${result.abandoned_sessions} sesión(es) cerrada(s)` : null,
        ].filter(Boolean).join(' · '))
        setTimeout(() => setSaveToast(''), 2800)
      }
    } catch (err) {
      const message = err.message || 'No se pudo eliminar el paso'
      setSaveError(message)
      window.alert(message)
    }
  }, [activePillId, nodes])

  const handleMoveNode = useCallback((id, direction) => {
    setNodes((prev) => {
      const index = prev.findIndex((n) => n.id === id)
      if (index === -1) return prev
      const swapWith = direction === 'up' ? index - 1 : index + 1
      if (swapWith < 0 || swapWith >= prev.length) return prev
      const a = prev[index]
      const b = prev[swapWith]
      const posA = Number(a.position || 0)
      const posB = Number(b.position || 0)
      setDirtyIds((d) => {
        const next = new Set(d)
        next.add(a.id)
        next.add(b.id)
        return next
      })
      const next = [...prev]
      next[index] = { ...a, position: posB }
      next[swapWith] = { ...b, position: posA }
      next.sort((x, y) => Number(x.position) - Number(y.position))
      return next
    })
  }, [])

  const validateNode = (node) => {
    if (!node.name?.trim()) return `"${node.node_key}" necesita un nombre`
    if (node.type === 'open_question_ai' && !node.ai_system_prompt?.trim()) {
      return `"${node.name}" necesita una instrucción para la IA`
    }
    if (node.type === 'capture_data' && !node.capture_field) {
      return `"${node.name}" necesita elegir qué dato va a guardar`
    }
    if (node.type === 'action' && !node.action_type) {
      return `"${node.name}" necesita elegir una acción`
    }
    return null
  }

  const handleSaveAll = useCallback(async () => {
    if (savingAll) return
    setSaveError('')
    setSaveToast('')
    const dirty = nodes.filter((n) => dirtyIds.has(n.id))
    if (dirty.length === 0) {
      setSaveToast('Nada para guardar')
      setTimeout(() => setSaveToast(''), 1800)
      return
    }
    for (const node of dirty) {
      const err = validateNode(node)
      if (err) {
        setSaveError(err)
        return
      }
    }
    setSavingAll(true)
    try {
      const results = await Promise.all(
        dirty.map((node) => apiPut(`/api/funnel/nodes/${node.id}`, buildPayload(node))
          .then((updated) => ({ id: node.id, updated: normalizeNode(updated) }))
        )
      )
      setNodes((prev) => {
        const byId = new Map(results.map((r) => [r.id, r.updated]))
        return prev.map((n) => byId.get(n.id) || n)
      })
      setDirtyIds(new Set())
      setSaveToast(`${dirty.length} ${dirty.length === 1 ? 'cambio guardado' : 'cambios guardados'}`)
      setTimeout(() => setSaveToast(''), 2200)
    } catch (err) {
      setSaveError(err.message || 'Error al guardar')
    } finally {
      setSavingAll(false)
    }
  }, [dirtyIds, nodes, savingAll])

  // ── Warnings de nodos de sistema faltantes ─────────────────────────────
  const missingHardcoded = useMemo(() => {
    const keys = new Set(nodes.map((n) => n.node_key))
    const requiredKeys = new Set()

    for (const node of nodes) {
      if (node.type !== 'action') continue
      const deps = SYSTEM_NODE_DEPENDENCIES[node.action_type] || []
      for (const key of deps) requiredKeys.add(key)
    }

    return Array.from(requiredKeys).filter((k) => !keys.has(k))
  }, [nodes])

  // ══════════════════════════════════════════════════════════════════════
  //   RENDER
  // ══════════════════════════════════════════════════════════════════════
  return (
    <div>
      <div className="flex items-center justify-between gap-2" style={{ flexWrap: 'wrap' }}>
        <h1 className="page-title">Embudo</h1>
        <div className="funnel-control-panel">
          <span className={`live-indicator ${connected ? 'connected' : ''}`}>
            {connected ? 'En vivo' : 'Reconectando'}
          </span>
          <span className={`funnel-control-state ${funnelPaused ? 'paused' : 'active'}`}>
            {loadingControl ? 'Cargando control...' : funnelPaused ? 'Pausa global activa' : 'Bot activo'}
          </span>
          <button
            type="button"
            className={`funnel-control-toggle ${funnelPaused ? '' : 'active'}`}
            onClick={handleToggleFunnelPause}
            disabled={loadingControl || savingControl || !canManageControl}
            title={canManageControl
              ? (funnelPaused ? 'Reanudar respuestas automáticas' : 'Pausar respuestas automáticas')
              : 'Solo owner/admin puede cambiar este control'}
          >
            <span className="funnel-control-toggle-track" aria-hidden="true">
              <span className="funnel-control-toggle-thumb" />
            </span>
            <span>{savingControl ? 'Guardando...' : funnelPaused ? 'Reanudar bot' : 'Pausar bot'}</span>
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

      {controlError ? (
        <div className="inline-notice inline-notice-warning mt-4">{controlError}</div>
      ) : null}
      {controlToast ? (
        <div className={`inline-notice ${funnelPaused ? 'inline-notice-warning' : 'inline-notice-success'} mt-4`}>
          {controlToast}
        </div>
      ) : null}
      {!loadingControl && funnelPaused ? (
        <div className="inline-notice inline-notice-warning mt-4">
          El embudo está en pausa global: WA/Telegram sigue recibiendo y guardando mensajes, pero el chatbot no responde.
        </div>
      ) : null}

      {activeTab === 'flow' ? (
        <FlowEditor
          nodes={nodes}
          loading={loadingNodes}
          dirtyIds={dirtyIds}
          savingAll={savingAll}
          saveError={saveError}
          saveToast={saveToast}
          activePillId={activePillId}
          setActivePillId={setActivePillId}
          updateNode={updateNode}
          onAddNode={handleAddNode}
          onDuplicateNode={handleDuplicateNode}
          onDeleteNode={handleDeleteNode}
          onMoveNode={handleMoveNode}
          onSaveAll={handleSaveAll}
          missingHardcoded={missingHardcoded}
        />
      ) : (
        <SessionsView
          sessionSearch={sessionSearch}
          setSessionSearch={setSessionSearch}
          loadingSessions={loadingSessions}
          filteredSessions={filteredSessions}
          selectedSessionId={selectedSessionId}
          setSelectedSessionId={setSelectedSessionId}
          loadingSessionDetail={loadingSessionDetail}
          selectedSession={selectedSession}
        />
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
//   FLOW EDITOR
// ══════════════════════════════════════════════════════════════════════════
function FlowEditor({
  nodes,
  loading,
  dirtyIds,
  savingAll,
  saveError,
  saveToast,
  activePillId,
  setActivePillId,
  updateNode,
  onAddNode,
  onDuplicateNode,
  onDeleteNode,
  onMoveNode,
  onSaveAll,
  missingHardcoded,
}) {
  const dirtyCount = dirtyIds.size

  return (
    <div className="mt-4">
      <div className="fnl-toolbar mb-4" style={{ marginBottom: 'var(--space-4)' }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onSaveAll}
          disabled={savingAll || dirtyCount === 0}
        >
          <Icon name="save" size={14} />
          {savingAll ? 'Guardando...' : `Guardar${dirtyCount > 0 ? ` (${dirtyCount})` : ''}`}
        </button>
        {dirtyCount > 0 && !savingAll ? (
          <span className="fnl-dirty-indicator">
            <Icon name="alert-triangle" size={12} />
            {dirtyCount} {dirtyCount === 1 ? 'cambio sin guardar' : 'cambios sin guardar'}
          </span>
        ) : null}
        {saveToast ? (
          <span className="fnl-dirty-indicator" style={{ color: 'var(--color-success)' }}>
            <Icon name="check" size={12} />
            {saveToast}
          </span>
        ) : null}
      </div>

      {saveError ? (
        <div className="fnl-hardcoded-warn" style={{
          background: 'var(--color-danger-bg)',
          borderColor: 'var(--color-danger)',
          color: 'var(--color-danger)',
        }}>
          <Icon name="alert-triangle" size={14} />
          <span>{saveError}</span>
        </div>
      ) : null}

      {missingHardcoded.length > 0 && nodes.length > 0 ? (
        <div className="fnl-hardcoded-warn">
          <Icon name="alert-triangle" size={14} />
          <div>
            <div style={{ fontWeight: 600, marginBottom: 'var(--space-1)' }}>
              Faltan nodos de sistema que el motor referencia por nombre:
            </div>
            <div>
              {missingHardcoded.map((k, i) => (
                <span key={k}>
                  <code className="fnl-inline-code">{k}</code>
                  {i < missingHardcoded.length - 1 ? ', ' : ''}
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="fnl-layout">
        {/* Sidebar */}
        <aside className="fnl-sidebar">
          <div className="fnl-sidebar-title">Pasos del embudo</div>
          {loading ? (
            <div className="text-muted" style={{ padding: 'var(--space-3)' }}>Cargando...</div>
          ) : nodes.length === 0 ? (
            <div className="text-muted" style={{ padding: 'var(--space-3)' }}>Sin pasos todavía</div>
          ) : (
            nodes.map((n, i) => (
              <button
                type="button"
                key={n.id}
                className={`fnl-pill ${activePillId === n.id ? 'active' : ''}`}
                onClick={() => {
                  setActivePillId(n.id)
                  const el = document.getElementById(`fnl-card-${n.id}`)
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}
              >
                <div className="fnl-pill-num">{i + 1}</div>
                <span className="fnl-pill-label">{n.name || 'Sin nombre'}</span>
                {dirtyIds.has(n.id) ? <span className="fnl-pill-dirty" /> : null}
              </button>
            ))
          )}
          <button type="button" className="fnl-sidebar-add" onClick={onAddNode}>
            <Icon name="plus" size={14} />
            Agregar paso
          </button>
        </aside>

        {/* Canvas */}
        <div className="fnl-canvas">
          {loading ? (
            <div className="fnl-empty">Cargando nodos...</div>
          ) : nodes.length === 0 ? (
            <div className="fnl-empty">
              No hay pasos configurados todavía. Agregá el primero para empezar.
            </div>
          ) : (
            nodes.map((n, i) => (
              <div key={n.id} style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <NodeCard
                  node={n}
                  index={i}
                  total={nodes.length}
                  nodes={nodes}
                  dirty={dirtyIds.has(n.id)}
                  updateNode={updateNode}
                  onDuplicate={() => onDuplicateNode(n)}
                  onDelete={() => onDeleteNode(n)}
                  onMoveUp={() => onMoveNode(n.id, 'up')}
                  onMoveDown={() => onMoveNode(n.id, 'down')}
                />
                <div className="fnl-card-save-row">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={onSaveAll}
                    disabled={savingAll || dirtyCount === 0}
                  >
                    <Icon name="save" size={13} />
                    {savingAll ? 'Guardando...' : dirtyCount > 0 ? `Guardar todo (${dirtyCount})` : 'Guardar todo'}
                  </button>
                </div>
                {i < nodes.length - 1 ? <div className="fnl-connector" /> : null}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════
//   NODE CARD
// ══════════════════════════════════════════════════════════════════════════
function NodeCard({ node, index, total, nodes, dirty, updateNode, onDuplicate, onDelete, onMoveUp, onMoveDown }) {
  // Secciones expandibles
  const [openSend, setOpenSend] = useState(true)
  const [openProcess, setOpenProcess] = useState(false)
  const [openRoute, setOpenRoute] = useState(false)

  const textareaRef = useRef(null)

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
    }
  }, [node.message_text])

  // ── Badges ───────────────────────────────────────────────────────────
  const typeMeta = NODE_TYPES.find((t) => t.value === node.type) || NODE_TYPES[0]
  const destNode = nodes.find((x) => x.node_key === node.next_node_key)

  const badges = []
  badges.push(
    <span key="type" className="fnl-badge fnl-badge-type">
      <Icon name={typeMeta.icon} size={10} />
      {typeMeta.label}
    </span>
  )
  if (node.type === 'action' && node.action_type) {
    badges.push(
      <span key="action" className="fnl-badge fnl-badge-type">
        {ACTION_LABEL[node.action_type] || node.action_type}
      </span>
    )
  }
  if (node.type === 'open_question_detect' && (node.keywords?.length || 0) > 0) {
    badges.push(
      <span key="kw" className="fnl-badge fnl-badge-dest">
        {node.keywords.length} keyword{node.keywords.length === 1 ? '' : 's'}
      </span>
    )
  }
  if (node.type === 'options' && (node.options?.length || 0) > 0) {
    badges.push(
      <span key="btns" className="fnl-badge fnl-badge-dest">
        {node.options.length}/3 botones
      </span>
    )
  }
  if (node.type === 'capture_data' && node.capture_field) {
    badges.push(
      <span key="capture" className="fnl-badge fnl-badge-dest">
        Guarda {CAPTURE_FIELD_LABEL[node.capture_field] || node.capture_field}
      </span>
    )
  }
  if (destNode) {
    badges.push(
      <span key="dest" className="fnl-badge fnl-badge-dest">
        → {destNode.name || destNode.node_key}
      </span>
    )
  }

  // ── Handlers ─────────────────────────────────────────────────────────
  const setType = (nextType) => {
    const patch = { type: nextType }
    if (nextType === 'options' && !(node.options || []).length) {
      patch.options = [{ label: '', next_node_key: '' }]
    }
    if (nextType === 'capture_data' && !node.capture_field) {
      patch.capture_field = 'last_name'
    }
    updateNode(node.id, patch)
  }

  const insertWA = (char) => {
    const ta = textareaRef.current
    if (!ta) return
    const s = ta.selectionStart
    const e = ta.selectionEnd
    const v = ta.value
    const nextValue = s !== e
      ? v.slice(0, s) + char + v.slice(s, e) + char + v.slice(e)
      : v.slice(0, s) + char + char + v.slice(e)
    updateNode(node.id, { message_text: nextValue })
    requestAnimationFrame(() => {
      if (!ta) return
      ta.focus()
      const pos = s + 1
      ta.selectionStart = s !== e ? pos : pos
      ta.selectionEnd = s !== e ? e + 1 : pos
    })
  }

  const addOption = () => {
    const opts = [...(node.options || [])]
    if (opts.length >= 3) return
    opts.push({ label: '', next_node_key: '' })
    updateNode(node.id, { options: opts })
  }
  const removeOption = (idx) => {
    const opts = (node.options || []).filter((_, i) => i !== idx)
    updateNode(node.id, { options: opts })
  }
  const updateOption = (idx, field, value) => {
    const opts = (node.options || []).map((o, i) => (i === idx ? { ...o, [field]: value } : o))
    updateNode(node.id, { options: opts })
  }

  const keywordText = keywordsToText(node.keywords_input ?? node.keywords)

  // Validaciones inline (visual feedback)
  const needsAiPrompt = node.type === 'open_question_ai' && !node.ai_system_prompt?.trim()
  const needsCaptureField = node.type === 'capture_data' && !node.capture_field
  const needsActionType = node.type === 'action' && !node.action_type
  const hasHiddenConfig = (
    needsAiPrompt || needsCaptureField || needsActionType
    || (node.type === 'open_question_detect' && (node.keywords?.length || 0) === 0)
    || (node.type === 'options' && (node.options?.length || 0) === 0)
  )

  const routeLabel = node.type === 'action' ? 'Continuar a' : 'Siguiente paso'

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div id={`fnl-card-${node.id}`} className={`fnl-card ${dirty ? 'dirty' : ''}`}>
      {/* Header */}
      <div className="fnl-card-header">
        <div className="fnl-card-num">{index + 1}</div>
        <input
          className="fnl-card-title"
          value={node.name}
          placeholder="Nombre del paso"
          onChange={(e) => updateNode(node.id, { name: e.target.value })}
        />
        <span className="fnl-card-key" title="Identificador interno (no editable)">
          <Icon name="lock" size={10} />
          {node.node_key}
        </span>
        <div className="fnl-card-badges">{badges}</div>
        <label className="fnl-delay-chip" title={`Retraso antes de enviar (0-${MAX_SEND_DELAY_SECONDS} segundos)`}>
          <Icon name="clock-3" size={12} />
          <input
            type="number"
            min={0}
            max={MAX_SEND_DELAY_SECONDS}
            step={1}
            value={clampSendDelaySeconds(node.send_delay_seconds)}
            onChange={(event) => updateNode(node.id, { send_delay_seconds: clampSendDelaySeconds(event.target.value) })}
          />
          <span>s</span>
        </label>
        <div className="fnl-card-actions">
          <button
            type="button"
            className="fnl-icon-btn"
            title="Mover arriba"
            disabled={index === 0}
            onClick={onMoveUp}
          >
            <Icon name="arrow-up" />
          </button>
          <button
            type="button"
            className="fnl-icon-btn"
            title="Mover abajo"
            disabled={index === total - 1}
            onClick={onMoveDown}
          >
            <Icon name="arrow-down" />
          </button>
          <button
            type="button"
            className="fnl-icon-btn"
            title="Duplicar paso"
            onClick={onDuplicate}
          >
            <Icon name="copy" />
          </button>
          <IconConfirmButton onConfirm={onDelete} />
        </div>
      </div>

      {/* Type selector */}
      <div className="fnl-type-selector">
        {NODE_TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            className={`fnl-type-pill ${node.type === t.value ? 'active' : ''}`}
            onClick={() => setType(t.value)}
            title={t.help}
          >
            <Icon name={t.icon} size={14} />
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Sección 1: ENVÍO ── */}
      {node.type !== 'action' ? (
        <div className={`fnl-section ${openSend ? 'open' : ''}`}>
          <button type="button" className="fnl-section-header" onClick={() => setOpenSend((v) => !v)}>
            <div className="fnl-section-dot active" />
            <span className="fnl-section-label">1. Mensaje que verá el cliente</span>
            <span className="fnl-section-chevron">
              <Icon name="chevron-down" size={14} />
            </span>
          </button>
          {openSend ? (
            <div className="fnl-section-body">
              <div className="fnl-wa-toolbar">
                <button type="button" title="Negrita *texto*" onClick={() => insertWA('*')}>
                  <Icon name="bold" size={13} />
                </button>
                <button type="button" title="Cursiva _texto_" onClick={() => insertWA('_')}>
                  <Icon name="italic" size={13} />
                </button>
                <button type="button" title="Tachado ~texto~" onClick={() => insertWA('~')}>
                  <Icon name="strikethrough" size={13} />
                </button>
                <span className="fnl-wa-hint">Formato nativo de WhatsApp</span>
              </div>
              <textarea
                ref={textareaRef}
                className="fnl-textarea fnl-wa-textarea"
                value={node.message_text}
                placeholder="Escribí lo que verá el cliente. Usá variables entre corchetes como [NOMBRE_COMPLETO], [VENUE] o [FECHA]."
                rows={3}
                onChange={(e) => updateNode(node.id, { message_text: e.target.value })}
              />
              <div className="fnl-field-hint">
                El reloj del encabezado define cuántos segundos espera este paso antes de enviar su mensaje.
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── Sección 2: ESPERAR (informativa) ── */}
      {node.type === 'message' || node.type === 'action' ? null : (
        <div className="fnl-section">
          <div className="fnl-section-header" style={{ cursor: 'default' }}>
            <div className="fnl-section-dot" />
            <span className="fnl-section-label">
              2. Esperar respuesta del cliente — automático
            </span>
          </div>
        </div>
      )}

      {/* ── Sección 3: PROCESAR ── */}
      {node.type === 'open_question_ai' || node.type === 'capture_data' || node.type === 'open_question_detect' || node.type === 'action' ? (
        <div className={`fnl-section ${openProcess || hasHiddenConfig ? 'open' : ''}`}>
          <button type="button" className="fnl-section-header" onClick={() => setOpenProcess((v) => !v)}>
            <div className="fnl-section-dot process" />
            <span className="fnl-section-label">
              {node.type === 'open_question_ai'     ? '3. Procesar con IA' : null}
              {node.type === 'capture_data'         ? '3. Guardar dato capturado' : null}
              {node.type === 'open_question_detect' ? '3. Detectar palabras clave' : null}
              {node.type === 'action'                ? 'Acción automática del sistema' : null}
            </span>
            <span className="fnl-section-chevron">
              <Icon name="chevron-down" size={14} />
            </span>
          </button>
          {(openProcess || hasHiddenConfig) ? (
            <div className="fnl-section-body">
              {node.type === 'open_question_ai' ? (
                <div className="fnl-field">
                  <div className="fnl-field-label">Instrucción secreta para la IA</div>
                  <textarea
                    className={`fnl-textarea ${needsAiPrompt ? 'warn' : ''}`}
                    rows={3}
                    placeholder='Ej: Extrae solo el primer nombre del mensaje. Si no hay uno claro, responde "desconocido".'
                    value={node.ai_system_prompt}
                    onChange={(e) => updateNode(node.id, { ai_system_prompt: e.target.value })}
                  />
                  <div className="fnl-field-hint">
                    El cliente nunca ve esto. La IA (Groq) lo usa como system prompt para interpretar la respuesta.
                  </div>
                </div>
              ) : null}

              {node.type === 'open_question_detect' ? (
                <div className="fnl-field">
                  <div className="fnl-field-label">Palabras a detectar en la respuesta</div>
                  <input
                    type="text"
                    className="fnl-input"
                    value={keywordText}
                    placeholder="taller, interés, constelar, participar, etc."
                    onChange={(e) => updateNode(node.id, {
                      keywords_input: e.target.value,
                      keywords: normalizeKeywords(e.target.value),
                    })}
                  />
                  <div className="fnl-field-hint">
                    Usa comas para separar palabras o frases. No uses puntos. El sistema ignora mayúsculas y acentos automáticamente.
                  </div>
                </div>
              ) : null}

              {node.type === 'capture_data' ? (
                <div className="fnl-field">
                  <div className="fnl-field-label">Dato que se va a guardar</div>
                  <select
                    className={`fnl-select ${needsCaptureField ? 'warn' : ''}`}
                    value={node.capture_field || ''}
                    onChange={(e) => updateNode(node.id, { capture_field: e.target.value })}
                  >
                    <option value="">Elegir dato...</option>
                    {CAPTURE_FIELDS.map((field) => (
                      <option key={field.value} value={field.value}>{field.label}</option>
                    ))}
                  </select>
                  <div className="fnl-field-hint">
                    {(CAPTURE_FIELDS.find((field) => field.value === node.capture_field)?.help)
                      || 'Este nodo espera un dato puntual y lo guarda antes de pasar al siguiente paso.'}
                  </div>
                </div>
              ) : null}

              {node.type === 'action' ? (
                <>
                  <div className="fnl-field">
                    <div className="fnl-field-label">¿Qué hace el sistema en este paso?</div>
                    <select
                      className={`fnl-select ${needsActionType ? 'warn' : ''}`}
                      value={node.action_type || ''}
                      onChange={(e) => updateNode(node.id, { action_type: e.target.value })}
                    >
                      <option value="">Elegir acción...</option>
                      {ACTION_TYPES.map((a) => (
                        <option key={a.value} value={a.value}>{a.label}</option>
                      ))}
                    </select>
                  </div>
                  {node.action_type ? (
                    <div className="fnl-action-panel">
                      {(() => {
                        const meta = ACTION_TYPES.find((a) => a.value === node.action_type)
                        if (!meta) return null
                        return (
                          <>
                            <div className={`fnl-action-panel-title ${meta.value === 'escalate' ? 'danger' : ''}`}>
                              <Icon name={meta.icon} size={12} />
                              Cómo funciona
                            </div>
                            <div className="fnl-field-hint" style={{ fontSize: 'var(--font-size-xs)' }}>
                              {meta.help}
                            </div>
                          </>
                        )
                      })()}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── Sección 4: ENRUTAR ── */}
      <div className={`fnl-section ${openRoute ? 'open' : ''}`}>
        <button type="button" className="fnl-section-header" onClick={() => setOpenRoute((v) => !v)}>
          <div className="fnl-section-dot route" />
          <span className="fnl-section-label">
            {node.type === 'open_question_detect' ? '4. Enrutar según detección' : null}
            {node.type === 'options'               ? 'Botones de respuesta rápida' : null}
            {(node.type !== 'open_question_detect' && node.type !== 'options') ? `4. ${routeLabel}` : null}
          </span>
          <span className="fnl-section-chevron">
            <Icon name="chevron-down" size={14} />
          </span>
        </button>
        {openRoute ? (
          <div className="fnl-section-body">
            {node.type === 'open_question_detect' ? (
              <div className="fnl-split-grid">
                <div>
                  <div className="fnl-split-label ok">
                    <Icon name="check" size={11} />
                    Si detecta las palabras
                  </div>
                  <NodeKeySelect
                    nodes={nodes}
                    excludeKey={node.node_key}
                    value={node.keyword_match_next}
                    onChange={(v) => updateNode(node.id, { keyword_match_next: v })}
                    className="ok"
                  />
                </div>
                <div>
                  <div className="fnl-split-label danger">
                    <Icon name="x" size={11} />
                    Si NO las detecta
                  </div>
                  <NodeKeySelect
                    nodes={nodes}
                    excludeKey={node.node_key}
                    value={node.keyword_nomatch_next}
                    onChange={(v) => updateNode(node.id, { keyword_nomatch_next: v })}
                    className="danger"
                  />
                </div>
              </div>
            ) : null}

            {node.type === 'options' ? (
              <>
                {(node.options || []).map((btn, idx) => {
                  const len = (btn.label || '').length
                  const warn = len >= 17
                  const over = len > 20
                  return (
                    <div key={`btn-${idx}`} className="fnl-btn-row">
                      <input
                        type="text"
                        value={btn.label || ''}
                        maxLength={24}
                        placeholder="Texto del botón..."
                        onChange={(e) => updateOption(idx, 'label', e.target.value)}
                      />
                      <div className={`fnl-btn-count ${over ? 'over' : warn ? 'warn' : ''}`}>
                        {len}/20
                      </div>
                      <div className="fnl-btn-row-divider" />
                      <select
                        value={btn.next_node_key || ''}
                        onChange={(e) => updateOption(idx, 'next_node_key', e.target.value)}
                      >
                        <option value="">Ir a...</option>
                        {nodes.filter((x) => x.node_key !== node.node_key).map((x) => (
                          <option key={x.id} value={x.node_key}>{x.name || x.node_key}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="fnl-btn-del"
                        onClick={() => removeOption(idx)}
                        title="Quitar botón"
                      >
                        <Icon name="x" size={12} />
                      </button>
                    </div>
                  )
                })}
                <button
                  type="button"
                  className="fnl-add-inline"
                  disabled={(node.options || []).length >= 3}
                  onClick={addOption}
                >
                  <Icon name="plus" size={13} />
                  {(node.options || []).length >= 3 ? 'Máximo 3 botones' : 'Agregar botón'}
                </button>
                <div className="fnl-field-hint" style={{ marginTop: 'var(--space-2)' }}>
                  WhatsApp permite hasta 3 botones de respuesta rápida, 20 caracteres cada uno.
                </div>
              </>
            ) : null}

            {(node.type !== 'open_question_detect' && node.type !== 'options') ? (
              <div className="fnl-field" style={{ marginBottom: 0 }}>
                <NodeKeySelect
                  nodes={nodes}
                  excludeKey={node.node_key}
                  value={node.next_node_key}
                  onChange={(v) => updateNode(node.id, { next_node_key: v })}
                />
                {node.type === 'action' && node.action_type === 'escalate' ? (
                  <div className="fnl-field-hint">
                    La acción <code className="fnl-inline-code">escalate</code> detiene el bot. El siguiente paso se ignora.
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

// ── Select de node_key con placeholder ────────────────────────────────────
function NodeKeySelect({ nodes, excludeKey, value, onChange, className = '' }) {
  return (
    <select
      className={`fnl-select ${className}`}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Sin siguiente paso</option>
      {nodes
        .filter((n) => n.node_key !== excludeKey)
        .map((n) => (
          <option key={n.id} value={n.node_key}>
            {n.name || 'Sin nombre'} · {n.node_key}
          </option>
        ))}
    </select>
  )
}

// ══════════════════════════════════════════════════════════════════════════
//   SESSIONS VIEW (sin cambios respecto a la versión previa)
// ══════════════════════════════════════════════════════════════════════════
function SessionsView({
  sessionSearch,
  setSessionSearch,
  loadingSessions,
  filteredSessions,
  selectedSessionId,
  setSelectedSessionId,
  loadingSessionDetail,
  selectedSession,
}) {
  return (
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
                            {item.node_key} · {TYPE_LABEL[item.type] || item.type}
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
