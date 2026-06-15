// /api/weighin — POST { userId, weight, unit, calories?, date? }
// Inserts the weigh-in, recomputes maintenance from history, and if there's
// enough data, updates the stored plan. Returns the full updated state.
import { db, ensureSchema, recalibrate } from '../lib/db.js'
import { toLbs } from '../lib/macros.js'

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'DELETE') return res.status(405).json({ error: 'Use POST or DELETE.' })

  try {
    await ensureSchema()
    const sql = db()

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}

    if (req.method === 'DELETE') {
      const { userId, id } = body
      if (!userId || !id) return res.status(400).json({ error: 'userId and id required' })

      await sql`DELETE FROM weigh_ins WHERE id = ${id} AND user_id = ${userId}`

      const plans = await sql`SELECT * FROM plans WHERE user_id = ${userId}`
      const plan = plans[0]
      const weighIns = await sql`
        SELECT id, logged_on, weight_lbs, calories
        FROM weigh_ins WHERE user_id = ${userId}
        ORDER BY logged_on ASC`

      if (!plan) return res.status(200).json({ plan: null, weighIns, recalibration: null })

      const recal = recalibrate(plan, weighIns)
      if (recal.applied) {
        await sql`
          UPDATE plans SET
            target_cal  = ${recal.newPlan.target_cal},
            protein_g   = ${recal.newPlan.protein_g},
            carbs_g     = ${recal.newPlan.carbs_g},
            fat_g       = ${recal.newPlan.fat_g},
            maintenance = ${recal.newPlan.maintenance},
            updated_at  = now()
          WHERE user_id = ${userId}`
      }

      const updated = await sql`SELECT * FROM plans WHERE user_id = ${userId}`
      return res.status(200).json({ plan: updated[0], weighIns, recalibration: recal })
    }

    const { userId, weight, unit = 'lb', calories, date } = body

    if (!userId) return res.status(400).json({ error: 'userId required' })
    if (typeof weight !== 'number' || weight <= 0) return res.status(400).json({ error: 'valid weight required' })

    const weightLbs = toLbs(weight, unit)
    const loggedOn = date || new Date().toISOString().slice(0, 10) // YYYY-MM-DD
    const cals = typeof calories === 'number' && calories > 0 ? Math.round(calories) : null

    // insert the weigh-in
    await sql`
      INSERT INTO weigh_ins (user_id, logged_on, weight_lbs, calories)
      VALUES (${userId}, ${loggedOn}, ${weightLbs}, ${cals})`

    // pull plan + full history
    const plans = await sql`SELECT * FROM plans WHERE user_id = ${userId}`
    const plan = plans[0]
    const weighIns = await sql`
      SELECT id, logged_on, weight_lbs, calories
      FROM weigh_ins WHERE user_id = ${userId}
      ORDER BY logged_on ASC`

    if (!plan) {
      // weigh-ins without a saved plan — just return history
      return res.status(200).json({ plan: null, weighIns, recalibration: null })
    }

    // recalibrate from observed data
    const recal = recalibrate(plan, weighIns)

    if (recal.applied) {
      await sql`
        UPDATE plans SET
          target_cal  = ${recal.newPlan.target_cal},
          protein_g   = ${recal.newPlan.protein_g},
          carbs_g     = ${recal.newPlan.carbs_g},
          fat_g       = ${recal.newPlan.fat_g},
          maintenance = ${recal.newPlan.maintenance},
          updated_at  = now()
        WHERE user_id = ${userId}`
    }

    const updated = await sql`SELECT * FROM plans WHERE user_id = ${userId}`
    return res.status(200).json({ plan: updated[0], weighIns, recalibration: recal })
  } catch (err) {
    console.error('/api/weighin error:', err?.message)
    return res.status(500).json({ error: 'Database error. Is the Postgres integration connected?' })
  }
}
