import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAdminEvents } from '../hooks/useAdminEvents'
import { apiGet, apiPost, apiPut } from '../utils/api'
import { formatCurrency, formatDate, formatDateTime } from '../utils/dates'

const SORTABLE_COLUMNS = new Set(['name', 'participant_role', 'payment_state', 'amount'])
const DEFAULT_AMOUNTS = {
  constela: '250',
  participa: '150',
}

function initialEmergencyForm() {
  return {
    full_name: '',
    phone: '',
    participant_role: 'participa',
    payment_state: 'pending',
    amount: DEFAULT_AMOUNTS.participa,
  }
}

function normalizePaymentState(item) {
  if (item.payment_status === 'paid') return 'paid'
  if (item.payment_method === 'onsite') return 'onsite'
  return 'pending'
}

function getParticipantLabel(value) {
  return value === 'constela' ? 'Constela' : 'Participa'
}

function getParticipantBadgeClass(value) {
  return value === 'constela' ? 'attendance-badge attendance-badge-accent' : 'attendance-badge'
}

function getPaymentLabel(value) {
  if (value === 'paid') return 'Pagado'
  if (value === 'onsite') return 'Pago en sitio'
  return 'Pendiente'
}

function getPaymentBadgeClass(value) {
  if (value === 'paid') return 'attendance-badge attendance-badge-success'
  if (value === 'onsite') return 'attendance-badge attendance-badge-warning'
  return 'attendance-badge attendance-badge-danger'
}

function getAttendanceLabel(value) {
  if (value === 'present') return 'Presente'
  if (value === 'absent') return 'Ausente'
  return 'Pendiente'
}

function getDisplayAmount(item) {
  return Number(item.amount_paid || item.amount_due || 0)
}

function compareValues(left, right, direction = 'asc') {
  const multiplier = direction === 'asc' ? 1 : -1
  if (left < right) return -1 * multiplier
  if (left > right) return 1 * multiplier
  return 0
}

function sortAttendees(items, sortConfig) {
  const rows = [...items]
  rows.sort((left, right) => {
    let result = 0

    if (sortConfig.column === 'participant_role') {
      result = compareValues(getParticipantLabel(left.participant_role), getParticipantLabel(right.participant_role), sortConfig.direction)
    } else if (sortConfig.column === 'payment_state') {
      result = compareValues(getPaymentLabel(normalizePaymentState(left)), getPaymentLabel(normalizePaymentState(right)), sortConfig.direction)
    } else if (sortConfig.column === 'amount') {
      result = compareValues(getDisplayAmount(left), getDisplayAmount(right), sortConfig.direction)
    } else {
      result = compareValues(String(left.lead_name || '').toLocaleLowerCase('es-BO'), String(right.lead_name || '').toLocaleLowerCase('es-BO'), sortConfig.direction)
    }

    if (result !== 0) return result
    return compareValues(String(left.lead_name || '').toLocaleLowerCase('es-BO'), String(right.lead_name || '').toLocaleLowerCase('es-BO'), 'asc')
  })
  return rows
}

function SortHeader({ column, label, sortConfig, onToggle }) {
  const active = sortConfig.column === column
  const arrow = !active ? '↕' : (sortConfig.direction === 'asc' ? '↑' : '↓')

  return (
    <button
      type="button"
      className={`attendance-sort-button ${active ? 'active' : ''}`}
      onClick={() => onToggle(column)}
    >
      <span>{label}</span>
      <span className="attendance-sort-arrow">{arrow}</span>
    </button>
  )
}

function AttendanceControl({ name, value, disabled, onChange }) {
  const options = [
    { value: 'present', label: 'Presente' },
    { value: 'absent', label: 'Ausente' },
    { value: 'pending', label: 'Pendiente' },
  ]

  return (
    <div className="attendance-pill-group" role="radiogroup" aria-label="Asistencia">
      {options.map((option) => (
        <label
          key={option.value}
          className={`attendance-pill ${value === option.value ? 'active' : ''}`}
        >
          <input
            className="attendance-radio"
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            disabled={disabled}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  )
}

export default function WorkshopAttendance() {
  const { tallerId } = useParams()
  const [workshop, setWorkshop] = useState(null)
  const [attendees, setAttendees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sortConfig, setSortConfig] = useState({ column: 'name', direction: 'asc' })
  const [rowBusy, setRowBusy] = useState({})
  const [onsiteTarget, setOnsiteTarget] = useState(null)
  const [confirmingOnsite, setConfirmingOnsite] = useState(false)
  const [showEmergencyModal, setShowEmergencyModal] = useState(false)
  const [emergencyForm, setEmergencyForm] = useState(initialEmergencyForm())
  const [creatingEmergency, setCreatingEmergency] = useState(false)

  const loadAttendance = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await apiGet(`/api/workshops/${tallerId}/attendance`)
      setWorkshop(response.workshop || null)
      setAttendees(Array.isArray(response.attendees) ? response.attendees : [])
    } catch (err) {
      setError(err.message)
      setWorkshop(null)
      setAttendees([])
    } finally {
      setLoading(false)
    }
  }, [tallerId])

  useEffect(() => {
    loadAttendance()
  }, [loadAttendance])

  const { connected } = useAdminEvents({
    'enrollment:change': (payload) => {
      if (String(payload?.workshopId) === String(tallerId)) {
        loadAttendance()
      }
    },
    'workshop:change': (payload) => {
      if (String(payload?.id) === String(tallerId)) {
        loadAttendance()
      }
    },
  }, Boolean(tallerId))

  const sortedAttendees = useMemo(() => sortAttendees(attendees, sortConfig), [attendees, sortConfig])
  const summary = useMemo(() => {
    const total = attendees.length
    const present = attendees.filter((item) => item.attendance_status === 'present').length
    const paid = attendees.filter((item) => normalizePaymentState(item) === 'paid').length
    return {
      total,
      present,
      paid,
      pendingPayment: total - paid,
    }
  }, [attendees])

  function toggleSort(column) {
    if (!SORTABLE_COLUMNS.has(column)) return
    setSortConfig((current) => {
      if (current.column === column) {
        return { column, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      }
      return { column, direction: 'asc' }
    })
  }

  function patchAttendee(updated) {
    setAttendees((current) => current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)))
  }

  async function handleAttendanceChange(enrollmentId, nextStatus) {
    let previousItem = null

    setRowBusy((current) => ({ ...current, [enrollmentId]: 'attendance' }))
    setAttendees((current) => current.map((item) => {
      if (item.id !== enrollmentId) return item
      previousItem = item
      return { ...item, attendance_status: nextStatus }
    }))

    try {
      const response = await apiPut(`/api/enrollments/${enrollmentId}/attendance`, {
        attendance_status: nextStatus,
      })
      if (response.enrollment) {
        patchAttendee(response.enrollment)
      }
    } catch (err) {
      if (previousItem) {
        patchAttendee(previousItem)
      }
      setError(err.message)
    } finally {
      setRowBusy((current) => {
        const next = { ...current }
        delete next[enrollmentId]
        return next
      })
    }
  }

  async function handleConfirmOnsite() {
    if (!onsiteTarget) return

    setConfirmingOnsite(true)
    setError('')
    try {
      const response = await apiPost(`/api/enrollments/${onsiteTarget.id}/confirm-onsite`, {
        amount: getDisplayAmount(onsiteTarget),
      })
      if (response.enrollment) {
        patchAttendee(response.enrollment)
      }
      setOnsiteTarget(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setConfirmingOnsite(false)
    }
  }

  function openEmergencyModal() {
    setEmergencyForm(initialEmergencyForm())
    setShowEmergencyModal(true)
  }

  function handleEmergencyFieldChange(event) {
    const { name, value } = event.target
    setEmergencyForm((current) => {
      if (name === 'participant_role') {
        return {
          ...current,
          participant_role: value,
          amount: DEFAULT_AMOUNTS[value] || current.amount,
        }
      }
      return { ...current, [name]: value }
    })
  }

  async function handleEmergencySubmit(event) {
    event.preventDefault()
    setCreatingEmergency(true)
    setError('')
    try {
      const response = await apiPost(`/api/workshops/${tallerId}/attendance/manual-entry`, emergencyForm)
      if (response.enrollment) {
        setAttendees((current) => [...current, response.enrollment])
      } else {
        await loadAttendance()
      }
      setShowEmergencyModal(false)
      setEmergencyForm(initialEmergencyForm())
    } catch (err) {
      setError(err.message)
    } finally {
      setCreatingEmergency(false)
    }
  }

  return (
    <div className="attendance-page">
      <div className="attendance-topbar">
        <Link to="/workshops" className="btn btn-ghost btn-sm">Volver a talleres</Link>
        <div className={`live-indicator ${connected ? 'connected' : ''}`}>
          {connected ? 'Sincronizado' : 'Sin conexión en vivo'}
        </div>
      </div>

      <div className="attendance-header card">
        <div className="attendance-header-main">
          <div>
            <div className="text-sm text-muted">Control de asistencia</div>
            <h1 className="page-title">{workshop?.name || 'Taller'}</h1>
            <div className="attendance-workshop-meta">
              <span>{workshop?.date ? formatDate(workshop.date) : 'Fecha por definir'}</span>
              <span>{workshop?.venue_name || workshop?.venue_city || 'Venue por definir'}</span>
            </div>
          </div>
          <button type="button" className="btn btn-primary" onClick={openEmergencyModal}>
            Añadir emergencia
          </button>
        </div>

        <div className="attendance-summary-grid">
          <div className="attendance-summary-card">
            <div className="text-sm text-muted">Asistencia</div>
            <div className="attendance-summary-value">{summary.present} presentes / {summary.total} inscritos</div>
          </div>
          <div className="attendance-summary-card">
            <div className="text-sm text-muted">Pagos</div>
            <div className="attendance-summary-value">{summary.paid} pagados / {summary.pendingPayment} pendientes</div>
          </div>
        </div>
      </div>

      {error ? <div className="inline-notice inline-notice-warning mt-4">{error}</div> : null}

      <div className="card mt-4">
        {loading ? (
          <div className="text-muted">Cargando asistentes...</div>
        ) : (
          <div className="table-container attendance-table-wrap">
            <table className="table attendance-table">
              <thead>
                <tr>
                  <th>Asistencia</th>
                  <th><SortHeader column="name" label="Nombre completo" sortConfig={sortConfig} onToggle={toggleSort} /></th>
                  <th>Teléfono</th>
                  <th><SortHeader column="participant_role" label="Modalidad" sortConfig={sortConfig} onToggle={toggleSort} /></th>
                  <th><SortHeader column="payment_state" label="Estado de pago" sortConfig={sortConfig} onToggle={toggleSort} /></th>
                  <th><SortHeader column="amount" label="Monto" sortConfig={sortConfig} onToggle={toggleSort} /></th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sortedAttendees.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="text-muted">No hay inscritos para este taller todavía.</td>
                  </tr>
                ) : sortedAttendees.map((item) => {
                  const paymentState = normalizePaymentState(item)
                  const busy = Boolean(rowBusy[item.id])
                  return (
                    <tr key={item.id}>
                      <td>
                        <AttendanceControl
                          name={`attendance-${item.id}`}
                          value={item.attendance_status || 'pending'}
                          disabled={busy}
                          onChange={(nextStatus) => handleAttendanceChange(item.id, nextStatus)}
                        />
                      </td>
                      <td>
                        <div className="font-semibold">{item.lead_name || 'Sin nombre'}</div>
                        <div className="text-xs text-muted">{getAttendanceLabel(item.attendance_status || 'pending')}</div>
                      </td>
                      <td>{item.lead_phone || '—'}</td>
                      <td>
                        <span className={getParticipantBadgeClass(item.participant_role)}>
                          {getParticipantLabel(item.participant_role)}
                        </span>
                      </td>
                      <td>
                        <span className={getPaymentBadgeClass(paymentState)}>
                          {getPaymentLabel(paymentState)}
                        </span>
                      </td>
                      <td>{formatCurrency(getDisplayAmount(item))}</td>
                      <td>
                        {paymentState === 'onsite' ? (
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOnsiteTarget(item)}>
                            Confirmar pago
                          </button>
                        ) : (
                          <span className="text-muted text-xs">
                            {item.payment_recorded_at ? formatDateTime(item.payment_recorded_at) : '—'}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {onsiteTarget ? (
        <div className="attendance-modal-backdrop" role="presentation">
          <div className="attendance-modal card" role="dialog" aria-modal="true" aria-labelledby="onsite-modal-title">
            <div className="card-header">
              <h2 id="onsite-modal-title" className="card-title">Confirmar pago en sitio</h2>
            </div>
            <p className="attendance-modal-copy">
              ¿Confirmar pago en sitio de <strong>{onsiteTarget.lead_name || 'este inscrito'}</strong> — <strong>{formatCurrency(getDisplayAmount(onsiteTarget))}</strong>?
            </p>
            <div className="attendance-modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setOnsiteTarget(null)} disabled={confirmingOnsite}>
                Cancelar
              </button>
              <button type="button" className="btn btn-primary" onClick={handleConfirmOnsite} disabled={confirmingOnsite}>
                {confirmingOnsite ? 'Confirmando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showEmergencyModal ? (
        <div className="attendance-modal-backdrop" role="presentation">
          <div className="attendance-modal card" role="dialog" aria-modal="true" aria-labelledby="emergency-modal-title">
            <div className="card-header">
              <h2 id="emergency-modal-title" className="card-title">Añadir participante de emergencia</h2>
            </div>
            <form onSubmit={handleEmergencySubmit}>
              <div className="form-group">
                <label>Nombre completo</label>
                <input
                  className="input"
                  name="full_name"
                  value={emergencyForm.full_name}
                  onChange={handleEmergencyFieldChange}
                  required
                />
              </div>
              <div className="form-group">
                <label>Teléfono</label>
                <input
                  className="input"
                  name="phone"
                  value={emergencyForm.phone}
                  onChange={handleEmergencyFieldChange}
                  placeholder="Opcional"
                />
              </div>
              <div className="attendance-form-grid">
                <div className="form-group">
                  <label>Modalidad</label>
                  <select className="input" name="participant_role" value={emergencyForm.participant_role} onChange={handleEmergencyFieldChange}>
                    <option value="participa">Participa</option>
                    <option value="constela">Constela</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Estado de pago</label>
                  <select className="input" name="payment_state" value={emergencyForm.payment_state} onChange={handleEmergencyFieldChange}>
                    <option value="pending">Pendiente</option>
                    <option value="onsite">Pago en sitio</option>
                    <option value="paid">Pagado</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Monto</label>
                  <input
                    className="input"
                    type="number"
                    min="1"
                    name="amount"
                    value={emergencyForm.amount}
                    onChange={handleEmergencyFieldChange}
                    required
                  />
                </div>
              </div>
              <div className="attendance-modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowEmergencyModal(false)} disabled={creatingEmergency}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={creatingEmergency}>
                  {creatingEmergency ? 'Guardando...' : 'Añadir participante'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}
