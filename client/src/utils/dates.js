// Todas las fechas del server vienen en America/La_Paz (-04:00)
const TZ = 'America/La_Paz'

const MYSQL_DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
const ISO_WITHOUT_OFFSET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/

export function parseAppDate(value) {
  if (!value) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  const text = String(value).trim()
  if (!text) return null

  // MySQL DATETIME sin zona: interpretarlo explícitamente en Bolivia
  if (MYSQL_DATETIME_RE.test(text)) {
    const parsed = new Date(text.replace(' ', 'T') + '-04:00')
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  // ISO sin offset explícito: también asumir Bolivia para evitar shifts ambiguos
  if (ISO_WITHOUT_OFFSET_RE.test(text)) {
    const parsed = new Date(`${text}-04:00`)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function formatDate(dateStr) {
  const d = parseAppDate(dateStr)
  if (!d) return ''
  return d.toLocaleDateString('es-BO', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatTime(dateStr) {
  const d = parseAppDate(dateStr)
  if (!d) return ''
  return d.toLocaleTimeString('es-BO', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
}

export function formatDateTime(dateStr) {
  if (!dateStr) return ''
  return `${formatDate(dateStr)} ${formatTime(dateStr)}`
}

export function timeAgo(dateStr) {
  const d = parseAppDate(dateStr)
  if (!d) return ''
  const now = new Date()
  const diffMs = now - d
  if (!Number.isFinite(diffMs)) return ''
  const diffMin = Math.floor(diffMs / 60000)

  if (diffMin < 1) return 'ahora'
  if (diffMin < 60) return `hace ${diffMin} min`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `hace ${diffH}h`
  const diffD = Math.floor(diffH / 24)
  if (diffD < 7) return `hace ${diffD}d`
  return formatDate(dateStr)
}

export function formatCurrency(amount, symbol = 'Bs') {
  if (amount == null) return ''
  const num = Number(amount)
  return `${symbol} ${num.toLocaleString('es-BO', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

export function formatPercent(value) {
  if (value == null) return ''
  return `${Math.round(value * 100) / 100}%`
}
