import { useEffect, useRef, useState } from 'react'
import { Chart, registerables } from 'chart.js'
import { apiGet } from '../utils/api'

Chart.register(...registerables)

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444',
  '#06b6d4', '#ec4899', '#f97316', '#14b8a6', '#84cc16']

const FUNNEL_STEPS = [
  { key: 'total', label: 'Total' },
  { key: 'qualified', label: 'Calificados' },
  { key: 'negotiating', label: 'Negociando' },
  { key: 'converted', label: 'Convertidos' },
]

function toNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatDayMonth(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '--/--'
  const parts = dateStr.split('-')
  if (parts.length !== 3) return dateStr
  return `${parts[2]}/${parts[1]}`
}

function formatFullDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return 'Sin fecha'
  const parts = dateStr.split('-')
  if (parts.length !== 3) return dateStr
  return `${parts[2]}/${parts[1]}/${parts[0]}`
}

function formatBs(amount) {
  return `Bs ${toNumber(amount).toLocaleString('es-BO', { maximumFractionDigits: 2 })}`
}

function getStepRate(fromValue, toValue) {
  const from = toNumber(fromValue)
  const to = toNumber(toValue)
  if (from <= 0) return 0
  return Math.round((to / from) * 100)
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, toNumber(value)))
}

const GRID_TWO_COLUMNS_STYLE = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: '1.5rem',
}

export default function Insights() {
  const [loading, setLoading] = useState(true)
  const [funnel, setFunnel] = useState(null)
  const [leadsTrend, setLeadsTrend] = useState([])
  const [sources, setSources] = useState([])
  const [workshopsFinance, setWorkshopsFinance] = useState([])
  const [flowDropoff, setFlowDropoff] = useState([])

  const trendCanvasRef = useRef(null)
  const trendInstanceRef = useRef(null)
  const sourcesCanvasRef = useRef(null)
  const sourcesInstanceRef = useRef(null)

  useEffect(() => {
    let active = true
    setLoading(true)

    Promise.allSettled([
      apiGet('/api/analytics/funnel'),
      apiGet('/api/analytics/leads-trend'),
      apiGet('/api/analytics/sources'),
      apiGet('/api/analytics/workshops-finance'),
      apiGet('/api/analytics/flow-dropoff'),
    ])
      .then(([funnelRes, leadsTrendRes, sourcesRes, workshopsRes, dropoffRes]) => {
        if (!active) return

        setFunnel(funnelRes.status === 'fulfilled' ? (funnelRes.value || null) : null)
        setLeadsTrend(leadsTrendRes.status === 'fulfilled' && Array.isArray(leadsTrendRes.value) ? leadsTrendRes.value : [])
        setSources(sourcesRes.status === 'fulfilled' && Array.isArray(sourcesRes.value) ? sourcesRes.value : [])
        setWorkshopsFinance(workshopsRes.status === 'fulfilled' && Array.isArray(workshopsRes.value) ? workshopsRes.value : [])
        setFlowDropoff(dropoffRes.status === 'fulfilled' && Array.isArray(dropoffRes.value) ? dropoffRes.value : [])
      })
      .finally(() => {
        if (active) {
          setLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!trendCanvasRef.current || !leadsTrend?.length) return
    trendInstanceRef.current?.destroy()
    trendInstanceRef.current = new Chart(trendCanvasRef.current, {
      type: 'line',
      data: {
        labels: leadsTrend.map((row) => formatDayMonth(row.week_start)),
        datasets: [{
          data: leadsTrend.map((row) => toNumber(row.total)),
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.14)',
          fill: true,
          tension: 0.32,
          pointRadius: 3,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1 },
          },
        },
      },
    })
    return () => trendInstanceRef.current?.destroy()
  }, [leadsTrend])

  useEffect(() => {
    if (!sourcesCanvasRef.current || !sources?.length) return
    sourcesInstanceRef.current?.destroy()
    sourcesInstanceRef.current = new Chart(sourcesCanvasRef.current, {
      type: 'doughnut',
      data: {
        labels: sources.map((row) => row.source || 'sin fuente'),
        datasets: [{
          data: sources.map((row) => toNumber(row.total)),
          backgroundColor: sources.map((_, index) => COLORS[index % COLORS.length]),
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
      },
    })
    return () => sourcesInstanceRef.current?.destroy()
  }, [sources])

  if (loading) {
    return <div className="text-muted">Cargando insights...</div>
  }

  const totalLeads = toNumber(funnel?.total)
  const convertedLeads = toNumber(funnel?.converted)
  const lostLeads = toNumber(funnel?.lost)
  const qualifiedLeads = toNumber(funnel?.qualified)
  const negotiatingLeads = toNumber(funnel?.negotiating)
  const conversionRate = totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0
  const activeSources = sources.filter((item) => toNumber(item.total) > 0).length
  const workshopsCount = workshopsFinance.length
  const maxFunnelValue = Math.max(1, totalLeads, qualifiedLeads, negotiatingLeads, convertedLeads)

  return (
    <div>
      <h1 className="page-title">Insights</h1>

      <div className="kpi-grid mt-4">
        <KPI label="Leads totales" value={totalLeads} />
        <KPI label="Convertidos" value={convertedLeads} />
        <KPI label="Tasa %" value={`${conversionRate}%`} />
        <KPI label="Perdidos" value={lostLeads} />
        <KPI label="Fuentes activas" value={activeSources} />
        <KPI label="Talleres" value={workshopsCount} />
      </div>

      <div className="mt-4" style={GRID_TWO_COLUMNS_STYLE}>
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Embudo comercial</h2>
          </div>
          {!funnel ? (
            <p className="text-muted">No se pudo cargar el embudo.</p>
          ) : (
            <div className="funnel-bar">
              {FUNNEL_STEPS.map((step, index) => {
                const value = toNumber(funnel?.[step.key])
                const nextStep = FUNNEL_STEPS[index + 1]
                const width = value > 0 ? `${Math.max(8, Math.round((value / maxFunnelValue) * 100))}%` : '0%'
                return (
                  <div key={step.key}>
                    <div className="funnel-step">
                      <div className="funnel-step-label">{step.label}</div>
                      <div style={{ flex: 1 }}>
                        <div className="funnel-step-bar" style={{ width }} />
                      </div>
                      <div className="font-semibold">{value}</div>
                    </div>
                    {nextStep ? (
                      <div className="text-xs text-secondary" style={{ paddingLeft: '124px' }}>
                        → {getStepRate(value, funnel?.[nextStep.key])}%
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Tendencia semanal</h2>
          </div>
          {!leadsTrend.length ? (
            <p className="text-muted">No hay semanas suficientes para mostrar tendencia.</p>
          ) : (
            <div style={{ height: 200 }}>
              <canvas ref={trendCanvasRef} />
            </div>
          )}
        </div>
      </div>

      <div className="mt-4" style={GRID_TWO_COLUMNS_STYLE}>
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Fuentes de leads</h2>
          </div>
          {!sources.length ? (
            <p className="text-muted">Todavía no hay fuentes registradas.</p>
          ) : (
            <>
              <div style={{ height: 200 }}>
                <canvas ref={sourcesCanvasRef} />
              </div>
              <div className="mt-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.5rem 1rem' }}>
                {sources.map((row, index) => (
                  <div key={`${row.source}-${index}`} className="flex items-center gap-2">
                    <span
                      aria-hidden
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: COLORS[index % COLORS.length],
                        display: 'inline-block',
                        flexShrink: 0,
                      }}
                    />
                    <span className="text-sm">{row.source || 'sin fuente'}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Conversión por fuente</h2>
          </div>
          {!sources.length ? (
            <p className="text-muted">Sin datos de conversión por fuente.</p>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Fuente</th>
                    <th>Leads</th>
                    <th>Convertidos</th>
                    <th>Tasa</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((row, index) => (
                    <tr key={`${row.source}-${index}`}>
                      <td className="font-semibold">{row.source || 'sin fuente'}</td>
                      <td>{toNumber(row.total)}</td>
                      <td>{toNumber(row.converted)}</td>
                      <td>{toNumber(row.conversion_rate)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card mt-4">
        <div className="card-header">
          <h2 className="card-title">Abandono en el bot</h2>
        </div>
        {!flowDropoff.length ? (
          <p className="text-muted">No hay abandonos registrados.</p>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Nodo</th>
                  <th>Nombre</th>
                  <th>Abandonos</th>
                </tr>
              </thead>
              <tbody>
                {flowDropoff.map((row, index) => (
                  <tr key={`${row.node_key || 'nodo'}-${index}`}>
                    <td className="font-semibold">{row.node_key || '-'}</td>
                    <td>{row.node_name || 'Sin nombre'}</td>
                    <td>{toNumber(row.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card mt-4">
        <div className="card-header">
          <h2 className="card-title">Salud financiera por taller</h2>
        </div>
        {!workshopsFinance.length ? (
          <p className="text-muted">Sin talleres registrados.</p>
        ) : (
          <div>
            {workshopsFinance.map((workshop, index) => {
              const enrolled = toNumber(workshop.enrolled)
              const paid = toNumber(workshop.paid)
              const maxParticipants = toNumber(workshop.max_participants)
              const fillRate = toNumber(workshop.fill_rate)
              const paymentRate = toNumber(workshop.payment_rate)
              return (
                <div
                  key={workshop.id || index}
                  style={{
                    padding: '1rem 0',
                    borderBottom: index < workshopsFinance.length - 1 ? '1px solid var(--color-border)' : '0',
                  }}
                >
                  <div className="flex items-center justify-between gap-2" style={{ flexWrap: 'wrap' }}>
                    <div className="font-semibold">{workshop.name || 'Sin nombre'}</div>
                    <div className="text-sm text-secondary">{formatFullDate(workshop.date)}</div>
                  </div>

                  <div className="mt-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-secondary">Llenado</span>
                      <span className="text-xs text-secondary">{fillRate}%</span>
                    </div>
                    <div style={{ background: 'var(--color-border)', borderRadius: 4, height: 8, marginTop: 6 }}>
                      <div style={{ width: `${clampPercent(fillRate)}%`, background: '#10b981', height: '100%', borderRadius: 4 }} />
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-secondary">Pagos</span>
                      <span className="text-xs text-secondary">{paymentRate}%</span>
                    </div>
                    <div style={{ background: 'var(--color-border)', borderRadius: 4, height: 8, marginTop: 6 }}>
                      <div style={{ width: `${clampPercent(paymentRate)}%`, background: '#3b82f6', height: '100%', borderRadius: 4 }} />
                    </div>
                  </div>

                  <div className="text-sm text-muted mt-4">
                    {`${enrolled}/${maxParticipants} inscritos · ${paid} pagaron · ${formatBs(workshop.revenue)} ingresos`}
                  </div>
                </div>
              )
            })}
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
