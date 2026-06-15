import { useState } from 'react'

const GOALS = [
  { key: 'lose', title: 'Lose', sub: 'fat loss' },
  { key: 'maintain', title: 'Maintain', sub: 'hold steady' },
  { key: 'gain', title: 'Gain', sub: 'build muscle' },
]

export default function InputForm({ onSubmit, loading }) {
  const [weight, setWeight] = useState('')
  const [unit, setUnit] = useState('lb')
  const [currentCalories, setCurrentCalories] = useState('')
  const [goal, setGoal] = useState('lose')

  // optional — refine the AI's reasoning
  const [sex, setSex] = useState('unspecified')
  const [age, setAge] = useState('')
  const [activity, setActivity] = useState('')

  const [error, setError] = useState('')

  function submit() {
    const w = parseFloat(weight)
    const cals = parseFloat(currentCalories)

    if (!w || w <= 0) return setError('Enter your weight.')
    if (!cals || cals < 800) return setError('Enter your typical daily calories (at least 800).')
    setError('')

    onSubmit({
      weight: w,
      unit,
      currentCalories: cals,
      goal,
      sex,
      age: age ? parseInt(age, 10) : undefined,
      activity: activity || undefined,
    })
  }

  return (
    <section className="card" aria-label="Your details">
      <p className="card-label">Your inputs</p>

      {/* weight + unit */}
      <div className="field">
        <label htmlFor="weight">Current weight</label>
        <div className="input-row">
          <input
            id="weight"
            type="number"
            inputMode="decimal"
            placeholder={unit === 'lb' ? '200' : '90'}
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
          />
          <div className="toggle" role="group" aria-label="Weight unit">
            <button type="button" aria-pressed={unit === 'lb'} onClick={() => setUnit('lb')}>lb</button>
            <button type="button" aria-pressed={unit === 'kg'} onClick={() => setUnit('kg')}>kg</button>
          </div>
        </div>
      </div>

      {/* current calories */}
      <div className="field">
        <label htmlFor="cals">
          Typical daily calories <span className="hint">— what a normal day looks like now</span>
        </label>
        <input
          id="cals"
          type="number"
          inputMode="numeric"
          placeholder="3000"
          value={currentCalories}
          onChange={(e) => setCurrentCalories(e.target.value)}
        />
      </div>

      {/* goal */}
      <div className="field">
        <label>Goal</label>
        <div className="goals" role="group" aria-label="Goal">
          {GOALS.map((g) => (
            <button
              key={g.key}
              type="button"
              className="goal-btn"
              aria-pressed={goal === g.key}
              onClick={() => setGoal(g.key)}
            >
              <span className="g-title">{g.title}</span>
              <span className="g-sub">{g.sub}</span>
            </button>
          ))}
        </div>
      </div>

      {/* optional refinements */}
      <details className="advanced">
        <summary>Optional — sharpen the estimate</summary>

        <div className="field">
          <label htmlFor="sex">Sex</label>
          <select id="sex" value={sex} onChange={(e) => setSex(e.target.value)}>
            <option value="unspecified">Prefer not to say</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="age">Age</label>
          <input
            id="age"
            type="number"
            inputMode="numeric"
            placeholder="21"
            value={age}
            onChange={(e) => setAge(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="activity">Activity level</label>
          <select id="activity" value={activity} onChange={(e) => setActivity(e.target.value)}>
            <option value="">Unspecified</option>
            <option value="sedentary">Sedentary (desk, little exercise)</option>
            <option value="light">Light (1–3 days/week)</option>
            <option value="moderate">Moderate (3–5 days/week)</option>
            <option value="very active">Very active (6–7 days/week)</option>
          </select>
        </div>
      </details>

      <button className="cta" onClick={submit} disabled={loading}>
        {loading ? 'Crunching…' : 'Calculate my macros'}
      </button>

      {error && <p className="form-error">{error}</p>}
    </section>
  )
}
