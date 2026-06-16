// ============================================================
// db.js — Supabase Postgres access + the recalibration engine
//
// Uses postgres.js (the `postgres` npm package). Connect via the
// Supabase transaction pooler (port 6543); `prepare: false` is
// required because the pooler does not support prepared statements.
//
// Schema is created lazily on first use, so there's no separate
// migration step — just deploy and go.
// ============================================================

import postgres from 'postgres'
import { computeMacros } from './macros.js'

const CONN = process.env.DATABASE_URL || process.env.POSTGRES_URL
const KCAL_PER_LB = 3500 // approx energy in a pound of body mass

// One connection per warm serverless instance.
let _sql = null
// Test seam: lets integration tests inject a Postgres-compatible `sql` tagged
// template (e.g. backed by an in-process database). Never used in production.
let _override = null
export function __setSqlForTest(fn) {
  _override = fn
  _schemaReady = null // re-run schema against the injected db
}
export function db() {
  if (_override) return _override
  if (!CONN) throw new Error('No database URL set (DATABASE_URL / POSTGRES_URL).')
  if (!_sql) _sql = postgres(CONN, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10 })
  return _sql
}

// Create tables once per warm instance (cached promise).
let _schemaReady = null
export function ensureSchema() {
  if (_schemaReady) return _schemaReady
  const sql = db()
  _schemaReady = (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email         TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    await sql`
      CREATE TABLE IF NOT EXISTS plans (
        user_id          TEXT PRIMARY KEY,
        weight_unit      TEXT NOT NULL DEFAULT 'lb',
        goal             TEXT NOT NULL,
        target_cal       INTEGER NOT NULL,
        protein_g        INTEGER NOT NULL,
        carbs_g          INTEGER NOT NULL,
        fat_g            INTEGER NOT NULL,
        maintenance      INTEGER NOT NULL,
        sex              TEXT,
        age              INTEGER,
        activity         TEXT,
        weight           REAL,
        current_calories INTEGER,
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    // add columns that may be missing from existing deployments
    await sql`ALTER TABLE plans ADD COLUMN IF NOT EXISTS age INTEGER`
    await sql`ALTER TABLE plans ADD COLUMN IF NOT EXISTS activity TEXT`
    await sql`ALTER TABLE plans ADD COLUMN IF NOT EXISTS weight REAL`
    await sql`ALTER TABLE plans ADD COLUMN IF NOT EXISTS current_calories INTEGER`
    await sql`
      CREATE TABLE IF NOT EXISTS weigh_ins (
        id         BIGSERIAL PRIMARY KEY,
        user_id    TEXT NOT NULL,
        logged_on  DATE NOT NULL,
        weight_lbs REAL NOT NULL,
        calories   INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    await sql`CREATE INDEX IF NOT EXISTS idx_weighins_user ON weigh_ins (user_id, logged_on)`
  })()
  return _schemaReady
}

const MS_PER_DAY = 86400000

// Calendar-day key ('YYYY-MM-DD') for a logged_on value, whether it arrives
// as a Date object (from the pg driver) or an ISO string (from JSON).
function dayKey(loggedOn) {
  return new Date(loggedOn).toISOString().slice(0, 10)
}

function dayTime(key) {
  const [y, m, d] = key.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

// ---------------------------------------------------------------
// trendWeights(): 7-day rolling average ("trend weight") per calendar day.
// Smooths out single-day noise (water retention, sodium, sleep) so
// recalibrate() and the UI chart aren't skewed by one bad reading.
// Same-day duplicate weigh-ins are averaged into one point first so a day
// with two entries doesn't get double weight inside the window. Days with
// less than a full window of history just average over what exists.
// ---------------------------------------------------------------
export function trendWeights(weighIns, windowDays = 7) {
  const byDay = new Map()
  for (const w of weighIns) {
    const key = dayKey(w.logged_on)
    const entry = byDay.get(key) || { sum: 0, count: 0 }
    entry.sum += w.weight_lbs
    entry.count += 1
    byDay.set(key, entry)
  }

  const days = [...byDay.entries()]
    .map(([key, { sum, count }]) => ({ key, time: dayTime(key), weight_lbs: sum / count }))
    .sort((a, b) => a.time - b.time)

  const windowMs = (windowDays - 1) * MS_PER_DAY

  return days.map((d, i) => {
    let sum = 0, count = 0
    for (let j = i; j >= 0 && d.time - days[j].time <= windowMs; j--) {
      sum += days[j].weight_lbs
      count++
    }
    return { logged_on: d.key, weight_lbs: d.weight_lbs, trend: sum / count }
  })
}

// attachTrend(): merges each raw weigh-in row with its day's trend value, for
// API responses where the UI needs both the raw point and the smoothed line.
export function attachTrend(weighIns) {
  const trends = new Map(trendWeights(weighIns).map((t) => [t.logged_on, t.trend]))
  return weighIns.map((w) => ({ ...w, trend: trends.get(dayKey(w.logged_on)) ?? null }))
}

// ---------------------------------------------------------------
// recalibrate(): the interesting part.
//
// Energy balance over a window: (avgIntake − TDEE) × days = ΔweightLbs × 3500.
// Rearranged, we can MEASURE maintenance from observed data:
//     TDEE ≈ avgIntake − (ΔweightLbs × 3500 / days)
//
// Example: ate ~2200 kcal/day, dropped 2 lb over 14 days.
//   ΔweightLbs = −2,  days = 14
//   TDEE = 2200 − (−2 × 3500 / 14) = 2200 + 500 = 2700 kcal
//   → real maintenance is ~2700, not the 2200 they're eating.
//
// We then re-run the goal math off that measured TDEE, scale protein/
// fat to their LATEST bodyweight, and dampen the move to ±250 kcal so
// a single water-weight blip can't swing the target wildly.
// ---------------------------------------------------------------
export function recalibrate(plan, weighIns) {
  const sorted = [...weighIns].sort((a, b) => new Date(a.logged_on) - new Date(b.logged_on))

  // Need at least two points spanning a real stretch of time.
  if (sorted.length < 2) {
    return { applied: false, reason: 'Need at least 2 weigh-ins to estimate your real maintenance.' }
  }

  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const days = (new Date(last.logged_on) - new Date(first.logged_on)) / 86400000

  if (days < 1) {
    return { applied: false, reason: 'Log weigh-ins on at least two different days to start calculating.' }
  }

  // trend weight (7-day rolling average) instead of raw first/last points,
  // so a single noisy reading on either end can't skew the estimate.
  const trends = trendWeights(sorted)
  const deltaLbs = trends[trends.length - 1].trend - trends[0].trend

  // average intake across the window. Per design choice: a weigh-in WITHOUT
  // logged calories is assumed to have hit the plan target — so we impute the
  // target for those, then average across ALL weigh-ins (not just logged ones).
  const avgIntake =
    sorted.reduce(
      (sum, w) => sum + (typeof w.calories === 'number' && w.calories > 0 ? w.calories : plan.target_cal),
      0
    ) / sorted.length

  // measured maintenance
  let estTDEE = avgIntake - (deltaLbs * KCAL_PER_LB) / days

  // dampen vs current estimate so we converge instead of swinging
  const prev = plan.maintenance
  const cap = 250
  if (Math.abs(estTDEE - prev) > cap) estTDEE = prev + Math.sign(estTDEE - prev) * cap
  estTDEE = Math.round(estTDEE / 10) * 10

  // re-run goal math off measured maintenance, scaled to current weight
  const fresh = computeMacros({
    weight: last.weight_lbs,
    unit: 'lb',
    currentCalories: estTDEE,
    goal: plan.goal,
    sex: plan.sex || 'unspecified',
    age: plan.age || undefined,
    activity: plan.activity || undefined,
  })

  const lostText =
    deltaLbs === 0
      ? 'held steady'
      : `${deltaLbs < 0 ? 'lost' : 'gained'} ${Math.abs(deltaLbs).toFixed(1)} lb`

  // If today's raw reading is well off the smoothed trend, say so explicitly —
  // otherwise someone who just stepped on the scale at 183 will be confused why
  // the message above only mentions a 0.4 lb move.
  const latestRaw = last.weight_lbs
  const latestTrend = trends[trends.length - 1].trend
  const noiseNote =
    Math.abs(latestRaw - latestTrend) >= 1
      ? ` Your latest scale reading was ${latestRaw.toFixed(1)} lb — day-to-day swings like that are normal noise, so the smoothed trend is what drives this number.`
      : ''

  const message =
    `Over ${Math.round(days)} days your weight trend ${lostText} on ~${Math.round(avgIntake)} kcal/day. ` +
    `That puts your real maintenance near ${estTDEE} kcal (was ${prev}).${noiseNote} ` +
    `New ${plan.goal} target: ${fresh.calories} kcal.`

  return {
    applied: true,
    earlyData: days < 7,
    estimatedTDEE: estTDEE,
    previousMaintenance: prev,
    newPlan: {
      target_cal: fresh.calories,
      protein_g: fresh.protein_g,
      carbs_g: fresh.carbs_g,
      fat_g: fresh.fat_g,
      maintenance: estTDEE,
    },
    message,
  }
}
