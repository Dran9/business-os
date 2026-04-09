import { startTransition, useCallback, useEffect, useMemo, useState } from 'react'
import { apiDelete, apiGet, apiPost, apiPut } from '../utils/api'
import { useAdminEvents } from '../hooks/useAdminEvents'
import { formatCurrency } from '../utils/dates'
import ConfirmButton from '../components/ui/ConfirmButton'

const CATEGORIES = ['taller', 'publicidad', 'venue', 'materiales', 'herramientas', 'transporte', 'otros']

function currentMonthValue() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/La_Paz',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date())
  const year = parts.find((part) => part.type === 'year')?.value || '0000'
  const month = parts.find((part) => part.type === 'month')?.value || '01'
  return `${year}-${month}`
}

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

export default function Finance() {
  const [month, setMonth] = useState(currentMonthValue)
  const [typeFilter, setTypeFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [summary, setSummary] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [savingGoal, setSavingGoal] = useState(false)
  const [goalInput, setGoalInput] = useState('')
  const [editing, setEditing] = useState(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ month })
      if (typeFilter) qs.set('type', typeFilter)
      if (categoryFilter) qs.set('category', categoryFilter)

      const [summaryData, transactionsData] = await Promise.all([
        apiGet(`/api/finance/summary?month=${month}`),
        apiGet(`/api/finance/transactions?${qs.toString()}`),
      ])

      startTransition(() => {
        setSummary(summaryData)
        setTransactions(transactionsData.data || [])
        setGoalInput(summaryData?.target_income != null ? String(summaryData.target_income) : '')
      })
    } catch (err) {
      console.error(err)
      setSummary(null)
      setTransactions([])
    } finally {
      setLoading(false)
    }
  }, [categoryFilter, month, typeFilter])

  useEffect(() => {
    loadData()
  }, [loadData])

  const { connected } = useAdminEvents({
    'finance:change': loadData,
  })

  async function handleGoalSave() {
    setSavingGoal(true)
    try {
      await apiPut('/api/finance/goals/current', {
        month,
        target_income: goalInput === '' ? null : Number(goalInput),
      })
      await loadData()
    } catch (err) {
      alert(err.message)
    } finally {
      setSavingGoal(false)
    }
  }

  const netTone = useMemo(() => {
    if (!summary) return ''
    return summary.net >= 0 ? 'positive' : 'negative'
  }, [summary])

  return (
    <div>
      <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', rowGap: 'var(--space-3)' }}>
        <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
          <h1 className="page-title">Finanzas</h1>
          <span className={`live-indicator ${connected ? 'connected' : ''}`}>
            {connected ? 'En vivo' : 'Reconectando'}
          </span>
        </div>
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          <input type="month" className="input" style={{ width: 180 }} value={month} onChange={(e) => setMonth(e.target.value)} />
          <select className="input" style={{ width: 160 }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">Todos los tipos</option>
            <option value="income">Ingresos</option>
            <option value="expense">Gastos</option>
          </select>
          <select className="input" style={{ width: 180 }} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">Todas las categorías</option>
            {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
        </div>
      </div>

      <div className="kpi-grid mt-4">
        <KPI label="Ingreso del mes" value={formatCurrency(summary?.income || 0)} />
        <KPI label="Gasto del mes" value={formatCurrency(summary?.expense || 0)} />
        <KPI label="Neto" value={formatCurrency(summary?.net || 0)} className={netTone} />
        <KPI label="Meta mensual" value={summary?.target_income != null ? formatCurrency(summary.target_income) : 'Sin meta'} />
      </div>

      <div className="card mt-4">
        <div className="card-header">
          <h2 className="card-title">Meta del mes</h2>
        </div>
        <div className="flex gap-2 items-center" style={{ flexWrap: 'wrap' }}>
          <input
            type="number"
            className="input"
            style={{ maxWidth: 220 }}
            placeholder="Monto objetivo"
            value={goalInput}
            onChange={(e) => setGoalInput(e.target.value)}
          />
          <button type="button" className="btn btn-primary" onClick={handleGoalSave} disabled={savingGoal}>
            {savingGoal ? 'Guardando...' : 'Guardar meta'}
          </button>
          {summary?.progress_pct != null && (
            <span className="text-secondary text-sm">
              Progreso: {summary.progress_pct}% {summary.target_delta != null ? `· Diferencia ${formatCurrency(summary.target_delta)}` : ''}
            </span>
          )}
        </div>
      </div>

      <TransactionForm
        key={editing?.id || 'new'}
        transaction={editing}
        month={month}
        onSaved={() => {
          setEditing(null)
          loadData()
        }}
        onCancel={() => setEditing(null)}
      />

      <div className="table-container mt-4">
        {loading ? (
          <p className="text-muted">Cargando transacciones...</p>
        ) : transactions.length === 0 ? (
          <p className="text-muted">No hay transacciones para este filtro.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Categoría</th>
                <th>Descripción</th>
                <th>Monto</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((row) => (
                <tr key={row.id}>
                  <td>{row.date}</td>
                  <td><span className={row.type === 'income' ? 'badge badge-success' : 'badge badge-warning'}>{row.type === 'income' ? 'Ingreso' : 'Gasto'}</span></td>
                  <td className="text-secondary">{row.category}</td>
                  <td>{row.description || '-'}</td>
                  <td className={row.type === 'income' ? 'positive' : 'negative'}>{formatCurrency(row.amount)}</td>
                  <td>
                    <div className="flex gap-2">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(row)}>Editar</button>
                      <ConfirmButton
                        label="Eliminar"
                        confirmLabel="¿Eliminar?"
                        onConfirm={async () => {
                          await apiDelete(`/api/finance/transactions/${row.id}`)
                          if (editing?.id === row.id) setEditing(null)
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

function TransactionForm({ transaction, month, onSaved, onCancel }) {
  const [form, setForm] = useState({
    type: transaction?.type || 'expense',
    category: transaction?.category || 'otros',
    amount: transaction?.amount || '',
    description: transaction?.description || '',
    date: transaction?.date || `${month}-01`,
  })
  const [saving, setSaving] = useState(false)

  function handleChange(e) {
    setForm((current) => ({ ...current, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      if (transaction?.id) {
        await apiPut(`/api/finance/transactions/${transaction.id}`, {
          ...form,
          amount: Number(form.amount),
        })
      } else {
        await apiPost('/api/finance/transactions', {
          ...form,
          amount: Number(form.amount),
        })
      }
      setForm({
        type: 'expense',
        category: 'otros',
        amount: '',
        description: '',
        date: currentDateValue(),
      })
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
        <h2 className="card-title">{transaction ? 'Editar transacción' : 'Nueva transacción'}</h2>
      </div>
      <form onSubmit={handleSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-4)' }}>
          <div className="form-group">
            <label>Tipo</label>
            <select className="input" name="type" value={form.type} onChange={handleChange}>
              <option value="income">Ingreso</option>
              <option value="expense">Gasto</option>
            </select>
          </div>
          <div className="form-group">
            <label>Categoría</label>
            <select className="input" name="category" value={form.category} onChange={handleChange}>
              {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Monto</label>
            <input className="input" name="amount" type="number" min="1" value={form.amount} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label>Fecha</label>
            <input className="input" name="date" type="date" value={form.date} onChange={handleChange} required />
          </div>
        </div>
        <div className="form-group">
          <label>Descripción</label>
          <input className="input" name="description" value={form.description} onChange={handleChange} placeholder="Detalle breve" />
        </div>
        <div className="flex gap-2">
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando...' : transaction ? 'Actualizar' : 'Agregar'}</button>
          {transaction && <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancelar edición</button>}
        </div>
      </form>
    </div>
  )
}
