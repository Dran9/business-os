import { useEffect, useState } from 'react'
import { apiDelete, apiGet, apiPost, apiPut, apiUpload } from '../utils/api'

const ROLE_LABELS = {
  owner: 'Owner',
  admin: 'Admin',
  viewer: 'Viewer',
}

export default function Settings({ currentUser }) {
  const [team, setTeam] = useState([])
  const [paymentSettings, setPaymentSettings] = useState({
    payment_options: [
      { slot: 1, label: 'Precio 1', amount: '', active: true, has_qr: false },
      { slot: 2, label: 'Precio 2', amount: '', active: true, has_qr: false },
      { slot: 3, label: 'Precio 3', amount: '', active: true, has_qr: false },
      { slot: 4, label: 'Precio 4', amount: '', active: true, has_qr: false },
    ],
    payment_destination_accounts: [],
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingPayment, setSavingPayment] = useState(false)
  const [form, setForm] = useState({
    username: '',
    display_name: '',
    pin: '',
    role: 'viewer',
  })

  async function load() {
    setLoading(true)
    try {
      const [rows, paymentData] = await Promise.all([
        apiGet('/api/team').catch(() => []),
        apiGet('/api/settings/payment-options').catch(() => null),
      ])
      setTeam(rows)
      if (paymentData) setPaymentSettings(paymentData)
    } catch {
      setTeam([])
    } finally {
      setLoading(false)
    }
  }

  async function savePaymentSettings() {
    setSavingPayment(true)
    try {
      const payload = {
        payment_options: paymentSettings.payment_options.map((option) => ({
          label: option.label,
          amount: option.amount === '' ? null : Number(option.amount),
          active: option.active,
        })),
        payment_destination_accounts: paymentSettings.payment_destination_accounts,
      }
      const updated = await apiPut('/api/settings/payment-options', payload)
      setPaymentSettings(updated)
    } catch (err) {
      alert(err.message)
    } finally {
      setSavingPayment(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      await apiPost('/api/team', form)
      setForm({ username: '', display_name: '', pin: '', role: 'viewer' })
      await load()
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h1 className="page-title">Configuración</h1>

      <div className="card mt-4">
        <div className="card-header">
          <h2 className="card-title">Equipo interno</h2>
        </div>
        <p className="text-muted">Usuarios internos que pueden entrar a la app y ayudar a gestionar chats y operación.</p>

        <form onSubmit={handleSubmit} className="mt-4">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-4)' }}>
            <div className="form-group">
              <label>Username</label>
              <input className="input" name="username" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} required />
            </div>
            <div className="form-group">
              <label>Nombre visible</label>
              <input className="input" name="display_name" value={form.display_name} onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>PIN</label>
              <input className="input" name="pin" inputMode="numeric" maxLength={4} value={form.pin} onChange={(e) => setForm((f) => ({ ...f, pin: e.target.value.replace(/\D/g, '').slice(0, 4) }))} required />
            </div>
            <div className="form-group">
              <label>Rol</label>
              <select className="input" name="role" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
                {Object.entries(ROLE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </div>
          </div>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Creando...' : 'Crear usuario'}</button>
        </form>
      </div>

      <div className="card mt-4">
        <div className="card-header">
          <h2 className="card-title">Cobros, QR y OCR</h2>
        </div>
        <p className="text-muted">Configura hasta 4 opciones de cobro. Para constelaciones familiares puedes usar, por ejemplo, “Precio constelar” y “Precio participar”.</p>

        <div className="mt-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-4)' }}>
          {paymentSettings.payment_options.map((option, index) => (
            <div key={option.slot} className="card" style={{ padding: 'var(--space-4)' }}>
              <div className="form-group">
                <label>Etiqueta</label>
                <input
                  className="input"
                  value={option.label}
                  onChange={(e) => setPaymentSettings((current) => ({
                    ...current,
                    payment_options: current.payment_options.map((item, itemIndex) => itemIndex === index ? { ...item, label: e.target.value } : item),
                  }))}
                />
              </div>
              <div className="form-group">
                <label>Monto (Bs)</label>
                <input
                  className="input"
                  type="number"
                  value={option.amount ?? ''}
                  onChange={(e) => setPaymentSettings((current) => ({
                    ...current,
                    payment_options: current.payment_options.map((item, itemIndex) => itemIndex === index ? { ...item, amount: e.target.value } : item),
                  }))}
                />
              </div>
              <div className="form-group">
                <label>Activo</label>
                <select
                  className="input"
                  value={option.active ? '1' : '0'}
                  onChange={(e) => setPaymentSettings((current) => ({
                    ...current,
                    payment_options: current.payment_options.map((item, itemIndex) => itemIndex === index ? { ...item, active: e.target.value === '1' } : item),
                  }))}
                >
                  <option value="1">Sí</option>
                  <option value="0">No</option>
                </select>
              </div>
              <div className="form-group">
                <label>QR</label>
                <input
                  className="input"
                  type="file"
                  accept="image/*"
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    const formData = new FormData()
                    formData.append('file', file)
                    try {
                      await apiUpload(`/api/settings/payment-options/${option.slot}/qr`, formData)
                      const updated = await apiGet('/api/settings/payment-options')
                      setPaymentSettings(updated)
                    } catch (err) {
                      alert(err.message)
                    }
                  }}
                />
                <img
                  src={`/api/settings/payment-options/${option.slot}/qr?token=${encodeURIComponent(localStorage.getItem('bos_token') || '')}`}
                  alt=""
                  className="mt-4"
                  style={{ width: 120, height: 120, objectFit: 'contain', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' }}
                  onError={(e) => { e.currentTarget.style.display = 'none' }}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="form-group mt-4">
          <label>Cuentas destino válidas para OCR</label>
          <textarea
            className="input"
            rows={5}
            value={Array.isArray(paymentSettings.payment_destination_accounts) ? paymentSettings.payment_destination_accounts.join('\n') : ''}
            onChange={(e) => setPaymentSettings((current) => ({
              ...current,
              payment_destination_accounts: e.target.value
                .split('\n')
                .map((item) => item.trim())
                .filter(Boolean),
            }))}
            style={{ resize: 'vertical' }}
            placeholder={'Una cuenta por línea\nEjemplo:\n30151182874355\n6896894011'}
          />
          <p className="text-muted text-sm mt-4">El OCR validará el comprobante solo si detecta una de estas cuentas como destino.</p>
        </div>

        <button type="button" className="btn btn-primary" disabled={savingPayment} onClick={savePaymentSettings}>
          {savingPayment ? 'Guardando...' : 'Guardar configuración de cobro'}
        </button>
      </div>

      <div className="table-container mt-4">
        {loading ? (
          <p className="text-muted">Cargando equipo...</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Nombre</th>
                <th>Rol</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {team.map((member) => (
                <tr key={member.id}>
                  <td className="font-semibold">{member.username}</td>
                  <td>{member.display_name || '-'}</td>
                  <td>{ROLE_LABELS[member.role] || member.role}</td>
                  <td><span className={member.active ? 'badge badge-success' : 'badge badge-warning'}>{member.active ? 'Activo' : 'Inactivo'}</span></td>
                  <td>
                    <div className="flex gap-2">
                      {member.id !== currentUser?.id && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={async () => {
                            const nextActive = !member.active
                            try {
                              await apiPut(`/api/team/${member.id}`, { active: nextActive })
                              load()
                            } catch (err) {
                              alert(err.message)
                            }
                          }}
                        >
                          {member.active ? 'Desactivar' : 'Activar'}
                        </button>
                      )}
                      {member.id !== currentUser?.id && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={async () => {
                            if (!confirm(`¿Eliminar a ${member.username}?`)) return
                            try {
                              await apiDelete(`/api/team/${member.id}`)
                              load()
                            } catch (err) {
                              alert(err.message)
                            }
                          }}
                        >
                          Eliminar
                        </button>
                      )}
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
