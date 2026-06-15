import { useState } from 'react'
import InputForm from './components/InputForm.jsx'
import Results from './components/Results.jsx'
import Tracker from './components/Tracker.jsx'
import AuthModal from './components/AuthModal.jsx'
import { getAuth, setAuth } from './lib/user.js'

export default function App() {
  const [status, setStatus] = useState('idle') // idle | loading | done | error
  const [result, setResult] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [showAuth, setShowAuth] = useState(false)
  const [authUser, setAuthUser] = useState(() => {
    const a = getAuth()
    return a ? { userId: a.userId, email: a.email } : null
  })

  function handleAuth(user) {
    setAuthUser(user)
  }

  function handleLogout() {
    setAuth(null)
    setAuthUser(null)
  }

  async function handleSubmit(payload) {
    setStatus('loading')
    setErrorMsg('')
    try {
      const res = await fetch('/api/calculate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Something went wrong.')
      data.goal = payload.goal
      data.sex = payload.sex
      data.unit = payload.unit
      setResult(data)
      setStatus('done')
    } catch (err) {
      setErrorMsg(err.message)
      setStatus('error')
    }
  }

  return (
    <div className="shell">
      <header className="masthead">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <i></i><i></i><i></i>
          </span>
          Macro&nbsp;Coach
        </div>

        {authUser ? (
          <div className="auth-status">
            <span className="auth-email">{authUser.email}</span>
            <button className="auth-btn-ghost" onClick={handleLogout}>Log out</button>
          </div>
        ) : (
          <button className="auth-btn" onClick={() => setShowAuth(true)}>
            Log in / Sign up
          </button>
        )}
      </header>

      <p className="tagline">Turn your weight, intake, and a goal into numbers you can actually eat to.</p>

      <h1 className="hero">
        Stop guessing your <em>macros</em>.
      </h1>
      <p className="hero-sub">
        Tell it what you weigh, what you normally eat in a day, and where you want your weight to
        go. It sets a calorie target and splits it into protein, carbs, and fat — protein first.
      </p>

      <div className="grid">
        <InputForm onSubmit={handleSubmit} loading={status === 'loading'} />
        <Results status={status} result={result} errorMsg={errorMsg} />
      </div>

      <Tracker key={authUser?.userId || 'guest'} calcResult={status === 'done' ? result : null} />

      <p className="foot">
        Estimates for general guidance, not medical advice. Recalculate every few weeks as your
        weight changes — your maintenance moves with it.
      </p>

      {showAuth && (
        <AuthModal onClose={() => setShowAuth(false)} onAuth={handleAuth} />
      )}
    </div>
  )
}
