import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiGet } from '../utils/api'
import { formatDate } from '../utils/dates'

function isUpcoming(workshop) {
  if (!workshop.date) return true
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return new Date(workshop.date) >= today
}

function sortWorkshops(workshops) {
  const upcoming = workshops.filter(isUpcoming).sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0))
  const past = workshops.filter((w) => !isUpcoming(w)).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
  return { upcoming, past }
}

export default function AttendanceHub() {
  const [workshops, setWorkshops] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')
      try {
        const response = await apiGet('/api/workshops?limit=200')
        if (cancelled) return
        setWorkshops(Array.isArray(response.data) ? response.data : [])
      } catch (err) {
        if (cancelled) return
        setError(err.message || 'No se pudo cargar talleres')
        setWorkshops([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  const { upcoming, past } = sortWorkshops(workshops)

  function WorkshopRow({ workshop, dimmed }) {
    return (
      <tr
        key={workshop.id}
        onClick={() => navigate(`/taller/${workshop.id}/asistencia`)}
        style={{
          cursor: 'pointer',
          opacity: dimmed ? 0.45 : 1,
          transition: 'opacity 0.15s',
        }}
        className="attendance-hub-row"
      >
        <td className="font-semibold">{workshop.name}</td>
        <td>{workshop.date ? formatDate(workshop.date) : 'Sin fecha'}</td>
        <td className="text-secondary">{workshop.venue_name || 'Sin venue'}</td>
        <td>{workshop.current_participants || 0}/{workshop.max_participants || 0}</td>
        <td>
          <span className={`attendance-badge ${dimmed ? '' : 'attendance-badge-success'}`}>
            {dimmed ? 'Finalizado' : 'Activo'}
          </span>
        </td>
      </tr>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2" style={{ flexWrap: 'wrap' }}>
        <h1 className="page-title">Asistencia</h1>
      </div>

      <div className="card mt-4">
        <div className="card-header">
          <h2 className="card-title">Elige un taller</h2>
        </div>

        {loading ? (
          <div className="text-muted">Cargando talleres...</div>
        ) : error ? (
          <div className="inline-notice inline-notice-warning">{error}</div>
        ) : workshops.length === 0 ? (
          <div className="text-muted">No hay talleres creados todavía.</div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Taller</th>
                  <th>Fecha</th>
                  <th>Venue</th>
                  <th>Cupos</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((w) => <WorkshopRow key={w.id} workshop={w} dimmed={false} />)}
                {past.length > 0 && upcoming.length > 0 && (
                  <tr>
                    <td colSpan="5" style={{ padding: '4px 0', borderBottom: '1px solid var(--border-color)' }}>
                      <span className="text-muted text-xs" style={{ paddingLeft: 8 }}>Talleres pasados</span>
                    </td>
                  </tr>
                )}
                {past.map((w) => <WorkshopRow key={w.id} workshop={w} dimmed={true} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
