import { useEffect, useMemo, useState } from 'react'
import { apiDelete, apiGet, apiPost, apiPut, apiUpload, setStoredUser } from '../utils/api'
import ConfirmButton from '../components/ui/ConfirmButton'

const ROLE_LABELS = {
  owner: 'Owner',
  admin: 'Admin',
  viewer: 'Viewer',
}

const ROLE_DESCRIPTIONS = {
  owner: 'Control total de equipo, configuración, cobros y decisiones sensibles.',
  admin: 'Opera chats, CRM, cobros y equipo, pero no puede tocar owners.',
  viewer: 'Solo consulta información operativa; no gestiona equipo ni cambios sensibles.',
}

function initialCreateForm() {
  return {
    username: '',
    display_name: '',
    pin: '',
    role: 'viewer',
  }
}

function initialSecurityForm() {
  return {
    current_pin: '',
    new_pin: '',
    confirm_pin: '',
  }
}

export default function Settings({ currentUser }) {
  const canManageTeam = ['owner', 'admin'].includes(currentUser?.role)
  const [team, setTeam] = useState([])
  const [activity, setActivity] = useState([])
  const [paymentSettings, setPaymentSettings] = useState({
    payment_options: [
      { slot: 1, label: 'Precio 1', amount: '', active: true, has_qr: false },
      { slot: 2, label: 'Precio 2', amount: '', active: true, has_qr: false },
      { slot: 3, label: 'Precio 3', amount: '', active: true, has_qr: false },
      { slot: 4, label: 'Precio 4', amount: '', active: true, has_qr: false },
    ],
    payment_destination_accounts: [],
    payment_proof_debug_mode: false,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingPayment, setSavingPayment] = useState(false)
  const [savingSecurity, setSavingSecurity] = useState(false)
  const [paymentLoaded, setPaymentLoaded] = useState(false)
  const [paymentDirty, setPaymentDirty] = useState(false)
  const [notice, setNotice] = useState(null)
  const [form, setForm] = useState(initialCreateForm())
  const [securityForm, setSecurityForm] = useState(initialSecurityForm())
  const [editingId, setEditingId] = useState(null)
  const [editingForm, setEditingForm] = useState(null)

  const editingMember = useMemo(
    () => team.find((member) => member.id === editingId) || null,
    [editingId, team]
  )

  async function load() {
    setLoading(true)
    try {
      const requests = [
        apiGet('/api/settings/payment-options').catch(() => null),
      ]
      if (canManageTeam) {
        requests.unshift(apiGet('/api/team').catch(() => []), apiGet('/api/team/activity?limit=40').catch(() => []))
      }

      const results = await Promise.all(requests)
      if (canManageTeam) {
        const [teamRows, activityRows, paymentData] = results
        setTeam(teamRows)
        setActivity(activityRows)
        if (paymentData && !paymentDirty) {
          setPaymentSettings(paymentData)
        }
      } else {
        const [paymentData] = results
        setTeam([])
        setActivity([])
        if (paymentData && !paymentDirty) {
          setPaymentSettings(paymentData)
        }
      }
    } finally {
      setPaymentLoaded(true)
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [canManageTeam])

  useEffect(() => {
    if (!notice) return undefined
    const timeout = window.setTimeout(() => setNotice(null), 4000)
    return () => window.clearTimeout(timeout)
  }, [notice])

  function markPaymentDirty() {
    setPaymentDirty(true)
    setNotice(null)
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
        payment_proof_debug_mode: paymentSettings.payment_proof_debug_mode === true,
      }
      const updated = await apiPut('/api/settings/payment-options', payload)
      setPaymentSettings(updated)
      setPaymentDirty(false)
      setPaymentLoaded(true)
      setNotice({ type: 'success', text: 'Configuración de cobro guardada correctamente.' })
    } catch (err) {
      alert(err.message)
    } finally {
      setSavingPayment(false)
    }
  }

  async function handleCreateUser(event) {
    event.preventDefault()
    setSaving(true)
    try {
      await apiPost('/api/team', form)
      setForm(initialCreateForm())
      setNotice({ type: 'success', text: 'Usuario creado correctamente.' })
      await load()
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleChangePin(event) {
    event.preventDefault()
    if (securityForm.new_pin !== securityForm.confirm_pin) {
      alert('La confirmación del PIN no coincide')
      return
    }
    setSavingSecurity(true)
    try {
      await apiPost('/api/auth/change-pin', {
        current_pin: securityForm.current_pin,
        new_pin: securityForm.new_pin,
      })
      setSecurityForm(initialSecurityForm())
      setNotice({ type: 'success', text: 'PIN actualizado correctamente.' })
      if (canManageTeam) {
        await load()
      }
    } catch (err) {
      alert(err.message)
    } finally {
      setSavingSecurity(false)
    }
  }

  function beginEdit(member) {
    setEditingId(member.id)
    setEditingForm({
      username: member.username,
      display_name: member.display_name || '',
      role: member.role,
      active: !!member.active,
      pin: '',
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setEditingForm(null)
  }

  async function saveEdit() {
    if (!editingMember || !editingForm) return
    try {
      const response = await apiPut(`/api/team/${editingMember.id}`, {
        username: editingForm.username,
        display_name: editingForm.display_name,
        role: editingForm.role,
        active: editingForm.active,
        pin: editingForm.pin || undefined,
      })
      if (editingMember.id === currentUser?.id && response?.user) {
        setStoredUser(response.user)
      }
      cancelEdit()
      setNotice({ type: 'success', text: 'Cambios del usuario guardados correctamente.' })
      await load()
    } catch (err) {
      alert(err.message)
    }
  }

  return (
    <div>
      <h1 className="page-title">Configuración</h1>
      {notice && (
        <div className={`inline-notice inline-notice-${notice.type} mt-4`}>
          {notice.text}
        </div>
      )}

      <div className="card mt-4">
        <div className="card-header">
          <h2 className="card-title">Seguridad personal</h2>
        </div>
        <p className="text-muted">Cambia tu PIN sin depender de otra persona del equipo.</p>

        <form onSubmit={handleChangePin} className="mt-4">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-4)' }}>
            <div className="form-group">
              <label>PIN actual</label>
              <input
                className="input"
                inputMode="numeric"
                maxLength={4}
                value={securityForm.current_pin}
                onChange={(event) => setSecurityForm((current) => ({ ...current, current_pin: event.target.value.replace(/\D/g, '').slice(0, 4) }))}
                required
              />
            </div>
            <div className="form-group">
              <label>PIN nuevo</label>
              <input
                className="input"
                inputMode="numeric"
                maxLength={4}
                value={securityForm.new_pin}
                onChange={(event) => setSecurityForm((current) => ({ ...current, new_pin: event.target.value.replace(/\D/g, '').slice(0, 4) }))}
                required
              />
            </div>
            <div className="form-group">
              <label>Confirmar PIN nuevo</label>
              <input
                className="input"
                inputMode="numeric"
                maxLength={4}
                value={securityForm.confirm_pin}
                onChange={(event) => setSecurityForm((current) => ({ ...current, confirm_pin: event.target.value.replace(/\D/g, '').slice(0, 4) }))}
                required
              />
            </div>
          </div>
          <button type="submit" className="btn btn-primary" disabled={savingSecurity}>
            {savingSecurity ? 'Actualizando...' : 'Cambiar mi PIN'}
          </button>
        </form>
      </div>

      {canManageTeam && (
        <>
          <div className="card mt-4">
            <div className="card-header">
              <h2 className="card-title">Roles y permisos</h2>
            </div>
            <div className="lead-mini-lists">
              {Object.entries(ROLE_LABELS).map(([key, label]) => (
                <div key={key} className="lead-meta-card">
                  <div className="font-semibold">{label}</div>
                  <div className="text-sm text-secondary mt-1">{ROLE_DESCRIPTIONS[key]}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card mt-4">
            <div className="card-header">
              <h2 className="card-title">Equipo interno</h2>
            </div>
            <p className="text-muted">Usuarios internos que pueden entrar a la app y ayudar a gestionar chats y operación.</p>

            <form onSubmit={handleCreateUser} className="mt-4">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-4)' }}>
                <div className="form-group">
                  <label>Username</label>
                  <input className="input" name="username" value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} required />
                </div>
                <div className="form-group">
                  <label>Nombre visible</label>
                  <input className="input" name="display_name" value={form.display_name} onChange={(event) => setForm((current) => ({ ...current, display_name: event.target.value }))} />
                </div>
                <div className="form-group">
                  <label>PIN</label>
                  <input className="input" name="pin" inputMode="numeric" maxLength={4} value={form.pin} onChange={(event) => setForm((current) => ({ ...current, pin: event.target.value.replace(/\D/g, '').slice(0, 4) }))} required />
                </div>
                <div className="form-group">
                  <label>Rol</label>
                  <select className="input" name="role" value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))}>
                    {(currentUser?.role === 'owner'
                      ? Object.entries(ROLE_LABELS)
                      : Object.entries(ROLE_LABELS).filter(([key]) => key !== 'owner')
                    ).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </select>
                </div>
              </div>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Creando...' : 'Crear usuario'}</button>
            </form>
          </div>
        </>
      )}

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
                  onChange={(event) => {
                    setPaymentSettings((current) => ({
                      ...current,
                      payment_options: current.payment_options.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item),
                    }))
                    markPaymentDirty()
                  }}
                />
              </div>
              <div className="form-group">
                <label>Monto (Bs)</label>
                <input
                  className="input"
                  type="number"
                  value={option.amount ?? ''}
                  onChange={(event) => {
                    setPaymentSettings((current) => ({
                      ...current,
                      payment_options: current.payment_options.map((item, itemIndex) => itemIndex === index ? { ...item, amount: event.target.value } : item),
                    }))
                    markPaymentDirty()
                  }}
                />
              </div>
              <div className="form-group">
                <label>Activo</label>
                <select
                  className="input"
                  value={option.active ? '1' : '0'}
                  onChange={(event) => {
                    setPaymentSettings((current) => ({
                      ...current,
                      payment_options: current.payment_options.map((item, itemIndex) => itemIndex === index ? { ...item, active: event.target.value === '1' } : item),
                    }))
                    markPaymentDirty()
                  }}
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
                  onChange={async (event) => {
                    const file = event.target.files?.[0]
                    if (!file) return
                    const formData = new FormData()
                    formData.append('file', file)
                    try {
                      await apiUpload(`/api/settings/payment-options/${option.slot}/qr`, formData)
                      const updated = await apiGet('/api/settings/payment-options')
                      setPaymentSettings((current) => ({
                        ...current,
                        payment_options: current.payment_options.map((item) => {
                          const serverOption = updated.payment_options.find((serverItem) => serverItem.slot === item.slot)
                          return serverOption ? { ...item, has_qr: serverOption.has_qr } : item
                        }),
                      }))
                      setNotice({ type: 'success', text: `QR del slot ${option.slot} subido correctamente.` })
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
                  onError={(event) => { event.currentTarget.style.display = 'none' }}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="form-group mt-4">
          <label>Cuentas destino válidas para OCR</label>
          <textarea
            className="input textarea"
            rows={5}
            value={Array.isArray(paymentSettings.payment_destination_accounts) ? paymentSettings.payment_destination_accounts.join('\n') : ''}
            onChange={(event) => {
              setPaymentSettings((current) => ({
                ...current,
                payment_destination_accounts: event.target.value
                  .split('\n')
                  .map((item) => item.trim())
                  .filter(Boolean),
              }))
              markPaymentDirty()
            }}
            placeholder={'Una cuenta por línea\nEjemplo:\n30151182874355\n6896894011'}
          />
          <p className="text-muted text-sm mt-4">El OCR validará el comprobante solo si detecta una de estas cuentas como destino.</p>
        </div>

        <div className="card mt-4" style={{ padding: 'var(--space-4)' }}>
          <div className="card-header" style={{ padding: 0, border: 0, marginBottom: 'var(--space-3)' }}>
            <div>
              <h3 className="card-title">Modo prueba de comprobantes</h3>
              <p className="text-muted text-sm mt-4">
                Si está activo, cualquier imagen o documento que llegue al bot se analiza como comprobante y devuelve diagnóstico OCR aunque la conversación no esté en el nodo de pago.
              </p>
            </div>
          </div>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={paymentSettings.payment_proof_debug_mode === true}
              onChange={(event) => {
                setPaymentSettings((current) => ({
                  ...current,
                  payment_proof_debug_mode: event.target.checked,
                }))
                markPaymentDirty()
              }}
            />
            <span>
              {paymentSettings.payment_proof_debug_mode ? 'Sí, activar modo prueba' : 'No, usar solo el flujo normal'}
            </span>
          </label>
          <div className="text-muted text-sm mt-4">
            Úsalo para probar lectura OCR, destinatario, monto, fecha y mensajes de error sin depender del embudo.
          </div>
        </div>

        <button type="button" className="btn btn-primary" disabled={savingPayment} onClick={savePaymentSettings}>
          {savingPayment ? 'Guardando...' : 'Guardar configuración de cobro'}
        </button>
        <div className="mt-4">
          {savingPayment ? (
            <span className="badge badge-info">Guardando cambios...</span>
          ) : paymentDirty ? (
            <span className="badge badge-warning">Hay cambios sin guardar</span>
          ) : paymentLoaded ? (
            <span className="badge badge-success">Cambios guardados</span>
          ) : null}
        </div>
      </div>

      {canManageTeam && (
        <>
          <div className="card mt-4">
            <div className="card-header">
              <h2 className="card-title">Usuarios del equipo</h2>
            </div>
            <div className="table-container">
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
                        <td className="font-semibold">
                          {member.username}
                          {member.id === currentUser?.id ? <span className="text-xs text-muted"> · Tú</span> : null}
                        </td>
                        <td>{member.display_name || '-'}</td>
                        <td>{ROLE_LABELS[member.role] || member.role}</td>
                        <td><span className={member.active ? 'badge badge-success' : 'badge badge-warning'}>{member.active ? 'Activo' : 'Inactivo'}</span></td>
                        <td>
                          <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => beginEdit(member)}>
                              Editar
                            </button>
                            {member.id !== currentUser?.id && (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={async () => {
                                  try {
                                    await apiPut(`/api/team/${member.id}`, { active: !member.active })
                                    setNotice({ type: 'success', text: 'Estado del usuario actualizado correctamente.' })
                                    await load()
                                  } catch (err) {
                                    alert(err.message)
                                  }
                                }}
                              >
                                {member.active ? 'Desactivar' : 'Activar'}
                              </button>
                            )}
                            {member.id !== currentUser?.id && (
                              <ConfirmButton
                                size="sm"
                                label="Eliminar"
                                confirmLabel="¿Eliminar usuario?"
                                onConfirm={async () => {
                                  try {
                                    await apiDelete(`/api/team/${member.id}`)
                                    setNotice({ type: 'success', text: 'Usuario eliminado correctamente.' })
                                    await load()
                                  } catch (err) {
                                    alert(err.message)
                                  }
                                }}
                              />
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

          {editingMember && editingForm && (
            <div className="card mt-4">
              <div className="card-header">
                <h2 className="card-title">Editar usuario</h2>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-4)' }}>
                <div className="form-group">
                  <label>Username</label>
                  <input className="input" value={editingForm.username} onChange={(event) => setEditingForm((current) => ({ ...current, username: event.target.value }))} />
                </div>
                <div className="form-group">
                  <label>Nombre visible</label>
                  <input className="input" value={editingForm.display_name} onChange={(event) => setEditingForm((current) => ({ ...current, display_name: event.target.value }))} />
                </div>
                <div className="form-group">
                  <label>Rol</label>
                  <select className="input" value={editingForm.role} onChange={(event) => setEditingForm((current) => ({ ...current, role: event.target.value }))}>
                    {(currentUser?.role === 'owner'
                      ? Object.entries(ROLE_LABELS)
                      : Object.entries(ROLE_LABELS).filter(([key]) => key !== 'owner')
                    ).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Estado</label>
                  <select className="input" value={editingForm.active ? '1' : '0'} onChange={(event) => setEditingForm((current) => ({ ...current, active: event.target.value === '1' }))}>
                    <option value="1">Activo</option>
                    <option value="0">Inactivo</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Nuevo PIN</label>
                  <input className="input" inputMode="numeric" maxLength={4} placeholder="Opcional" value={editingForm.pin} onChange={(event) => setEditingForm((current) => ({ ...current, pin: event.target.value.replace(/\D/g, '').slice(0, 4) }))} />
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn btn-primary" onClick={saveEdit}>Guardar cambios</button>
                <button type="button" className="btn btn-secondary" onClick={cancelEdit}>Cancelar</button>
              </div>
            </div>
          )}

          <div className="card mt-4">
            <div className="card-header">
              <h2 className="card-title">Bitácora del equipo</h2>
            </div>
            <div className="table-container">
              {activity.length === 0 ? (
                <p className="text-muted">Todavía no hay cambios registrados del equipo.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Actor</th>
                      <th>Acción</th>
                      <th>Detalle</th>
                      <th>Fecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activity.map((item) => (
                      <tr key={item.id}>
                        <td className="font-semibold">{item.actor}</td>
                        <td>{formatAction(item.action)}</td>
                        <td className="text-secondary">{formatDetails(item.details)}</td>
                        <td className="text-muted text-sm">{new Date(item.created_at).toLocaleString('es-BO', { timeZone: 'America/La_Paz' })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function formatAction(action) {
  if (action === 'team.user.create') return 'Creó usuario'
  if (action === 'team.user.update') return 'Actualizó usuario'
  if (action === 'team.user.delete') return 'Eliminó usuario'
  if (action === 'team.change_pin.self') return 'Cambió su PIN'
  return action
}

function formatDetails(details) {
  if (!details) return '—'
  if (details.username && typeof details.username === 'string') return details.username
  if (details.username?.to) return `${details.username.from} → ${details.username.to}`
  if (details.role?.to) return `Rol: ${details.role.from} → ${details.role.to}`
  if (details.display_name?.to) return `Nombre: ${details.display_name.to || 'sin nombre'}`
  if (details.pin_reset) return 'Reset de PIN'
  if (details.active) return `Activo: ${details.active.to ? 'sí' : 'no'}`
  return JSON.stringify(details)
}
