import { useState, useEffect, useCallback } from 'react'
import { apiGet } from '../utils/api'
import { timeAgo } from '../utils/dates'

const STATUS_LABELS = {
  new: 'Nuevo', qualifying: 'Calificando', qualified: 'Calificado',
  negotiating: 'Negociando', converted: 'Convertido', lost: 'Perdido', dormant: 'Dormido',
}

const STATUS_CLASSES = {
  new: 'badge badge-info', qualifying: 'badge badge-info',
  qualified: 'badge badge-success', negotiating: 'badge badge-warning',
  converted: 'badge badge-success', lost: 'badge badge-danger', dormant: 'badge',
}

export default function Leads() {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    let url = '/api/leads?limit=100'
    if (filter) url += `&status=${filter}`
    if (search) url += `&search=${encodeURIComponent(search)}`
    apiGet(url)
      .then(r => setLeads(r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [filter, search])

  useEffect(() => { load() }, [load])

  return (
    <div>
      <h1 className="page-title">Leads</h1>

      <div className="flex gap-2 mt-4" style={{ flexWrap: 'wrap' }}>
        <input
          className="input"
          style={{ maxWidth: 250 }}
          placeholder="Buscar por nombre o teléfono..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="input" style={{ maxWidth: 180 }} value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {loading ? (
        <p className="text-muted mt-4">Cargando...</p>
      ) : leads.length === 0 ? (
        <p className="text-muted mt-4">No hay leads todavía. Llegarán cuando alguien escriba al bot.</p>
      ) : (
        <div className="table-container mt-4">
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
              {leads.map(l => (
                <tr key={l.id}>
                  <td className="font-semibold">{l.name || 'Sin nombre'}</td>
                  <td className="text-secondary">{l.phone}</td>
                  <td className="text-secondary">{l.source || '-'}</td>
                  <td><span className={STATUS_CLASSES[l.status] || 'badge'}>{STATUS_LABELS[l.status] || l.status}</span></td>
                  <td>
                    <ScoreBar score={l.quality_score || 0} />
                  </td>
                  <td className="text-muted text-sm">{timeAgo(l.last_contact_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ScoreBar({ score }) {
  const color = score >= 70 ? 'var(--color-success)' : score >= 40 ? 'var(--color-warning)' : 'var(--color-text-muted)';
  return (
    <div className="flex items-center gap-2">
      <div style={{ width: 60, height: 6, background: 'var(--color-border)', borderRadius: 3 }}>
        <div style={{ width: `${Math.min(score, 100)}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.3s' }} />
      </div>
      <span className="text-xs text-muted">{score}</span>
    </div>
  )
}
