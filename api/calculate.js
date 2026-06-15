// ============================================================
// /api/calculate  — Vercel serverless function (Node)
//
// Flow:
//   1. validate input
//   2. compute a deterministic baseline (lib/macros.js)
//   3. if GEMINI_API_KEY is set, ask Gemini to personalize the
//      numbers + write the rationale, returning STRICT JSON
//   4. validate Gemini's JSON; if anything is off or the key is
//      missing, fall back to the deterministic result
//
// The app therefore works with OR without an API key — add the key
// to turn the "wrapper" on. Set it in Vercel: Project > Settings >
// Environment Variables > GEMINI_API_KEY.
// ============================================================

import { computeMacros, toLbs } from '../lib/macros.js'

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST.' })
    return
  }

  // --- validate -------------------------------------------------
  const body = typeof req.body === 'string' ? safeParse(req.body) : req.body || {}
  const { weight, unit, currentCalories, goal, sex, activity, age } = body

  const v = validate({ weight, unit, currentCalories, goal })
  if (v) {
    res.status(400).json({ error: v })
    return
  }

  // --- deterministic baseline (also the fallback) ---------------
  const baseline = computeMacros({ weight, unit, currentCalories, goal, sex, age, activity })

  // --- no key? return the deterministic answer ------------------
  if (!process.env.GEMINI_API_KEY) {
    res.status(200).json({ ...baseline, source: 'fallback' })
    return
  }

  // --- AI wrapper ----------------------------------------------
  try {
    const ai = await askGemini({ weight, unit, currentCalories, goal, sex, activity, age, baseline })
    res.status(200).json({ ...ai, maintenance: currentCalories, delta: ai.calories - currentCalories, source: 'ai' })
  } catch (err) {
    // Never fail the user — degrade to the deterministic result.
    console.error('AI call failed, using fallback:', err?.message)
    res.status(200).json({ ...baseline, source: 'fallback' })
  }
}

// ---------------------------------------------------------------
function validate({ weight, unit, currentCalories, goal }) {
  if (typeof weight !== 'number' || weight <= 0 || weight > 1500) return 'Enter a valid weight.'
  if (unit && !['lb', 'kg'].includes(unit)) return 'Unit must be lb or kg.'
  if (typeof currentCalories !== 'number' || currentCalories < 800 || currentCalories > 8000)
    return 'Enter your typical daily calories (800–8000).'
  if (!['lose', 'maintain', 'gain'].includes(goal)) return 'Pick a goal.'
  return null
}

function safeParse(s) {
  try { return JSON.parse(s) } catch { return {} }
}

// ---------------------------------------------------------------
async function askGemini({ weight, unit, currentCalories, goal, sex, activity, age, baseline }) {
  const weightLbs = Math.round(toLbs(weight, unit))

  const system =
    `You are a sports-nutrition coach. Given a person's weight, typical daily ` +
    `calories, and goal, return a daily calorie target and a protein/carbs/fat split.\n\n` +
    `RULES (follow exactly):\n` +
    `- Treat their CURRENT typical intake as maintenance/TDEE (assume roughly weight-stable).\n` +
    `- lose: maintenance minus 300-500 kcal. gain: maintenance plus 200-350 kcal. maintain: maintenance.\n` +
    `- Set PROTEIN first: ~1.0 g/lb when losing, ~0.8 g/lb maintaining, ~0.9 g/lb gaining.\n` +
    `- Set FAT next: ~0.35-0.4 g/lb. Fill the remaining calories with CARBS.\n` +
    `- protein*4 + carbs*4 + fat*9 must come within ~50 kcal of the calorie target.\n` +
    `- Never put the target below 1500 kcal (male) or 1200 (female); warn if you had to clamp.\n` +
    `- Use any optional info (sex, age, activity) to refine within those ranges.\n\n` +
    `Respond with STRICT JSON ONLY — no prose, no markdown, no backticks. Schema:\n` +
    `{"calories": int, "protein_g": int, "carbs_g": int, "fat_g": int, ` +
    `"rationale": "2-4 plain sentences on the why", "warnings": ["..."]}`

  const userMsg =
    `Weight: ${weightLbs} lb\n` +
    `Typical daily calories: ${currentCalories} kcal\n` +
    `Goal: ${goal}\n` +
    `Sex: ${sex || 'unspecified'}\n` +
    `Age: ${age || 'unspecified'}\n` +
    `Activity: ${activity || 'unspecified'}\n\n` +
    `For reference, a baseline formula produced: ${baseline.calories} kcal, ` +
    `${baseline.protein_g}P / ${baseline.carbs_g}C / ${baseline.fat_g}F. ` +
    `You may adjust within the rules. Return JSON only.`

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: userMsg }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        maxOutputTokens: 1024,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  })

  if (!r.ok) throw new Error(`Gemini ${r.status}: ${await r.text()}`)

  const data = await r.json()
  const text = data.candidates[0].content.parts[0].text.trim()

  const parsed = JSON.parse(stripFences(text))

  // validate the shape before trusting it
  const need = ['calories', 'protein_g', 'carbs_g', 'fat_g']
  for (const k of need) {
    if (typeof parsed[k] !== 'number' || !isFinite(parsed[k])) throw new Error(`bad field ${k}`)
  }

  // SAFETY: the model is told not to go below the floor, but enforce it here
  // too. If it returned an unsafe target or macros that don't add up, throw —
  // the caller catches this and serves the safe deterministic result instead.
  const floor = sex === 'female' ? 1200 : 1500
  if (parsed.calories < floor - 25) throw new Error('AI target below safe floor')
  const sumCal = parsed.protein_g * 4 + parsed.carbs_g * 4 + parsed.fat_g * 9
  if (Math.abs(sumCal - parsed.calories) > 250) throw new Error('AI macros inconsistent with calories')

  return {
    calories: Math.round(parsed.calories),
    protein_g: Math.round(parsed.protein_g),
    carbs_g: Math.round(parsed.carbs_g),
    fat_g: Math.round(parsed.fat_g),
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale : baseline.rationale,
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter((w) => typeof w === 'string') : [],
  }
}

// strip ```json fences if the model adds them despite instructions
function stripFences(t) {
  return t.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
}
