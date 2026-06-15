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
        user_id     TEXT PRIMARY KEY,
        weight_unit TEXT NOT NULL DEFAULT 'lb',
        goal        TEXT NOT NULL,
        target_cal  INTEGER NOT NULL,
        protein_g   INTEGER NOT NULL,
        carbs_g     INTEGER NOT NULL,
        fat_g       INTEGER NOT NULL,
        maintenance INTEGER NOT NULL,
        sex         TEXT,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
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

  const deltaLbs = last.weight_lbs - first.weight_lbs

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
  })

  const lostText =
    deltaLbs === 0
      ? 'held steady'
      : `${deltaLbs < 0 ? 'lost' : 'gained'} ${Math.abs(deltaLbs).toFixed(1)} lb`
  const message =
    `Over ${Math.round(days)} days you ${lostText} on ~${Math.round(avgIntake)} kcal/day. ` +
    `That puts your real maintenance near ${estTDEE} kcal (was ${prev}). ` +
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
