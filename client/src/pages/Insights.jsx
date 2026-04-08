import { useEffect, useMemo, useState } from 'react'
import { apiGet } from '../utils/api'

const FUNNEL_STEPS = [
  { key: 'total', label: 'Leads totales' },
  { key: 'qualified', label: 'Calificados' },
  { key: 'negotiating', label: 'Negociando' },
  { key: 'converted', label: 'Convertidos' },
  { key: 'lost', label: 'Perdidos' },
]

export default function Insights() {
  const [funnel, setFunnel] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiGet('/api/analytics/funnel')
      .then(setFunnel)
      .catch(() => setFunnel(null))
      .finally(() => setLoading(false))
  }, [])

  const maxValue = useMemo(() => {
    return Math.max(1, ...(FUNNEL_STEPS.map((step) => Number(funnel?.[step.key] || 0)))
    )
  }, [funnel])

  if (loading) {
    return <div className="text-muted">Cargando insights...</div>
  }

  if (!funnel) {
    return <div className="text-muted">No se pudieron cargar los insights.</div>
  }

  return (
    <div>
      <h1 className="page-title">Insights</h1>

      <div className="kpi-grid mt-4">
        <KPI label="Conversión total" value={`${funnel.conversion_rate || 0}%`} />
        <KPI label="Tasa de pérdida" value={`${funnel.loss_rate || 0}%`} />
        <KPI label="Leads calificados" value={funnel.qualified || 0} />
        <KPI label="Leads negociando" value={funnel.negotiating || 0} />
      </div>

      <div className="card mt-4">
        <div className="card-header">
          <h2 className="card-title">Embudo comercial</h2>
        </div>
        <div className="funnel-bar">
          {FUNNEL_STEPS.map((step) => {
            const value = Number(funnel[step.key] || 0)
            const width = value > 0 ? `${Math.max(8, Math.round((value / maxValue) * 100))}%` : '0%'
            return (
              <div key={step.key} className="funnel-step">
                <div className="funnel-step-label">{step.label}</div>
                <div style={{ flex: 1 }}>
                  <div className="funnel-step-bar" style={{ width }} />
                </div>
                <div className="font-semibold">{value}</div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="card mt-4">
        <div className="card-header">
          <h2 className="card-title">Top fuentes de leads</h2>
        </div>
        {!funnel.top_sources?.length ? (
          <p className="text-muted">Todavía no hay fuentes registradas.</p>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Fuente</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {funnel.top_sources.map((item) => (
                  <tr key={item.source}>
                    <td className="font-semibold">{item.source}</td>
                    <td>{item.total}</td>
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

function KPI({ label, value }) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
    </div>
  )
}
