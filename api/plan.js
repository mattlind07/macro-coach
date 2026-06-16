// /api/plan — GET ?userId=  -> { plan, weighIns }
//            POST { userId, ...planFields } -> upsert the plan
import { db, ensureSchema } from '../lib/db.js'
import { getAuthedUserId } from '../lib/auth.js'

export default async function handler(req, res) {
  try {
    await ensureSchema()
    const sql = db()

    const auth = getAuthedUserId(req)
    if (!auth.valid) return res.status(401).json({ error: 'Invalid or expired session.' })

    if (req.method === 'GET') {
      const userId = req.query.userId
      if (!userId) return res.status(400).json({ error: 'userId required' })
      if (auth.userId && auth.userId !== userId) return res.status(403).json({ error: 'Not authorized for this user.' })

      const plans = await sql`SELECT * FROM plans WHERE user_id = ${userId}`
      const weighIns = await sql`
        SELECT id, logged_on, weight_lbs, calories
        FROM weigh_ins WHERE user_id = ${userId}
        ORDER BY logged_on ASC`
      return res.status(200).json({ plan: plans[0] || null, weighIns })
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
      const { userId, weightUnit = 'lb', goal, target_cal, protein_g, carbs_g, fat_g, maintenance, sex, age, activity, weight, current_calories } = body
      if (!userId || !goal || target_cal == null) return res.status(400).json({ error: 'missing fields' })
      if (auth.userId && auth.userId !== userId) return res.status(403).json({ error: 'Not authorized for this user.' })

      // upsert — one plan per user
      await sql`
        INSERT INTO plans (user_id, weight_unit, goal, target_cal, protein_g, carbs_g, fat_g, maintenance, sex, age, activity, weight, current_calories)
        VALUES (${userId}, ${weightUnit}, ${goal}, ${target_cal}, ${protein_g}, ${carbs_g}, ${fat_g}, ${maintenance}, ${sex || null}, ${age || null}, ${activity || null}, ${weight || null}, ${current_calories || null})
        ON CONFLICT (user_id) DO UPDATE SET
          weight_unit      = EXCLUDED.weight_unit,
          goal             = EXCLUDED.goal,
          target_cal       = EXCLUDED.target_cal,
          protein_g        = EXCLUDED.protein_g,
          carbs_g          = EXCLUDED.carbs_g,
          fat_g            = EXCLUDED.fat_g,
          maintenance      = EXCLUDED.maintenance,
          sex              = EXCLUDED.sex,
          age              = EXCLUDED.age,
          activity         = EXCLUDED.activity,
          weight           = EXCLUDED.weight,
          current_calories = EXCLUDED.current_calories,
          updated_at       = now()`
      const plans = await sql`SELECT * FROM plans WHERE user_id = ${userId}`
      return res.status(200).json({ plan: plans[0] })
    }

    return res.status(405).json({ error: 'Use GET or POST.' })
  } catch (err) {
    console.error('/api/plan error:', err?.message)
    return res.status(500).json({ error: 'Database error. Is the Postgres integration connected?' })
  }
}
