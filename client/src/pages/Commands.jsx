import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/layout/Sidebar'
import { useAdminEvents } from '../hooks/useAdminEvents'
import { apiGet, apiPost, apiPut } from '../utils/api'
import { formatCurrency, formatDateTime, timeAgo } from '../utils/dates'

const LEAD_STATUS_LABELS = {
  new: 'Nuevo',
  qualifying: 'Calificando',
  qualified: 'Calificado',
  negotiating: 'Negociando',
  converted: 'Convertido',
  lost: 'Perdido',
  dormant: 'Dormido',
}

const CONVERSATION_STATUS_LABELS = {
  active: 'Bot activo',
  escalated: 'Escalado',
  converted: 'Convertida',
  lost: 'Perdida',
  dormant: 'Dormida',
}

const ACTIONS = [
  {
    id: 'resume-bot',
    label: 'Reanudar bot',
    icon: 'zap',
    tone: 'primary',
    description: 'Reactiva la conversación y devuelve el control al bot.',
  },
  {
    id: 'stop-bot',
    label: 'Detener bot',
    icon: 'x',
    tone: 'danger',
    description: 'Escala la conversación y evita que el bot siga respondiendo.',
  },
  {
    id: 'send-qr',
    label: 'Mandar QR',
    icon: 'qr',
    tone: 'secondary',
    description: 'Reenvía el QR de pago de la inscripción elegida.',
  },
  {
    id: 'payment-reminder',
    label: 'Recordar pago',
    icon: 'dollar-sign',
    tone: 'secondary',
    description: 'Reenvía las instrucciones de pago al lead.',
  },
  {
    id: 'practical-info',
    label: 'Datos prácticos',
    icon: 'message-circle',
    tone: 'secondary',
    description: 'Envía un mensaje operativo usando variables del taller y del lead.',
  },
]

function initialQuickSettings() {
  return {
    global_open_question_context: '',
    practical_info_template: '',
    text_buffer_idle_ms: 4000,
    text_buffer_max_messages: 5,
    text_buffer_max_window_ms: 12000,
  }
}

function pickPreferredConversation(conversations = []) {
  if (!conversations.length) return null
  return (
    conversations.find((item) => item.status === 'escalated')
    || conversations.find((item) => item.status === 'active')
    || conversations[0]
  )
}

function pickPreferredEnrollment(enrollments = []) {
  if (!enrollments.length) return null
  return (
    enrollments.find((item) => item.payment_status === 'unpaid')
    || enrollments.find((item) => item.status === 'pending')
    || enrollments[0]
  )
}

function getLeadBadgeClass(status) {
  if (status === 'converted') return 'badge badge-success'
  if (status === 'lost') return 'badge badge-danger'
  if (status === 'negotiating' || status === 'qualified') return 'badge badge-warning'
  return 'badge badge-info'
}

function getConversationBadgeClass(status) {
  if (status === 'escalated') return 'badge badge-warning'
  if (status === 'converted') return 'badge badge-success'
  return 'badge badge-info'
}

function getActionButtonClass(tone, isActive) {
  const base = 'commands-action-card'
  if (isActive) {
    if (tone === 'danger') return `${base} active danger`
    if (tone === 'primary') return `${base} active primary`
    return `${base} active`
  }
  if (tone === 'danger') return `${base} danger`
  if (tone === 'primary') return `${base} primary`
  return base
}

export default function Commands() {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query.trim())
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [selectedLead, setSelectedLead] = useState(null)
  const [loadingLead, setLoadingLead] = useState(false)
  const [activeAction, setActiveAction] = useState(null)
  const [actionLoading, setActionLoading] = useState('')
  const [actionResult, setActionResult] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [quickSettings, setQuickSettings] = useState(initialQuickSettings())
  const [settingsDirty, setSettingsDirty] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [selectedConversationId, setSelectedConversationId] = useState('')
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState('')
  const [practicalDraft, setPracticalDraft] = useState('')

  const currentConversation = useMemo(
    () => (selectedLead?.conversations || []).find((item) => String(item.id) === String(selectedConversationId)) || null,
    [selectedConversationId, selectedLead?.conversations]
  )
  const currentEnrollment = useMemo(
    () => (selectedLead?.enrollments || []).find((item) => String(item.id) === String(selectedEnrollmentId)) || null,
    [selectedEnrollmentId, selectedLead?.enrollments]
  )

  const applyLeadDetail = useCallback((detail) => {
    const nextConversation = (
      (detail.conversations || []).find((item) => String(item.id) === String(selectedConversationId))
      || pickPreferredConversation(detail.conversations || [])
      || null
    )
    const nextEnrollment = (
      (detail.enrollments || []).find((item) => String(item.id) === String(selectedEnrollmentId))
      || pickPreferredEnrollment(detail.enrollments || [])
      || null
    )

    startTransition(() => {
      setSelectedLead(detail)
      setSelectedConversationId(nextConversation ? String(nextConversation.id) : '')
      setSelectedEnrollmentId(nextEnrollment ? String(nextEnrollment.id) : '')
    })
  }, [selectedConversationId, selectedEnrollmentId])

  const loadLeadDetail = useCallback(async (leadId) => {
    if (!leadId) return
    setLoadingLead(true)
    try {
      const detail = await apiGet(`/api/leads/${leadId}`)
      applyLeadDetail(detail)
      setPracticalDraft((current) => current || quickSettings.practical_info_template || '')
    } catch (err) {
      alert(err.message)
    } finally {
      setLoadingLead(false)
    }
  }, [applyLeadDetail, quickSettings.practical_info_template])

  const loadQuickSettings = useCallback(async () => {
    try {
      const settings = await apiGet('/api/settings/llm')
      setQuickSettings(settings)
      setSettingsDirty(false)
      setPracticalDraft((current) => current || settings.practical_info_template || '')
    } catch {
      // Silencio: el panel sigue siendo usable sin refrescar config
    }
  }, [])

  useEffect(() => {
    loadQuickSettings()
  }, [loadQuickSettings])

  useEffect(() => {
    if (deferredQuery.length < 2) {
      setResults([])
      setSearching(false)
      return undefined
    }

    let cancelled = false
    setSearching(true)
    const timeout = window.setTimeout(async () => {
      try {
        const response = await apiGet(`/api/leads?search=${encodeURIComponent(deferredQuery)}&limit=12`)
        if (!cancelled) {
          setResults(response.data || [])
        }
      } catch (err) {
        if (!cancelled) {
          setResults([])
        }
      } finally {
        if (!cancelled) {
          setSearching(false)
        }
      }
    }, 220)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [deferredQuery])

  useAdminEvents({
    'lead:change': (payload) => {
      if (selectedLead?.id && Number(payload?.id) === Number(selectedLead.id)) {
        loadLeadDetail(selectedLead.id)
      }
    },
    'conversation:change': (payload) => {
      const hasConversation = (selectedLead?.conversations || []).some((item) => Number(item.id) === Number(payload?.id))
      if (selectedLead?.id && hasConversation) {
        loadLeadDetail(selectedLead.id)
      }
    },
  }, Boolean(selectedLead?.id))

  function handleSelectLead(leadRow) {
    setActionResult(null)
    setActiveAction(null)
    setQuery('')
    setResults([])
    setPracticalDraft(quickSettings.practical_info_template || '')
    loadLeadDetail(leadRow.id)
  }

  function clearLead() {
    setSelectedLead(null)
    setSelectedConversationId('')
    setSelectedEnrollmentId('')
    setActiveAction(null)
    setActionResult(null)
    setPracticalDraft(quickSettings.practical_info_template || '')
  }

  async function executeAction(actionId) {
    if (!selectedLead) return
    setActionLoading(actionId)
    setActionResult(null)

    try {
      if (actionId === 'resume-bot') {
        if (!selectedConversationId) {
          throw new Error('Este lead no tiene conversación para reanudar')
        }
        const response = await apiPost(`/api/conversations/${selectedConversationId}/resume-bot`, { node_key: null })
        setActionResult({
          success: true,
          title: 'Bot reanudado',
          detail: response.responses_sent > 0
            ? `Se reenviaron ${response.responses_sent} mensaje(s) desde ${response.resumed_node_name || response.resumed_node_key}.`
            : 'La conversación volvió a quedar en manos del bot.',
        })
      }

      if (actionId === 'stop-bot') {
        if (!selectedConversationId) {
          throw new Error('Este lead no tiene conversación para pausar')
        }
        await apiPost(`/api/conversations/${selectedConversationId}/stop-bot`, {})
        setActionResult({
          success: true,
          title: 'Bot detenido',
          detail: 'La conversación quedó escalada para atención manual.',
        })
      }

      if (actionId === 'send-qr') {
        if (!selectedEnrollmentId) {
          throw new Error('No hay inscripción disponible para reenviar QR')
        }
        const response = await apiPost(`/api/enrollments/${selectedEnrollmentId}/resend-qr`, {})
        setActionResult({
          success: true,
          title: 'QR reenviado',
          detail: response?.result?.amount
            ? `Se reenviaron datos de cobro por ${formatCurrency(response.result.amount)}.`
            : 'El QR salió nuevamente por el canal del lead.',
        })
      }

      if (actionId === 'payment-reminder') {
        if (!selectedEnrollmentId) {
          throw new Error('No hay inscripción disponible para recordar el pago')
        }
        await apiPost(`/api/enrollments/${selectedEnrollmentId}/resend-instructions`, {})
        setActionResult({
          success: true,
          title: 'Recordatorio enviado',
          detail: 'Se reenviaron las instrucciones de pago del taller.',
        })
      }

      if (actionId === 'practical-info') {
        if (!selectedConversationId) {
          throw new Error('Este lead no tiene conversación para enviar datos prácticos')
        }
        if (!practicalDraft.trim()) {
          throw new Error('Escribe un template de datos prácticos antes de enviar')
        }
        const response = await apiPost(`/api/conversations/${selectedConversationId}/send-practical-info`, {
          enrollment_id: selectedEnrollmentId || null,
          template: practicalDraft,
        })
        setActionResult({
          success: true,
          title: 'Datos prácticos enviados',
          detail: response.workshop_name
            ? `Mensaje enviado usando datos de ${response.workshop_name}.`
            : 'Mensaje operativo enviado correctamente.',
        })
      }

      await loadLeadDetail(selectedLead.id)
    } catch (err) {
      setActionResult({
        success: false,
        title: 'Acción no ejecutada',
        detail: err.message,
      })
    } finally {
      setActionLoading('')
    }
  }

  async function saveQuickSettings() {
    setSettingsSaving(true)
    try {
      const payload = {
        practical_info_template: quickSettings.practical_info_template,
        text_buffer_idle_ms: Number(quickSettings.text_buffer_idle_ms),
        text_buffer_max_messages: Number(quickSettings.text_buffer_max_messages),
        text_buffer_max_window_ms: Number(quickSettings.text_buffer_max_window_ms),
      }
      const updated = await apiPut('/api/settings/llm', payload)
      setQuickSettings(updated)
      setSettingsDirty(false)
      setPracticalDraft(updated.practical_info_template || '')
      setActionResult({
        success: true,
        title: 'Ajustes guardados',
        detail: 'El panel ya usa los nuevos tiempos y template práctico.',
      })
    } catch (err) {
      setActionResult({
        success: false,
        title: 'No se guardaron los ajustes',
        detail: err.message,
      })
    } finally {
      setSettingsSaving(false)
    }
  }

  function updateQuickSetting(key, value) {
    setQuickSettings((current) => ({
      ...current,
      [key]: value,
    }))
    setSettingsDirty(true)
  }

  const leadHeaderConversation = currentConversation || pickPreferredConversation(selectedLead?.conversations || [])
  const leadHeaderEnrollment = currentEnrollment || pickPreferredEnrollment(selectedLead?.enrollments || [])

  return (
    <div className="commands-shell">
      <div className="commands-head">
        <div>
          <h1 className="page-title">Comandos</h1>
          <div className="text-muted">
            Acciones rápidas sobre leads, conversación y cobro sin entrar a varios módulos.
          </div>
        </div>
      </div>

      <div className="card mt-4">
        <div className="commands-search-row">
          <div className="commands-search-input-wrap">
            <Icon name="message-circle" size={18} />
            <input
              className="input commands-search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar lead por nombre o celular..."
            />
          </div>
          {selectedLead ? (
            <button type="button" className="btn btn-ghost" onClick={clearLead}>
              Limpiar
            </button>
          ) : null}
        </div>

        {searching ? (
          <div className="text-muted text-sm mt-4">Buscando leads...</div>
        ) : null}

        {!searching && query.trim().length >= 2 && results.length === 0 ? (
          <div className="text-muted text-sm mt-4">No se encontraron leads.</div>
        ) : null}

        {!selectedLead && results.length > 0 ? (
          <div className="commands-result-list mt-4">
            {results.map((lead) => (
              <button
                key={lead.id}
                type="button"
                className="commands-result-row"
                onClick={() => handleSelectLead(lead)}
              >
                <div>
                  <div className="font-semibold">{lead.name || 'Sin nombre'}</div>
                  <div className="text-sm text-secondary">{lead.phone || 'Sin celular'} · {lead.city || 'Sin ciudad'}</div>
                </div>
                <div className={getLeadBadgeClass(lead.status)}>
                  {LEAD_STATUS_LABELS[lead.status] || lead.status || 'Lead'}
                </div>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {loadingLead ? (
        <div className="card mt-4 text-muted">Cargando ficha del lead...</div>
      ) : null}

      {selectedLead ? (
        <div className="commands-layout mt-4">
          <div className="commands-main">
            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">{selectedLead.name || 'Sin nombre'}</h2>
                  <div className="text-sm text-muted">
                    {selectedLead.phone || 'Sin celular'} · {selectedLead.city || 'Sin ciudad'} · {selectedLead.source || 'Sin fuente'}
                  </div>
                </div>
                <div className="commands-chip-wrap">
                  <span className={getLeadBadgeClass(selectedLead.status)}>
                    {LEAD_STATUS_LABELS[selectedLead.status] || selectedLead.status || 'Lead'}
                  </span>
                  {leadHeaderConversation ? (
                    <span className={getConversationBadgeClass(leadHeaderConversation.status)}>
                      {CONVERSATION_STATUS_LABELS[leadHeaderConversation.status] || leadHeaderConversation.status}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="lead-summary-grid">
                <LeadMeta label="Último contacto" value={selectedLead.last_contact_at ? timeAgo(selectedLead.last_contact_at) : '—'} />
                <LeadMeta label="Conversaciones" value={String(selectedLead.conversations?.length || 0)} />
                <LeadMeta label="Inscripciones" value={String(selectedLead.enrollments?.length || 0)} />
                <LeadMeta label="Pago actual" value={leadHeaderEnrollment ? `${leadHeaderEnrollment.payment_status || leadHeaderEnrollment.status}` : '—'} />
              </div>

              <div className="commands-context-grid mt-4">
                <div className="commands-context-card">
                  <div className="commands-context-title">Conversación activa</div>
                  {leadHeaderConversation ? (
                    <>
                      <div className="font-semibold mt-1">{leadHeaderConversation.workshop_name || 'Sin taller'}</div>
                      <div className="text-sm text-secondary mt-1">
                        {CONVERSATION_STATUS_LABELS[leadHeaderConversation.status] || leadHeaderConversation.status} · {leadHeaderConversation.assigned_to || 'bot'}
                      </div>
                      <div className="text-xs text-muted mt-1">
                        {leadHeaderConversation.escalation_reason || 'Sin motivo de escalamiento'}
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-muted mt-1">Este lead todavía no tiene conversación vinculada.</div>
                  )}
                </div>

                <div className="commands-context-card">
                  <div className="commands-context-title">Inscripción útil</div>
                  {leadHeaderEnrollment ? (
                    <>
                      <div className="font-semibold mt-1">{leadHeaderEnrollment.workshop_name || 'Sin taller'}</div>
                      <div className="text-sm text-secondary mt-1">
                        {leadHeaderEnrollment.payment_status || leadHeaderEnrollment.status}
                        {leadHeaderEnrollment.amount_due ? ` · ${formatCurrency(leadHeaderEnrollment.amount_due)}` : ''}
                      </div>
                      <div className="text-xs text-muted mt-1">
                        {leadHeaderEnrollment.payment_requested_at
                          ? `Pedido ${formatDateTime(leadHeaderEnrollment.payment_requested_at)}`
                          : 'Sin recordatorio de pago todavía'}
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-muted mt-1">No hay inscripción lista para QR o cobro.</div>
                  )}
                </div>
              </div>
            </div>

            <div className="card mt-4">
              <div className="card-header">
                <h2 className="card-title">Acciones rápidas</h2>
              </div>

              <div className="commands-actions-grid">
                {ACTIONS.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    className={getActionButtonClass(action.tone, activeAction === action.id)}
                    onClick={() => setActiveAction((current) => current === action.id ? null : action.id)}
                  >
                    <Icon name={action.icon} size={18} />
                    <span>{action.label}</span>
                  </button>
                ))}
              </div>

              {activeAction ? (
                <div className="commands-action-panel">
                  <ActionPanel
                    actionId={activeAction}
                    currentConversation={currentConversation}
                    currentEnrollment={currentEnrollment}
                    conversations={selectedLead.conversations || []}
                    enrollments={selectedLead.enrollments || []}
                    selectedConversationId={selectedConversationId}
                    setSelectedConversationId={setSelectedConversationId}
                    selectedEnrollmentId={selectedEnrollmentId}
                    setSelectedEnrollmentId={setSelectedEnrollmentId}
                    practicalDraft={practicalDraft}
                    setPracticalDraft={setPracticalDraft}
                    quickSettings={quickSettings}
                    actionLoading={actionLoading}
                    onExecute={executeAction}
                  />
                </div>
              ) : (
                <div className="text-sm text-muted mt-4">
                  Elige una acción para abrir su panel contextual.
                </div>
              )}
            </div>

            {actionResult ? (
              <div className={`inline-notice mt-4 ${actionResult.success ? 'inline-notice-success' : 'inline-notice-warning'}`}>
                <div className="font-semibold">{actionResult.title}</div>
                {actionResult.detail ? <div className="text-sm mt-1">{actionResult.detail}</div> : null}
              </div>
            ) : null}
          </div>

          <div className="commands-side">
            <div className="card">
              <button
                type="button"
                className="commands-settings-toggle"
                onClick={() => setSettingsOpen((current) => !current)}
              >
                <span className="font-semibold">Ajustes rápidos</span>
                <span className="text-muted text-sm">{settingsOpen ? 'Ocultar' : 'Abrir'}</span>
              </button>

              {settingsOpen ? (
                <div className="commands-settings-body">
                  <div className="form-group">
                    <label>Buffer: pausa mínima antes de responder (ms)</label>
                    <input
                      className="input"
                      type="number"
                      min="500"
                      step="100"
                      value={quickSettings.text_buffer_idle_ms}
                      onChange={(event) => updateQuickSetting('text_buffer_idle_ms', event.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label>Buffer: máximo de mensajes agrupados</label>
                    <input
                      className="input"
                      type="number"
                      min="1"
                      max="20"
                      value={quickSettings.text_buffer_max_messages}
                      onChange={(event) => updateQuickSetting('text_buffer_max_messages', event.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label>Buffer: ventana máxima acumulada (ms)</label>
                    <input
                      className="input"
                      type="number"
                      min="1000"
                      step="500"
                      value={quickSettings.text_buffer_max_window_ms}
                      onChange={(event) => updateQuickSetting('text_buffer_max_window_ms', event.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label>Template de datos prácticos</label>
                    <textarea
                      className="input textarea"
                      rows={12}
                      value={quickSettings.practical_info_template}
                      onChange={(event) => updateQuickSetting('practical_info_template', event.target.value)}
                    />
                  </div>

                  <div className="text-muted text-sm">
                    Variables disponibles: [NOMBRE], [NOMBRE_COMPLETO], [CELULAR], [TALLER], [FECHA], [HORA_INICIO], [HORA_FIN], [VENUE], [VENUE_DIRECCION], [MODALIDAD], [MONTO], [PRECIO], [PRECIO_NORMAL], [PRECIO_EARLY_BIRD], [PRECIO_GRUPAL].
                  </div>

                  <button type="button" className="btn btn-primary mt-4" onClick={saveQuickSettings} disabled={settingsSaving}>
                    {settingsSaving ? 'Guardando...' : 'Guardar ajustes rápidos'}
                  </button>

                  <div className="mt-4">
                    {settingsSaving ? (
                      <span className="badge badge-info">Guardando...</span>
                    ) : settingsDirty ? (
                      <span className="badge badge-warning">Hay cambios sin guardar</span>
                    ) : (
                      <span className="badge badge-success">Sin cambios pendientes</span>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <div className="card mt-4">
          <div className="commands-empty">
            Busca un lead y abre acciones rápidas para reanudar bot, detenerlo, reenviar QR, recordar pago o mandar datos prácticos.
          </div>
        </div>
      )}
    </div>
  )
}

function ActionPanel({
  actionId,
  currentConversation,
  currentEnrollment,
  conversations,
  enrollments,
  selectedConversationId,
  setSelectedConversationId,
  selectedEnrollmentId,
  setSelectedEnrollmentId,
  practicalDraft,
  setPracticalDraft,
  quickSettings,
  actionLoading,
  onExecute,
}) {
  const action = ACTIONS.find((item) => item.id === actionId)
  if (!action) return null

  return (
    <div>
      <div className="commands-action-title">
        <Icon name={action.icon} size={16} />
        <span>{action.label}</span>
      </div>
      <div className="text-sm text-muted mt-1">{action.description}</div>

      {(actionId === 'resume-bot' || actionId === 'stop-bot' || actionId === 'practical-info') ? (
        <div className="form-group mt-4">
          <label>Conversación</label>
          <select
            className="input"
            value={selectedConversationId}
            onChange={(event) => setSelectedConversationId(event.target.value)}
          >
            {conversations.length === 0 ? (
              <option value="">Sin conversaciones</option>
            ) : conversations.map((conversation) => (
              <option key={conversation.id} value={conversation.id}>
                {(conversation.workshop_name || 'General')} · {CONVERSATION_STATUS_LABELS[conversation.status] || conversation.status}
              </option>
            ))}
          </select>
          {currentConversation ? (
            <div className="text-xs text-muted mt-1">
              Asignada a {currentConversation.assigned_to || 'bot'} · fase {currentConversation.current_phase || 'sin fase'}
            </div>
          ) : null}
        </div>
      ) : null}

      {(actionId === 'send-qr' || actionId === 'payment-reminder' || actionId === 'practical-info') ? (
        <div className="form-group mt-4">
          <label>Inscripción</label>
          <select
            className="input"
            value={selectedEnrollmentId}
            onChange={(event) => setSelectedEnrollmentId(event.target.value)}
          >
            {enrollments.length === 0 ? (
              <option value="">Sin inscripciones</option>
            ) : enrollments.map((enrollment) => (
              <option key={enrollment.id} value={enrollment.id}>
                {(enrollment.workshop_name || 'Sin taller')} · {enrollment.payment_status || enrollment.status}
              </option>
            ))}
          </select>
          {currentEnrollment ? (
            <div className="text-xs text-muted mt-1">
              {currentEnrollment.amount_due ? `${formatCurrency(currentEnrollment.amount_due)} · ` : ''}
              {currentEnrollment.payment_requested_at ? `pedido ${formatDateTime(currentEnrollment.payment_requested_at)}` : 'sin pedido de cobro'}
            </div>
          ) : null}
        </div>
      ) : null}

      {actionId === 'practical-info' ? (
        <div className="form-group mt-4">
          <label>Mensaje a enviar</label>
          <textarea
            className="input textarea"
            rows={10}
            value={practicalDraft}
            onChange={(event) => setPracticalDraft(event.target.value)}
            placeholder={quickSettings.practical_info_template}
          />
        </div>
      ) : null}

      <button
        type="button"
        className={`btn mt-4 ${action.tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
        onClick={() => onExecute(actionId)}
        disabled={actionLoading === actionId}
      >
        {actionLoading === actionId ? 'Ejecutando...' : action.label}
      </button>
    </div>
  )
}

function LeadMeta({ label, value }) {
  return (
    <div className="lead-meta-card">
      <div className="text-muted text-sm">{label}</div>
      <div className="font-semibold mt-1">{value}</div>
    </div>
  )
}
