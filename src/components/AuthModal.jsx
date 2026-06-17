import { useState } from 'react'
import { setAuth } from '../lib/user.js'

// mode: 'login' | 'signup' | 'forgot' | 'reset'
// resetToken is only passed in when the modal is opened from a reset-link click.
export default function AuthModal({ onClose, onAuth, resetToken }) {
  const [tab, setTab] = useState(resetToken ? 'reset' : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [forgotSent, setForgotSent] = useState(false)

  function switchTab(next) {
    setTab(next)
    setError('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if ((tab === 'signup' || tab === 'reset') && password !== confirm) {
      return setError('Passwords do not match.')
    }

    setLoading(true)
    try {
      if (tab === 'forgot') {
        const res = await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Something went wrong.')
        setForgotSent(true)
        return
      }

      if (tab === 'reset') {
        const res = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: resetToken, password }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Something went wrong.')
        setAuth({ token: data.token, userId: data.userId, email: data.email })
        onAuth({ userId: data.userId, email: data.email })
        onClose()
        return
      }

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

        {(tab === 'login' || tab === 'signup') && (
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
        )}

        {tab === 'forgot' && forgotSent ? (
          <div className="modal-form">
            <p>If an account exists for that email, we’ve sent a password reset link.</p>
            <button type="button" className="link-btn" onClick={() => switchTab('login')}>
              Back to log in
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="modal-form">
            {tab === 'reset' && <p>Choose a new password for your account.</p>}

            {tab !== 'reset' && (
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
            )}

            {tab !== 'forgot' && (
              <div className="field">
                <label htmlFor="auth-password">{tab === 'reset' ? 'New password' : 'Password'}</label>
                <input
                  id="auth-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus={tab === 'reset'}
                  autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
                  placeholder={tab === 'signup' || tab === 'reset' ? 'At least 8 characters' : ''}
                  minLength={tab === 'signup' || tab === 'reset' ? 8 : undefined}
                />
              </div>
            )}

            {(tab === 'signup' || tab === 'reset') && (
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

            {tab === 'login' && (
              <button type="button" className="link-btn" onClick={() => switchTab('forgot')}>
                Forgot password?
              </button>
            )}
            {tab === 'forgot' && (
              <button type="button" className="link-btn" onClick={() => switchTab('login')}>
                Back to log in
              </button>
            )}

            {error && <p className="form-error">{error}</p>}

            <button type="submit" className="cta" disabled={loading}>
              {loading
                ? tab === 'login' ? 'Logging in…'
                  : tab === 'signup' ? 'Creating account…'
                  : tab === 'forgot' ? 'Sending…'
                  : 'Saving…'
                : tab === 'login' ? 'Log in'
                  : tab === 'signup' ? 'Create account'
                  : tab === 'forgot' ? 'Send reset link'
                  : 'Set new password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
