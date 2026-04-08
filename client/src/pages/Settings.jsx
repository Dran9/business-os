import { useEffect, useState } from 'react'
import { apiDelete, apiGet, apiPost, apiPut } from '../utils/api'

const ROLE_LABELS = {
  owner: 'Owner',
  admin: 'Admin',
  viewer: 'Viewer',
}

export default function Settings({ currentUser }) {
  const [team, setTeam] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    username: '',
    display_name: '',
    pin: '',
    role: 'viewer',
  })

  async function load() {
    setLoading(true)
    try {
      const rows = await apiGet('/api/team')
      setTeam(rows)
    } catch {
      setTeam([])
    } finally {
      setLoading(false)
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
