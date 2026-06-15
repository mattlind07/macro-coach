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
