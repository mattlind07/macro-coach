import { useState } from 'react'
import InputForm from './components/InputForm.jsx'
import Results from './components/Results.jsx'
import Tracker from './components/Tracker.jsx'

export default function App() {
  const [status, setStatus] = useState('idle') // idle | loading | done | error
  const [result, setResult] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')

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
      // carry the goal/sex/unit through so the tracker can save them with the plan
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
        <p className="tagline">Turn your weight, intake, and a goal into numbers you can actually eat to.</p>
      </header>

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

      <Tracker calcResult={status === 'done' ? result : null} />

      <p className="foot">
        Estimates for general guidance, not medical advice. Recalculate every few weeks as your
        weight changes — your maintenance moves with it.
      </p>
    </div>
  )
}
