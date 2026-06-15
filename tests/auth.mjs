// Integration test: runs the real /api/auth/signup and /api/auth/login
// handlers against an in-process PGlite database. Run: node tests/auth.mjs
import { PGlite } from '@electric-sql/pglite'
import { __setSqlForTest } from '../lib/db.js'
import signupHandler from '../api/auth/signup.js'
import loginHandler from '../api/auth/login.js'

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

function mockRes() {
  return {
    statusCode: null, body: null,
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
  }
}
const signup = (body) => { const r = mockRes(); return signupHandler({ method: 'POST', body }, r).then(() => r) }
const login  = (body) => { const r = mockRes(); return loginHandler({ method: 'POST', body }, r).then(() => r) }

console.log('\n— signup: validation —')
{
  let r = await signup({})
  check('missing email+password → 400', r.statusCode === 400, r.body?.error)

  r = await signup({ email: 'bad-email', password: 'password123' })
  check('invalid email → 400', r.statusCode === 400, r.body?.error)

  r = await signup({ email: 'test@example.com', password: 'short' })
  check('password < 8 chars → 400', r.statusCode === 400, r.body?.error)
}

console.log('\n— signup: success —')
let savedUserId = null
{
  const r = await signup({ email: 'alice@example.com', password: 'secure-password-1' })
  check('signup → 201', r.statusCode === 201, JSON.stringify(r.body))
  check('returns token', typeof r.body?.token === 'string' && r.body.token.length > 20)
  check('returns userId', typeof r.body?.userId === 'string' && r.body.userId.length > 0)
  check('returns email (lowercased)', r.body?.email === 'alice@example.com')
  savedUserId = r.body?.userId
}

console.log('\n— signup: duplicate email —')
{
  const r = await signup({ email: 'ALICE@example.com', password: 'another-password-1' })
  check('duplicate email (case-insensitive) → 409', r.statusCode === 409, r.body?.error)
}

console.log('\n— login: wrong password —')
{
  const r = await login({ email: 'alice@example.com', password: 'wrong-password' })
  check('wrong password → 401', r.statusCode === 401, r.body?.error)
}

console.log('\n— login: unknown email —')
{
  const r = await login({ email: 'nobody@example.com', password: 'password123' })
  check('unknown email → 401 (same message as wrong password)', r.statusCode === 401)
  check('error message does not reveal which field is wrong',
    r.body?.error === 'Invalid email or password.')
}

console.log('\n— login: success —')
{
  const r = await login({ email: 'alice@example.com', password: 'secure-password-1' })
  check('login → 200', r.statusCode === 200, JSON.stringify(r.body))
  check('returns token', typeof r.body?.token === 'string' && r.body.token.length > 20)
  check('userId matches the one from signup', r.body?.userId === savedUserId)
  check('email matches', r.body?.email === 'alice@example.com')
}

console.log('\n— login: email is case-insensitive —')
{
  const r = await login({ email: 'ALICE@EXAMPLE.COM', password: 'secure-password-1' })
  check('uppercase email still logs in → 200', r.statusCode === 200, r.body?.error)
}

console.log('\n— wrong HTTP method —')
{
  const rS = mockRes(); await signupHandler({ method: 'GET', body: {} }, rS)
  check('signup GET → 405', rS.statusCode === 405)
  const rL = mockRes(); await loginHandler({ method: 'GET', body: {} }, rL)
  check('login GET → 405', rL.statusCode === 405)
}

console.log('\n— password hash is not returned —')
{
  const rows = await pg.query('SELECT password_hash FROM users WHERE email=$1', ['alice@example.com'])
  const hash = rows.rows[0]?.password_hash
  check('hash is stored', typeof hash === 'string' && hash.startsWith('$2'))
  check('hash is not the plaintext password', hash !== 'secure-password-1')
}

console.log(`\nAUTH: ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
