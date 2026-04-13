import { useEffect, useRef, useState } from 'react'
import { Chart, registerables } from 'chart.js'
import { apiGet } from '../utils/api'

Chart.register(...registerables)

// Paleta visual
const C = {
  accent: 'rgba(99,102,241,.8)',
  green:  'rgba(34,197,94,.8)',
  yellow: 'rgba(234,179,8,.8)',
  orange: 'rgba(249,115,22,.8)',
  red:    'rgba(239,68,68,.8)',
  cyan:   'rgba(6,182,212,.8)',
  pink:   'rgba(236,72,153,.8)',
  purple: 'rgba(168,85,247,.8)',
  muted:  'rgba(123,130,168,.5)',
}
const DONUT_COLORS = ['#6366f1','#22c55e','#eab308','#8b5cf6','#ef4444','#06b6d4','#ec4899','#f97316']
const CHART_OPTS = {
  plugins: { legend: { labels: { color: '#7b82a8', font: { size: 11 } } } },
  scales: {
    x: { ticks: { color: '#7b82a8', font: { size: 11 } }, grid: { color: 'rgba(100,116,139,.15)' } },
    y: { ticks: { color: '#7b82a8', font: { size: 11 } }, grid: { color: 'rgba(100,116,139,.15)' } },
  },
}

const KPI_DEFS = [
  { key: 'income_total',    label: 'Ingreso total',     accent: '#6366f1', vc: '#a5b4fc', fmt: fmtBs },
  { key: 'converted',       label: 'Convertidos',       accent: '#22c55e', vc: '#22c55e', fmt: (v) => v },
  { key: 'pending_cobro',   label: 'Pendiente cobro',   accent: '#eab308', vc: '#eab308', fmt: fmtBs },
  { key: 'avg_days_to_pay', label: 'Días lead→pago',    accent: '#f97316', vc: '#f97316', fmt: (v) => v != null ? `${v}d` : '—' },
  { key: 'referidos',       label: 'Referidos',         accent: '#06b6d4', vc: '#06b6d4', fmt: (v) => v },
  { key: 'total',           label: 'Leads totales',     accent: '#8b5cf6', vc: '#c4b5fd', fmt: (v) => v },
]

const TAG_COLORS = {
  intent:    'rgba(99,102,241,.2)',   intent_text:   '#a5b4fc',
  sentiment: 'rgba(234,179,8,.2)',    sentiment_text:'#fde047',
  objection: 'rgba(239,68,68,.2)',    objection_text:'#fca5a5',
  stage:     'rgba(34,197,94,.2)',    stage_text:    '#86efac',
  behavior:  'rgba(168,85,247,.2)',   behavior_text: '#d8b4fe',
  quality:   'rgba(249,115,22,.2)',   quality_text:  '#fdba74',
}

function toN(v) { const n = Number(v); return Number.isFinite(n) ? n : 0 }
function fmtBs(v) { return `Bs ${toN(v).toLocaleString('es-BO', { maximumFractionDigits: 0 })}` }
function fmtMon(s) { if (!s) return '--'; const [y, m] = s.split('-'); const names = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']; return `${names[Number(m) - 1] || m} ${y}` }
function fmtDM(s) { if (!s) return '--'; const p = String(s).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}` : s }
function fmtDate(s) { if (!s) return 'Sin fecha'; const p = String(s).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s }
function clamp(v) { return Math.max(0, Math.min(100, toN(v))) }
function rateColor(pct) {
  if (pct >= 60) return '#22c55e'
  if (pct >= 30) return '#eab308'
  return '#ef4444'
}

function useChart(ref, instanceRef, config, deps) {
  useEffect(() => {
    if (!ref.current) return
    instanceRef.current?.destroy()
    instanceRef.current = new Chart(ref.current, config)
    return () => instanceRef.current?.destroy()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

function Card({ title, sub, children, style }) {
  return (
    <div style={{
      background: 'var(--color-surface)', border: '1px solid var(--color-border)',
      borderRadius: 12, padding: 20, ...style,
    }}>
      {title && <div style={{ fontSize: 15, fontWeight: 600, marginBottom: sub ? 2 : 16 }}>{title}</div>}
      {sub && <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 16 }}>{sub}</div>}
      {children}
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--color-text-muted)', margin: '28px 0 12px' }}>
      {children}
    </div>
  )
}

function Grid2({ children, style }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, ...style }}>{children}</div>
}

function Grid3({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>{children}</div>
}

export default function Insights() {
  const [loading, setLoading] = useState(true)
  const [funnel, setFunnel] = useState(null)
  const [trend, setTrend] = useState([])
  const [sources, setSources] = useState([])
  const [workshops, setWorkshops] = useState([])
  const [dropoff, setDropoff] = useState([])
  const [kpis, setKpis] = useState(null)
  const [convStats, setConvStats] = useState(null)
  const [profile, setProfile] = useState(null)
  const [revenue, setRevenue] = useState([])

  // chart refs
  const trendRef = useRef(null); const trendChart = useRef(null)
  const donutRef = useRef(null); const donutChart = useRef(null)
  const convSrcRef = useRef(null); const convSrcChart = useRef(null)
  const cityRef = useRef(null); const cityChart = useRef(null)
  const revenueRef = useRef(null); const revenueChart = useRef(null)

  useEffect(() => {
    let alive = true
    Promise.allSettled([
      apiGet('/api/analytics/funnel'),
      apiGet('/api/analytics/leads-trend'),
      apiGet('/api/analytics/sources'),
      apiGet('/api/analytics/workshops-finance'),
      apiGet('/api/analytics/flow-dropoff'),
      apiGet('/api/analytics/kpis'),
      apiGet('/api/analytics/conversation-stats'),
      apiGet('/api/analytics/lead-profile'),
      apiGet('/api/analytics/monthly-revenue'),
    ]).then(([f, t, s, w, d, k, cs, p, r]) => {
      if (!alive) return
      if (f.status === 'fulfilled') setFunnel(f.value)
      if (t.status === 'fulfilled' && Array.isArray(t.value)) setTrend(t.value)
      if (s.status === 'fulfilled' && Array.isArray(s.value)) setSources(s.value)
      if (w.status === 'fulfilled' && Array.isArray(w.value)) setWorkshops(w.value)
      if (d.status === 'fulfilled' && Array.isArray(d.value)) setDropoff(d.value)
      if (k.status === 'fulfilled') setKpis(k.value)
      if (cs.status === 'fulfilled') setConvStats(cs.value)
      if (p.status === 'fulfilled') setProfile(p.value)
      if (r.status === 'fulfilled' && Array.isArray(r.value)) setRevenue(r.value)
      setLoading(false)
    })
    return () => { alive = false }
  }, [])

  // Tendencia leads + convertidos
  useChart(trendRef, trendChart, {
    type: 'line',
    data: {
      labels: trend.map((r) => fmtDM(r.week_start)),
      datasets: [
        { label: 'Nuevos leads', data: trend.map((r) => toN(r.total)), borderColor: C.accent, backgroundColor: 'rgba(99,102,241,.1)', tension: 0.4, fill: true, pointRadius: 3 },
        { label: 'Convertidos',  data: trend.map((r) => toN(r.converted)), borderColor: C.green, backgroundColor: 'rgba(34,197,94,.08)', tension: 0.4, fill: true, pointRadius: 3 },
      ],
    },
    options: { ...CHART_OPTS, responsive: true, maintainAspectRatio: false, plugins: { ...CHART_OPTS.plugins, legend: { ...CHART_OPTS.plugins.legend, position: 'bottom' } } },
  }, [trend])

  // Donut fuentes
  useChart(donutRef, donutChart, {
    type: 'doughnut',
    data: {
      labels: sources.map((r) => r.source || 'sin fuente'),
      datasets: [{ data: sources.map((r) => toN(r.total)), backgroundColor: sources.map((_, i) => DONUT_COLORS[i % DONUT_COLORS.length]), borderWidth: 0, hoverOffset: 6 }],
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'right', labels: { color: '#7b82a8', font: { size: 11 }, padding: 10 } } } },
  }, [sources])

  // Conversión por fuente (barra horizontal)
  useChart(convSrcRef, convSrcChart, {
    type: 'bar',
    data: {
      labels: [...sources].sort((a, b) => toN(b.conversion_rate) - toN(a.conversion_rate)).map((r) => r.source || 'sin fuente'),
      datasets: [{ label: '% conversión', data: [...sources].sort((a, b) => toN(b.conversion_rate) - toN(a.conversion_rate)).map((r) => toN(r.conversion_rate)), backgroundColor: DONUT_COLORS, borderRadius: 8, barThickness: 28 }],
    },
    options: {
      ...CHART_OPTS, responsive: true, maintainAspectRatio: false, indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: {
        x: { ...CHART_OPTS.scales.x, max: 100, ticks: { ...CHART_OPTS.scales.x.ticks, callback: (v) => `${v}%` } },
        y: { ...CHART_OPTS.scales.y },
      },
    },
  }, [sources])

  // Ciudad (barra horizontal)
  useChart(cityRef, cityChart, {
    type: 'bar',
    data: {
      labels: (profile?.cities || []).map((r) => r.city),
      datasets: [{ label: 'Leads', data: (profile?.cities || []).map((r) => toN(r.total)), backgroundColor: C.accent, borderRadius: 6, barThickness: 22 }],
    },
    options: { ...CHART_OPTS, responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } } },
  }, [profile])

  // Ingresos mensuales
  useChart(revenueRef, revenueChart, {
    type: 'bar',
    data: {
      labels: revenue.map((r) => fmtMon(r.month)),
      datasets: [{ label: 'Ingresos', data: revenue.map((r) => toN(r.total)), backgroundColor: C.green, borderRadius: 8 }],
    },
    options: { ...CHART_OPTS, responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
  }, [revenue])

  if (loading) return <div className="text-muted" style={{ padding: 32 }}>Cargando insights...</div>

  // KPI values merge de funnel + kpis
  const kpiValues = { ...funnel, ...kpis }
  const dropMax = dropoff.length > 0 ? Math.max(1, ...dropoff.map((r) => toN(r.total))) : 1

  // Funnel steps extendido
  const FUNNEL_STEPS = [
    { label: 'Leads',        val: toN(funnel?.total),             color: 'rgba(99,102,241,.7)' },
    { label: 'Conversación', val: toN(funnel?.with_conversation), color: 'rgba(99,102,241,.55)' },
    { label: 'Calificados',  val: toN(funnel?.qualified),         color: 'rgba(139,92,246,.65)' },
    { label: 'Negociando',   val: toN(funnel?.negotiating),       color: 'rgba(236,72,153,.55)' },
    { label: 'Inscrito',     val: toN(funnel?.enrolled),          color: 'rgba(234,179,8,.6)' },
    { label: 'Pagado',       val: toN(funnel?.paid),              color: 'rgba(34,197,94,.7)' },
  ]
  const funnelMax = Math.max(1, toN(funnel?.total))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 28 }}>
        <div>
          <h1 className="page-title">Insights</h1>
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 2 }}>
            {workshops.length} talleres · {toN(funnel?.total)} leads
          </div>
        </div>
      </div>

      {/* KPI Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(148px, 1fr))', gap: 12, marginBottom: 4 }}>
        {KPI_DEFS.map(({ key, label, accent, vc, fmt }) => (
          <div key={key} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: '18px 20px', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: accent }} />
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1, color: vc }}>{fmt(kpiValues[key])}</div>
          </div>
        ))}
      </div>

      {/* Embudo y tendencia */}
      <SectionLabel>Embudo de conversión</SectionLabel>
      <Grid2>
        <Card title="Funnel completo" sub="Dónde se cae la gente en tu proceso">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {FUNNEL_STEPS.map((step, i) => {
              const pct = step.val > 0 ? Math.max(8, Math.round((step.val / funnelMax) * 100)) : 0
              const prev = i > 0 ? FUNNEL_STEPS[i - 1].val : null
              const rate = prev != null && prev > 0 ? Math.round((step.val / prev) * 100) : null
              return (
                <div key={step.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 100, fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'right', flexShrink: 0 }}>{step.label}</div>
                  <div style={{ flex: 1, background: 'var(--color-surface-hover)', borderRadius: 4, height: 32, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: step.color, display: 'flex', alignItems: 'center', paddingLeft: 10, fontSize: 13, fontWeight: 600, color: '#fff', borderRadius: 4 }}>
                      {step.val > 0 ? step.val : ''}
                    </div>
                  </div>
                  <div style={{ width: 48, textAlign: 'right', fontSize: 12, fontWeight: 600, color: rate != null ? rateColor(rate) : 'var(--color-text-muted)', flexShrink: 0 }}>
                    {rate != null ? `${rate}%` : '—'}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>

        <Card title="Tendencia de leads" sub="Nuevos leads y convertidos por semana">
          {trend.length === 0 ? <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Sin datos.</p> : (
            <div style={{ height: 220 }}><canvas ref={trendRef} /></div>
          )}
        </Card>
      </Grid2>

      {/* Conversaciones */}
      <SectionLabel>Métricas de conversación</SectionLabel>
      <Grid2>
        <Card title="Mensajes hasta decisión" sub="Promedio de intercambios por resultado">
          {!convStats ? <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Sin datos.</p> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                { label: 'Lead convertido', detail: 'mensajes promedio', val: convStats.avg_msgs_converted, bg: 'rgba(34,197,94,.12)', ic: '#22c55e', sym: '✓' },
                { label: 'Lead perdido',    detail: 'mensajes antes de abandonar', val: convStats.avg_msgs_lost, bg: 'rgba(239,68,68,.12)', ic: '#ef4444', sym: '✗' },
                { label: 'En curso',        detail: 'mensajes promedio actuales', val: convStats.avg_msgs_active, bg: 'rgba(234,179,8,.12)', ic: '#eab308', sym: '…' },
              ].map((item) => (
                <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: item.bg, color: item.ic, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>{item.sym}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{item.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{item.detail}</div>
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: item.ic }}>{item.val}</div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Abandono en el bot" sub="% de leads que se van en cada nodo">
          {dropoff.length === 0 ? <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>No hay abandonos registrados.</p> : (
            <div>
              {dropoff.map((row, i) => {
                const barPct = Math.round((toN(row.total) / dropMax) * 100)
                const barColor = barPct >= 40 ? '#ef4444' : barPct >= 20 ? '#f97316' : '#eab308'
                return (
                  <div key={row.node_key || i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: i < dropoff.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{row.node_name || row.node_key || '—'}</div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{row.node_key}</div>
                    </div>
                    <div style={{ width: 80, height: 6, background: 'var(--color-surface-hover)', borderRadius: 6, overflow: 'hidden' }}>
                      <div style={{ width: `${barPct}%`, height: '100%', background: barColor, borderRadius: 6 }} />
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, width: 36, textAlign: 'right', color: barColor }}>{toN(row.total)}</div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </Grid2>

      {/* Fuentes */}
      <SectionLabel>Origen de leads</SectionLabel>
      <div style={{ background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.25)', borderRadius: 8, padding: '8px 14px', fontSize: 12, color: '#a5b4fc', marginBottom: 12 }}>
        Fuentes marcadas desde el primer mensaje de WhatsApp. Los anuncios de Meta con botón de WhatsApp se detectan automáticamente.
      </div>
      <Grid2>
        <Card title="Leads por fuente" sub="Total y tasa de conversión por canal">
          {sources.length === 0 ? <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Sin fuentes.</p> : (
            <div style={{ height: 220 }}><canvas ref={donutRef} /></div>
          )}
        </Card>
        <Card title="Conversión por fuente" sub="% de leads que pagaron, por canal">
          {sources.length === 0 ? <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Sin datos.</p> : (
            <div style={{ height: 220 }}><canvas ref={convSrcRef} /></div>
          )}
        </Card>
      </Grid2>

      {/* Salud financiera */}
      <SectionLabel>Salud financiera por taller</SectionLabel>
      <Grid2>
        <Card title="Estado de cobros" sub="Pagado vs pendiente por taller">
          {workshops.length === 0 ? <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Sin talleres.</p> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {workshops.map((w, i) => {
                const goal = toN(w.goal) || 1
                const paidPct = Math.round((toN(w.revenue) / goal) * 100)
                const partialPct = Math.round(((toN(w.partial) * toN(w.price)) / goal) * 100)
                const unpaidPct = Math.max(0, 100 - paidPct - partialPct)
                return (
                  <div key={w.id || i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{w.name}</span>
                      <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{fmtBs(w.revenue)} / {fmtBs(w.goal)} esperados</span>
                    </div>
                    <div style={{ height: 10, background: 'var(--color-surface-hover)', borderRadius: 10, overflow: 'hidden', display: 'flex' }}>
                      <div style={{ width: `${clamp(paidPct)}%`, background: '#22c55e', height: '100%' }} />
                      <div style={{ width: `${clamp(partialPct)}%`, background: '#eab308', height: '100%' }} />
                      <div style={{ width: `${clamp(unpaidPct)}%`, background: 'transparent', height: '100%' }} />
                    </div>
                    <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 11 }}>
                      <span style={{ color: '#22c55e' }}>● {fmtBs(w.revenue)} pagados</span>
                      <span style={{ color: '#eab308' }}>● {w.partial} parciales</span>
                      <span style={{ color: 'var(--color-text-muted)' }}>● {w.unpaid} pendientes</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        <Card title="Ingresos mensuales" sub="Recaudado por mes">
          {revenue.length === 0 ? <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Sin datos de ingresos.</p> : (
            <div style={{ height: 200 }}><canvas ref={revenueRef} /></div>
          )}
        </Card>
      </Grid2>

      {/* Perfil del lead */}
      <SectionLabel>Perfil del lead que convierte</SectionLabel>
      <Grid2>
        <Card title="Atributos comunes en convertidos" sub="vs leads perdidos">
          {!profile ? <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Sin datos.</p> : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                {[
                  { label: 'Ciudad #1', val: profile.cities?.[0]?.city || '—' },
                  { label: 'Score convertidos', val: profile.avg_score_converted ? `${profile.avg_score_converted} pts` : '—', color: '#22c55e' },
                  { label: 'Score perdidos', val: profile.avg_score_lost ? `${profile.avg_score_lost} pts` : '—', color: '#ef4444' },
                  { label: 'Referidos', val: toN(funnel?.referidos) },
                ].map((item) => (
                  <div key={item.label} style={{ background: 'var(--color-surface-hover)', borderRadius: 8, padding: '12px 14px' }}>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>{item.label}</div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: item.color || 'var(--color-text)' }}>{item.val}</div>
                  </div>
                ))}
              </div>
              {profile.top_tags?.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {profile.top_tags.slice(0, 10).map((tag, i) => {
                    const bg = TAG_COLORS[`${tag.category}`] || 'rgba(99,102,241,.15)'
                    const color = TAG_COLORS[`${tag.category}_text`] || '#a5b4fc'
                    return (
                      <span key={i} style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 500, background: bg, color }}>
                        {tag.value}
                      </span>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </Card>

        <Card title="Distribución geográfica" sub="Leads por ciudad">
          {!profile?.cities?.length ? <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Sin datos.</p> : (
            <div style={{ height: 220 }}><canvas ref={cityRef} /></div>
          )}
        </Card>
      </Grid2>

      {/* Retención */}
      <SectionLabel>Retención y valor de vida</SectionLabel>
      <Grid2>
        <Card title="Red de referidos" sub="Leads que llegaron recomendados">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 0', textAlign: 'center' }}>
            <div style={{ fontSize: 52, fontWeight: 800, color: '#06b6d4', lineHeight: 1 }}>{toN(funnel?.referidos)}</div>
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 8 }}>
              leads referidos
              {toN(funnel?.referidos) > 0 && funnel?.total > 0 && ` · ${Math.round((toN(funnel.referidos) / toN(funnel.total)) * 100)}% del total`}
            </div>
          </div>
        </Card>

        <Card title="Top leads por valor" sub="Lifetime value acumulado">
          {!profile?.top_ltv?.length ? <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Sin datos.</p> : (
            <div>
              {profile.top_ltv.map((lead, i) => (
                <div key={lead.id || i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: i < profile.top_ltv.length - 1 ? '1px solid var(--color-border)' : 'none', fontSize: 13 }}>
                  <span style={{ fontWeight: 500 }}>{lead.name || `Lead #${lead.id}`}</span>
                  <span style={{ fontWeight: 700, color: '#22c55e' }}>{fmtBs(lead.ltv)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </Grid2>

      <div style={{ height: 40 }} />
    </div>
  )
}
