import { useEffect, useRef, useState } from 'react'
import { Chart, registerables } from 'chart.js'
import { apiGet } from '../utils/api'

Chart.register(...registerables)

const COLORS = ['#6366f1','#22c55e','#eab308','#8b5cf6','#ef4444','#06b6d4','#ec4899','#f97316','#14b8a6','#84cc16']

const KPI_ACCENT = ['#6366f1','#22c55e','#eab308','#f97316','#ec4899','#06b6d4']
const KPI_VALUE_COLOR = ['#a5b4fc','#22c55e','#eab308','#f97316','#ec4899','#06b6d4']

function toNumber(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function fmtDayMonth(s) {
  if (!s) return '--'
  const p = String(s).split('-')
  return p.length === 3 ? `${p[2]}/${p[1]}` : s
}

function fmtDate(s) {
  if (!s) return 'Sin fecha'
  const p = String(s).split('-')
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s
}

function fmtBs(n) {
  return `Bs ${toNumber(n).toLocaleString('es-BO', { maximumFractionDigits: 0 })}`
}

function stepRate(from, to) {
  const f = toNumber(from); const t = toNumber(to)
  if (f <= 0) return null
  return Math.round((t / f) * 100)
}

function rateColor(pct) {
  if (pct == null) return 'var(--color-text-muted)'
  if (pct >= 60) return '#22c55e'
  if (pct >= 30) return '#eab308'
  return '#ef4444'
}

function clamp(v) { return Math.max(0, Math.min(100, toNumber(v))) }

const FUNNEL_STEPS = [
  { key: 'total', label: 'Total' },
  { key: 'qualified', label: 'Calificados' },
  { key: 'negotiating', label: 'Negociando' },
  { key: 'converted', label: 'Convertidos' },
]

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
      letterSpacing: '.08em', color: 'var(--color-text-muted)',
      margin: '28px 0 12px',
    }}>
      {children}
    </div>
  )
}

function InsightCard({ title, sub, children, style }) {
  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 12,
      padding: 20,
      ...style,
    }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: sub ? 2 : 16 }}>{title}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 16 }}>{sub}</div>}
      {children}
    </div>
  )
}

function KPICard({ label, value, accent, valueColor }) {
  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 12,
      padding: '18px 20px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        height: 3, background: accent,
      }} />
      <div style={{
        fontSize: 11, color: 'var(--color-text-muted)',
        textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6,
      }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1, color: valueColor }}>
        {value}
      </div>
    </div>
  )
}

export default function Insights() {
  const [loading, setLoading] = useState(true)
  const [funnel, setFunnel] = useState(null)
  const [trend, setTrend] = useState([])
  const [sources, setSources] = useState([])
  const [workshops, setWorkshops] = useState([])
  const [dropoff, setDropoff] = useState([])

  const trendRef = useRef(null)
  const trendChart = useRef(null)
  const donutRef = useRef(null)
  const donutChart = useRef(null)

  useEffect(() => {
    let alive = true
    Promise.allSettled([
      apiGet('/api/analytics/funnel'),
      apiGet('/api/analytics/leads-trend'),
      apiGet('/api/analytics/sources'),
      apiGet('/api/analytics/workshops-finance'),
      apiGet('/api/analytics/flow-dropoff'),
    ]).then(([f, t, s, w, d]) => {
      if (!alive) return
      setFunnel(f.status === 'fulfilled' ? f.value || null : null)
      setTrend(t.status === 'fulfilled' && Array.isArray(t.value) ? t.value : [])
      setSources(s.status === 'fulfilled' && Array.isArray(s.value) ? s.value : [])
      setWorkshops(w.status === 'fulfilled' && Array.isArray(w.value) ? w.value : [])
      setDropoff(d.status === 'fulfilled' && Array.isArray(d.value) ? d.value : [])
      setLoading(false)
    })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!trendRef.current || !trend.length) return
    trendChart.current?.destroy()
    trendChart.current = new Chart(trendRef.current, {
      type: 'line',
      data: {
        labels: trend.map((r) => fmtDayMonth(r.week_start)),
        datasets: [{
          data: trend.map((r) => toNumber(r.total)),
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99,102,241,0.12)',
          fill: true,
          tension: 0.35,
          pointRadius: 4,
          pointBackgroundColor: '#6366f1',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#7b82a8' } },
          y: { beginAtZero: true, ticks: { stepSize: 1, color: '#7b82a8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        },
      },
    })
    return () => trendChart.current?.destroy()
  }, [trend])

  useEffect(() => {
    if (!donutRef.current || !sources.length) return
    donutChart.current?.destroy()
    donutChart.current = new Chart(donutRef.current, {
      type: 'doughnut',
      data: {
        labels: sources.map((r) => r.source || 'sin fuente'),
        datasets: [{
          data: sources.map((r) => toNumber(r.total)),
          backgroundColor: sources.map((_, i) => COLORS[i % COLORS.length]),
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: { legend: { display: false } },
      },
    })
    return () => donutChart.current?.destroy()
  }, [sources])

  if (loading) {
    return <div className="text-muted" style={{ padding: 32 }}>Cargando insights...</div>
  }

  const total = toNumber(funnel?.total)
  const converted = toNumber(funnel?.converted)
  const lost = toNumber(funnel?.lost)
  const convRate = total > 0 ? Math.round((converted / total) * 100) : 0
  const activeSources = sources.filter((s) => toNumber(s.total) > 0).length
  const maxFunnel = Math.max(1, total)

  const dropMax = dropoff.length > 0 ? Math.max(1, ...dropoff.map((r) => toNumber(r.total))) : 1

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <h1 className="page-title">Insights</h1>
      </div>

      {/* KPI Strip */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: 12,
        marginBottom: 4,
      }}>
        <KPICard label="Leads totales" value={total} accent={KPI_ACCENT[0]} valueColor={KPI_VALUE_COLOR[0]} />
        <KPICard label="Convertidos" value={converted} accent={KPI_ACCENT[1]} valueColor={KPI_VALUE_COLOR[1]} />
        <KPICard label="Tasa conversión" value={`${convRate}%`} accent={KPI_ACCENT[2]} valueColor={KPI_VALUE_COLOR[2]} />
        <KPICard label="Perdidos" value={lost} accent={KPI_ACCENT[3]} valueColor={KPI_VALUE_COLOR[3]} />
        <KPICard label="Fuentes activas" value={activeSources} accent={KPI_ACCENT[4]} valueColor={KPI_VALUE_COLOR[4]} />
        <KPICard label="Talleres" value={workshops.length} accent={KPI_ACCENT[5]} valueColor={KPI_VALUE_COLOR[5]} />
      </div>

      {/* Embudo + Tendencia */}
      <SectionLabel>Embudo y tendencia</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        <InsightCard title="Embudo comercial" sub="Leads por etapa del ciclo de venta">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {FUNNEL_STEPS.map((step, i) => {
              const val = toNumber(funnel?.[step.key])
              const next = FUNNEL_STEPS[i + 1]
              const rate = next ? stepRate(val, funnel?.[next.key]) : null
              const pct = Math.max(val > 0 ? 8 : 0, Math.round((val / maxFunnel) * 100))
              const barColors = ['#6366f1','#06b6d4','#eab308','#22c55e']
              return (
                <div key={step.key}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 100, fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'right', flexShrink: 0 }}>
                      {step.label}
                    </div>
                    <div style={{
                      flex: 1, background: 'var(--color-surface-hover)',
                      borderRadius: 4, height: 32, overflow: 'hidden', position: 'relative',
                    }}>
                      <div style={{
                        width: `${pct}%`, height: '100%', background: barColors[i],
                        display: 'flex', alignItems: 'center', paddingLeft: 10,
                        fontSize: 13, fontWeight: 600, color: '#fff',
                        borderRadius: 4, transition: 'width .4s ease',
                      }}>
                        {val > 0 ? val : ''}
                      </div>
                    </div>
                    <div style={{ width: 44, textAlign: 'right', fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>
                      {val}
                    </div>
                  </div>
                  {rate !== null && (
                    <div style={{
                      paddingLeft: 116, fontSize: 11,
                      color: rateColor(rate), marginTop: 2, marginBottom: 2,
                    }}>
                      → {rate}% pasan
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </InsightCard>

        <InsightCard title="Tendencia semanal" sub="Nuevos leads por semana (últimas 8 semanas)">
          {trend.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Sin datos de tendencia.</p>
          ) : (
            <div style={{ height: 220 }}>
              <canvas ref={trendRef} />
            </div>
          )}
        </InsightCard>
      </div>

      {/* Fuentes */}
      <SectionLabel>Fuentes de captación</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        <InsightCard title="Distribución por fuente" sub="De dónde vienen tus leads">
          {sources.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Sin fuentes registradas.</p>
          ) : (
            <>
              <div style={{ height: 200 }}>
                <canvas ref={donutRef} />
              </div>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '6px 16px', marginTop: 14,
              }}>
                {sources.map((r, i) => (
                  <div key={r.source || i} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{
                      width: 9, height: 9, borderRadius: '50%',
                      background: COLORS[i % COLORS.length], flexShrink: 0, display: 'inline-block',
                    }} />
                    <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{r.source || 'sin fuente'}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </InsightCard>

        <InsightCard title="Conversión por fuente" sub="Efectividad de cada canal">
          {sources.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Sin datos.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['Fuente','Leads','Convertidos','Tasa'].map((h) => (
                    <th key={h} style={{
                      textAlign: 'left', paddingBottom: 10,
                      fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)',
                      textTransform: 'uppercase', letterSpacing: '.05em',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sources.map((r, i) => (
                  <tr key={r.source || i} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '9px 0', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: COLORS[i % COLORS.length], flexShrink: 0, display: 'inline-block',
                      }} />
                      {r.source || 'sin fuente'}
                    </td>
                    <td style={{ padding: '9px 8px' }}>{toNumber(r.total)}</td>
                    <td style={{ padding: '9px 8px' }}>{toNumber(r.converted)}</td>
                    <td style={{ padding: '9px 0', fontWeight: 600, color: rateColor(toNumber(r.conversion_rate)) }}>
                      {toNumber(r.conversion_rate)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </InsightCard>
      </div>

      {/* Abandono en el bot */}
      <SectionLabel>Abandono en el bot</SectionLabel>
      <InsightCard title="Nodos de abandono" sub="En qué punto del flujo la gente se va sin comprar">
        {dropoff.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>No hay abandonos registrados.</p>
        ) : (
          <div>
            {dropoff.map((row, i) => {
              const pct = Math.round((toNumber(row.total) / dropMax) * 100)
              return (
                <div key={row.node_key || i} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '11px 0',
                  borderBottom: i < dropoff.length - 1 ? '1px solid var(--color-border)' : 'none',
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{row.node_name || row.node_key || '—'}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{row.node_key}</div>
                  </div>
                  <div style={{ width: 80, height: 6, background: 'var(--color-surface-hover)', borderRadius: 6, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: '#ef4444', borderRadius: 6 }} />
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, width: 36, textAlign: 'right', color: '#ef4444' }}>
                    {toNumber(row.total)}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </InsightCard>

      {/* Salud financiera */}
      <SectionLabel>Salud financiera por taller</SectionLabel>
      <InsightCard title="Inscritos y pagos" sub="Llenado y recaudación por evento">
        {workshops.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Sin talleres registrados.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {workshops.map((w, i) => {
              const enrolled = toNumber(w.enrolled)
              const paid = toNumber(w.paid)
              const max = toNumber(w.max_participants)
              const fillRate = clamp(w.fill_rate)
              const payRate = clamp(w.payment_rate)
              return (
                <div key={w.id || i}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{w.name || 'Sin nombre'}</span>
                    <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{fmtDate(w.date)}</span>
                  </div>

                  <div style={{ marginBottom: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 5 }}>
                      <span>Llenado</span><span>{fillRate}%</span>
                    </div>
                    <div style={{ height: 10, background: 'var(--color-surface-hover)', borderRadius: 10, overflow: 'hidden' }}>
                      <div style={{ width: `${fillRate}%`, height: '100%', background: '#22c55e', borderRadius: 10 }} />
                    </div>
                  </div>

                  <div style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 5 }}>
                      <span>Pagos recibidos</span><span>{payRate}%</span>
                    </div>
                    <div style={{ height: 10, background: 'var(--color-surface-hover)', borderRadius: 10, overflow: 'hidden' }}>
                      <div style={{ width: `${payRate}%`, height: '100%', background: '#6366f1', borderRadius: 10 }} />
                    </div>
                  </div>

                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                    {enrolled}/{max} inscritos · {paid} pagaron · {fmtBs(w.revenue)} ingresos
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </InsightCard>

      <div style={{ height: 32 }} />
    </div>
  )
}
