import { useState, useEffect } from 'react'
import { apiGet } from '../utils/api'
import { formatCurrency } from '../utils/dates'

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiGet('/api/analytics/dashboard')
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="text-muted">Cargando...</div>
  }

  // Fallback mientras no hay datos reales
  const s = stats || {
    leads_total: 0,
    leads_new: 0,
    leads_converted: 0,
    conversion_rate: 0,
    workshops_active: 0,
    income_month: 0,
    expense_month: 0,
    net_month: 0,
  }

  return (
    <div>
      <h1 className="page-title">Dashboard</h1>

      <div className="kpi-grid mt-4">
        <KPI label="Leads este mes" value={s.leads_total} />
        <KPI label="Nuevos" value={s.leads_new} />
        <KPI label="Convertidos" value={s.leads_converted} />
        <KPI label="Tasa conversión" value={`${s.conversion_rate}%`} />
      </div>

      <div className="kpi-grid mt-4">
        <KPI label="Talleres activos" value={s.workshops_active} />
        <KPI label="Ingresos mes" value={formatCurrency(s.income_month)} />
        <KPI label="Gastos mes" value={formatCurrency(s.expense_month)} />
        <KPI label="Neto" value={formatCurrency(s.net_month)}
          className={s.net_month >= 0 ? 'positive' : 'negative'} />
      </div>
    </div>
  )
}

function KPI({ label, value, className = '' }) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${className}`}>{value}</div>
    </div>
  )
}
