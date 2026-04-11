import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/layout/Sidebar'
import { apiDelete, apiGet, apiPut, apiUpload } from '../utils/api'
import { formatDateTime } from '../utils/dates'

function initialAiSettings() {
  return {
    global_open_question_context: '',
  }
}

export default function AI() {
  const [settings, setSettings] = useState(initialAiSettings())
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [notice, setNotice] = useState(null)

  const activeCount = useMemo(
    () => documents.filter((item) => item.active).length,
    [documents]
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [settingsResponse, documentsResponse] = await Promise.all([
        apiGet('/api/ai/settings'),
        apiGet('/api/ai/documents'),
      ])
      setSettings(settingsResponse)
      setDocuments(documentsResponse || [])
      setDirty(false)
    } catch (err) {
      setNotice({ type: 'warning', text: err.message })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!notice) return undefined
    const timeout = window.setTimeout(() => setNotice(null), 3500)
    return () => window.clearTimeout(timeout)
  }, [notice])

  async function saveSettings() {
    setSaving(true)
    try {
      const updated = await apiPut('/api/ai/settings', settings)
      setSettings(updated)
      setDirty(false)
      setNotice({ type: 'success', text: 'Contexto global de IA guardado.' })
    } catch (err) {
      setNotice({ type: 'warning', text: err.message })
    } finally {
      setSaving(false)
    }
  }

  async function handleUpload(event) {
    const file = event.target.files?.[0]
    if (!file) return

    const formData = new FormData()
    formData.append('file', file)

    setUploading(true)
    try {
      const created = await apiUpload('/api/ai/documents', formData)
      setDocuments((current) => [created, ...current])
      setNotice({ type: 'success', text: 'Documento cargado y listo para IA.' })
      event.target.value = ''
    } catch (err) {
      setNotice({ type: 'warning', text: err.message })
    } finally {
      setUploading(false)
    }
  }

  async function toggleDocument(document) {
    try {
      const updated = await apiPut(`/api/ai/documents/${document.id}`, { active: !document.active })
      setDocuments((current) => current.map((item) => item.id === updated.id ? updated : item))
    } catch (err) {
      setNotice({ type: 'warning', text: err.message })
    }
  }

  async function removeDocument(document) {
    const confirmed = window.confirm(`Eliminar "${document.filename}" del contexto IA?`)
    if (!confirmed) return

    try {
      await apiDelete(`/api/ai/documents/${document.id}`)
      setDocuments((current) => current.filter((item) => item.id !== document.id))
      setNotice({ type: 'success', text: 'Documento eliminado.' })
    } catch (err) {
      setNotice({ type: 'warning', text: err.message })
    }
  }

  return (
    <div className="ai-shell">
      <section className="ai-hero">
        <div className="ai-hero-copy">
          <div className="ai-kicker">Memoria operativa</div>
          <h1 className="page-title">IA</h1>
          <p className="text-secondary">
            Define el contexto base del bot y sube documentos que la IA debe leer para responder con criterio real del negocio.
          </p>
        </div>

        <div className="ai-hero-stats">
          <StatCard label="Docs activos" value={String(activeCount)} tone="primary" />
          <StatCard label="Docs cargados" value={String(documents.length)} tone="neutral" />
          <StatCard
            label="Estado"
            value={loading ? 'Cargando' : dirty ? 'Pendiente' : 'Sin cambios'}
            tone={dirty ? 'warning' : 'success'}
          />
        </div>
      </section>

      {notice ? (
        <div className={`inline-notice mt-4 ${notice.type === 'success' ? 'inline-notice-success' : 'inline-notice-warning'}`}>
          {notice.text}
        </div>
      ) : null}

      <div className="ai-layout mt-4">
        <section className="card ai-context-card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Contexto global</h2>
              <div className="text-muted text-sm">Se inyecta antes del prompt de cada nodo IA.</div>
            </div>
            <div className={`badge ${dirty ? 'badge-warning' : 'badge-success'}`}>
              {dirty ? 'Pendiente' : 'Guardado'}
            </div>
          </div>

          <textarea
            className="input textarea ai-context-textarea"
            rows={14}
            value={settings.global_open_question_context}
            onChange={(event) => {
              setSettings((current) => ({
                ...current,
                global_open_question_context: event.target.value,
              }))
              setDirty(true)
            }}
            placeholder={'Ejemplo:\nSoy Daniel MacLean.\nResponde en español boliviano.\nTono cálido, directo y concreto.\nNunca inventes datos ni prometas resultados.\nSi falta un dato, dilo con honestidad.'}
          />

          <div className="ai-variable-panel">
            <div className="ai-variable-title">Variables disponibles</div>
            <div className="ai-variable-tags">
              {['[FECHA]', '[VENUE]', '[VENUE_DIRECCION]', '[HORA_INICIO]', '[HORA_FIN]', '[TALLER]', '[PRECIO]', '[MONTO]', '[NOMBRE]', '[NOMBRE_COMPLETO]', '[CELULAR]'].map((item) => (
                <span key={item} className="ai-variable-chip">{item}</span>
              ))}
            </div>
          </div>

          <button type="button" className="btn btn-primary mt-4" onClick={saveSettings} disabled={saving}>
            {saving ? 'Guardando...' : 'Guardar contexto IA'}
          </button>
        </section>

        <aside className="ai-side-column">
          <section className="card ai-upload-card">
            <div className="ai-upload-head">
              <div>
                <h2 className="card-title">Documentos</h2>
                <div className="text-muted text-sm">TXT, MD, CSV, JSON, HTML, XML o PDF.</div>
              </div>
              <div className="ai-icon-badge">
                <Icon name="brain" size={18} />
              </div>
            </div>

            <label className="ai-upload-dropzone">
              <input type="file" accept=".txt,.md,.csv,.json,.html,.xml,.pdf,text/plain,text/markdown,text/csv,application/json,application/pdf" onChange={handleUpload} hidden />
              <span className="ai-upload-title">{uploading ? 'Procesando documento...' : 'Subir documento para IA'}</span>
              <span className="text-muted text-sm">El texto extraído queda disponible para el bot en todo el tenant.</span>
            </label>

            <div className="text-muted text-sm mt-4">
              Los PDFs requieren <code>GOOGLE_VISION_API_KEY</code> para extraer texto.
            </div>
          </section>

          <section className="card mt-4">
            <div className="card-header">
              <h2 className="card-title">Biblioteca activa</h2>
            </div>

            {loading ? (
              <div className="text-muted">Cargando documentos...</div>
            ) : documents.length === 0 ? (
              <div className="ai-empty-state">
                Todavía no hay documentos. Sube material operativo para darle memoria persistente a la IA.
              </div>
            ) : (
              <div className="ai-document-list">
                {documents.map((document) => (
                  <article key={document.id} className={`ai-document-card ${document.active ? 'active' : 'muted'}`}>
                    <div className="ai-document-top">
                      <div>
                        <div className="font-semibold">{document.filename}</div>
                        <div className="text-xs text-muted">
                          {document.char_count?.toLocaleString('es-BO')} caracteres · {document.mime_type}
                        </div>
                      </div>
                      <button
                        type="button"
                        className={`settings-switch ${document.active ? 'active' : ''}`}
                        onClick={() => toggleDocument(document)}
                        aria-label={document.active ? 'Desactivar documento' : 'Activar documento'}
                      >
                        <span className="settings-switch-thumb" />
                      </button>
                    </div>

                    <p className="text-sm text-secondary mt-3">{document.excerpt || 'Sin extracto visible.'}</p>

                    <div className="ai-document-footer">
                      <span className={`badge ${document.active ? 'badge-success' : 'badge'}`}>
                        {document.active ? 'Activo' : 'Pausado'}
                      </span>
                      <span className="text-xs text-muted">{formatDateTime(document.updated_at || document.created_at)}</span>
                    </div>

                    <button type="button" className="btn btn-ghost btn-sm mt-3" onClick={() => removeDocument(document)}>
                      Eliminar
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}

function StatCard({ label, value, tone }) {
  return (
    <div className={`ai-stat-card ${tone || 'neutral'}`}>
      <div className="text-xs text-muted">{label}</div>
      <div className="ai-stat-value">{value}</div>
    </div>
  )
}
