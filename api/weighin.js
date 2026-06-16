// /api/weighin — POST { userId, weight, unit, calories?, date? }
// Inserts the weigh-in, recomputes maintenance from history, and if there's
// enough data, updates the stored plan. Returns the full updated state.
import { db, ensureSchema, recalibrate, attachTrend } from '../lib/db.js'
import { toLbs } from '../lib/macros.js'
import { getAuthedUserId } from '../lib/auth.js'

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'DELETE') return res.status(405).json({ error: 'Use POST or DELETE.' })

  try {
    await ensureSchema()
    const sql = db()

    const auth = getAuthedUserId(req)
    if (!auth.valid) return res.status(401).json({ error: 'Invalid or expired session.' })

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}

    if (req.method === 'DELETE') {
      const { userId, id } = body
      if (!userId || !id) return res.status(400).json({ error: 'userId and id required' })
      if (auth.userId && auth.userId !== userId) return res.status(403).json({ error: 'Not authorized for this user.' })

      // Transaction: if recalibrate() throws partway through, the delete and
      // any plan update roll back together instead of leaving a half-applied state.
      const result = await sql.begin(async (tx) => {
        await tx`DELETE FROM weigh_ins WHERE id = ${id} AND user_id = ${userId}`

        const plans = await tx`SELECT * FROM plans WHERE user_id = ${userId}`
        const plan = plans[0]
        const weighIns = await tx`
          SELECT id, logged_on, weight_lbs, calories
          FROM weigh_ins WHERE user_id = ${userId}
          ORDER BY logged_on ASC`

        if (!plan) return { plan: null, weighIns: attachTrend(weighIns), recalibration: null }

        const recal = recalibrate(plan, weighIns)
        if (recal.applied) {
          await tx`
            UPDATE plans SET
              target_cal  = ${recal.newPlan.target_cal},
              protein_g   = ${recal.newPlan.protein_g},
              carbs_g     = ${recal.newPlan.carbs_g},
              fat_g       = ${recal.newPlan.fat_g},
              maintenance = ${recal.newPlan.maintenance},
              updated_at  = now()
            WHERE user_id = ${userId}`
        }

        const updated = await tx`SELECT * FROM plans WHERE user_id = ${userId}`
        return { plan: updated[0], weighIns: attachTrend(weighIns), recalibration: recal }
      })
      return res.status(200).json(result)
    }

    const { userId, weight, unit = 'lb', calories, date } = body

    if (!userId) return res.status(400).json({ error: 'userId required' })
    if (auth.userId && auth.userId !== userId) return res.status(403).json({ error: 'Not authorized for this user.' })
    if (typeof weight !== 'number' || weight <= 0) return res.status(400).json({ error: 'valid weight required' })

    const weightLbs = toLbs(weight, unit)
    const loggedOn = date || new Date().toISOString().slice(0, 10) // YYYY-MM-DD
    const cals = typeof calories === 'number' && calories > 0 ? Math.round(calories) : null

    // Transaction: if recalibrate() throws partway through, the insert and any
    // plan update roll back together — a failed request leaves no trace, so a
    // client retry can't create a duplicate weigh-in.
    const result = await sql.begin(async (tx) => {
      await tx`
        INSERT INTO weigh_ins (user_id, logged_on, weight_lbs, calories)
        VALUES (${userId}, ${loggedOn}, ${weightLbs}, ${cals})`

      const plans = await tx`SELECT * FROM plans WHERE user_id = ${userId}`
      const plan = plans[0]
      const weighIns = await tx`
        SELECT id, logged_on, weight_lbs, calories
        FROM weigh_ins WHERE user_id = ${userId}
        ORDER BY logged_on ASC`

      if (!plan) {
        // weigh-ins without a saved plan — just return history
        return { plan: null, weighIns: attachTrend(weighIns), recalibration: null }
      }

      // recalibrate from observed data
      const recal = recalibrate(plan, weighIns)

      if (recal.applied) {
        await tx`
          UPDATE plans SET
            target_cal  = ${recal.newPlan.target_cal},
            protein_g   = ${recal.newPlan.protein_g},
            carbs_g     = ${recal.newPlan.carbs_g},
            fat_g       = ${recal.newPlan.fat_g},
            maintenance = ${recal.newPlan.maintenance},
            updated_at  = now()
          WHERE user_id = ${userId}`
      }

      const updated = await tx`SELECT * FROM plans WHERE user_id = ${userId}`
      return { plan: updated[0], weighIns: attachTrend(weighIns), recalibration: recal }
    })
    return res.status(200).json(result)
  } catch (err) {
    console.error('/api/weighin error:', err?.message)
    return res.status(500).json({ error: 'Database error. Is the Postgres integration connected?' })
  }
}
