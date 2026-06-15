import { db, ensureSchema } from '../../lib/db.js'
import { signToken } from '../../lib/auth.js'
import bcrypt from 'bcryptjs'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' })

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
  const { email, password } = body

  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' })

  try {
    await ensureSchema()
    const sql = db()

    const rows = await sql`SELECT id, email, password_hash FROM users WHERE email = ${email.toLowerCase()}`
    const user = rows[0]

    // Deliberately vague error to prevent user enumeration
    if (!user) return res.status(401).json({ error: 'Invalid email or password.' })

    const match = await bcrypt.compare(password, user.password_hash)
    if (!match) return res.status(401).json({ error: 'Invalid email or password.' })

    const token = signToken({ userId: user.id, email: user.email })
    return res.status(200).json({ token, userId: user.id, email: user.email })
  } catch (err) {
    console.error('/api/auth/login error:', err?.message)
    return res.status(500).json({ error: 'Could not log in.' })
  }
}
