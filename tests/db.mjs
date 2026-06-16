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

console.log('\n— weigh-ins drive recalibration over time —')
{
  let r = await weighPost({ userId: A, weight: 185, unit: 'lb', calories: 1800, date: '2026-06-01' })
  check('1st weigh-in saved', r.statusCode === 200 && r.body.weighIns.length === 1)
  check('1 point → recalibration not applied', r.body.recalibration && r.body.recalibration.applied === false)

 r = await weighPost({ userId: A, weight: 184, unit: 'lb', calories: 1800, date: '2026-06-04' })
check('2nd weigh-in (3 days later) → applied with earlyData', r.body.recalibration.applied === true && r.body.recalibration.earlyData === true)

  r = await weighPost({ userId: A, weight: 183, unit: 'lb', calories: 1800, date: '2026-06-15' })
  check('3rd weigh-in (14d span) → recalibration APPLIED', r.body.recalibration.applied === true,
    JSON.stringify(r.body.recalibration))
  // lost 2lb over 14d on 1800 → TDEE ~2300 → lose target ~1900
  check('plan target updated to ~1900', Math.abs(r.body.plan.target_cal - 1900) <= 20,
    `target=${r.body.plan.target_cal}`)
  check('protein rescaled to ~183g (latest weight)', Math.abs(r.body.plan.protein_g - 183) <= 2,
    `protein=${r.body.plan.protein_g}`)
}

console.log('\n— recalibrated plan persists —')
{
  const g = await planGet(A)
  check('reloaded target reflects recalibration', Math.abs(g.body.plan.target_cal - 1900) <= 20,
    `target=${g.body.plan.target_cal}`)
  check('exactly 3 weigh-ins stored, ordered', g.body.weighIns.length === 3)
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
