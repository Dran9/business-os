import { useState, useRef, useEffect } from 'react'

export default function Login({ onLogin, loading, error }) {
  const [digits, setDigits] = useState(['', '', '', ''])
  const inputRefs = [useRef(), useRef(), useRef(), useRef()]

  useEffect(() => {
    inputRefs[0].current?.focus()
  }, [])

  function handleChange(index, value) {
    // Solo dígitos
    const digit = value.replace(/\D/g, '').slice(-1)
    const next = [...digits]
    next[index] = digit
    setDigits(next)

    // Auto-avanzar al siguiente
    if (digit && index < 3) {
      inputRefs[index + 1].current?.focus()
    }

    // Auto-submit cuando se completan los 4
    if (digit && index === 3) {
      const pin = next.join('')
      if (pin.length === 4) {
        onLogin(pin)
      }
    }
  }

  function handleKeyDown(index, e) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs[index - 1].current?.focus()
    }
  }

  function handlePaste(e) {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4)
    if (pasted.length === 4) {
      setDigits(pasted.split(''))
      onLogin(pasted)
    }
  }

  return (
    <div className="login-container">
      <div className="login-form">
        <h1 className="login-title">Business OS</h1>
        <p className="login-subtitle">Ingresa tu PIN</p>

        {error && <div className="login-error">{error}</div>}

        <div className="pin-inputs">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={inputRefs[i]}
              className="pin-digit"
              type="password"
              inputMode="numeric"
              maxLength={1}
              value={d}
              onChange={e => handleChange(i, e.target.value)}
              onKeyDown={e => handleKeyDown(i, e)}
              onPaste={i === 0 ? handlePaste : undefined}
              disabled={loading}
              autoComplete="off"
            />
          ))}
        </div>

        {loading && <p className="text-muted" style={{ textAlign: 'center', marginTop: 'var(--space-4)' }}>Verificando...</p>}
      </div>
    </div>
  )
}
