import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiDelete, apiGet, apiPost, apiPut } from '../utils/api'
import { timeAgo } from '../utils/dates'
import ConfirmButton from '../components/ui/ConfirmButton'

const LABEL_OPTIONS = [
  { value: '', label: 'Todos los labels' },
  { value: 'cliente', label: 'Cliente' },
  { value: 'cliente_agenda', label: 'Cliente Agenda' },
  { value: 'nurture', label: 'Nurture' },
  { value: 'cold', label: 'Cold' },
  { value: 'lista_negra', label: 'Lista negra' },
]

const NAME_QUALITY_OPTIONS = [
  { value: '', label: 'Todas las calidades' },
  { value: 'nombre_completo', label: 'Nombre completo' },
  { value: 'nombre_parcial', label: 'Nombre parcial' },
  { value: 'sin_nombre', label: 'Sin nombre' },
]

const LABEL_BADGES = {
  cliente: 'badge badge-success',
  cliente_agenda: 'badge badge-info',
  nurture: 'badge badge-warning',
  cold: 'badge',
  lista_negra: 'badge badge-danger',
}

const QUALITY_BADGES = {
  nombre_completo: 'badge badge-success',
  nombre_parcial: 'badge badge-warning',
  sin_nombre: 'badge badge-danger',
}

function initialForm() {
  return {
    phone: '',
    wa_name: '',
    label: 'cold',
    city: '',
    notes: '',
    needs_review: false,
    review_reason: '',
  }
}

export default function Contacts() {
  const [contacts, setContacts] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [selectedContact, setSelectedContact] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [search, setSearch] = useState('')
  const [labelFilter, setLabelFilter] = useState('')
  const [qualityFilter, setQualityFilter] = useState('')
  const [editing, setEditing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(initialForm())

  const loadContacts = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search.trim()) params.set('search', search.trim())
      if (labelFilter) params.set('label', labelFilter)
      if (qualityFilter) params.set('name_quality', qualityFilter)
      params.set('limit', '200')
      const response = await apiGet(`/api/contacts?${params.toString()}`)
      const rows = Array.isArray(response) ? response : (response.data || [])
      setContacts(rows)
    } catch (err) {
      console.error(err)
      setContacts([])
    } finally {
      setLoading(false)
    }
  }, [labelFilter, qualityFilter, search])

  const loadDetail = useCallback(async (contactId) => {
    if (!contactId) {
      setSelectedContact(null)
      return
    }
    setLoadingDetail(true)
    try {
      const detail = await apiGet(`/api/contacts/${contactId}`)
      setSelectedContact(detail)
      setForm({
        phone: detail.phone || '',
        wa_name: detail.wa_name || '',
        label: detail.label || 'cold',
        city: detail.city || '',
        notes: detail.notes || '',
        needs_review: Boolean(detail.needs_review),
        review_reason: detail.review_reason || '',
      })
    } catch (err) {
      console.error(err)
      setSelectedContact(null)
    } finally {
      setLoadingDetail(false)
    }
  }, [])

  useEffect(() => {
    loadContacts()
  }, [loadContacts])

  useEffect(() => {
    if (!creating && !selectedId && contacts.length > 0) {
      setSelectedId(contacts[0].id)
      return
    }
    if (!creating && selectedId && !contacts.some((contact) => contact.id === selectedId)) {
      setSelectedId(contacts[0]?.id || null)
    }
  }, [contacts, creating, selectedId])

  useEffect(() => {
    if (creating) {
      setSelectedContact(null)
      setForm(initialForm())
      return
    }
    loadDetail(selectedId)
  }, [creating, loadDetail, selectedId])

  const currentLeadRows = useMemo(() => selectedContact?.leads || [], [selectedContact?.leads])

  function beginCreate() {
    setCreating(true)
    setEditing(true)
    setSelectedId(null)
    setSelectedContact(null)
    setForm(initialForm())
  }

  function beginEdit() {
    if (!selectedContact) return
    setCreating(false)
    setEditing(true)
    setForm({
      phone: selectedContact.phone || '',
      wa_name: selectedContact.wa_name || '',
      label: selectedContact.label || 'cold',
      city: selectedContact.city || '',
      notes: selectedContact.notes || '',
      needs_review: Boolean(selectedContact.needs_review),
      review_reason: selectedContact.review_reason || '',
    })
  }

  function cancelEdit() {
    setEditing(false)
    if (creating) {
      setCreating(false)
      setSelectedId(contacts[0]?.id || null)
      return
    }
    if (selectedContact) {
      setForm({
        phone: selectedContact.phone || '',
        wa_name: selectedContact.wa_name || '',
        label: selectedContact.label || 'cold',
        city: selectedContact.city || '',
        notes: selectedContact.notes || '',
        needs_review: Boolean(selectedContact.needs_review),
        review_reason: selectedContact.review_reason || '',
      })
    }
  }

  function handleFieldChange(event) {
    const { name, value, type, checked } = event.target
    setForm((current) => ({
      ...current,
      [name]: type === 'checkbox' ? checked : value,
      ...(name === 'needs_review' && !checked ? { review_reason: '' } : {}),
    }))
  }

  async function handleSave(event) {
    event.preventDefault()
    setSaving(true)
    try {
      const payload = {
        phone: form.phone.trim(),
        wa_name: form.wa_name.trim(),
        label: form.label,
        city: form.city.trim(),
        notes: form.notes.trim(),
        needs_review: form.needs_review,
        review_reason: form.needs_review ? form.review_reason.trim() : '',
      }

      if (creating) {
        const created = await apiPost('/api/contacts', payload)
        setCreating(false)
        setEditing(false)
        await loadContacts()
        setSelectedId(created.id)
        await loadDetail(created.id)
      } else if (selectedContact?.id) {
        await apiPut(`/api/contacts/${selectedContact.id}`, payload)
        setEditing(false)
        await Promise.all([loadContacts(), loadDetail(selectedContact.id)])
      }
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteContact() {
    if (!selectedContact?.id) return
    try {
      await apiDelete(`/api/contacts/${selectedContact.id}`)
      setSelectedContact(null)
      setSelectedId(null)
      setEditing(false)
      setCreating(false)
      await loadContacts()
    } catch (err) {
      alert(err.message)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2" style={{ flexWrap: 'wrap' }}>
        <h1 className="page-title">Contacts</h1>
        <button type="button" className="btn btn-primary" onClick={beginCreate}>
          Nuevo contacto
        </button>
      </div>

      <div className="flex gap-2 mt-4" style={{ flexWrap: 'wrap' }}>
        <input
          className="input"
          style={{ maxWidth: 280 }}
          placeholder="Buscar por nombre o teléfono..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select className="input" style={{ maxWidth: 180 }} value={labelFilter} onChange={(event) => setLabelFilter(event.target.value)}>
          {LABEL_OPTIONS.map((option) => <option key={option.label} value={option.value}>{option.label}</option>)}
        </select>
        <select className="input" style={{ maxWidth: 220 }} value={qualityFilter} onChange={(event) => setQualityFilter(event.target.value)}>
          {NAME_QUALITY_OPTIONS.map((option) => <option key={option.label} value={option.value}>{option.label}</option>)}
        </select>
      </div>

      <div className="crm-layout mt-4">
        <div className="table-container card">
          {loading ? (
            <div className="text-muted">Cargando contactos...</div>
          ) : contacts.length === 0 ? (
            <div className="text-muted">No hay contactos todavía.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Teléfono</th>
                  <th>Calidad nombre</th>
                  <th>Label</th>
                  <th>Ciudad</th>
                  <th>Consultas</th>
                  <th>Compras</th>
                  <th>Último contacto</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact) => (
                  <tr
                    key={contact.id}
                    className={selectedId === contact.id && !creating ? 'table-row-selected' : ''}
                    onClick={() => {
                      setCreating(false)
                      setEditing(false)
                      setSelectedId(contact.id)
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <td className="font-semibold">{contact.clean_name || contact.wa_name || 'Sin nombre'}</td>
                    <td className="text-secondary">{contact.phone}</td>
                    <td><span className={QUALITY_BADGES[contact.name_quality] || 'badge'}>{formatQuality(contact.name_quality)}</span></td>
                    <td><span className={LABEL_BADGES[contact.label] || 'badge'}>{formatLabel(contact.label)}</span></td>
                    <td className="text-secondary">{contact.city || '—'}</td>
                    <td>{contact.times_inquired || 0}</td>
                    <td>{contact.times_purchased || 0}</td>
                    <td className="text-muted text-sm">{timeAgo(contact.last_contact_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="crm-detail">
          {creating ? (
            <ContactFormCard
              title="Nuevo contacto"
              form={form}
              saving={saving}
              onChange={handleFieldChange}
              onSubmit={handleSave}
              onCancel={cancelEdit}
            />
          ) : loadingDetail ? (
            <div className="card text-muted">Cargando detalle del contacto...</div>
          ) : !selectedContact ? (
            <div className="card text-muted">Selecciona un contacto para ver su detalle.</div>
          ) : editing ? (
            <ContactFormCard
              title="Editar contacto"
              form={form}
              saving={saving}
              onChange={handleFieldChange}
              onSubmit={handleSave}
              onCancel={cancelEdit}
            />
          ) : (
            <>
              <div className="card">
                <div className="card-header">
                  <div>
                    <h2 className="card-title">{selectedContact.clean_name || selectedContact.wa_name || 'Sin nombre'}</h2>
                    <div className="text-sm text-muted">
                      {selectedContact.phone} · {selectedContact.city || 'Sin ciudad'}
                    </div>
                  </div>
                  <div className="flex gap-2" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={beginEdit}>
                      Editar
                    </button>
                    <ConfirmButton
                      label="Borrar"
                      confirmLabel="¿Borrar contacto?"
                      onConfirm={handleDeleteContact}
                    />
                  </div>
                </div>

                <div className="lead-summary-grid">
                  <LeadMeta label="Wa name" value={selectedContact.wa_name || '—'} />
                  <LeadMeta label="Clean name" value={selectedContact.clean_name || '—'} />
                  <LeadMeta label="Calidad" value={formatQuality(selectedContact.name_quality)} />
                  <LeadMeta label="Label" value={formatLabel(selectedContact.label)} />
                  <LeadMeta label="Consultas" value={String(selectedContact.times_inquired || 0)} />
                  <LeadMeta label="Compras" value={String(selectedContact.times_purchased || 0)} />
                </div>

                <div className="mt-4">
                  <div className="text-sm font-semibold">Revisión</div>
                  <div className="text-sm text-secondary mt-1">
                    {selectedContact.needs_review
                      ? `Pendiente${selectedContact.review_reason ? ` · ${selectedContact.review_reason}` : ''}`
                      : 'Sin revisión pendiente'}
                  </div>
                </div>

                <div className="mt-4">
                  <div className="text-sm font-semibold">Notas</div>
                  <div className="text-sm text-secondary mt-1">{selectedContact.notes || 'Sin notas.'}</div>
                </div>
              </div>

              <div className="card mt-4">
                <div className="card-header">
                  <h2 className="card-title">Leads vinculados</h2>
                </div>
                {currentLeadRows.length === 0 ? (
                  <div className="text-sm text-muted">Este contacto aún no tiene leads vinculados.</div>
                ) : (
                  <div className="lead-mini-lists">
                    <div>
                      {currentLeadRows.map((lead) => (
                        <div key={lead.id} className="mini-list-row">
                          <span>{lead.name || lead.phone}</span>
                          <span className="text-muted">{lead.workshop_name || 'Sin taller'}</span>
                        </div>
                      ))}
                    </div>
                    <div>
                      {currentLeadRows.map((lead) => (
                        <div key={`status-${lead.id}`} className="mini-list-row">
                          <span>Lead #{lead.id}</span>
                          <span className="text-muted">{formatLeadStatus(lead.status)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ContactFormCard({ title, form, saving, onChange, onSubmit, onCancel }) {
  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">{title}</h2>
      </div>
      <form onSubmit={onSubmit}>
        <div className="form-group">
          <label>Teléfono</label>
          <input className="input" name="phone" value={form.phone} onChange={onChange} required />
        </div>
        <div className="form-group">
          <label>Wa name</label>
          <input className="input" name="wa_name" value={form.wa_name} onChange={onChange} />
        </div>
        <div className="form-group">
          <label>Label</label>
          <select className="input" name="label" value={form.label} onChange={onChange}>
            {LABEL_OPTIONS.filter((option) => option.value).map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>Ciudad</label>
          <input className="input" name="city" value={form.city} onChange={onChange} />
        </div>
        <div className="form-group">
          <label>Notas</label>
          <textarea className="input textarea" name="notes" rows="4" value={form.notes} onChange={onChange} />
        </div>
        <label className="funnel-checkbox" style={{ marginBottom: 'var(--space-4)' }}>
          <input type="checkbox" name="needs_review" checked={form.needs_review} onChange={onChange} />
          <span>Necesita revisión</span>
        </label>
        {form.needs_review ? (
          <div className="form-group">
            <label>Motivo de revisión</label>
            <input className="input" name="review_reason" value={form.review_reason} onChange={onChange} />
          </div>
        ) : null}
        <div className="flex gap-2">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </form>
    </div>
  )
}

function LeadMeta({ label, value }) {
  return (
    <div className="lead-meta-card">
      <div className="text-xs text-muted">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  )
}

function formatQuality(value) {
  if (value === 'nombre_completo') return 'Nombre completo'
  if (value === 'nombre_parcial') return 'Nombre parcial'
  return 'Sin nombre'
}

function formatLabel(value) {
  if (value === 'cliente_agenda') return 'Cliente Agenda'
  if (value === 'lista_negra') return 'Lista negra'
  if (value === 'cliente') return 'Cliente'
  if (value === 'nurture') return 'Nurture'
  return 'Cold'
}

function formatLeadStatus(value) {
  if (value === 'qualifying') return 'Calificando'
  if (value === 'qualified') return 'Calificado'
  if (value === 'negotiating') return 'Negociando'
  if (value === 'converted') return 'Convertido'
  if (value === 'lost') return 'Perdido'
  if (value === 'dormant') return 'Dormido'
  return 'Nuevo'
}
