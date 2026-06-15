import { useState } from 'react'
import { setAuth } from '../lib/user.js'

export default function AuthModal({ onClose, onAuth }) {
  const [tab, setTab] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function switchTab(next) {
    setTab(next)
    setError('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (tab === 'signup' && password !== confirm) {
      return setError('Passwords do not match.')
    }

    setLoading(true)
    try {
      const endpoint = tab === 'signup' ? '/api/auth/signup' : '/api/auth/login'
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Something went wrong.')
      setAuth({ token: data.token, userId: data.userId, email: data.email })
      onAuth({ userId: data.userId, email: data.email })
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Authentication">
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>

        <div className="modal-tabs">
          <button
            className={`modal-tab${tab === 'login' ? ' active' : ''}`}
            onClick={() => switchTab('login')}
            type="button"
          >
            Log in
          </button>
          <button
            className={`modal-tab${tab === 'signup' ? ' active' : ''}`}
            onClick={() => switchTab('signup')}
            type="button"
          >
            Sign up
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          <div className="field">
            <label htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              autoComplete="email"
              placeholder="you@example.com"
            />
          </div>

          <div className="field">
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
              placeholder={tab === 'signup' ? 'At least 8 characters' : ''}
              minLength={tab === 'signup' ? 8 : undefined}
            />
          </div>

          {tab === 'signup' && (
            <div className="field">
              <label htmlFor="auth-confirm">Confirm password</label>
              <input
                id="auth-confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
                placeholder="Same as above"
              />
            </div>
          )}

          {error && <p className="form-error">{error}</p>}

          <button type="submit" className="cta" disabled={loading}>
            {loading
              ? tab === 'login' ? 'Logging in…' : 'Creating account…'
              : tab === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  )
}
