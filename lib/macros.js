const KCAL = { protein: 4, carbs: 4, fat: 9 }

// Per-activity calorie adjustment and macro targets.
// Lose deficit: active people burn calories through exercise so a smaller food
// cut is enough; sedentary people have no exercise to rely on, so they need a
// bigger food-based deficit to move the scale.
// Gain surplus: active people with real training stimulus can channel a larger
// surplus into muscle; sedentary people mostly store extra calories as fat.
const ACTIVITY = {
  sedentary:     { lose: -500, gain: 150, protein: { lose: 0.80, maintain: 0.70, gain: 0.80 }, fat: 0.40 },
  light:         { lose: -425, gain: 200, protein: { lose: 0.90, maintain: 0.75, gain: 0.85 }, fat: 0.38 },
  moderate:      { lose: -400, gain: 250, protein: { lose: 1.00, maintain: 0.80, gain: 0.90 }, fat: 0.35 },
  'very active': { lose: -300, gain: 300, protein: { lose: 1.10, maintain: 0.90, gain: 1.00 }, fat: 0.32 },
}
const DEFAULT_ACTIVITY = ACTIVITY.moderate

export function toLbs(weight, unit) {
  return unit === 'kg' ? weight * 2.20462 : weight
}

function safeFloor(calories, sex) {
  const floor = sex === 'female' ? 1200 : 1500
  return { calories: Math.max(calories, floor), hitFloor: calories < floor, floor }
}

export function computeMacros(input) {
  const {
    weight,
    unit = 'lb',
    currentCalories,
    goal = 'lose',
    sex = 'unspecified',
    age,
    activity,
  } = input

  const weightLbs = toLbs(weight, unit)
  const maintenance = currentCalories
  const act = ACTIVITY[activity] || DEFAULT_ACTIVITY

  // 1) calorie target: base goal adjustment scaled by activity level
  const adjust = goal === 'lose' ? act.lose : goal === 'gain' ? act.gain : 0
  let target = maintenance + adjust

  const warnings = []
  const floored = safeFloor(target, sex)
  if (floored.hitFloor) {
    warnings.push(
      `Your target was pulled up to ${floored.floor} kcal — going lower than that while active tends to backfire (muscle loss, low energy, rebound).`
    )
    target = floored.calories
  }
  target = Math.round(target / 10) * 10

  // 2) protein: activity-based g/lb, bumped +0.10 for 50+ to offset muscle loss
  let proteinPerLb = act.protein[goal]
  if (age && age >= 50) proteinPerLb = Math.min(proteinPerLb + 0.10, 1.30)
  const protein_g = Math.round(weightLbs * proteinPerLb)
  const proteinCal = protein_g * KCAL.protein

  // 3) fat at activity-adjusted g/lb, then 4) carbs fill the rest
  let fat_g
  let carbs_g
  const remaining = target - proteinCal
  if (remaining <= 0) {
    fat_g = 0
    carbs_g = 0
    warnings.push(
      `At ${target} kcal, protein alone (${protein_g} g) already uses your whole budget. ` +
      `That's very low for your size — consider a smaller deficit or a higher target.`
    )
  } else {
    fat_g = Math.round(weightLbs * act.fat)
    if (fat_g * KCAL.fat > remaining) fat_g = Math.floor(remaining / KCAL.fat)
    const carbsCal = target - proteinCal - fat_g * KCAL.fat
    carbs_g = Math.round(Math.max(carbsCal, 0) / KCAL.carbs)
  }

  if (currentCalories < 1200) {
    warnings.push(
      `${currentCalories} kcal as a typical day is very low. If that's accurate, this tool's "maintenance = current intake" assumption may be off — you may already be in a deficit.`
    )
  }

  const actLabel = activity || 'moderate'
  const ageNote = age && age >= 50 ? ` Protein is bumped slightly to help offset age-related muscle loss.` : ''
  const rationale =
    `Your typical intake (${maintenance} kcal) is treated as maintenance. ` +
    (goal === 'lose'
      ? `At a ${actLabel} activity level we drop ${Math.abs(act.lose)} kcal/day from food (~${((Math.abs(act.lose) / 3500) * 7).toFixed(1)} lb/week) — exercise handles the rest. `
      : goal === 'gain'
      ? `At a ${actLabel} activity level we add ${act.gain} kcal/day to support muscle growth. `
      : `To hold steady we keep calories at maintenance. `) +
    `Protein is set first at ${proteinPerLb.toFixed(2)} g/lb to protect muscle${ageNote}, fat at ${act.fat} g/lb for hormones and satiety, and carbs fill the rest to fuel training.`

  return {
    calories: target,
    maintenance,
    delta: target - maintenance,
    protein_g,
    carbs_g,
    fat_g,
    rationale,
    warnings,
  }
}
