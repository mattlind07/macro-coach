// Tests /api/calculate by stubbing global.fetch (the Gemini call) and
// process.env. Run: node tests/calculate.mjs
import handler from '../api/calculate.js'

let pass = 0, fail = 0
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}  ${detail}`) }
}

function mockRes() {
  return {
    statusCode: null, body: null,
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
  }
}
const VALID = { weight: 175, unit: 'lb', currentCalories: 2600, goal: 'lose', sex: 'male' }

// stub fetch to return a Gemini-shaped text payload
function stubGeminiText(text) {
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
  })
}
function stubGeminiHTTPError(status = 500) {
  global.fetch = async () => ({ ok: false, status, text: async () => 'server error' })
}

async function call(body) {
  const res = mockRes()
  await handler({ method: 'POST', body }, res)
  return res
}

console.log('\n— input validation —')
{
  delete process.env.GEMINI_API_KEY
  let r = await call({ ...VALID, weight: undefined })
  check('missing weight → 400', r.statusCode === 400, JSON.stringify(r.body))
  r = await call({ ...VALID, goal: 'bulk' })
  check('invalid goal → 400', r.statusCode === 400)
  r = await call({ ...VALID, currentCalories: 200 })
  check('absurd calories → 400', r.statusCode === 400)
  r = await call({ method: 'GET' })
}
{
  const res = mockRes()
  await handler({ method: 'GET' }, res)
  check('GET → 405', res.statusCode === 405)
}

console.log('\n— no API key → deterministic fallback —')
{
  delete process.env.GEMINI_API_KEY
  const r = await call(VALID)
  check('200 + source=fallback', r.statusCode === 200 && r.body.source === 'fallback', r.body.source)
  check('has all macro fields', ['calories', 'protein_g', 'carbs_g', 'fat_g'].every((k) => typeof r.body[k] === 'number'))
}

console.log('\n— API key set, well-formed AI JSON → source=ai —')
{
  process.env.GEMINI_API_KEY = 'test-key'
  stubGeminiText(JSON.stringify({
    calories: 2150, protein_g: 175, carbs_g: 180, fat_g: 67,
    rationale: 'Cut from maintenance.', warnings: [],
  }))
  const r = await call(VALID)
  check('source=ai', r.body.source === 'ai', r.body.source)
  check('uses AI calories (2150)', r.body.calories === 2150, String(r.body.calories))
  check('carries maintenance + delta', r.body.maintenance === 2600 && r.body.delta === 2150 - 2600)
}

console.log('\n— AI wraps JSON in ```json fences → still parses —')
{
  process.env.GEMINI_API_KEY = 'test-key'
  stubGeminiText('```json\n' + JSON.stringify({
    calories: 2200, protein_g: 175, carbs_g: 190, fat_g: 67, rationale: 'x', warnings: [],
  }) + '\n```')
  const r = await call(VALID)
  check('fenced JSON → source=ai', r.body.source === 'ai', r.body.source)
}

console.log('\n— malformed / unsafe AI output → safe fallback —')
{
  process.env.GEMINI_API_KEY = 'test-key'

  stubGeminiText('Sure! Here is your plan: eat less and move more.')
  check('non-JSON → fallback', (await call(VALID)).body.source === 'fallback')

  stubGeminiText(JSON.stringify({ calories: 2000 })) // missing macro fields
  check('missing fields → fallback', (await call(VALID)).body.source === 'fallback')

  stubGeminiText(JSON.stringify({ calories: 900, protein_g: 175, carbs_g: 10, fat_g: 20, warnings: [] }))
  check('below safe floor → fallback', (await call(VALID)).body.source === 'fallback')

  // macros that don't add up to the stated calories
  stubGeminiText(JSON.stringify({ calories: 2200, protein_g: 50, carbs_g: 50, fat_g: 10, warnings: [] }))
  check('inconsistent macros → fallback', (await call(VALID)).body.source === 'fallback')

  stubGeminiHTTPError(500)
  check('Gemini 500 → fallback', (await call(VALID)).body.source === 'fallback')

  global.fetch = async () => { throw new Error('network down') }
  check('network error → fallback', (await call(VALID)).body.source === 'fallback')
}

console.log(`\nCALCULATE: ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
