import { useState, useEffect, useCallback } from 'react'
import { apiGet, apiPost, apiPut, apiDelete } from '../utils/api'
import { formatDate, formatCurrency } from '../utils/dates'

const STATUS_LABELS = {
  draft: 'Borrador', planned: 'Planificado', open: 'Inscripciones abiertas',
  full: 'Lleno', completed: 'Completado', cancelled: 'Cancelado',
}

const STATUS_CLASSES = {
  draft: 'badge', planned: 'badge badge-info', open: 'badge badge-success',
  full: 'badge badge-warning', completed: 'badge', cancelled: 'badge badge-danger',
}

export default function Workshops() {
  const [workshops, setWorkshops] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    apiGet('/api/workshops')
      .then(r => setWorkshops(r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  function handleEdit(w) {
    setEditing(w)
    setShowForm(true)
  }

  function handleNew() {
    setEditing(null)
    setShowForm(true)
  }

  async function handleDelete(id) {
    if (!confirm('¿Eliminar este taller?')) return
    await apiDelete(`/api/workshops/${id}`)
    load()
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
          onSave={() => { setShowForm(false); load() }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {loading ? (
        <p className="text-muted mt-4">Cargando...</p>
      ) : workshops.length === 0 ? (
        <p className="text-muted mt-4">No hay talleres. Crea el primero.</p>
      ) : (
        <div className="table-container mt-4">
          <table className="table">
            <thead>
              <tr>
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
              {workshops.map(w => (
                <tr key={w.id}>
                  <td className="font-semibold">{w.name}</td>
                  <td>{w.date ? formatDate(w.date) : '-'}</td>
                  <td>{w.price ? formatCurrency(w.price) : '-'}</td>
                  <td>{w.current_participants}/{w.max_participants}</td>
                  <td><span className={STATUS_CLASSES[w.status] || 'badge'}>{STATUS_LABELS[w.status] || w.status}</span></td>
                  <td className="text-secondary">{w.venue_name || '-'}</td>
                  <td>
                    <div className="flex gap-2">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleEdit(w)}>Editar</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleDelete(w.id)}>Eliminar</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function WorkshopForm({ workshop, onSave, onCancel }) {
  const [form, setForm] = useState({
    name: workshop?.name || '',
    type: workshop?.type || '',
    modality: workshop?.modality || 'presencial',
    status: workshop?.status || 'draft',
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

  function handleChange(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
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
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
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
            <input className="input" name="max_participants" type="number" value={form.max_participants} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label>Precio (Bs)</label>
            <input className="input" name="price" type="number" value={form.price} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label>Precio early bird (Bs)</label>
            <input className="input" name="early_bird_price" type="number" value={form.early_bird_price} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label>Deadline early bird</label>
            <input className="input" name="early_bird_deadline" type="date" value={form.early_bird_deadline} onChange={handleChange} />
          </div>
        </div>
        <div className="form-group mt-4">
          <label>Descripción</label>
          <textarea className="input" name="description" value={form.description} onChange={handleChange}
            rows={3} style={{ resize: 'vertical' }} />
        </div>
        <div className="flex gap-2 mt-4">
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancelar</button>
        </div>
      </form>
    </div>
  )
}
