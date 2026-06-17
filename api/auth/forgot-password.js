import { db, ensureSchema } from '../../lib/db.js'
import { generateResetToken } from '../../lib/resetToken.js'
import { sendPasswordResetEmail } from '../../lib/email.js'

const RESET_WINDOW_MS = 60 * 60 * 1000 // 1 hour

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' })

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
  const { email } = body

  // Same generic response whether or not the account exists — never confirm
  // or deny enumeration of an email address.
  const genericMessage = 'If an account exists for that email, we’ve sent a password reset link.'

  if (!email) return res.status(400).json({ error: 'Email is required.' })

  try {
    await ensureSchema()
    const sql = db()

    const rows = await sql`SELECT id, email FROM users WHERE email = ${email.toLowerCase()}`
    const user = rows[0]

    if (user) {
      const { token, tokenHash } = generateResetToken()
      const expires = new Date(Date.now() + RESET_WINDOW_MS)
      await sql`
        UPDATE users SET reset_token_hash = ${tokenHash}, reset_token_expires = ${expires}
        WHERE id = ${user.id}`

      const proto = req.headers['x-forwarded-proto'] || 'https'
      const host = req.headers.host
      const resetLink = `${proto}://${host}/?reset_token=${token}`

      try {
        await sendPasswordResetEmail(user.email, resetLink)
      } catch (err) {
        console.error('/api/auth/forgot-password email error:', err?.message)
      }
    }

    return res.status(200).json({ message: genericMessage })
  } catch (err) {
    console.error('/api/auth/forgot-password error:', err?.message)
    return res.status(500).json({ error: 'Could not process request.' })
  }
}
