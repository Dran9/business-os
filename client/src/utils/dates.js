// Todas las fechas del server vienen en America/La_Paz (-04:00)
const TZ = 'America/La_Paz'

export function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('es-BO', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatTime(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleTimeString('es-BO', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
}

export function formatDateTime(dateStr) {
  if (!dateStr) return ''
  return `${formatDate(dateStr)} ${formatTime(dateStr)}`
}

export function timeAgo(dateStr) {
  if (!dateStr) return ''
  const now = new Date()
  const d = new Date(dateStr)
  const diffMs = now - d
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
