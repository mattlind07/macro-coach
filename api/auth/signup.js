import { db, ensureSchema } from '../../lib/db.js'
import { signToken } from '../../lib/auth.js'
import bcrypt from 'bcryptjs'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' })

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
  const { email, password } = body

  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address.' })
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' })

  try {
    await ensureSchema()
    const sql = db()

    const existing = await sql`SELECT id FROM users WHERE email = ${email.toLowerCase()}`
    if (existing.length > 0) return res.status(409).json({ error: 'An account with that email already exists.' })

    const hash = await bcrypt.hash(password, 12)
    const rows = await sql`
      INSERT INTO users (email, password_hash) VALUES (${email.toLowerCase()}, ${hash})
      RETURNING id, email`
    const user = rows[0]
    const token = signToken({ userId: user.id, email: user.email })

    return res.status(201).json({ token, userId: user.id, email: user.email })
  } catch (err) {
    console.error('/api/auth/signup error:', err?.message)
    return res.status(500).json({ error: 'Could not create account.' })
  }
}
