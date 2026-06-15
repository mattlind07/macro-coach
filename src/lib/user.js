// A login-free identity: one random id per browser, stored locally and
// used as the key for this user's plan + weigh-ins in Postgres. Swap this
// out for real auth later without touching the API shape.
const KEY = 'macrocoach.userId'

export function getUserId() {
  if (typeof window === 'undefined') return null
  let id = null
  try {
    id = window.localStorage.getItem(KEY)
    if (!id) {
      id = (crypto?.randomUUID?.() || `u_${Date.now()}_${Math.random().toString(36).slice(2)}`)
      window.localStorage.setItem(KEY, id)
    }
  } catch {
    // localStorage blocked (private mode etc.) — fall back to a session id
    id = `u_${Date.now()}_${Math.random().toString(36).slice(2)}`
  }
  return id
}
