import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { apiDelete, apiGet, apiPost, apiPut } from '../utils/api'
import { useAdminEvents } from '../hooks/useAdminEvents'
import { formatCurrency } from '../utils/dates'
import ConfirmButton from '../components/ui/ConfirmButton'

const STATUS_OPTIONS = ['draft', 'active', 'paused', 'completed']
const PLATFORM_OPTIONS = ['meta', 'instagram', 'facebook', 'tiktok', 'google', 'whatsapp', 'referidos', 'otros']

function currentDateValue() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/La_Paz',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const year = parts.find((part) => part.type === 'year')?.value || '0000'
  const month = parts.find((part) => part.type === 'month')?.value || '01'
  const day = parts.find((part) => part.type === 'day')?.value || '01'
  return `${year}-${month}-${day}`
}

export default function Marketing() {
  const [summary, setSummary] = useState(null)
  const [campaigns, setCampaigns] = useState([])
  const [workshops, setWorkshops] = useState([])
  const [statusFilter, setStatusFilter] = useState('')
  const [platformFilter, setPlatformFilter] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const deferredSearch = useDeferredValue(search)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ limit: '100' })
      if (statusFilter) qs.set('status', statusFilter)
      if (platformFilter) qs.set('platform', platformFilter)
      if (deferredSearch) qs.set('search', deferredSearch)

      const [summaryData, campaignsData, workshopsData] = await Promise.all([
        apiGet('/api/marketing/summary'),
        apiGet(`/api/marketing?${qs.toString()}`),
        apiGet('/api/workshops?limit=200'),
      ])

      startTransition(() => {
        setSummary(summaryData)
        setCampaigns(campaignsData.data || [])
        setWorkshops(workshopsData.data || [])
      })
    } catch (err) {
      console.error(err)
      setSummary(null)
      setCampaigns([])
    } finally {
      setLoading(false)
    }
  }, [deferredSearch, platformFilter, statusFilter])

  useEffect(() => {
    loadData()
  }, [loadData])

  const { connected } = useAdminEvents({
    'marketing:change': loadData,
  })

  const profitTone = useMemo(() => {
    if (!summary) return ''
    return Number(summary.profit || 0) >= 0 ? 'positive' : 'negative'
  }, [summary])

  return (
    <div>
      <div className="flex items-center justify-between gap-2" style={{ flexWrap: 'wrap' }}>
        <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
          <h1 className="page-title">Marketing</h1>
          <span className={`live-indicator ${connected ? 'connected' : ''}`}>
            {connected ? 'En vivo' : 'Reconectando'}
          </span>
        </div>
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          <input
            className="input"
            style={{ width: 220 }}
            placeholder="Buscar campaña..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select className="input" style={{ width: 160 }} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">Todos los estados</option>
            {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{formatStatus(status)}</option>)}
          </select>
          <select className="input" style={{ width: 160 }} value={platformFilter} onChange={(event) => setPlatformFilter(event.target.value)}>
            <option value="">Todas las plataformas</option>
            {PLATFORM_OPTIONS.map((platform) => <option key={platform} value={platform}>{formatPlatform(platform)}</option>)}
          </select>
        </div>
      </div>

      <div className="kpi-grid mt-4">
        <KPI label="Invertido" value={formatCurrency(summary?.total_spent || 0)} />
        <KPI label="Ingresos atribuidos" value={formatCurrency(summary?.total_revenue || 0)} />
        <KPI label="Resultado" value={formatCurrency(summary?.profit || 0)} className={profitTone} />
        <KPI label="ROI" value={summary?.roi_pct != null ? `${summary.roi_pct}%` : '—'} />
        <KPI label="Costo por lead" value={summary?.cost_per_lead != null ? formatCurrency(summary.cost_per_lead) : '—'} />
        <KPI label="Costo por conversión" value={summary?.cost_per_conversion != null ? formatCurrency(summary.cost_per_conversion) : '—'} />
      </div>

      <CampaignForm
        key={editing?.id || 'new'}
        campaign={editing}
        workshops={workshops}
        onSaved={() => {
          setEditing(null)
          loadData()
        }}
        onCancel={() => setEditing(null)}
      />

      <div className="marketing-grid mt-4">
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Rendimiento por plataforma</h2>
          </div>
          {!summary?.by_platform?.length ? (
            <div className="text-muted">Todavía no hay campañas registradas.</div>
          ) : (
            <div className="platform-list">
              {summary.by_platform.map((row) => (
                <div key={row.platform} className="platform-row">
                  <div>
                    <div className="font-semibold">{formatPlatform(row.platform)}</div>
                    <div className="text-sm text-muted">{row.campaigns} campañas · {row.leads} leads · {row.conversions} conversiones</div>
                  </div>
                  <div className="font-semibold">{formatCurrency(row.spent || 0)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Resumen operativo</h2>
          </div>
          <div className="timeline-list">
            <div className="mini-list-row">
              <span>Campañas activas</span>
              <span className="font-semibold">{campaigns.filter((campaign) => campaign.status === 'active').length}</span>
            </div>
            <div className="mini-list-row">
              <span>Leads generados</span>
              <span className="font-semibold">{summary?.total_leads || 0}</span>
            </div>
            <div className="mini-list-row">
              <span>Conversiones</span>
              <span className="font-semibold">{summary?.total_conversions || 0}</span>
            </div>
            <div className="mini-list-row">
              <span>Presupuesto cargado</span>
              <span className="font-semibold">{formatCurrency(summary?.total_budget || 0)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="table-container card mt-4">
        <div className="card-header">
          <h2 className="card-title">Campañas</h2>
        </div>
        {loading ? (
          <p className="text-muted">Cargando campañas...</p>
        ) : campaigns.length === 0 ? (
          <p className="text-muted">No hay campañas para este filtro.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Campaña</th>
                <th>Taller</th>
                <th>Plataforma</th>
                <th>Estado</th>
                <th>Invertido</th>
                <th>Leads</th>
                <th>Conv.</th>
                <th>Ingresos</th>
                <th>ROI</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((campaign) => (
                <tr key={campaign.id}>
                  <td>
                    <div className="font-semibold">{campaign.name}</div>
                    <div className="text-sm text-muted">{campaign.started_at || 'Sin fecha'}{campaign.ended_at ? ` → ${campaign.ended_at}` : ''}</div>
                  </td>
                  <td>{campaign.workshop_name || 'General'}</td>
                  <td>{formatPlatform(campaign.platform)}</td>
                  <td><span className={statusBadgeClass(campaign.status)}>{formatStatus(campaign.status)}</span></td>
                  <td>{formatCurrency(campaign.spent || 0)}</td>
                  <td>{campaign.leads_generated || 0}</td>
                  <td>{campaign.conversions || 0}</td>
                  <td>{formatCurrency(campaign.revenue_generated || 0)}</td>
                  <td className={campaignRoi(campaign) >= 0 ? 'positive' : 'negative'}>
                    {Number.isFinite(campaignRoi(campaign)) ? `${campaignRoi(campaign)}%` : '—'}
                  </td>
                  <td>
                    <div className="flex gap-2">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(campaign)}>Editar</button>
                      <ConfirmButton
                        label="Eliminar"
                        confirmLabel="¿Eliminar?"
                        onConfirm={async () => {
                          await apiDelete(`/api/marketing/${campaign.id}`)
                          if (editing?.id === campaign.id) setEditing(null)
                          loadData()
                        }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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

function CampaignForm({ campaign, workshops, onSaved, onCancel }) {
  const [form, setForm] = useState({
    name: campaign?.name || '',
    workshop_id: campaign?.workshop_id || '',
    platform: campaign?.platform || 'meta',
    status: campaign?.status || 'draft',
    budget: campaign?.budget || '',
    spent: campaign?.spent || '',
    leads_generated: campaign?.leads_generated || '',
    conversions: campaign?.conversions || '',
    revenue_generated: campaign?.revenue_generated || '',
    started_at: campaign?.started_at || currentDateValue(),
    ended_at: campaign?.ended_at || '',
    copy_text: campaign?.copy_text || '',
  })
  const [saving, setSaving] = useState(false)

  function handleChange(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    try {
      const payload = {
        ...form,
        workshop_id: form.workshop_id || null,
        budget: toNullableNumber(form.budget),
        spent: toNullableNumber(form.spent) ?? 0,
        leads_generated: toNullableNumber(form.leads_generated) ?? 0,
        conversions: toNullableNumber(form.conversions) ?? 0,
        revenue_generated: toNullableNumber(form.revenue_generated) ?? 0,
      }

      if (campaign?.id) {
        await apiPut(`/api/marketing/${campaign.id}`, payload)
      } else {
        await apiPost('/api/marketing', payload)
      }

      onSaved()
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card mt-4">
      <div className="card-header">
        <h2 className="card-title">{campaign ? 'Editar campaña' : 'Nueva campaña'}</h2>
      </div>
      <form onSubmit={handleSubmit}>
        <div className="marketing-form-grid">
          <div className="form-group">
            <label>Nombre</label>
            <input className="input" name="name" value={form.name} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label>Taller</label>
            <select className="input" name="workshop_id" value={form.workshop_id} onChange={handleChange}>
              <option value="">General / sin taller</option>
              {workshops.map((workshop) => <option key={workshop.id} value={workshop.id}>{workshop.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Plataforma</label>
            <select className="input" name="platform" value={form.platform} onChange={handleChange}>
              {PLATFORM_OPTIONS.map((platform) => <option key={platform} value={platform}>{formatPlatform(platform)}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Estado</label>
            <select className="input" name="status" value={form.status} onChange={handleChange}>
              {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{formatStatus(status)}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Presupuesto</label>
            <input className="input" name="budget" type="number" min="0" value={form.budget} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label>Gastado</label>
            <input className="input" name="spent" type="number" min="0" value={form.spent} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label>Leads generados</label>
            <input className="input" name="leads_generated" type="number" min="0" value={form.leads_generated} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label>Conversiones</label>
            <input className="input" name="conversions" type="number" min="0" value={form.conversions} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label>Ingresos atribuidos</label>
            <input className="input" name="revenue_generated" type="number" min="0" value={form.revenue_generated} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label>Inicio</label>
            <input className="input" name="started_at" type="date" value={form.started_at} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label>Fin</label>
            <input className="input" name="ended_at" type="date" value={form.ended_at} onChange={handleChange} />
          </div>
        </div>

        <div className="form-group">
          <label>Copy / notas de campaña</label>
          <textarea className="input textarea" name="copy_text" value={form.copy_text} onChange={handleChange} placeholder="Copys, hooks, hipótesis, observaciones..." />
        </div>

        <div className="flex gap-2">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Guardando...' : campaign ? 'Actualizar campaña' : 'Crear campaña'}
          </button>
          {campaign ? <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancelar edición</button> : null}
        </div>
      </form>
    </div>
  )
}

function toNullableNumber(value) {
  if (value === '' || value == null) return null
  return Number(value)
}

function formatStatus(status) {
  if (status === 'draft') return 'Borrador'
  if (status === 'active') return 'Activa'
  if (status === 'paused') return 'Pausada'
  if (status === 'completed') return 'Completada'
  return status || '—'
}

function formatPlatform(platform) {
  if (!platform) return '—'
  if (platform === 'meta') return 'Meta'
  if (platform === 'tiktok') return 'TikTok'
  if (platform === 'google') return 'Google'
  if (platform === 'whatsapp') return 'WhatsApp'
  return platform.charAt(0).toUpperCase() + platform.slice(1)
}

function statusBadgeClass(status) {
  if (status === 'active') return 'badge badge-success'
  if (status === 'paused') return 'badge badge-warning'
  if (status === 'completed') return 'badge badge-info'
  return 'badge'
}

function campaignRoi(campaign) {
  const spent = Number(campaign.spent || 0)
  const revenue = Number(campaign.revenue_generated || 0)
  if (spent <= 0) return Number.NaN
  return Math.round(((revenue - spent) / spent) * 100)
}
