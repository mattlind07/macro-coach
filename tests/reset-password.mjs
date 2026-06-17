// Integration test: runs the real /api/auth/forgot-password, reset-password,
// and login handlers against an in-process PGlite database. Run: node tests/reset-password.mjs
import { PGlite } from '@electric-sql/pglite'
import { __setSqlForTest } from '../lib/db.js'
import { __setEmailSenderForTest } from '../lib/email.js'
import signupHandler from '../api/auth/signup.js'
import loginHandler from '../api/auth/login.js'
import forgotHandler from '../api/auth/forgot-password.js'
import resetHandler from '../api/auth/reset-password.js'

process.env.JWT_SECRET = 'test-secret-for-auth-integration-tests-only'

let pass = 0, fail = 0
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}  ${detail}`) }
}

const pg = new PGlite()
const sql = async (strings, ...values) => {
  let text = strings[0]
  for (let i = 0; i < values.length; i++) text += '$' + (i + 1) + strings[i + 1]
  const res = await pg.query(text, values)
  return res.rows
}
__setSqlForTest(sql)

let sentTo = null, sentLink = null
__setEmailSenderForTest((toEmail, resetLink) => {
  sentTo = toEmail
  sentLink = resetLink
})

function mockRes() {
  return {
    statusCode: null, body: null,
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
  }
}
const headers = { host: 'macro-coach.test', 'x-forwarded-proto': 'https' }
const signup = (body) => { const r = mockRes(); return signupHandler({ method: 'POST', body }, r).then(() => r) }
const login  = (body) => { const r = mockRes(); return loginHandler({ method: 'POST', body }, r).then(() => r) }
const forgot = (body) => { const r = mockRes(); return forgotHandler({ method: 'POST', body, headers }, r).then(() => r) }
const reset  = (body) => { const r = mockRes(); return resetHandler({ method: 'POST', body }, r).then(() => r) }

function tokenFromLink(link) {
  return new URL(link).searchParams.get('reset_token')
}

console.log('\n— setup: create account —')
{
  const r = await signup({ email: 'bob@example.com', password: 'original-password' })
  check('signup → 201', r.statusCode === 201, JSON.stringify(r.body))
}

console.log('\n— forgot-password: unknown email —')
{
  sentTo = null; sentLink = null
  const r = await forgot({ email: 'nobody@example.com' })
  check('unknown email → 200 (generic, no enumeration)', r.statusCode === 200, JSON.stringify(r.body))
  check('no email actually sent', sentTo === null)
}

console.log('\n— forgot-password: known email —')
let resetToken = null
{
  sentTo = null; sentLink = null
  const r = await forgot({ email: 'BOB@example.com' })
  check('known email (case-insensitive) → 200', r.statusCode === 200, JSON.stringify(r.body))
  check('email sent to the account address', sentTo === 'bob@example.com', sentTo)
  check('reset link points at the right host', sentLink?.startsWith('https://macro-coach.test/?reset_token='), sentLink)
  resetToken = tokenFromLink(sentLink)
  check('reset link contains a token', typeof resetToken === 'string' && resetToken.length > 20)
}

console.log('\n— forgot-password: missing email —')
{
  const r = await forgot({})
  check('missing email → 400', r.statusCode === 400, r.body?.error)
}

console.log('\n— reset-password: validation —')
{
  let r = await reset({})
  check('missing token+password → 400', r.statusCode === 400, r.body?.error)

  r = await reset({ token: resetToken, password: 'short' })
  check('password < 8 chars → 400', r.statusCode === 400, r.body?.error)
}

console.log('\n— reset-password: invalid token —')
{
  const r = await reset({ token: 'not-a-real-token', password: 'brand-new-password' })
  check('bogus token → 400', r.statusCode === 400, r.body?.error)
}

console.log('\n— reset-password: success —')
{
  const r = await reset({ token: resetToken, password: 'brand-new-password' })
  check('reset → 200', r.statusCode === 200, JSON.stringify(r.body))
  check('returns token', typeof r.body?.token === 'string' && r.body.token.length > 20)
  check('returns matching email', r.body?.email === 'bob@example.com')
}

console.log('\n— reset-password: token is single-use —')
{
  const r = await reset({ token: resetToken, password: 'another-password-1' })
  check('reusing a consumed token → 400', r.statusCode === 400, r.body?.error)
}

console.log('\n— login: old password no longer works —')
{
  const r = await login({ email: 'bob@example.com', password: 'original-password' })
  check('old password → 401', r.statusCode === 401, r.body?.error)
}

console.log('\n— login: new password works —')
{
  const r = await login({ email: 'bob@example.com', password: 'brand-new-password' })
  check('new password → 200', r.statusCode === 200, JSON.stringify(r.body))
}

console.log('\n— wrong HTTP method —')
{
  const rF = mockRes(); await forgotHandler({ method: 'GET', body: {}, headers }, rF)
  check('forgot-password GET → 405', rF.statusCode === 405)
  const rR = mockRes(); await resetHandler({ method: 'GET', body: {} }, rR)
  check('reset-password GET → 405', rR.statusCode === 405)
}

console.log(`\nRESET-PASSWORD: ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
