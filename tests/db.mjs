// Integration test: runs the REAL /api/plan and /api/weighin handlers against
// a real Postgres engine (PGlite, in-process WASM). Run: node tests/db.mjs
import { PGlite } from '@electric-sql/pglite'
import { __setSqlForTest } from '../lib/db.js'
import planHandler from '../api/plan.js'
import weighinHandler from '../api/weighin.js'

let pass = 0, fail = 0
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}  ${detail}`) }
}

// --- wire a Postgres-compatible tagged-template `sql` over PGlite ---
const pg = new PGlite()
const taggedQuery = (runner) => async (strings, ...values) => {
  let text = strings[0]
  for (let i = 0; i < values.length; i++) text += '$' + (i + 1) + strings[i + 1]
  const res = await runner(text, values)
  return res.rows
}
const sql = taggedQuery((text, values) => pg.query(text, values))
// postgres.js exposes sql.begin(async tx => {...}); mirror it here using PGlite's
// real transaction support so a thrown error actually rolls back, same as prod.
sql.begin = (callback) => pg.transaction((tx) => callback(taggedQuery((text, values) => tx.query(text, values))))
__setSqlForTest(sql)

function mockRes() {
  return {
    statusCode: null, body: null,
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
  }
}
const planGet = (userId) => { const r = mockRes(); return planHandler({ method: 'GET', query: { userId } }, r).then(() => r) }
const planPost = (body) => { const r = mockRes(); return planHandler({ method: 'POST', body }, r).then(() => r) }
const weighPost = (body) => { const r = mockRes(); return weighinHandler({ method: 'POST', body }, r).then(() => r) }

const A = 'user-A'
const B = 'user-B'

console.log('\n— fresh user has no plan —')
{
  const r = await planGet(A)
  check('GET → 200', r.statusCode === 200, JSON.stringify(r.body))
  check('plan is null, no weigh-ins', r.body.plan === null && r.body.weighIns.length === 0)
}

console.log('\n— save a plan, then read it back —')
{
  const r = await planPost({
    userId: A, weightUnit: 'lb', goal: 'lose',
    target_cal: 1800, protein_g: 185, carbs_g: 150, fat_g: 70, maintenance: 2200, sex: 'male',
  })
  check('POST plan → 200', r.statusCode === 200, JSON.stringify(r.body))
  check('returns saved target', r.body.plan.target_cal === 1800)

  const g = await planGet(A)
  check('GET now returns the plan', g.body.plan && g.body.plan.goal === 'lose')
  check('maintenance persisted', g.body.plan.maintenance === 2200)
}

console.log('\n— upsert: saving again replaces, not duplicates —')
{
  await planPost({
    userId: A, weightUnit: 'lb', goal: 'maintain',
    target_cal: 2200, protein_g: 150, carbs_g: 250, fat_g: 70, maintenance: 2200, sex: 'male',
  })
  const all = await pg.query('SELECT count(*)::int AS n FROM plans WHERE user_id=$1', [A])
  check('still exactly one plan row', all.rows[0].n === 1, `rows=${all.rows[0].n}`)
  // put it back to the lose plan for the recalibration scenario
  await planPost({
    userId: A, weightUnit: 'lb', goal: 'lose',
    target_cal: 1800, protein_g: 185, carbs_g: 150, fat_g: 70, maintenance: 2200, sex: 'male',
  })
}

console.log('\n— weigh-ins accumulate but need 7 entries over 7 days before recalibrating —')
{
  let r = await weighPost({ userId: A, weight: 185, unit: 'lb', calories: 1800, date: '2026-06-01' })
  check('1st weigh-in saved', r.statusCode === 200 && r.body.weighIns.length === 1)
  check('1 point → not applied', r.body.recalibration && r.body.recalibration.applied === false)

  r = await weighPost({ userId: A, weight: 184, unit: 'lb', calories: 1800, date: '2026-06-04' })
  check('2nd weigh-in (3 days later) → not enough data yet', r.body.recalibration.applied === false)

  r = await weighPost({ userId: A, weight: 183, unit: 'lb', calories: 1800, date: '2026-06-15' })
  check('3rd weigh-in (14d span, only 3 entries) → still not enough', r.body.recalibration.applied === false)
}

console.log('\n— plan unchanged before minimum data threshold is reached —')
{
  const g = await planGet(A)
  check('target stays at original 1800', g.body.plan.target_cal === 1800, `target=${g.body.plan.target_cal}`)
  check('exactly 3 weigh-ins stored', g.body.weighIns.length === 3)
}

console.log('\n— daily-noise regression: overeating + water-weight gain must NOT drop target —')
{
  const D = 'user-D'
  await planPost({
    userId: D, weightUnit: 'lb', goal: 'lose',
    target_cal: 1900, protein_g: 188, carbs_g: 160, fat_g: 75, maintenance: 2300, sex: 'male', activity: 'moderate',
  })
  await weighPost({ userId: D, weight: 188.0, unit: 'lb', calories: 2100, date: '2026-06-15' })
  await weighPost({ userId: D, weight: 188.9, unit: 'lb', calories: 2100, date: '2026-06-16' })
  const r = await weighPost({ userId: D, weight: 189.0, unit: 'lb', calories: 2100, date: '2026-06-17' })
  check('3 noisy weigh-ins → not applied (original bug)', r.body.recalibration.applied === false,
    JSON.stringify(r.body.recalibration))
  check('target NOT dropped', r.body.plan.target_cal === 1900, `target=${r.body.plan.target_cal}`)
}

console.log('\n— valid recalibration: 7 weigh-ins over 7 days with real trend —')
{
  const E = 'user-E'
  await planPost({
    userId: E, weightUnit: 'lb', goal: 'lose',
    target_cal: 1800, protein_g: 185, carbs_g: 150, fat_g: 70, maintenance: 2200, sex: 'male', activity: 'moderate',
  })
  // Jun 1–8 (7 entries over 7 days) → Jun 1 to Jun 8 = 7-day span, passes both guards
  const days = [
    { w: 185.0, date: '2026-06-01' },
    { w: 184.5, date: '2026-06-02' },
    { w: 184.2, date: '2026-06-03' },
    { w: 183.8, date: '2026-06-04' },
    { w: 183.5, date: '2026-06-05' },
    { w: 183.2, date: '2026-06-06' },
    { w: 182.9, date: '2026-06-08' },
  ]
  let r
  for (const { w, date } of days) {
    r = await weighPost({ userId: E, weight: w, unit: 'lb', calories: 1800, date })
  }
  check('7th weigh-in → recalibration applied', r.body.recalibration.applied === true,
    JSON.stringify(r.body.recalibration))
  check('estTDEE near 2450 (cap from 2200+250)', Math.abs(r.body.recalibration.estimatedTDEE - 2450) <= 50,
    `estTDEE=${r.body.recalibration.estimatedTDEE}`)
  check('new target near 2050 (TDEE - 400)', Math.abs(r.body.plan.target_cal - 2050) <= 30,
    `target=${r.body.plan.target_cal}`)
  check('last_recalibrated_on set to 2026-06-08', r.body.recalibration.newPlan.last_recalibrated_on === '2026-06-08',
    `last_recalibrated_on=${r.body.recalibration.newPlan.last_recalibrated_on}`)
}

console.log('\n— recalibration cadence: must not fire again within 7 days —')
{
  const E = 'user-E'
  // 8th weigh-in 2 days after last recal (Jun 8) → blocked
  const r8 = await weighPost({ userId: E, weight: 182.6, unit: 'lb', calories: 1800, date: '2026-06-10' })
  check('weigh-in 2 days after recal → not applied (too soon)', r8.body.recalibration.applied === false,
    JSON.stringify(r8.body.recalibration))

  // 9th weigh-in 8 days after last recal (Jun 8 + 8 = Jun 16) → allowed (9 entries, 15-day span)
  const r9 = await weighPost({ userId: E, weight: 182.2, unit: 'lb', calories: 1800, date: '2026-06-16' })
  check('weigh-in 8 days after last recal → applied again', r9.body.recalibration.applied === true,
    JSON.stringify(r9.body.recalibration))
}

console.log('\n— weigh-in WITHOUT a saved plan —')
{
  const r = await weighPost({ userId: B, weight: 200, unit: 'lb', date: '2026-06-01' })
  check('200, history returned', r.statusCode === 200 && r.body.weighIns.length === 1)
  check('no plan → recalibration null', r.body.plan === null && r.body.recalibration === null)
}

console.log('\n— kg weigh-in stored normalized to lbs —')
{
  await planPost({
    userId: 'user-kg', weightUnit: 'kg', goal: 'lose',
    target_cal: 1800, protein_g: 170, carbs_g: 150, fat_g: 65, maintenance: 2200, sex: 'male',
  })
  await weighPost({ userId: 'user-kg', weight: 80, unit: 'kg', date: '2026-06-01' })
  const row = await pg.query('SELECT weight_lbs FROM weigh_ins WHERE user_id=$1', ['user-kg'])
  check('80kg stored as ~176.4lb', Math.abs(row.rows[0].weight_lbs - 176.37) < 0.1, `lbs=${row.rows[0].weight_lbs}`)
}

console.log('\n— validation —')
{
  let r = await weighPost({ userId: A }) // no weight
  check('weigh-in missing weight → 400', r.statusCode === 400)
  r = await weighPost({ weight: 180 }) // no userId
  check('weigh-in missing userId → 400', r.statusCode === 400)
  r = await planPost({ userId: A }) // missing plan fields
  check('plan POST missing fields → 400', r.statusCode === 400)
  r = await planGet(undefined) // no userId
  check('plan GET missing userId → 400', r.statusCode === 400)
}

console.log(`\nDB INTEGRATION: ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
