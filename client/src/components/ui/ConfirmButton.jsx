import { useState, useRef, useEffect } from 'react'

const TrashIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
)

export default function ConfirmButton({
  onConfirm,
  label = 'Eliminar',
  confirmLabel = '¿Eliminar?',
  className = '',
  disabled = false,
  size = 'normal',
}) {
  const [confirming, setConfirming] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!confirming) return undefined
    function handleClickOutside(event) {
      if (ref.current && !ref.current.contains(event.target)) {
        setConfirming(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [confirming])

  function handleClick() {
    if (confirming) {
      setConfirming(false)
      onConfirm()
    } else {
      setConfirming(true)
    }
  }

  const sizeClass = size === 'sm' ? 'btn-sm' : ''

  return (
    <button
      type="button"
      ref={ref}
      className={`btn ${confirming ? 'btn-danger' : 'btn-secondary'} ${sizeClass} ${className}`.trim()}
      onClick={handleClick}
      disabled={disabled}
    >
      <TrashIcon />
      {confirming ? confirmLabel : label}
    </button>
  )
}
