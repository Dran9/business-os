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
  const [recentLeads, setRecentLeads] = useState([])
  const [loadingRecent, setLoadingRecent] = useState(true)
  const [selectedLead, setSelectedLead] = useState(null)
  const [loadingLead, setLoadingLead] = useState(false)
  const [activeAction, setActiveAction] = useState(null)
  const [actionLoading, setActionLoading] = useState('')
  const [actionResult, setActionResult] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(true)
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
        if (!cancelled) {
          setResults(response.data || [])
        }
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
  const discoveryItems = deferredQuery.length >= 2 ? results : recentLeads

  return (
    <div className="commands-shell">
      <section className="commands-hero">
        <div className="commands-hero-copy">
          <div className="commands-kicker">Panel táctico</div>
          <h1 className="page-title">Comandos</h1>
          <p className="text-secondary">
            Atajos operativos para actuar en segundos sobre los leads activos, sin entrar al inbox ni al embudo.
          </p>
        </div>

        <div className="commands-hero-stats">
          <StatCard label="Recientes" value={String(recentLeads.length)} tone="primary" />
          <StatCard label="Lead activo" value={selectedLead?.name ? '1' : '0'} tone="neutral" />
          <StatCard label="Buffer" value={`${quickSettings.text_buffer_idle_ms} ms`} tone="success" />
        </div>
      </section>

      <div className="commands-top-grid mt-4">
        <section className="card commands-discovery-card">
          <div className="commands-search-row">
            <div className="commands-search-input-wrap">
              <Icon name="command" size={18} />
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

          <div className="commands-section-head mt-4">
            <div>
              <h2 className="card-title">{deferredQuery.length >= 2 ? 'Resultados' : 'Leads recientes'}</h2>
              <div className="text-muted text-sm">
                {deferredQuery.length >= 2
                  ? 'Búsqueda instantánea por lead.'
                  : 'Siempre muestra hasta 4 leads con interacción reciente, excluyendo compras confirmadas.'}
              </div>
            </div>
            {!deferredQuery.length ? (
              <span className="badge badge-info">Ahora</span>
            ) : null}
          </div>

          {searching || loadingRecent ? (
            <div className="text-muted text-sm mt-4">Cargando leads...</div>
          ) : null}

          {!searching && deferredQuery.length >= 2 && results.length === 0 ? (
            <div className="commands-empty-block mt-4">No se encontraron leads con esa búsqueda.</div>
          ) : null}

          {!loadingRecent && deferredQuery.length < 2 && recentLeads.length === 0 ? (
            <div className="commands-empty-block mt-4">Todavía no hay leads recientes para accionar.</div>
          ) : null}

          {discoveryItems.length > 0 ? (
            <div className="commands-lead-grid mt-4">
              {discoveryItems.map((lead) => (
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

        <section className="card commands-focus-card">
          {loadingLead ? (
            <div className="commands-empty-block">Cargando ficha del lead...</div>
          ) : selectedLead ? (
            <>
              <div className="commands-focus-hero">
                <div className="commands-focus-avatar">{buildInitials(selectedLead.name)}</div>
                <div className="commands-focus-copy">
                  <div className="commands-focus-name">{selectedLead.name || 'Sin nombre'}</div>
                  <div className="text-secondary">
                    {selectedLead.phone || 'Sin celular'} · {selectedLead.city || 'Sin ciudad'} · {selectedLead.source || 'Sin fuente'}
                  </div>
                  <div className="commands-chip-wrap mt-3">
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
              </div>

              <div className="lead-summary-grid mt-4">
                <LeadMeta label="Último contacto" value={selectedLead.last_contact_at ? timeAgo(selectedLead.last_contact_at) : '—'} />
                <LeadMeta label="Conversaciones" value={String(selectedLead.conversations?.length || 0)} />
                <LeadMeta label="Inscripciones" value={String(selectedLead.enrollments?.length || 0)} />
                <LeadMeta label="Pago actual" value={leadHeaderEnrollment ? `${leadHeaderEnrollment.payment_status || leadHeaderEnrollment.status}` : '—'} />
              </div>

              <div className="commands-context-grid mt-4">
                <div className="commands-context-card">
                  <div className="commands-context-title">Conversación útil</div>
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
                    <div className="text-sm text-muted mt-1">Todavía no tiene conversación vinculada.</div>
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
            </>
          ) : (
            <div className="commands-empty-block">
              Selecciona uno de los leads recientes o usa el buscador para abrir su panel de acción inmediata.
            </div>
          )}
        </section>
      </div>

      <section className="card mt-4">
        <div className="card-header">
          <div>
            <h2 className="card-title">Acciones rápidas</h2>
            <div className="text-muted text-sm">Cada acción toma el lead seleccionado como contexto.</div>
          </div>
        </div>

        <div className="commands-actions-grid">
          {ACTIONS.map((action) => (
            <button
              key={action.id}
              type="button"
              className={getActionButtonClass(action.tone, activeAction === action.id)}
              onClick={() => setActiveAction((current) => current === action.id ? null : action.id)}
              disabled={!selectedLead}
            >
              <span className="commands-action-icon">
                <Icon name={action.icon} size={18} />
              </span>
              <span>{action.label}</span>
              <small>{action.description}</small>
            </button>
          ))}
        </div>

        {selectedLead && activeAction ? (
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
        ) : null}

        {!selectedLead ? (
          <div className="text-sm text-muted mt-4">Necesitas elegir un lead para activar estos comandos.</div>
        ) : null}
      </section>

      <section className="card mt-4 commands-quick-card">
        <button
          type="button"
          className="commands-quick-header"
          onClick={() => setSettingsOpen((current) => !current)}
        >
          <div>
            <h2 className="card-title">Ajustes rápidos</h2>
            <div className="text-muted text-sm">Son globales para toda la app, no para un lead puntual.</div>
          </div>
          <div className="commands-quick-summary">
            <span className="commands-summary-pill">{quickSettings.text_buffer_idle_ms} ms</span>
            <span className="commands-summary-pill">{quickSettings.text_buffer_max_messages} msgs</span>
            <span className="commands-summary-pill">{quickSettings.text_buffer_max_window_ms} ms</span>
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

      {actionResult ? (
        <div className={`inline-notice mt-4 ${actionResult.success ? 'inline-notice-success' : 'inline-notice-warning'}`}>
          <div className="font-semibold">{actionResult.title}</div>
          {actionResult.detail ? <div className="text-sm mt-1">{actionResult.detail}</div> : null}
        </div>
      ) : null}
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

function StatCard({ label, value, tone }) {
  return (
    <div className={`commands-stat-card ${tone || 'neutral'}`}>
      <div className="text-xs text-muted">{label}</div>
      <div className="commands-stat-value">{value}</div>
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

function buildInitials(name) {
  const normalized = String(name || '').trim()
  if (!normalized) return 'LD'
  const parts = normalized.split(/\s+/).slice(0, 2)
  return parts.map((part) => part[0]?.toUpperCase() || '').join('')
}
