import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { apiGet } from '../utils/api'
import { useAdminEvents } from '../hooks/useAdminEvents'
import { formatCurrency, formatDate, timeAgo } from '../utils/dates'

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

export default function Leads() {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [filter, setFilter] = useState('')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [selectedLead, setSelectedLead] = useState(null)
  const deferredSearch = useDeferredValue(search)

  const load = useCallback(() => {
    setLoading(true)
    let url = '/api/leads?limit=100'
    if (filter) url += `&status=${filter}`
    if (deferredSearch) url += `&search=${encodeURIComponent(deferredSearch)}`
    apiGet(url)
      .then((response) => {
        startTransition(() => {
          setLeads(response.data || [])
        })
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [deferredSearch, filter])

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
        })
      })
      .catch(() => setSelectedLead(null))
      .finally(() => setLoadingDetail(false))
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
  }, [loadLeadDetail, selectedId])

  const { connected } = useAdminEvents({
    'lead:change': (payload) => {
      load()
      if (payload?.id && payload.id === selectedId) {
        loadLeadDetail(selectedId)
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
                    <span className={STATUS_CLASSES[selectedLead.status] || 'badge'}>
                      {STATUS_LABELS[selectedLead.status] || selectedLead.status}
                    </span>
                  </div>
                  <div className="lead-summary-grid">
                    <LeadMeta label="Score" value={String(selectedLead.quality_score || 0)} />
                    <LeadMeta label="Último contacto" value={selectedLead.last_contact_at ? timeAgo(selectedLead.last_contact_at) : '—'} />
                    <LeadMeta label="Ingresos" value={formatCurrency(totals.income)} />
                    <LeadMeta label="Inscripciones" value={String(selectedLead.enrollments?.length || 0)} />
                  </div>
                  {selectedLead.tags?.length > 0 && (
                    <div className="flex gap-1 mt-4" style={{ flexWrap: 'wrap' }}>
                      {selectedLead.tags.map((tag) => (
                        <span key={tag.id} className={TAG_CLASSES[tag.category] || 'tag tag-custom'}>
                          {tag.value}
                        </span>
                      ))}
                    </div>
                  )}
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
