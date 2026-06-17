import { db, ensureSchema } from '../../lib/db.js'
import { signToken } from '../../lib/auth.js'
import { hashResetToken } from '../../lib/resetToken.js'
import bcrypt from 'bcryptjs'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' })

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
  const { token, password } = body

  if (!token || !password) return res.status(400).json({ error: 'Token and password are required.' })
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' })

  try {
    await ensureSchema()
    const sql = db()

    const tokenHash = hashResetToken(token)
    const rows = await sql`
      SELECT id, email FROM users
      WHERE reset_token_hash = ${tokenHash} AND reset_token_expires > now()`
    const user = rows[0]

    if (!user) return res.status(400).json({ error: 'This reset link is invalid or has expired.' })

    const hash = await bcrypt.hash(password, 12)
    await sql`
      UPDATE users SET password_hash = ${hash}, reset_token_hash = NULL, reset_token_expires = NULL
      WHERE id = ${user.id}`

    const newToken = signToken({ userId: user.id, email: user.email })
    return res.status(200).json({ token: newToken, userId: user.id, email: user.email })
  } catch (err) {
    console.error('/api/auth/reset-password error:', err?.message)
    return res.status(500).json({ error: 'Could not reset password.' })
  }
}
