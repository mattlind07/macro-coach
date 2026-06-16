// Trend-weight tests — no network, no DB. Run: node tests/trend.mjs
import { trendWeights, attachTrend, recalibrate } from '../lib/db.js'

let pass = 0, fail = 0
const approx = (a, b, t = 0.5) => Math.abs(a - b) <= t
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}  ${detail}`) }
}

const w = (date, weight_lbs) => ({ logged_on: date, weight_lbs })

console.log('\n— trendWeights: rolling 7-day average over consecutive days —')
{
  // flat 200lb for 6 days, then a +3lb spike on day 7
  const days = ['01', '02', '03', '04', '05', '06', '07']
  const weighIns = days.slice(0, 6).map((d) => w(`2026-01-${d}`, 200)).concat([w('2026-01-07', 203)])
  const trends = trendWeights(weighIns)
  check('one trend point per day', trends.length === 7, `len=${trends.length}`)
  check('day 1 trend = itself (no prior history)', approx(trends[0].trend, 200))
  // day7 trend = avg(200,200,200,200,200,200,203) = 200.43
  check('day 7 trend pulled only slightly by the spike', approx(trends[6].trend, 200.43, 0.1),
    `trend=${trends[6].trend}`)
  check('day 7 trend far below the raw spike value', trends[6].trend < 201, `trend=${trends[6].trend}`)
}

console.log('\n— trendWeights: same-day duplicates are averaged before windowing —')
{
  const weighIns = [w('2026-02-01', 180), w('2026-02-01', 182)]
  const trends = trendWeights(weighIns)
  check('duplicate same-day entries collapse to one point', trends.length === 1, `len=${trends.length}`)
  check('collapsed weight is the average', approx(trends[0].weight_lbs, 181))
  check('trend matches the collapsed average', approx(trends[0].trend, 181))
}

console.log('\n— trendWeights: fewer than 7 days of history degrades gracefully —')
{
  const weighIns = [w('2026-03-01', 150), w('2026-03-02', 152), w('2026-03-03', 151)]
  const trends = trendWeights(weighIns)
  // day 3 trend should average all 3 available days, not pad with zeros
  check('short-history trend averages only real data', approx(trends[2].trend, 151), `trend=${trends[2].trend}`)
}

console.log('\n— attachTrend: merges trend onto raw rows —')
{
  const weighIns = [w('2026-04-01', 170), w('2026-04-02', 172)]
  const withTrend = attachTrend(weighIns)
  check('every row gets a trend field', withTrend.every((r) => typeof r.trend === 'number'))
  check('raw weight_lbs untouched', withTrend[0].weight_lbs === 170 && withTrend[1].weight_lbs === 172)
}

console.log('\n— recalibrate: a single-day outlier no longer skews the estimate —')
{
  // Flat real weight (180lb) for 9 days, eating right at maintenance (2500),
  // then a one-day +3lb water/sodium spike on day 10. True maintenance hasn't
  // moved; the trend-weight delta should stay small, keeping estTDEE close to
  // the prior maintenance instead of swinging toward a large "gained weight" read.
  const plan = { maintenance: 2500, goal: 'maintain', sex: 'unspecified', target_cal: 2500 }
  const weighIns = []
  for (let d = 1; d <= 9; d++) weighIns.push({ logged_on: `2026-05-0${d}`, weight_lbs: 180, calories: 2500 })
  weighIns.push({ logged_on: '2026-05-10', weight_lbs: 183, calories: 2500 })

  const recal = recalibrate(plan, weighIns)
  check('recalibration applied', recal.applied === true, JSON.stringify(recal))
  // raw first/last math would have estimated TDEE near 1333 kcal (a huge, wrong
  // swing) and hit the damping floor of 2250; trend smoothing should land
  // noticeably above that, close to the true flat maintenance of 2500.
  check('estimated TDEE stays close to true maintenance, not skewed by the spike',
    recal.estimatedTDEE >= 2300, `estimatedTDEE=${recal.estimatedTDEE}`)
}

console.log(`\nTREND: ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
