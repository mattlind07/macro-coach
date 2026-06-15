import { useEffect, useRef, useState } from 'react'

const KCAL = { protein: 4, carbs: 4, fat: 9 }

// Count a number up from 0 — gives the readout an "instrument booting" feel.
// Honors prefers-reduced-motion by snapping straight to the value.
function useCountUp(target, deps) {
  const [val, setVal] = useState(0)
  const raf = useRef(null)
  useEffect(() => {
    if (target == null) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) { setVal(target); return }
    const start = performance.now()
    const dur = 600
    cancelAnimationFrame(raf.current)
    const tick = (now) => {
      const t = Math.min((now - start) / dur, 1)
      const eased = 1 - Math.pow(1 - t, 3) // easeOutCubic
      setVal(Math.round(target * eased))
      if (t < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return val
}

export default function Results({ status, result, errorMsg }) {
  const stamp = result ? `${result.calories}-${result.protein_g}-${result.carbs_g}-${result.fat_g}` : ''
  const calories = useCountUp(result?.calories, [stamp])
  const protein = useCountUp(result?.protein_g, [stamp])
  const carbs = useCountUp(result?.carbs_g, [stamp])
  const fat = useCountUp(result?.fat_g, [stamp])

  if (status === 'loading') {
    return (
      <section className="card" aria-busy="true" aria-label="Calculating">
        <p className="card-label">Your plan</p>
        <div className="loading">
          <div className="shimmer tall w60" />
          <div className="shimmer w40" />
          <div className="shimmer" />
          <div className="shimmer w60" />
        </div>
      </section>
    )
  }

  if (status === 'error') {
    return (
      <section className="card" aria-label="Error">
        <p className="card-label">Your plan</p>
        <div className="warning">⚠ {errorMsg || 'Something went wrong. Try again.'}</div>
      </section>
    )
  }

  if (status !== 'done' || !result) {
    return (
      <section className="card" aria-label="Results">
        <p className="card-label">Your plan</p>
        <div className="results-empty">
          <span className="big">— : — : —</span>
          <p>Fill in your details and hit calculate.<br />Your target and macro split land here.</p>
        </div>
      </section>
    )
  }

  // ratio of calories from each macro (this is what the bar encodes)
  const pCal = result.protein_g * KCAL.protein
  const cCal = result.carbs_g * KCAL.carbs
  const fCal = result.fat_g * KCAL.fat
  const totalCal = Math.max(pCal + cCal + fCal, 1)
  const pct = (x) => `${(x / totalCal) * 100}%`
  const round = (x) => Math.round((x / totalCal) * 100)

  const deltaText =
    result.delta === 0
      ? 'at maintenance'
      : result.delta < 0
      ? `${Math.abs(result.delta)} kcal below maintenance`
      : `${result.delta} kcal above maintenance`

  return (
    <section className="card" aria-label="Your plan">
      <p className="card-label">Your daily target</p>

      <div className="calorie-readout">
        <span className="num">{calories.toLocaleString()}</span>
        <span className="unit">kcal / day</span>
      </div>
      <p className="delta">
        maintenance <b>{result.maintenance?.toLocaleString()}</b> &nbsp;·&nbsp; {deltaText}
      </p>

      {/* signature: the macro ratio bar — width = share of calories */}
      <div className="ratio-bar" role="img" aria-label={`Calorie split: ${round(pCal)}% protein, ${round(cCal)}% carbs, ${round(fCal)}% fat`}>
        <span className="seg-p" style={{ width: pct(pCal) }} />
        <span className="seg-c" style={{ width: pct(cCal) }} />
        <span className="seg-f" style={{ width: pct(fCal) }} />
      </div>

      <div className="macros">
        <div className="macro p">
          <div className="m-name">Protein</div>
          <div className="m-grams">{protein}<span> g</span></div>
          <div className="m-meta">{round(pCal)}% · {pCal} kcal</div>
        </div>
        <div className="macro c">
          <div className="m-name">Carbs</div>
          <div className="m-grams">{carbs}<span> g</span></div>
          <div className="m-meta">{round(cCal)}% · {cCal} kcal</div>
        </div>
        <div className="macro f">
          <div className="m-name">Fat</div>
          <div className="m-grams">{fat}<span> g</span></div>
          <div className="m-meta">{round(fCal)}% · {fCal} kcal</div>
        </div>
      </div>

      <hr className="section-rule" />

      <div className="rationale">
        <h4>Why these numbers</h4>
        <p>{result.rationale}</p>
      </div>

      {result.warnings?.length > 0 && (
        <div className="warnings">
          {result.warnings.map((w, i) => (
            <div className="warning" key={i}>⚠ {w}</div>
          ))}
        </div>
      )}

      <div className={`source-tag ${result.source === 'fallback' ? 'fallback' : ''}`}>
        <span className="dot" />
        {result.source === 'ai' ? 'Personalized by AI' : 'Formula estimate (add an API key for AI tuning)'}
      </div>
    </section>
  )
}
