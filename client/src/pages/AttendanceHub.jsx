import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet } from '../utils/api'
import { formatDate } from '../utils/dates'

export default function AttendanceHub() {
  const [workshops, setWorkshops] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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

  return (
    <div>
      <div className="flex items-center justify-between gap-2" style={{ flexWrap: 'wrap' }}>
        <h1 className="page-title">Asistencia</h1>
        <Link className="btn btn-ghost btn-sm" to="/workshops">Ver talleres</Link>
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
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {workshops.map((workshop) => (
                  <tr key={workshop.id}>
                    <td className="font-semibold">{workshop.name}</td>
                    <td>{workshop.date ? formatDate(workshop.date) : 'Sin fecha'}</td>
                    <td className="text-secondary">{workshop.venue_name || 'Sin venue'}</td>
                    <td>{workshop.current_participants || 0}/{workshop.max_participants || 0}</td>
                    <td>
                      <Link className="btn btn-primary btn-sm" to={`/taller/${workshop.id}/asistencia`}>
                        Abrir asistencia
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
