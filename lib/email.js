import { Resend } from 'resend'

function getClient() {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error('RESEND_API_KEY env var is not set.')
  return new Resend(key)
}

function getFrom() {
  const from = process.env.RESET_EMAIL_FROM
  if (!from) throw new Error('RESET_EMAIL_FROM env var is not set.')
  return from
}

// Test seam: lets integration tests assert an email "was sent" without
// hitting the real Resend API. Never used in production.
let _override = null
export function __setEmailSenderForTest(fn) {
  _override = fn
}

export async function sendPasswordResetEmail(toEmail, resetLink) {
  if (_override) return _override(toEmail, resetLink)

  const resend = getClient()
  await resend.emails.send({
    to: toEmail,
    from: getFrom(),
    subject: 'Reset your Macro Coach password',
    text: `Reset your password: ${resetLink}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.`,
    html: `<p>Reset your password by clicking the link below:</p><p><a href="${resetLink}">${resetLink}</a></p><p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>`,
  })
}
