import { useState, useRef, useEffect } from 'react'

export default function ConfirmButton({
  onConfirm,
  label = 'Borrar',
  confirmLabel = '¿Borrar?',
  className = '',
  disabled = false,
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

  return (
    <button
      type="button"
      ref={ref}
      className={`confirm-btn ${confirming ? 'confirm-btn--danger' : ''} ${className}`.trim()}
      onClick={handleClick}
      disabled={disabled}
    >
      {confirming ? confirmLabel : label}
    </button>
  )
}
