import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
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
    description: 'Devuelve la conversación al flujo automático.',
  },
  {
    id: 'stop-bot',
    label: 'Detener bot',
    icon: 'x',
    tone: 'danger',
    description: 'Escala la conversación y corta nuevas respuestas del bot.',
  },
  {
    id: 'send-qr',
    label: 'Mandar QR',
    icon: 'qr',
    tone: 'secondary',
    description: 'Reenvía el QR de pago de la inscripción activa.',
  },
  {
    id: 'payment-reminder',
    label: 'Recordar pago',
    icon: 'dollar-sign',
    tone: 'secondary',
    description: 'Vuelve a mandar las instrucciones de cobro.',
  },
  {
    id: 'practical-info',
    label: 'Datos prácticos',
    icon: 'message-circle',
    tone: 'secondary',
    description: 'Envía ubicación, fecha y demás datos usando variables.',
  },
]

function initialQuickSettings() {
  return {
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

function getActionRowClass(tone, isActive) {
  const base = 'commands-action-row'
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
  const searchRef = useRef(null)

  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query.trim())
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [recentLeads, setRecentLeads] = useState([])
  const [loadingRecent, setLoadingRecent] = useState(true)
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

  const loadQuickSettings = useCallback(async () => {
    try {
      const settings = await apiGet('/api/ai/settings')
      setQuickSettings((current) => ({
        ...current,
        practical_info_template: settings.practical_info_template || '',
        text_buffer_idle_ms: settings.text_buffer_idle_ms ?? current.text_buffer_idle_ms,
        text_buffer_max_messages: settings.text_buffer_max_messages ?? current.text_buffer_max_messages,
        text_buffer_max_window_ms: settings.text_buffer_max_window_ms ?? current.text_buffer_max_window_ms,
      }))
      setSettingsDirty(false)
      setPracticalDraft((current) => current || settings.practical_info_template || '')
    } catch {
      // El módulo sigue siendo usable aunque no refresque la configuración global
    }
  }, [])

  const loadRecentLeads = useCallback(async () => {
    setLoadingRecent(true)
    try {
      const response = await apiGet('/api/leads?view=commands_recent&limit=4')
      setRecentLeads(response.data || [])
    } catch {
      setRecentLeads([])
    } finally {
      setLoadingRecent(false)
    }
  }, [])

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
      setActionResult({
        success: false,
        title: 'No se pudo cargar el lead',
        detail: err.message,
      })
    } finally {
      setLoadingLead(false)
    }
  }, [applyLeadDetail, quickSettings.practical_info_template])

  useEffect(() => {
    loadQuickSettings()
    loadRecentLeads()
    searchRef.current?.focus()
  }, [loadQuickSettings, loadRecentLeads])

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
        if (!cancelled) setResults(response.data || [])
      } catch {
        if (!cancelled) setResults([])
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 220)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [deferredQuery])

  useAdminEvents({
    'lead:change': (payload) => {
      loadRecentLeads()
      if (selectedLead?.id && Number(payload?.id) === Number(selectedLead.id)) {
        loadLeadDetail(selectedLead.id)
      }
    },
    'conversation:change': (payload) => {
      loadRecentLeads()
      const hasConversation = (selectedLead?.conversations || []).some((item) => Number(item.id) === Number(payload?.id))
      if (selectedLead?.id && hasConversation) {
        loadLeadDetail(selectedLead.id)
      }
    },
  }, true)

  function handleSelectLead(leadRow) {
    if (Number(leadRow.id) === Number(selectedLead?.id)) {
      clearLead()
      return
    }
    setActionResult(null)
    setActiveAction(null)
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
      switch (actionId) {
        case 'resume-bot': {
          if (!selectedConversationId) throw new Error('Este lead no tiene conversación para reanudar')
          const response = await apiPost(`/api/conversations/${selectedConversationId}/resume-bot`, { node_key: null })
          setActionResult({
            success: true,
            title: 'Bot reanudado',
            detail: response.responses_sent > 0
              ? `Se reenviaron ${response.responses_sent} mensaje(s) desde ${response.resumed_node_name || response.resumed_node_key}.`
              : 'La conversación volvió a quedar en manos del bot.',
          })
          break
        }

        case 'stop-bot': {
          if (!selectedConversationId) throw new Error('Este lead no tiene conversación para pausar')
          await apiPost(`/api/conversations/${selectedConversationId}/stop-bot`, {})
          setActionResult({
            success: true,
            title: 'Bot detenido',
            detail: 'La conversación quedó escalada para atención manual.',
          })
          break
        }

        case 'send-qr': {
          if (!selectedEnrollmentId) throw new Error('No hay inscripción disponible para reenviar QR')
          const response = await apiPost(`/api/enrollments/${selectedEnrollmentId}/resend-qr`, {})
          setActionResult({
            success: true,
            title: 'QR reenviado',
            detail: response?.result?.amount
              ? `Se reenviaron datos de cobro por ${formatCurrency(response.result.amount)}.`
              : 'El QR salió nuevamente por el canal del lead.',
          })
          break
        }

        case 'payment-reminder': {
          if (!selectedEnrollmentId) throw new Error('No hay inscripción disponible para recordar el pago')
          await apiPost(`/api/enrollments/${selectedEnrollmentId}/resend-instructions`, {})
          setActionResult({
            success: true,
            title: 'Recordatorio enviado',
            detail: 'Se reenviaron las instrucciones de pago del taller.',
          })
          break
        }

        case 'practical-info': {
          if (!selectedConversationId) throw new Error('Este lead no tiene conversación para enviar datos prácticos')
          if (!practicalDraft.trim()) throw new Error('Escribe un template de datos prácticos antes de enviar')
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
          break
        }

        default:
          break
      }

      await Promise.all([
        loadLeadDetail(selectedLead.id),
        loadRecentLeads(),
      ])
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
      const updated = await apiPut('/api/ai/settings', payload)
      setQuickSettings((current) => ({
        ...current,
        practical_info_template: updated.practical_info_template || '',
        text_buffer_idle_ms: updated.text_buffer_idle_ms,
        text_buffer_max_messages: updated.text_buffer_max_messages,
        text_buffer_max_window_ms: updated.text_buffer_max_window_ms,
      }))
      setPracticalDraft(updated.practical_info_template || '')
      setSettingsDirty(false)
      setActionResult({
        success: true,
        title: 'Ajustes guardados',
        detail: 'Los cambios ya aplican al buffer del bot y al template práctico.',
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
  const showingSearch = deferredQuery.length >= 2
  const leadItems = showingSearch ? results : recentLeads
  const discoveryTitle = showingSearch ? 'Resultados de búsqueda' : '4 leads más recientes'
  const discoveryHelp = showingSearch
    ? 'Elige un lead para abrir debajo sus acciones operativas.'
    : 'Acceso directo a los últimos leads con interacción reciente.'

  return (
    <div className="commands-page">
      <section className="card commands-search-shell">
        <div className="commands-search-copy">
          <div className="commands-overline">Comandos</div>
          <h1 className="commands-heading">Acciones rápidas sobre leads</h1>
          <p className="commands-subtitle">
            Busca por nombre o celular, o entra directo desde los cuatro contactos más recientes.
          </p>
        </div>

        <div className="commands-search-box">
          <div className="commands-search-input-wrap commands-search-input-wrap-large">
            <Icon name="command" size={20} />
            <input
              ref={searchRef}
              className="input commands-search-input commands-search-input-large"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar lead por nombre o celular..."
              autoComplete="off"
            />
          </div>
          {query ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setQuery('')
                setResults([])
                searchRef.current?.focus()
              }}
            >
              Limpiar búsqueda
            </button>
          ) : null}
        </div>
      </section>

      <section className="card mt-4">
        <div className="commands-section-head">
          <div>
            <h2 className="card-title">{discoveryTitle}</h2>
            <div className="text-muted text-sm">{discoveryHelp}</div>
          </div>
          {!showingSearch ? (
            <span className="badge badge-info">En vivo</span>
          ) : null}
        </div>

        {searching ? (
          <div className="commands-empty-block mt-4">Buscando leads...</div>
        ) : null}

        {!searching && showingSearch && results.length === 0 ? (
          <div className="commands-empty-block mt-4">No se encontraron leads con esa búsqueda.</div>
        ) : null}

        {!loadingRecent && !showingSearch && recentLeads.length === 0 ? (
          <div className="commands-empty-block mt-4">Todavía no hay leads recientes para accionar.</div>
        ) : null}

        {!searching && leadItems.length > 0 ? (
          <div className="commands-lead-grid mt-4">
            {leadItems.map((lead) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                active={Number(lead.id) === Number(selectedLead?.id)}
                onClick={() => handleSelectLead(lead)}
              />
            ))}
          </div>
        ) : null}
      </section>

      <section className="card mt-4 commands-selected-card">
        {loadingLead ? (
          <div className="commands-empty-block">Cargando panel del lead...</div>
        ) : selectedLead ? (
          <>
            <div className="commands-selected-header">
              <div className="commands-selected-identity">
                <div className="commands-selected-avatar">{buildInitials(selectedLead.name)}</div>
                <div className="commands-selected-copy">
                  <div className="commands-selected-name">{selectedLead.name || 'Sin nombre'}</div>
                  <div className="commands-selected-meta">
                    <span>{selectedLead.phone || 'Sin celular'}</span>
                    <span>{selectedLead.city || 'Sin ciudad'}</span>
                    <span>{selectedLead.source || 'Sin fuente'}</span>
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
                    {leadHeaderEnrollment ? (
                      <span className="badge badge-success">
                        {leadHeaderEnrollment.payment_status || leadHeaderEnrollment.status || 'Inscripción'}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              <button type="button" className="btn btn-ghost" onClick={clearLead}>
                Cerrar panel
              </button>
            </div>

            <div className="commands-summary-strip">
              <SummaryItem label="Último contacto" value={selectedLead.last_contact_at ? timeAgo(selectedLead.last_contact_at) : 'Sin interacción'} />
              <SummaryItem
                label="Conversación activa"
                value={leadHeaderConversation
                  ? `${CONVERSATION_STATUS_LABELS[leadHeaderConversation.status] || leadHeaderConversation.status} · ${leadHeaderConversation.workshop_name || 'General'}`
                  : 'Sin conversación'}
              />
              <SummaryItem
                label="Inscripción útil"
                value={leadHeaderEnrollment
                  ? `${leadHeaderEnrollment.workshop_name || 'Sin taller'} · ${leadHeaderEnrollment.payment_status || leadHeaderEnrollment.status}`
                  : 'Sin inscripción'}
              />
              <SummaryItem
                label="Monto pendiente"
                value={leadHeaderEnrollment?.amount_due ? formatCurrency(leadHeaderEnrollment.amount_due) : 'No aplica'}
              />
            </div>

            <div className="commands-actions-list">
              {ACTIONS.map((action) => {
                const isActive = activeAction === action.id
                return (
                  <div key={action.id} className={getActionRowClass(action.tone, isActive)}>
                    <button
                      type="button"
                      className="commands-action-trigger"
                      onClick={() => setActiveAction((current) => current === action.id ? null : action.id)}
                    >
                      <span className="commands-action-trigger-main">
                        <span className="commands-action-icon">
                          <Icon name={action.icon} size={18} />
                        </span>
                        <span>
                          <span className="commands-action-label">{action.label}</span>
                          <span className="commands-action-description">{action.description}</span>
                        </span>
                      </span>
                      <span className="commands-action-toggle">{isActive ? 'Ocultar' : 'Abrir'}</span>
                    </button>

                    {isActive ? (
                      <div className="commands-action-drawer">
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
                    ) : null}
                  </div>
                )
              })}
            </div>

            {actionResult ? (
              <div className={`inline-notice mt-4 ${actionResult.success ? 'inline-notice-success' : 'inline-notice-warning'}`}>
                <div className="font-semibold">{actionResult.title}</div>
                {actionResult.detail ? <div className="text-sm mt-1">{actionResult.detail}</div> : null}
              </div>
            ) : null}
          </>
        ) : (
          <div className="commands-empty-block">
            Selecciona un lead arriba. Su panel de acciones se abre aquí mismo, sin cambiar de pantalla.
          </div>
        )}
      </section>

      <section className="card mt-4 commands-quick-card">
        <button
          type="button"
          className="commands-quick-header"
          onClick={() => setSettingsOpen((current) => !current)}
        >
          <div>
            <h2 className="card-title">Ajustes rápidos</h2>
            <div className="text-muted text-sm">Configuración global del bot y del mensaje práctico.</div>
          </div>
          <div className="commands-quick-summary">
            <span className="commands-summary-pill">{quickSettings.text_buffer_idle_ms} ms</span>
            <span className="commands-summary-pill">{quickSettings.text_buffer_max_messages} msgs</span>
            <span className="commands-summary-pill">{quickSettings.text_buffer_max_window_ms} ms</span>
            <span className="commands-summary-pill">{settingsOpen ? 'Ocultar' : 'Abrir'}</span>
          </div>
        </button>

        {settingsOpen ? (
          <div className="commands-quick-body">
            <div className="commands-quick-grid">
              <QuickSettingCard
                title="Pausa mínima"
                description="Espera antes de responder cuando el lead sigue escribiendo."
                value={quickSettings.text_buffer_idle_ms}
                suffix="ms"
              >
                <input
                  className="input"
                  type="number"
                  min="500"
                  step="100"
                  value={quickSettings.text_buffer_idle_ms}
                  onChange={(event) => updateQuickSetting('text_buffer_idle_ms', event.target.value)}
                />
              </QuickSettingCard>

              <QuickSettingCard
                title="Mensajes agrupados"
                description="Cantidad máxima de mensajes que se fusionan antes de disparar respuesta."
                value={quickSettings.text_buffer_max_messages}
                suffix="msgs"
              >
                <input
                  className="input"
                  type="number"
                  min="1"
                  max="20"
                  value={quickSettings.text_buffer_max_messages}
                  onChange={(event) => updateQuickSetting('text_buffer_max_messages', event.target.value)}
                />
              </QuickSettingCard>

              <QuickSettingCard
                title="Ventana máxima"
                description="Tiempo total de espera acumulado antes de responder sí o sí."
                value={quickSettings.text_buffer_max_window_ms}
                suffix="ms"
              >
                <input
                  className="input"
                  type="number"
                  min="1000"
                  step="500"
                  value={quickSettings.text_buffer_max_window_ms}
                  onChange={(event) => updateQuickSetting('text_buffer_max_window_ms', event.target.value)}
                />
              </QuickSettingCard>
            </div>

            <div className="form-group mt-4">
              <label>Template de datos prácticos</label>
              <textarea
                className="input textarea"
                rows={10}
                value={quickSettings.practical_info_template}
                onChange={(event) => updateQuickSetting('practical_info_template', event.target.value)}
              />
            </div>

            <div className="text-muted text-sm">
              Variables disponibles: [NOMBRE], [NOMBRE_COMPLETO], [CELULAR], [TALLER], [FECHA], [HORA_INICIO], [HORA_FIN], [VENUE], [VENUE_DIRECCION], [MODALIDAD], [MONTO], [PRECIO], [PRECIO_NORMAL], [PRECIO_EARLY_BIRD], [PRECIO_GRUPAL].
            </div>

            <div className="commands-quick-footer mt-4">
              <button type="button" className="btn btn-primary" onClick={saveQuickSettings} disabled={settingsSaving}>
                {settingsSaving ? 'Guardando...' : 'Guardar ajustes rápidos'}
              </button>
              <span className={`badge ${settingsDirty ? 'badge-warning' : 'badge-success'}`}>
                {settingsDirty ? 'Hay cambios sin guardar' : 'Sin cambios pendientes'}
              </span>
            </div>
          </div>
        ) : null}
      </section>
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
      {(actionId === 'resume-bot' || actionId === 'stop-bot' || actionId === 'practical-info') ? (
        <div className="form-group">
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
              Asignada a {currentConversation.assigned_to || 'bot'}
              {currentConversation.current_phase ? ` · fase ${currentConversation.current_phase}` : ''}
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

      <div className="commands-action-footer">
        <button
          type="button"
          className={`btn ${action.tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
          onClick={() => onExecute(actionId)}
          disabled={actionLoading === actionId}
        >
          {actionLoading === actionId ? 'Ejecutando...' : action.label}
        </button>
      </div>
    </div>
  )
}

function LeadCard({ lead, active, onClick }) {
  return (
    <button type="button" className={`commands-lead-card ${active ? 'active' : ''}`} onClick={onClick}>
      <div className="commands-lead-card-top">
        <div className="commands-lead-avatar">{buildInitials(lead.name)}</div>
        <div className="commands-lead-meta">
          <div className="font-semibold">{lead.name || 'Sin nombre'}</div>
          <div className="text-sm text-secondary">{lead.phone || 'Sin celular'}</div>
        </div>
      </div>

      <div className="commands-lead-card-bottom">
        <span className={getLeadBadgeClass(lead.status)}>
          {LEAD_STATUS_LABELS[lead.status] || lead.status || 'Lead'}
        </span>
        <span className="text-xs text-muted">
          {lead.last_contact_at ? timeAgo(lead.last_contact_at) : 'sin interacción'}
        </span>
      </div>
    </button>
  )
}

function QuickSettingCard({ title, description, value, suffix, children }) {
  return (
    <div className="commands-setting-card">
      <div className="commands-setting-top">
        <div>
          <div className="font-semibold">{title}</div>
          <div className="text-sm text-secondary mt-1">{description}</div>
        </div>
        <div className="commands-setting-value">
          {value}{suffix ? ` ${suffix}` : ''}
        </div>
      </div>
      <div className="mt-3">{children}</div>
    </div>
  )
}

function SummaryItem({ label, value }) {
  return (
    <div className="commands-summary-item">
      <div className="commands-summary-label">{label}</div>
      <div className="commands-summary-value">{value}</div>
    </div>
  )
}

function buildInitials(name) {
  const normalized = String(name || '').trim()
  if (!normalized) return 'LD'
  const parts = normalized.split(/\s+/).slice(0, 2)
  return parts.map((part) => part[0]?.toUpperCase() || '').join('')
}
