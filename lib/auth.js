import jwt from 'jsonwebtoken'

function getSecret() {
  const s = process.env.JWT_SECRET
  if (!s) throw new Error('JWT_SECRET env var is not set.')
  return s
}

export function signToken(payload) {
  return jwt.sign(payload, getSecret(), { expiresIn: '30d' })
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, getSecret())
  } catch {
    return null
  }
}

// Returns { userId, valid: true } if a bearer token was sent and verifies,
// { valid: false } if a token was sent but is invalid/expired, or
// { userId: null, valid: true } if no token was sent at all (guest request).
export function getAuthedUserId(req) {
  const header = req.headers?.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return { userId: null, valid: true }

  const payload = verifyToken(token)
  if (!payload) return { userId: null, valid: false }
  return { userId: payload.userId, valid: true }
}
