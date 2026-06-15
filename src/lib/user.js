const GUEST_KEY = 'macrocoach.userId'
const AUTH_KEY = 'macrocoach.auth' // { token, userId, email }

export function getAuth() {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(AUTH_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function setAuth(auth) {
  if (typeof window === 'undefined') return
  try {
    if (auth) {
      window.localStorage.setItem(AUTH_KEY, JSON.stringify(auth))
    } else {
      window.localStorage.removeItem(AUTH_KEY)
    }
  } catch {}
}

export function getUserId() {
  if (typeof window === 'undefined') return null

  // Authenticated user — use their real DB id
  const auth = getAuth()
  if (auth?.userId) return auth.userId

  // Guest — stable random UUID per browser
  let id = null
  try {
    id = window.localStorage.getItem(GUEST_KEY)
    if (!id) {
      id = (crypto?.randomUUID?.() || `u_${Date.now()}_${Math.random().toString(36).slice(2)}`)
      window.localStorage.setItem(GUEST_KEY, id)
    }
  } catch {
    id = `u_${Date.now()}_${Math.random().toString(36).slice(2)}`
  }
  return id
}
