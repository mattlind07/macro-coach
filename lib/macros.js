// ============================================================
// macros.js — the deterministic nutrition engine
//
// Strategy: a weight-stable person's *current* intake ≈ their
// maintenance calories (TDEE). So we treat "current calories" as
// the baseline and adjust from there by goal. This avoids needing
// height/age/sex, though those refine the AI's reasoning if given.
//
// Framework:
//   lose  -> maintenance - 400 kcal   (~0.8 lb/week)
//   keep  -> maintenance
//   gain  -> maintenance + 250 kcal   (lean gain)
//   protein: 1.0 g/lb (cut), 0.8 (maintain), 0.9 (gain)  -- set FIRST
//   fat:     0.38 g/lb (cut), 0.35 (otherwise)
//   carbs:   fill the remaining calories
// ============================================================

const KCAL = { protein: 4, carbs: 4, fat: 9 }

export function toLbs(weight, unit) {
  return unit === 'kg' ? weight * 2.20462 : weight
}

// Clamp the calorie target to a safe floor and flag it.
function safeFloor(calories, sex) {
  // Conservative floors: under these, dieting gets risky / unsustainable.
  const floor = sex === 'female' ? 1200 : 1500
  return { calories: Math.max(calories, floor), hitFloor: calories < floor, floor }
}

export function computeMacros(input) {
  const {
    weight,
    unit = 'lb',
    currentCalories,
    goal = 'lose', // 'lose' | 'maintain' | 'gain'
    sex = 'unspecified',
  } = input

  const weightLbs = toLbs(weight, unit)
  const maintenance = currentCalories

  // 1) calorie target from goal
  const adjust = goal === 'lose' ? -400 : goal === 'gain' ? 250 : 0
  let target = maintenance + adjust

  const warnings = []
  const floored = safeFloor(target, sex)
  if (floored.hitFloor) {
    warnings.push(
      `Your target was pulled up to ${floored.floor} kcal — going lower than that while active tends to backfire (muscle loss, low energy, rebound).`
    )
    target = floored.calories
  }
  target = Math.round(target / 10) * 10 // round to nearest 10

  // 2) protein first (muscle priority)
  const proteinPerLb = goal === 'lose' ? 1.0 : goal === 'gain' ? 0.9 : 0.8
  const fatPerLb = goal === 'lose' ? 0.38 : 0.35
  const protein_g = Math.round(weightLbs * proteinPerLb)
  const proteinCal = protein_g * KCAL.protein

  // 3) fat next, then 4) carbs fill the remainder — but the macro calories
  //    must never exceed the target. If protein alone already eats the whole
  //    budget (a very heavy person at a very low target), keep protein and
  //    zero the rest rather than prescribing more food than the target allows.
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
    fat_g = Math.round(weightLbs * fatPerLb)
    // don't let fat push the total over the target
    if (fat_g * KCAL.fat > remaining) fat_g = Math.floor(remaining / KCAL.fat)
    const carbsCal = target - proteinCal - fat_g * KCAL.fat
    carbs_g = Math.round(Math.max(carbsCal, 0) / KCAL.carbs)
  }

  // sanity check on intake itself
  if (currentCalories < 1200) {
    warnings.push(
      `${currentCalories} kcal as a typical day is very low. If that's accurate, this tool's "maintenance = current intake" assumption may be off — you may already be in a deficit.`
    )
  }

  const rationale =
    `Your typical intake (${maintenance} kcal) is treated as maintenance. ` +
    (goal === 'lose'
      ? `For fat loss we drop ~400 kcal/day, roughly 0.8 lb/week. `
      : goal === 'gain'
      ? `For a lean gain we add ~250 kcal/day to grow muscle without much fat. `
      : `To hold steady we keep calories at maintenance. `) +
    `Protein is set first at ${proteinPerLb} g/lb to protect muscle, fat at ${fatPerLb} g/lb for hormones and satiety, and carbs fill the rest to fuel training.`

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
