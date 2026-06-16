import { useEffect, useMemo, useState } from 'react'
import { getUserId, getAuthToken } from '../lib/user.js'

const LB_PER_KG = 2.20462

// Logged-in requests carry the bearer token so the server can verify the
// caller actually owns userId; guests (no token) are sent as before.
function authHeaders() {
  const token = getAuthToken()
  return token ? { authorization: `Bearer ${token}` } : {}
}

export default function Tracker({ calcResult, calcPayload, onPlanLoaded }) {
  const userId = useMemo(() => getUserId(), [])
  const [plan, setPlan] = useState(null)
  const [weighIns, setWeighIns] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

  // Active weight unit: a saved plan's unit wins; otherwise the unit the user
  // just calculated in; default lb. (Fixes the bug where a kg calculation was
  // saved/displayed as lb.)
  const unit = plan?.weight_unit || calcResult?.unit || 'lb'

  // weigh-in form
  const [w, setW] = useState('')
  const [cals, setCals] = useState('')
  const [busy, setBusy] = useState(false)
  const [recal, setRecal] = useState(null)

  // load any saved plan + history on mount
  useEffect(() => {
    if (!userId) return
    ;(async () => {
      try {
        const r = await fetch(`/api/plan?userId=${encodeURIComponent(userId)}`, { headers: authHeaders() })
        const data = await r.json()
        if (!r.ok) throw new Error(data.error || 'Could not load your tracker.')
        if (data.plan) {
          setPlan(data.plan)
          onPlanLoaded?.(data.plan)
        }
        setWeighIns(data.weighIns || [])
      } catch (e) {
        setError(e.message)
      } finally {
        setLoaded(true)
      }
    })()
  }, [userId])

  async function startTracking() {
    if (!calcResult) return
    setError('')
    try {
      const r = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          userId,
          weightUnit: unit,
          goal: calcResult.goal || guessGoal(calcResult),
          target_cal: calcResult.calories,
          protein_g: calcResult.protein_g,
          carbs_g: calcResult.carbs_g,
          fat_g: calcResult.fat_g,
          maintenance: calcResult.maintenance,
          sex: calcResult.sex,
          age: calcPayload?.age,
          activity: calcPayload?.activity,
          weight: calcPayload?.weight,
          current_calories: calcPayload?.currentCalories,
        }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Could not start tracking.')
      setPlan(data.plan)
    } catch (e) {
      setError(e.message)
    }
  }

  async function deleteWeighIn(id) {
    try {
      const r = await fetch('/api/weighin', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ userId, id }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Could not delete weigh-in.')
      setWeighIns(data.weighIns || [])
      if (data.plan) setPlan(data.plan)
      setRecal(data.recalibration || null)
    } catch (e) {
      setError(e.message)
    }
  }

  async function addWeighIn() {
    const weight = parseFloat(w)
    if (!weight || weight <= 0) return setError('Enter your weight.')
    setError('')
    setBusy(true)
    try {
      const r = await fetch('/api/weighin', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          userId,
          weight,
          unit,
          calories: cals ? parseFloat(cals) : undefined,
        }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Could not save weigh-in.')
      setWeighIns(data.weighIns || [])
      if (data.plan) setPlan(data.plan)
      setRecal(data.recalibration || null)
      setW('')
      setCals('')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) {
    return (
      <section className="card tracker" aria-busy="true">
        <p className="card-label">Track progress</p>
        <div className="shimmer w40" style={{ height: 14 }} />
      </section>
    )
  }

  // no plan saved yet
  if (!plan) {
    return (
      <section className="card tracker">
        <p className="card-label">Track progress</p>
        {calcResult ? (
          <>
            <p className="tracker-intro">
              Save this plan, then log your weight each week. Once there's a week of data, it
              measures your <b>real</b> maintenance from how your weight actually moved — and adjusts
              your target automatically. That's the difference between a calculator and a coach.
            </p>
            <button className="cta" onClick={startTracking}>Start tracking this plan</button>
          </>
        ) : (
          <p className="tracker-intro">Calculate a plan above, then come back here to track it week to week.</p>
        )}
        {error && <p className="form-error">{error}</p>}
      </section>
    )
  }

  // active tracker
  return (
    <section className="card tracker">
      <p className="card-label">Track progress</p>

      <div className="tracker-current">
        <div>
          <span className="tc-label">Current target</span>
          <span className="tc-num">{plan.target_cal.toLocaleString()} <small>kcal</small></span>
        </div>
        <div className="tc-macros">
          <span className="tc-chip p">{plan.protein_g}P</span>
          <span className="tc-chip c">{plan.carbs_g}C</span>
          <span className="tc-chip f">{plan.fat_g}F</span>
        </div>
      </div>

      <WeightChart weighIns={weighIns} unit={unit} />

      <WeighInHistory weighIns={weighIns} unit={unit} plan={plan} onDelete={deleteWeighIn} />

      {recal && (
        <div className={recal.applied ? 'recal-note applied' : 'recal-note pending'}>
          {recal.applied ? '↻ ' : 'ⓘ '}{recal.message || recal.reason}
          {recal.applied && recal.earlyData && (
            <p className="recal-early-note">
              Best results come after 7+ consecutive days of data — early estimates may be skewed by water weight fluctuations.
            </p>
          )}
        </div>
      )}

      <div className="weighin-form">
        <div className="wf-row">
          <input
            type="number"
            inputMode="decimal"
            placeholder={`Weight (${unit})`}
            value={w}
            onChange={(e) => setW(e.target.value)}
            aria-label="Weight today"
          />
          <input
            type="number"
            inputMode="numeric"
            placeholder="Avg kcal (optional)"
            value={cals}
            onChange={(e) => setCals(e.target.value)}
            aria-label="Average calories since last weigh-in"
          />
        </div>
        <button className="cta secondary" onClick={addWeighIn} disabled={busy}>
          {busy ? 'Saving…' : 'Log weigh-in'}
        </button>
        <p className="wf-hint">
          Calories optional. Leave blank and it assumes you hit your target. Log daily for the
          cleanest trend — it averages your last 7 days to smooth out normal day-to-day swings.
        </p>
      </div>

      {error && <p className="form-error">{error}</p>}
    </section>
  )
}

// pick a goal label if the calc result didn't carry one
function guessGoal(r) {
  if (!r || r.delta == null) return 'maintain'
  if (r.delta < -50) return 'lose'
  if (r.delta > 50) return 'gain'
  return 'maintain'
}

// ---- weigh-in history list with delete ----
function WeighInHistory({ weighIns, unit, plan, onDelete }) {
  if (!weighIns || weighIns.length === 0) return null

  const toDisplay = (lbs) => (unit === 'kg' ? lbs / LB_PER_KG : lbs)

  const fmt = (dateStr) => {
    // logged_on is YYYY-MM-DD; parse as UTC to avoid timezone shifts
    const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  }

  return (
    <ul className="weighin-list">
      {[...weighIns].reverse().map((wi) => {
        // fall back to the plan's target when the day's calories weren't logged
        const loggedCals = wi.calories
        const cals = loggedCals ?? plan?.target_cal
        return (
          <li key={wi.id} className="weighin-item">
            <span className="wi-date">{fmt(wi.logged_on)}</span>
            <span className="wi-weight">{toDisplay(wi.weight_lbs).toFixed(1)} {unit}</span>
            {cals != null && (
              <span className={loggedCals != null ? 'wi-cals' : 'wi-cals target'}>
                {Math.round(cals).toLocaleString()} kcal{loggedCals == null && <span className="wi-cals-tag"> (target)</span>}
              </span>
            )}
            <button
              className="wi-del"
              onClick={() => onDelete(wi.id)}
              aria-label={`Delete weigh-in for ${fmt(wi.logged_on)}`}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M2 3.5h10M5.5 3.5V2.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1M12 3.5l-.7 7.7a1 1 0 0 1-1 .8H3.7a1 1 0 0 1-1-.8L2 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

// ---- compact dependency-free SVG trend line ----
function WeightChart({ weighIns, unit }) {
  if (!weighIns || weighIns.length === 0) {
    return <p className="chart-empty">No weigh-ins yet. Log your first below!</p>
  }

  const toDisplay = (lbs) => (unit === 'kg' ? lbs / LB_PER_KG : lbs)
  // Plot the smoothed trend (7-day rolling average) instead of the raw
  // weight, so the line matches what recalibration actually used. Raw
  // values are still visible in the history list below.
  const pts = weighIns.map((x) => ({ t: new Date(x.logged_on).getTime(), v: toDisplay(x.trend ?? x.weight_lbs) }))

  const W = 320, H = 120, PAD_R = 14, PAD_Y = 16, PAD_L = 38
  const vals = pts.map((p) => p.v)
  const times = pts.map((p) => p.t)
  const rawMinV = Math.min(...vals), rawMaxV = Math.max(...vals)
  const minT = Math.min(...times), maxT = Math.max(...times)

  // Floor the y-axis range so a fraction-of-a-pound trend wobble doesn't fill
  // the whole chart height and read as a dramatic swing. Real moves bigger
  // than the floor still get their true range.
  const MIN_SPAN = unit === 'kg' ? 2 : 4
  const mid = (rawMaxV + rawMinV) / 2
  const span = Math.max(rawMaxV - rawMinV, MIN_SPAN)
  const minV = mid - span / 2
  const maxV = mid + span / 2
  const spanT = maxT - minT || 1

  const x = (t) => PAD_L + ((t - minT) / spanT) * (W - PAD_L - PAD_R)
  const y = (v) => PAD_Y + (1 - (v - minV) / span) * (H - 2 * PAD_Y)

  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  const latest = pts[pts.length - 1].v
  const first = pts[0].v
  const change = latest - first

  // Reference gridlines so the y-axis has a sense of scale instead of an
  // unlabeled auto-fit line — top/middle/bottom of the padded range.
  const ticks = [maxV, mid, minV]

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Weight trend">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text x={PAD_L - 6} y={y(t)} className="chart-tick" textAnchor="end" dominantBaseline="middle">
              {t.toFixed(1)}
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke="var(--fat)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={x(p.t)} cy={y(p.v)} r={i === pts.length - 1 ? 4 : 2.5}
            fill={i === pts.length - 1 ? 'var(--fat)' : 'var(--surface)'} stroke="var(--fat)" strokeWidth="1.5" />
        ))}
      </svg>
      <div className="chart-meta">
        <span><b>{latest.toFixed(1)}</b> {unit} now</span>
        <span className={change <= 0 ? 'down' : 'up'}>
          {change === 0 ? '±0' : `${change < 0 ? '−' : '+'}${Math.abs(change).toFixed(1)}`} {unit} since start
        </span>
      </div>
    </div>
  )
}
