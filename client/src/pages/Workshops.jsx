import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiDelete, apiGet, apiPost, apiPut, getToken } from '../utils/api'
import { formatCurrency, formatDate } from '../utils/dates'
import ConfirmButton from '../components/ui/ConfirmButton'
import BulkActionBar from '../components/ui/BulkActionBar'
import useSelection from '../hooks/useSelection'

const STATUS_LABELS = {
  draft: 'Borrador',
  planned: 'Planificado',
  open: 'Inscripciones abiertas',
  full: 'Lleno',
  completed: 'Completado',
  cancelled: 'Cancelado',
}

const STATUS_CLASSES = {
  draft: 'badge',
  planned: 'badge badge-info',
  open: 'badge badge-success',
  full: 'badge badge-warning',
  completed: 'badge',
  cancelled: 'badge badge-danger',
}

export default function Workshops() {
  const [workshops, setWorkshops] = useState([])
  const [enrollments, setEnrollments] = useState([])
  const [team, setTeam] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingEnrollments, setLoadingEnrollments] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [workshopFilter, setWorkshopFilter] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [assignedFilter, setAssignedFilter] = useState('')
  const [search, setSearch] = useState('')
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState(null)
  const [selectedEnrollment, setSelectedEnrollment] = useState(null)
  const [loadingEnrollmentDetail, setLoadingEnrollmentDetail] = useState(false)
  const [manualAmount, setManualAmount] = useState('')
  const selection = useSelection()

  const loadWorkshops = useCallback(() => {
    setLoading(true)
    apiGet('/api/workshops')
      .then((response) => setWorkshops(response.data || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const loadEnrollments = useCallback(() => {
    setLoadingEnrollments(true)
    const params = new URLSearchParams({ limit: '100' })
    if (workshopFilter) params.set('workshop_id', workshopFilter)
    if (stateFilter) params.set('state', stateFilter)
    if (assignedFilter) params.set('assigned_to', assignedFilter)
    if (search) params.set('search', search)

    apiGet(`/api/enrollments?${params.toString()}`)
      .then((response) => setEnrollments(response.data || []))
      .catch(() => setEnrollments([]))
      .finally(() => setLoadingEnrollments(false))
  }, [assignedFilter, search, stateFilter, workshopFilter])

  const loadEnrollmentDetail = useCallback((id) => {
    if (!id) {
      setSelectedEnrollment(null)
      return Promise.resolve()
    }
    setLoadingEnrollmentDetail(true)
    return apiGet(`/api/enrollments/${id}`)
      .then((item) => {
        setSelectedEnrollment(item)
        setManualAmount(item.amount_due || item.amount_paid || '')
      })
      .catch(() => {
        setSelectedEnrollment(null)
        setManualAmount('')
      })
      .finally(() => setLoadingEnrollmentDetail(false))
  }, [])

  useEffect(() => {
    loadWorkshops()
    apiGet('/api/team').then(setTeam).catch(() => setTeam([]))
  }, [loadWorkshops])

  useEffect(() => {
    loadEnrollments()
  }, [loadEnrollments])

  useEffect(() => {
    if (!selectedEnrollmentId && enrollments.length > 0) {
      setSelectedEnrollmentId(enrollments[0].id)
      return
    }
    if (selectedEnrollmentId && !enrollments.some((item) => item.id === selectedEnrollmentId)) {
      setSelectedEnrollmentId(enrollments[0]?.id || null)
    }
  }, [enrollments, selectedEnrollmentId])

  useEffect(() => {
    loadEnrollmentDetail(selectedEnrollmentId)
  }, [loadEnrollmentDetail, selectedEnrollmentId])

  function handleEdit(workshop) {
    setEditing(workshop)
    setShowForm(true)
  }

  function handleNew() {
    setEditing(null)
    setShowForm(true)
  }

  async function handleDelete(id) {
    await apiDelete(`/api/workshops/${id}`)
    loadWorkshops()
    loadEnrollments()
  }

  async function handleEnrollmentAction(id, action, body = null) {
    try {
      await apiPost(`/api/enrollments/${id}/${action}`, body || {})
      await Promise.all([loadEnrollments(), loadWorkshops(), loadEnrollmentDetail(id)])
    } catch (err) {
      alert(err.message)
    }
  }

  const proofUrl = useMemo(() => {
    if (!selectedEnrollment?.payment_proof_present) return ''
    const token = getToken()
    if (!token) return ''
    return `/api/enrollments/${selectedEnrollment.id}/proof?token=${encodeURIComponent(token)}`
  }, [selectedEnrollment])
  const visibleWorkshopIds = useMemo(() => workshops.map((workshop) => workshop.id), [workshops])
  const allWorkshopsSelected = visibleWorkshopIds.length > 0 && visibleWorkshopIds.every((id) => selection.isSelected(id))

  async function handleBulkDeleteWorkshops() {
    const ids = selection.ids()
    if (ids.length === 0) return
    try {
      await Promise.all(ids.map((id) => apiDelete(`/api/workshops/${id}`)))
      if (editing?.id && ids.includes(editing.id)) {
        setEditing(null)
        setShowForm(false)
      }
      selection.clear()
      await Promise.all([loadWorkshops(), loadEnrollments()])
    } catch (err) {
      alert(err.message)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="page-title">Talleres</h1>
        <button type="button" className="btn btn-primary" onClick={handleNew}>Nuevo taller</button>
      </div>

      {showForm && (
        <WorkshopForm
          workshop={editing}
          onSave={() => { setShowForm(false); loadWorkshops(); loadEnrollments() }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {loading ? (
        <p className="text-muted mt-4">Cargando...</p>
      ) : workshops.length === 0 ? (
        <p className="text-muted mt-4">No hay talleres. Crea el primero.</p>
      ) : (
        <div className="mt-4">
          <BulkActionBar
            count={selection.count}
            onDelete={handleBulkDeleteWorkshops}
            onClear={selection.clear}
          />
          <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <input
                    type="checkbox"
                    className="header-checkbox"
                    checked={allWorkshopsSelected}
                    onChange={() => selection.toggleAll(visibleWorkshopIds)}
                  />
                </th>
                <th>Nombre</th>
                <th>Fecha</th>
                <th>Precio</th>
                <th>Inscritos</th>
                <th>Estado</th>
                <th>Venue</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {workshops.map((workshop) => (
                <tr key={workshop.id}>
                  <td>
                    <input
                      type="checkbox"
                      className="row-checkbox"
                      checked={selection.isSelected(workshop.id)}
                      onChange={() => selection.toggle(workshop.id)}
                    />
                  </td>
                  <td className="font-semibold">{workshop.name}</td>
                  <td>{workshop.date ? formatDate(workshop.date) : '-'}</td>
                  <td>{workshop.price ? formatCurrency(workshop.price) : '-'}</td>
                  <td>{workshop.current_participants}/{workshop.max_participants}</td>
                  <td><span className={STATUS_CLASSES[workshop.status] || 'badge'}>{STATUS_LABELS[workshop.status] || workshop.status}</span></td>
                  <td className="text-secondary">{workshop.venue_name || '-'}</td>
                  <td>
                    <div className="flex gap-2">
                      <Link to={`/taller/${workshop.id}/asistencia`} className="btn btn-secondary btn-sm">Asistencia</Link>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleEdit(workshop)}>Editar</button>
                      <ConfirmButton size="sm" label="Eliminar" confirmLabel="¿Eliminar?" onConfirm={() => handleDelete(workshop.id)} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      <div className="card mt-6">
        <div className="card-header">
          <h2 className="card-title">Inscripciones</h2>
        </div>
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          <select className="input" style={{ maxWidth: 220 }} value={workshopFilter} onChange={(event) => setWorkshopFilter(event.target.value)}>
            <option value="">Todos los talleres</option>
            {workshops.map((workshop) => (
              <option key={workshop.id} value={workshop.id}>{workshop.name}</option>
            ))}
          </select>
          <select className="input" style={{ maxWidth: 180 }} value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}>
            <option value="">Todos los estados</option>
            <option value="pending">Pendiente</option>
            <option value="proof_received">Comprobante recibido</option>
            <option value="confirmed">Confirmado</option>
            <option value="mismatch">Mismatch</option>
          </select>
          <select className="input" style={{ maxWidth: 180 }} value={assignedFilter} onChange={(event) => setAssignedFilter(event.target.value)}>
            <option value="">Todos los asignados</option>
            <option value="bot">Bot / sin asignar</option>
            {team.map((member) => (
              <option key={member.id} value={member.username}>{member.display_name || member.username}</option>
            ))}
          </select>
          <input
            className="input"
            style={{ maxWidth: 260 }}
            placeholder="Buscar lead o taller..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="crm-layout mt-4">
          <div className="table-container">
            {loadingEnrollments ? (
              <p className="text-muted">Cargando inscripciones...</p>
            ) : enrollments.length === 0 ? (
              <p className="text-muted">No hay inscripciones para este filtro.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Lead</th>
                    <th>Taller</th>
                    <th>Monto</th>
                    <th>Estado</th>
                    <th>Asignado</th>
                    <th>Notas</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {enrollments.map((item) => (
                    <tr key={item.id} className={selectedEnrollmentId === item.id ? 'table-row-selected' : ''}>
                      <td onClick={() => setSelectedEnrollmentId(item.id)}>
                        <div className="font-semibold">{item.lead_name || 'Sin nombre'}</div>
                        <div className="text-xs text-muted">{item.lead_phone}</div>
                      </td>
                      <td onClick={() => setSelectedEnrollmentId(item.id)}>
                        <div className="font-semibold">{item.workshop_name}</div>
                        <div className="text-xs text-muted">{item.workshop_date ? formatDate(item.workshop_date) : 'Sin fecha'}</div>
                      </td>
                      <td onClick={() => setSelectedEnrollmentId(item.id)}>{formatCurrency(item.amount_due || item.amount_paid || 0)}</td>
                      <td onClick={() => setSelectedEnrollmentId(item.id)}><span className={reviewStateClasses(item.review_state)}>{reviewStateLabel(item.review_state)}</span></td>
                      <td className="text-secondary" onClick={() => setSelectedEnrollmentId(item.id)}>{item.assigned_to || 'bot'}</td>
                      <td onClick={() => setSelectedEnrollmentId(item.id)}>
                        <div className="text-sm">{item.notes || '—'}</div>
                        {Array.isArray(item.ocr_data?.validation_problems) && item.ocr_data.validation_problems.length > 0 && (
                          <div className="text-xs text-muted" style={{ marginTop: 4 }}>
                            {item.ocr_data.validation_problems.map((problem, index) => (
                              <div key={index}>• {formatValidationProblem(problem)}</div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelectedEnrollmentId(item.id)}>
                          Revisar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="crm-detail">
            {!selectedEnrollmentId ? (
              <div className="card text-muted">Selecciona una inscripción</div>
            ) : loadingEnrollmentDetail ? (
              <div className="card text-muted">Cargando revisión...</div>
            ) : !selectedEnrollment ? (
              <div className="card text-muted">No se pudo cargar la inscripción.</div>
            ) : (
              <>
                <div className="card">
                  <div className="card-header">
                    <div>
                      <h2 className="card-title">{selectedEnrollment.lead_name || 'Sin nombre'}</h2>
                      <div className="text-sm text-muted">
                        {selectedEnrollment.workshop_name} · {selectedEnrollment.lead_phone}
                      </div>
                    </div>
                    <span className={reviewStateClasses(selectedEnrollment.review_state)}>
                      {reviewStateLabel(selectedEnrollment.review_state)}
                    </span>
                  </div>
                  <div className="lead-summary-grid">
                    <LeadMeta label="Monto esperado" value={formatCurrency(selectedEnrollment.amount_due || 0)} />
                    <LeadMeta label="Monto OCR" value={formatCurrency(selectedEnrollment.ocr_data?.amount || selectedEnrollment.amount_paid || 0)} />
                    <LeadMeta label="Fecha comprobante" value={selectedEnrollment.ocr_data?.date || 'Sin detectar'} />
                    <LeadMeta label="Cuenta detectada" value={selectedEnrollment.ocr_data?.destination_account || 'Sin detectar'} />
                  </div>
                  <div className="mt-4">
                    <div className="text-sm font-semibold">Problemas detectados</div>
                    {Array.isArray(selectedEnrollment.ocr_data?.validation_problems) && selectedEnrollment.ocr_data.validation_problems.length > 0 ? (
                      <div className="mt-2">
                        {selectedEnrollment.ocr_data.validation_problems.map((problem, index) => (
                          <div key={index} className="mini-list-row">
                            <span>{formatValidationProblem(problem)}</span>
                            <span className="text-muted">{problem.reason || problem.detected || 'Regla OCR'}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-muted mt-2">No hay problemas OCR registrados.</div>
                    )}
                  </div>
                  <div className="mt-4">
                    <div className="text-sm font-semibold">Notas operativas</div>
                    <div className="text-sm text-secondary mt-1">{selectedEnrollment.notes || 'Sin notas.'}</div>
                  </div>
                </div>

                <div className="card mt-4">
                  <div className="card-header">
                    <h2 className="card-title">Revisión OCR</h2>
                  </div>
                  <div className="ocr-grid">
                    <LeadMeta label="Banco" value={selectedEnrollment.ocr_data?.bank || '—'} />
                    <LeadMeta label="Referencia" value={selectedEnrollment.ocr_data?.reference || '—'} />
                    <LeadMeta label="Nombre detectado" value={selectedEnrollment.ocr_data?.name || '—'} />
                    <LeadMeta label="Solicitado" value={selectedEnrollment.payment_requested_at ? formatDate(selectedEnrollment.payment_requested_at) : '—'} />
                  </div>
                  {proofUrl && (
                    <div className="mt-4">
                      <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                        <a className="btn btn-secondary" href={proofUrl} target="_blank" rel="noreferrer">Abrir comprobante</a>
                        <a className="btn btn-ghost" href={proofUrl} download={`comprobante-${selectedEnrollment.id}`}>Descargar</a>
                      </div>
                      {selectedEnrollment.payment_proof_type?.startsWith('image/') && (
                        <img src={proofUrl} alt="Comprobante" className="proof-preview" />
                      )}
                    </div>
                  )}
                  <div className="form-group mt-4">
                    <label>Texto OCR crudo</label>
                    <textarea className="input textarea" rows="8" readOnly value={selectedEnrollment.ocr_data?.raw_text || ''} />
                  </div>
                </div>

                <div className="card mt-4">
                  <div className="card-header">
                    <h2 className="card-title">Acciones</h2>
                  </div>
                  <div className="form-group">
                    <label>Monto para confirmar manualmente</label>
                    <input className="input" type="number" min="1" value={manualAmount} onChange={(event) => setManualAmount(event.target.value)} />
                  </div>
                  <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => handleEnrollmentAction(selectedEnrollment.id, 'confirm', { amount: manualAmount })}
                    >
                      Confirmar pago
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        const reason = window.prompt('Motivo del rechazo o mismatch:', selectedEnrollment.notes || '')
                        if (reason == null) return
                        handleEnrollmentAction(selectedEnrollment.id, 'reject', { reason })
                      }}
                    >
                      Rechazar comprobante
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => handleEnrollmentAction(selectedEnrollment.id, 'resend-qr')}>
                      Reenviar QR
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => handleEnrollmentAction(selectedEnrollment.id, 'resend-instructions')}>
                      Reenviar instrucciones
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function LeadMeta({ label, value }) {
  return (
    <div className="lead-meta-card">
      <div className="text-xs text-muted">{label}</div>
      <div className="font-semibold">{value || '—'}</div>
    </div>
  )
}

function reviewStateLabel(value) {
  if (value === 'confirmed') return 'Confirmado'
  if (value === 'proof_received') return 'Comprobante recibido'
  if (value === 'mismatch') return 'Mismatch'
  return 'Pendiente'
}

function reviewStateClasses(value) {
  if (value === 'confirmed') return 'badge badge-success'
  if (value === 'proof_received') return 'badge badge-info'
  if (value === 'mismatch') return 'badge badge-danger'
  return 'badge badge-warning'
}

function formatValidationProblem(problem) {
  if (problem?.type === 'destinatario') return 'Cuenta destino no válida'
  if (problem?.type === 'monto') return 'Monto no coincide'
  if (problem?.type === 'fecha_pasada') return 'Fecha anterior al QR enviado'
  if (problem?.type === 'mismatch_manual') return problem.reason || 'Mismatch manual'
  return 'Validación pendiente'
}

function WorkshopForm({ workshop, onSave, onCancel }) {
  const [form, setForm] = useState({
    name: workshop?.name || '',
    type: workshop?.type || '',
    modality: workshop?.modality || 'presencial',
    status: workshop?.status || 'planned',
    date: workshop?.date ? workshop.date.split('T')[0] : '',
    time_start: workshop?.time_start || '',
    time_end: workshop?.time_end || '',
    max_participants: workshop?.max_participants || 25,
    price: workshop?.price || '',
    early_bird_price: workshop?.early_bird_price || '',
    early_bird_deadline: workshop?.early_bird_deadline ? workshop.early_bird_deadline.split('T')[0] : '',
    description: workshop?.description || '',
  })
  const [saving, setSaving] = useState(false)

  function handleChange(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    try {
      if (workshop?.id) {
        await apiPut(`/api/workshops/${workshop.id}`, form)
      } else {
        await apiPost('/api/workshops', form)
      }
      onSave()
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card mt-4">
      <form onSubmit={handleSubmit}>
        <div className="card-header">
          <h2 className="card-title">{workshop ? 'Editar taller' : 'Nuevo taller'}</h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-4)' }}>
          <div className="form-group">
            <label>Nombre</label>
            <input className="input" name="name" value={form.name} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label>Tipo</label>
            <input className="input" name="type" value={form.type} onChange={handleChange} placeholder="constelaciones, coaching..." />
          </div>
          <div className="form-group">
            <label>Modalidad</label>
            <select className="input" name="modality" value={form.modality} onChange={handleChange}>
              <option value="presencial">Presencial</option>
              <option value="online">Online</option>
              <option value="hibrido">Híbrido</option>
            </select>
          </div>
          <div className="form-group">
            <label>Estado</label>
            <select className="input" name="status" value={form.status} onChange={handleChange}>
              {Object.entries(STATUS_LABELS).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
            </select>
            <div className="text-xs text-muted" style={{ marginTop: 6 }}>
              El chatbot solo ofrece talleres en estado Planificado o Inscripciones abiertas.
            </div>
          </div>
          <div className="form-group">
            <label>Fecha</label>
            <input className="input" name="date" type="date" value={form.date} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label>Hora inicio</label>
            <input className="input" name="time_start" type="time" value={form.time_start} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label>Hora fin</label>
            <input className="input" name="time_end" type="time" value={form.time_end} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label>Cupos máximos</label>
            <input className="input" name="max_participants" type="number" min="1" value={form.max_participants} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label>Precio</label>
            <input className="input" name="price" type="number" min="0" value={form.price} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label>Precio early bird</label>
            <input className="input" name="early_bird_price" type="number" min="0" value={form.early_bird_price} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label>Fin early bird</label>
            <input className="input" name="early_bird_deadline" type="date" value={form.early_bird_deadline} onChange={handleChange} />
          </div>
        </div>
        <div className="form-group">
          <label>Descripción</label>
          <textarea className="input textarea" name="description" rows="4" value={form.description} onChange={handleChange} />
        </div>
        <div className="flex gap-2">
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar taller'}</button>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancelar</button>
        </div>
      </form>
    </div>
  )
}
