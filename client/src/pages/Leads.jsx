import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { apiDelete, apiGet, apiPost, apiPut } from '../utils/api'
import { useAdminEvents } from '../hooks/useAdminEvents'
import { formatCurrency, formatDate, timeAgo } from '../utils/dates'
import ConfirmButton from '../components/ui/ConfirmButton'

const STATUS_LABELS = {
  new: 'Nuevo',
  qualifying: 'Calificando',
  qualified: 'Calificado',
  negotiating: 'Negociando',
  converted: 'Convertido',
  lost: 'Perdido',
  dormant: 'Dormido',
}

const STATUS_CLASSES = {
  new: 'badge badge-info',
  qualifying: 'badge badge-info',
  qualified: 'badge badge-success',
  negotiating: 'badge badge-warning',
  converted: 'badge badge-success',
  lost: 'badge badge-danger',
  dormant: 'badge',
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

const VIEW_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: 'hot', label: 'Calientes' },
  { value: 'followup', label: 'Sin respuesta 48h' },
  { value: 'converted', label: 'Convertidos' },
  { value: 'agenda_pending', label: 'Sin vínculo Agenda' },
]

const TAG_CATEGORIES = [
  { value: 'custom', label: 'Custom' },
  { value: 'stage', label: 'Etapa' },
  { value: 'behavior', label: 'Comportamiento' },
  { value: 'objection', label: 'Objeción' },
  { value: 'quality', label: 'Calidad' },
]

export default function Leads() {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [filter, setFilter] = useState('')
  const [view, setView] = useState('')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [selectedLead, setSelectedLead] = useState(null)
  const [agendaBundle, setAgendaBundle] = useState(null)
  const [agendaLoading, setAgendaLoading] = useState(false)
  const [agendaSearch, setAgendaSearch] = useState('')
  const [agendaMatches, setAgendaMatches] = useState([])
  const [agendaSearchLoading, setAgendaSearchLoading] = useState(false)
  const [savingTag, setSavingTag] = useState(false)
  const [tagDraft, setTagDraft] = useState({ category: 'custom', value: '' })
  const deferredSearch = useDeferredValue(search)

  const load = useCallback(() => {
    setLoading(true)
    let url = '/api/leads?limit=100'
    if (filter) url += `&status=${filter}`
    if (view) url += `&view=${view}`
    if (deferredSearch) url += `&search=${encodeURIComponent(deferredSearch)}`
    apiGet(url)
      .then((response) => {
        startTransition(() => {
          setLeads(response.data || [])
        })
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [deferredSearch, filter, view])

  const loadLeadDetail = useCallback((leadId) => {
    if (!leadId) {
      setSelectedLead(null)
      return Promise.resolve()
    }
    setLoadingDetail(true)
    return apiGet(`/api/leads/${leadId}`)
      .then((lead) => {
        startTransition(() => {
          setSelectedLead(lead)
          setAgendaSearch(lead.phone || lead.name || '')
        })
      })
      .catch(() => setSelectedLead(null))
      .finally(() => setLoadingDetail(false))
  }, [])

  const loadAgendaBundle = useCallback((leadId) => {
    if (!leadId) {
      setAgendaBundle(null)
      setAgendaMatches([])
      return Promise.resolve()
    }
    setAgendaLoading(true)
    return apiGet(`/api/agenda/lead/${leadId}`)
      .then((bundle) => {
        startTransition(() => {
          setAgendaBundle(bundle)
          setAgendaMatches(bundle.matches || [])
        })
      })
      .catch((err) => {
        startTransition(() => {
          setAgendaBundle({ configured: false, error: err.message })
          setAgendaMatches([])
        })
      })
      .finally(() => setAgendaLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!selectedId && leads.length > 0) {
      setSelectedId(leads[0].id)
      return
    }
    if (selectedId && !leads.some((lead) => lead.id === selectedId)) {
      setSelectedId(leads[0]?.id || null)
    }
  }, [leads, selectedId])

  useEffect(() => {
    loadLeadDetail(selectedId)
    loadAgendaBundle(selectedId)
  }, [loadAgendaBundle, loadLeadDetail, selectedId])

  const { connected } = useAdminEvents({
    'lead:change': (payload) => {
      load()
      if (payload?.id && payload.id === selectedId) {
        loadLeadDetail(selectedId)
        loadAgendaBundle(selectedId)
      }
    },
    'conversation:change': () => {
      if (selectedId) loadLeadDetail(selectedId)
    },
    'message:change': () => {
      if (selectedId) loadLeadDetail(selectedId)
    },
    'finance:change': () => {
      if (selectedId) loadLeadDetail(selectedId)
    },
  })

  const totals = useMemo(() => {
    const transactions = selectedLead?.transactions || []
    let income = 0
    let expense = 0
    for (const transaction of transactions) {
      const amount = Number(transaction.amount || 0)
      if (transaction.type === 'income') income += amount
      if (transaction.type === 'expense') expense += amount
    }
    return { income, expense }
  }, [selectedLead?.transactions])

  async function handleTagSubmit(event) {
    event.preventDefault()
    if (!selectedId || !tagDraft.value.trim()) return
    setSavingTag(true)
    try {
      await apiPost(`/api/leads/${selectedId}/tags`, {
        category: tagDraft.category,
        value: tagDraft.value.trim(),
      })
      setTagDraft((current) => ({ ...current, value: '' }))
      await Promise.all([load(), loadLeadDetail(selectedId)])
    } catch (err) {
      alert(err.message)
    } finally {
      setSavingTag(false)
    }
  }

  async function handleRemoveTag(tagId) {
    if (!selectedId) return
    if (!confirm('¿Quitar este tag manual?')) return
    try {
      await apiDelete(`/api/leads/${selectedId}/tags/${tagId}`)
      await Promise.all([load(), loadLeadDetail(selectedId)])
    } catch (err) {
      alert(err.message)
    }
  }

  async function handleAgendaSearch(event) {
    event?.preventDefault?.()
    const query = agendaSearch.trim()
    if (!query) return
    setAgendaSearchLoading(true)
    try {
      const results = await apiGet(`/api/agenda/search?query=${encodeURIComponent(query)}`)
      setAgendaMatches(results || [])
    } catch (err) {
      alert(err.message)
    } finally {
      setAgendaSearchLoading(false)
    }
  }

  async function handleAgendaLink(agendaClientId) {
    if (!selectedId) return
    try {
      await apiPut(`/api/leads/${selectedId}/agenda-link`, { agenda_client_id: agendaClientId })
      await Promise.all([load(), loadLeadDetail(selectedId), loadAgendaBundle(selectedId)])
    } catch (err) {
      alert(err.message)
    }
  }

  async function handleDeleteLead() {
    if (!selectedId) return
    try {
      await apiDelete(`/api/leads/${selectedId}`)
      setSelectedLead(null)
      setSelectedId(null)
      setAgendaBundle(null)
      setAgendaMatches([])
      await load()
    } catch (err) {
      alert(err.message)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2" style={{ flexWrap: 'wrap' }}>
        <h1 className="page-title">Leads</h1>
        <span className={`live-indicator ${connected ? 'connected' : ''}`}>
          {connected ? 'En vivo' : 'Reconectando'}
        </span>
      </div>

      <div className="flex gap-2 mt-4" style={{ flexWrap: 'wrap' }}>
        <input
          className="input"
          style={{ maxWidth: 250 }}
          placeholder="Buscar por nombre o teléfono..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select className="input" style={{ maxWidth: 180 }} value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABELS).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
        </select>
      </div>

      <div className="quick-filter-row mt-4">
        {VIEW_OPTIONS.map((option) => (
          <button
            key={option.value || 'all'}
            type="button"
            className={`view-chip ${view === option.value ? 'active' : ''}`}
            onClick={() => setView(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-muted mt-4">Cargando...</p>
      ) : leads.length === 0 ? (
        <p className="text-muted mt-4">No hay leads todavía. Llegarán cuando alguien escriba al bot.</p>
      ) : (
        <div className="crm-layout mt-4">
          <div className="table-container card">
            <table className="table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Teléfono/ID</th>
                  <th>Fuente</th>
                  <th>Estado</th>
                  <th>Score</th>
                  <th>Último contacto</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr
                    key={lead.id}
                    className={selectedId === lead.id ? 'table-row-selected' : ''}
                    onClick={() => setSelectedId(lead.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td className="font-semibold">{lead.name || 'Sin nombre'}</td>
                    <td className="text-secondary">{lead.phone}</td>
                    <td className="text-secondary">{lead.source || '-'}</td>
                    <td><span className={STATUS_CLASSES[lead.status] || 'badge'}>{STATUS_LABELS[lead.status] || lead.status}</span></td>
                    <td><ScoreBar score={lead.quality_score || 0} /></td>
                    <td className="text-muted text-sm">{timeAgo(lead.last_contact_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="crm-detail">
            {!selectedId ? (
              <div className="card text-muted">Selecciona un lead</div>
            ) : loadingDetail ? (
              <div className="card text-muted">Cargando ficha del lead...</div>
            ) : !selectedLead ? (
              <div className="card text-muted">No se pudo cargar la ficha.</div>
            ) : (
              <>
                <div className="card">
                  <div className="card-header">
                    <div>
                      <h2 className="card-title">{selectedLead.name || 'Sin nombre'}</h2>
                      <div className="text-sm text-muted">
                        {selectedLead.phone} · {selectedLead.city || 'Sin ciudad'} · {selectedLead.source || 'Sin fuente'}
                      </div>
                    </div>
                    <div className="flex gap-2" style={{ flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
                      <span className={STATUS_CLASSES[selectedLead.status] || 'badge'}>
                        {STATUS_LABELS[selectedLead.status] || selectedLead.status}
                      </span>
                      <ConfirmButton
                        label="Eliminar lead"
                        confirmLabel="¿Eliminar lead?"
                        onConfirm={handleDeleteLead}
                      />
                    </div>
                  </div>
                  <div className="lead-summary-grid">
                    <LeadMeta label="Score" value={String(selectedLead.quality_score || 0)} />
                    <LeadMeta label="Último contacto" value={selectedLead.last_contact_at ? timeAgo(selectedLead.last_contact_at) : '—'} />
                    <LeadMeta label="Ingresos" value={formatCurrency(totals.income)} />
                    <LeadMeta label="Inscripciones" value={String(selectedLead.enrollments?.length || 0)} />
                  </div>
                  <div className="tag-section mt-4">
                    <div className="text-sm font-semibold">Tags</div>
                    {selectedLead.tags?.length > 0 ? (
                      <div className="flex gap-1 mt-2" style={{ flexWrap: 'wrap' }}>
                        {selectedLead.tags.map((tag) => (
                          <span key={tag.id} className={`${TAG_CLASSES[tag.category] || 'tag tag-custom'} removable-tag`}>
                            {tag.value}
                            {tag.source === 'manual' && (
                              <button
                                type="button"
                                className="tag-remove-btn"
                                onClick={() => handleRemoveTag(tag.id)}
                                aria-label={`Quitar tag ${tag.value}`}
                              >
                                ×
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-muted mt-2">Sin tags todavía.</div>
                    )}
                    <form className="tag-form mt-4" onSubmit={handleTagSubmit}>
                      <select
                        className="input"
                        value={tagDraft.category}
                        onChange={(event) => setTagDraft((current) => ({ ...current, category: event.target.value }))}
                      >
                        {TAG_CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
                      </select>
                      <input
                        className="input"
                        placeholder="Nuevo tag manual"
                        value={tagDraft.value}
                        onChange={(event) => setTagDraft((current) => ({ ...current, value: event.target.value }))}
                      />
                      <button type="submit" className="btn btn-secondary" disabled={savingTag}>
                        {savingTag ? 'Guardando...' : 'Agregar tag'}
                      </button>
                    </form>
                  </div>
                  <div className="mt-4">
                    <div className="text-sm font-semibold">Notas</div>
                    <div className="text-sm text-secondary mt-1">{selectedLead.notes || 'Sin notas todavía.'}</div>
                  </div>
                </div>

                <div className="card mt-4">
                  <div className="card-header">
                    <h2 className="card-title">Contexto comercial</h2>
                  </div>
                  <div className="lead-mini-lists">
                    <div>
                      <div className="text-sm font-semibold">Conversaciones</div>
                      {(selectedLead.conversations || []).slice(0, 4).map((conversation) => (
                        <div key={conversation.id} className="mini-list-row">
                          <span>{conversation.workshop_name || 'General'}</span>
                          <span className="text-muted">{timeAgo(conversation.last_message_at || conversation.started_at)}</span>
                        </div>
                      ))}
                    </div>
                    <div>
                      <div className="text-sm font-semibold">Inscripciones</div>
                      {(selectedLead.enrollments || []).slice(0, 4).map((enrollment) => (
                        <div key={enrollment.id} className="mini-list-row">
                          <span>{enrollment.workshop_name}</span>
                          <span className="text-muted">{formatEnrollmentStatus(enrollment)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="card mt-4">
                  <div className="card-header">
                    <div>
                      <h2 className="card-title">Cruce con Agenda 4.0</h2>
                      <div className="text-sm text-muted">Cliente de terapia, sesiones y pagos vinculados</div>
                    </div>
                    {selectedLead.agenda_client_id ? (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleAgendaLink(null)}>
                        Quitar vínculo
                      </button>
                    ) : null}
                  </div>

                  {agendaLoading ? (
                    <div className="text-muted">Consultando Agenda 4.0...</div>
                  ) : !agendaBundle?.configured ? (
                    <div className="text-muted">Bridge con Agenda 4.0 no configurado en esta instalación.</div>
                  ) : (
                    <>
                      {agendaBundle.client ? (
                        <>
                          <div className="lead-summary-grid">
                            <LeadMeta label="Cliente Agenda" value={formatAgendaName(agendaBundle.client)} />
                            <LeadMeta label="Teléfono" value={agendaBundle.client.phone || '—'} />
                            <LeadMeta label="Ciudad" value={agendaBundle.client.city || '—'} />
                            <LeadMeta label="Fee" value={agendaBundle.client.fee ? formatCurrency(agendaBundle.client.fee) : '—'} />
                          </div>
                          {!selectedLead.agenda_client_id && (
                            <button
                              type="button"
                              className="btn btn-primary mt-4"
                              onClick={() => handleAgendaLink(agendaBundle.client.id)}
                            >
                              Vincular este lead con Agenda
                            </button>
                          )}
                          <div className="agenda-grid mt-4">
                            <div>
                              <div className="text-sm font-semibold">Últimas citas</div>
                              {!agendaBundle.appointments?.length ? (
                                <div className="text-sm text-muted mt-2">Sin citas registradas.</div>
                              ) : agendaBundle.appointments.map((appointment) => (
                                <div key={appointment.id} className="mini-list-row">
                                  <span>{formatAgendaAppointment(appointment)}</span>
                                  <span className="text-muted">{appointment.status}</span>
                                </div>
                              ))}
                            </div>
                            <div>
                              <div className="text-sm font-semibold">Últimos pagos</div>
                              {!agendaBundle.payments?.length ? (
                                <div className="text-sm text-muted mt-2">Sin pagos registrados.</div>
                              ) : agendaBundle.payments.map((payment) => (
                                <div key={payment.id} className="mini-list-row">
                                  <span>{formatCurrency(payment.amount || 0)}</span>
                                  <span className="text-muted">{payment.status || 'pendiente'}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="text-sm text-muted">No se encontró cliente vinculado en Agenda 4.0.</div>
                      )}

                      <form className="agenda-search-row mt-4" onSubmit={handleAgendaSearch}>
                        <input
                          className="input"
                          placeholder="Buscar cliente en Agenda por nombre o teléfono"
                          value={agendaSearch}
                          onChange={(event) => setAgendaSearch(event.target.value)}
                        />
                        <button type="submit" className="btn btn-secondary" disabled={agendaSearchLoading}>
                          {agendaSearchLoading ? 'Buscando...' : 'Buscar coincidencias'}
                        </button>
                      </form>

                      {agendaMatches.length > 0 && (
                        <div className="match-list mt-4">
                          {agendaMatches.map((match) => (
                            <div key={match.id} className="match-row">
                              <div>
                                <div className="font-semibold">{formatAgendaName(match)}</div>
                                <div className="text-sm text-muted">
                                  {match.phone || 'Sin teléfono'}{match.city ? ` · ${match.city}` : ''}
                                </div>
                              </div>
                              <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleAgendaLink(match.id)}>
                                Vincular
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className="card mt-4">
                  <div className="card-header">
                    <h2 className="card-title">Timeline</h2>
                  </div>
                  <div className="timeline-list">
                    {(selectedLead.timeline || []).length === 0 ? (
                      <div className="text-muted">Sin eventos todavía.</div>
                    ) : selectedLead.timeline.map((item) => (
                      <div key={item.id} className="timeline-item">
                        <div className="timeline-dot" />
                        <div className="timeline-body">
                          <div className="timeline-head">
                            <span className="font-semibold">{timelineTitle(item)}</span>
                            <span className="text-xs text-muted">{timelineTime(item.created_at)}</span>
                          </div>
                          <div className="text-sm text-secondary">{timelineDescription(item)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function LeadMeta({ label, value }) {
  return (
    <div className="lead-meta-card">
      <div className="text-xs text-muted">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  )
}

function ScoreBar({ score }) {
  const color = score >= 70 ? 'var(--color-success)' : score >= 40 ? 'var(--color-warning)' : 'var(--color-text-muted)'
  return (
    <div className="flex items-center gap-2">
      <div style={{ width: 60, height: 6, background: 'var(--color-border)', borderRadius: 3 }}>
        <div style={{ width: `${Math.min(score, 100)}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.3s' }} />
      </div>
      <span className="text-xs text-muted">{score}</span>
    </div>
  )
}

function formatEnrollmentStatus(enrollment) {
  if (enrollment.payment_status === 'paid' || enrollment.status === 'confirmed') return 'Confirmado'
  if (enrollment.payment_status === 'unpaid') return 'Pendiente de pago'
  return enrollment.status || 'Pendiente'
}

function formatAgendaName(client) {
  const fullName = `${client.first_name || ''} ${client.last_name || ''}`.trim()
  return fullName || 'Sin nombre'
}

function formatAgendaAppointment(appointment) {
  const date = new Date(appointment.date_time)
  return `${formatDate(date)} · ${date.toLocaleTimeString('es-BO', {
    timeZone: 'America/La_Paz',
    hour: '2-digit',
    minute: '2-digit',
  })}`
}

function timelineTitle(item) {
  if (item.event_type === 'message') {
    return item.direction === 'inbound' ? 'Mensaje recibido' : 'Mensaje enviado'
  }
  if (item.event_type === 'enrollment') {
    return `Inscripción · ${item.workshop_name || 'Taller'}`
  }
  return item.type === 'income' ? 'Ingreso registrado' : 'Movimiento financiero'
}

function timelineDescription(item) {
  if (item.event_type === 'message') {
    return item.content || `[${item.content_type || 'mensaje'}]`
  }
  if (item.event_type === 'enrollment') {
    return `${formatEnrollmentStatus(item)}${item.amount_due ? ` · ${formatCurrency(item.amount_due)}` : ''}`
  }
  return `${item.description || item.category || 'Sin descripción'} · ${formatCurrency(item.amount || 0)}${item.verified ? ' · verificado' : ''}`
}

function timelineTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  return `${formatDate(date)} · ${date.toLocaleTimeString('es-BO', { timeZone: 'America/La_Paz', hour: '2-digit', minute: '2-digit' })}`
}
