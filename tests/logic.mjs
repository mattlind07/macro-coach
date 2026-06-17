// Logic tests — no network, no DB. Run: node tests/logic.mjs
import { computeMacros, toLbs } from '../lib/macros.js'
import { recalibrate } from '../lib/db.js'

let pass = 0, fail = 0
const approx = (a, b, t = 1) => Math.abs(a - b) <= t
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}  ${detail}`) }
}

console.log('\n— macros: sum never exceeds target —')
for (const goal of ['lose', 'maintain', 'gain']) {
  for (const [w, c] of [[120, 1600], [175, 2600], [250, 2200], [300, 1900], [110, 1300]]) {
    const r = computeMacros({ weight: w, unit: 'lb', currentCalories: c, goal, sex: 'male' })
    const sum = r.protein_g * 4 + r.carbs_g * 4 + r.fat_g * 9
    check(`${goal} ${w}lb/${c}kcal: macros (${sum}) ≤ target (${r.calories})`, sum <= r.calories + 4,
      `sum=${sum} target=${r.calories}`)
    check(`  ...and reasonably close (no big shortfall)`, r.calories - sum <= 60 || r.warnings.length > 0,
      `gap=${r.calories - sum}`)
    check(`  ...no negative macros`, r.protein_g >= 0 && r.carbs_g >= 0 && r.fat_g >= 0)
  }
}

console.log('\n— macros: extreme case (heavy + low intake) keeps protein, warns —')
const ext = computeMacros({ weight: 320, unit: 'lb', currentCalories: 1600, goal: 'lose', sex: 'male' })
check('extreme: carbs floored to 0 or low', ext.carbs_g >= 0)
check('extreme: total ≤ target', ext.protein_g * 4 + ext.carbs_g * 4 + ext.fat_g * 9 <= ext.calories + 4)
check('extreme: produced a warning', ext.warnings.length > 0)

console.log('\n— macros: unit conversion —')
check('150kg ≈ 330.7lb', approx(toLbs(150, 'kg'), 330.69, 0.1))
const kg = computeMacros({ weight: 80, unit: 'kg', currentCalories: 2500, goal: 'lose' })
const lb = computeMacros({ weight: 80 * 2.20462, unit: 'lb', currentCalories: 2500, goal: 'lose' })
check('kg and equivalent lb give same protein', kg.protein_g === lb.protein_g, `${kg.protein_g} vs ${lb.protein_g}`)

console.log('\n— macros: safety floor —')
const fl = computeMacros({ weight: 110, unit: 'lb', currentCalories: 1400, goal: 'lose', sex: 'female' })
check('female cut floored at 1200', fl.calories >= 1200)
check('floor produced a warning', fl.warnings.some((w) => /pulled up/i.test(w)))

console.log('\n— recalibrate: guards —')
const plan = { goal: 'lose', target_cal: 1800, maintenance: 2200, sex: 'male', weight_unit: 'lb' }
check('single entry → not applied', recalibrate(plan, [{ logged_on: '2026-06-01', weight_lbs: 185, calories: 1800 }]).applied === false)
check('2 entries / 3-day span → not applied (need 7)', (() => {
  const r = recalibrate(plan, [
    { logged_on: '2026-06-01', weight_lbs: 185, calories: 1800 },
    { logged_on: '2026-06-04', weight_lbs: 184, calories: 1800 },
  ])
  return r.applied === false
})())

check('same-day entries still blocked', recalibrate(plan, [
  { logged_on: '2026-06-01', weight_lbs: 185, calories: 1800 },
  { logged_on: '2026-06-01', weight_lbs: 185, calories: 1800 },
]).applied === false)

// Helper: 7 entries every 2 days (Jun 1, 3, 5, 7, 9, 11, 13 = 12-day window)
const sevenEntries = (weights, cals = 1800) =>
  ['2026-06-01','2026-06-03','2026-06-05','2026-06-07','2026-06-09','2026-06-11','2026-06-13']
    .map((date, i) => ({ logged_on: date, weight_lbs: weights[i], calories: cals }))

console.log('\n— recalibrate: measures maintenance + damps —')
// Slow loss: trend moves ~-0.2 lb over 12 days → raw TDEE 1858 → capped at 2200-250=1950
const slow = recalibrate(plan, sevenEntries([185.0, 185.0, 184.9, 184.9, 184.8, 184.8, 184.7]))
check('slow loss → maintenance revised DOWN from 2200', slow.estimatedTDEE < 2200, `est=${slow.estimatedTDEE}`)
check('slow loss → damped by ≤250', slow.estimatedTDEE >= 2200 - 250)
// Fast loss: trend moves ~-2.25 lb over 12 days → raw TDEE 2456 → capped at 2200+250=2450
const fast = recalibrate(plan, sevenEntries([185.0, 184.5, 184.0, 183.5, 183.0, 182.5, 182.0]))
check('fast loss → maintenance revised UP', fast.estimatedTDEE > 2200, `est=${fast.estimatedTDEE}`)
check('fast loss → damped to +250 cap', fast.estimatedTDEE <= 2200 + 250)

console.log('\n— recalibrate: imputes target for unlogged entries —')
// 7 entries Jun 1–8 (7-day span); first has 2500 kcal, rest null → avgIntake = (2500 + 6*1800)/7 = 1900
const mixedEntries = ['2026-06-01','2026-06-02','2026-06-03','2026-06-04','2026-06-05','2026-06-06','2026-06-08']
  .map((date, i) => ({ logged_on: date, weight_lbs: [185.0,185.0,184.9,184.9,184.8,184.8,184.7][i], calories: i === 0 ? 2500 : null }))
const mixed = recalibrate(plan, mixedEntries)
check('mixed week avgIntake imputes target (≈1900 in message)', /1900 kcal\/day/.test(mixed.message), mixed.message)

console.log(`\nLOGIC: ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
