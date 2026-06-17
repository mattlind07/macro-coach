import crypto from 'crypto'

// Raw token goes in the emailed link; only its hash is ever stored in the DB,
// so a leaked database can't be used to forge valid reset links.
export function generateResetToken() {
  const token = crypto.randomBytes(32).toString('hex')
  return { token, tokenHash: hashResetToken(token) }
}

export function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}
