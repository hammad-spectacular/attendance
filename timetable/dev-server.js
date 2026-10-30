'use strict'

/**
 * Standalone timetable dev server — for local testing only.
 *
 *   npm run dev:timetable     ->   http://localhost:4010/
 *
 * What is REAL here (the same code production will run):
 *   - timetable/routes.js       the actual API router
 *   - timetable/store.js        the actual store interface (memory driver)
 *   - timetable/solver.js       the actual solver
 *   - timetable/validator.js    the actual independent validator
 *   - ../authMiddleware.js      The Eye's actual requireAuth middleware
 *
 * What is DEV-ONLY here:
 *   - a forced dev JWT secret (this process never reads the production .env)
 *   - POST /api/timetable/dev-login, which signs demo identities instead of
 *     checking a password
 *
 * Because dev tokens are signed with the exact payload shape The Eye signs
 * (user_id, role, tenant_id, login_id, branch_id), the UI's fetch layer is
 * identical in both environments: it just sends Authorization: Bearer <token>.
 */

// Force a dev secret BEFORE authMiddleware is required. Never the production
// secret: this file must not read .env, and must not mint tokens production
// would accept. (serverg.js sets its own JWT_SECRET from .env in its process.)
process.env.JWT_SECRET = process.env.TIMETABLE_DEV_SECRET || 'timetable-dev-only-not-for-production'

const express = require('express')
const path = require('path')
const jwt = require('jsonwebtoken')
const { requireAuth } = require('../authMiddleware')
const { createMemoryStore } = require('./store')
const { sampleSchools } = require('./sample-data')
const { createTimetableRouter, READ_ROLES } = require('./routes')

const PORT = Number(process.env.TIMETABLE_PORT) || 4010
const HOST = process.env.TIMETABLE_HOST || '127.0.0.1'
const JWT_EXPIRY = '8h'

/** Demo identities. Each maps to a real role/tenant pair used by the tests. */
const DEV_USERS = [
  { user_id: 'dev_admin1', login_id: 'admin.greenwood', role: 'admin', tenant_id: 'DEMO1', branch_id: null, label: 'Admin — Greenwood (DEMO1)' },
  { user_id: 'dev_coord1', login_id: 'coord.greenwood', role: 'coordinator', tenant_id: 'DEMO1', branch_id: null, label: 'Coordinator — Greenwood (DEMO1)' },
  { user_id: 'dev_teacher1', login_id: 'teacher.greenwood', role: 'teacher', tenant_id: 'DEMO1', branch_id: null, label: 'Teacher — Greenwood (DEMO1)' },
  { user_id: 'dev_student1', login_id: 'student.greenwood', role: 'student', tenant_id: 'DEMO1', branch_id: null, label: 'Student — Greenwood (DEMO1)' },
  { user_id: 'dev_admin2', login_id: 'admin.sunrise', role: 'admin', tenant_id: 'DEMO2', branch_id: null, label: 'Admin — Sunrise (DEMO2)' },
  { user_id: 'dev_teacher2', login_id: 'teacher.sunrise', role: 'teacher', tenant_id: 'DEMO2', branch_id: null, label: 'Teacher — Sunrise (DEMO2)' }
]

function signDevToken(user) {
  return jwt.sign(
    {
      user_id: user.user_id,
      role: user.role,
      tenant_id: user.tenant_id,
      login_id: user.login_id,
      branch_id: user.branch_id
    },
    process.env.JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  )
}

/**
 * @param {{ persistPath?: string|null, seed?: object }} [opts]
 *   persistPath: set to a file path to keep drafts across restarts
 *                (the default server persists to timetable/dev-state.json;
 *                 tests pass null for an isolated in-memory store)
 */
function createApp(opts = {}) {
  const seed = opts.seed || sampleSchools()
  const store = createMemoryStore(seed, { persistPath: opts.persistPath || null })

  const app = express()
  app.use(express.json())

  // Dev-only: exchange a pickable demo identity for a token.
  app.get('/api/timetable/dev-users', (req, res) => {
    res.json(DEV_USERS.map(u => ({ user_id: u.user_id, label: u.label, role: u.role, tenant: u.tenant_id })))
  })

  app.post('/api/timetable/dev-login', (req, res) => {
    const userId = req.body && req.body.user_id
    const user = DEV_USERS.find(u => u.user_id === userId)
    if (!user) return res.status(400).json({ error: 'Unknown demo user' })
    res.json({ token: signDevToken(user), user: { ...user, token: undefined } })
  })

  // The REAL router, with The Eye's REAL requireAuth injected as its auth
  // chain. Auth lives inside the factory (not app.use) so GET /meta stays
  // reachable before sign-in — the UI needs it to decide whether to redirect
  // to The Eye's login page or show the standalone identity picker.
  app.use('/api/timetable', createTimetableRouter({
    store,
    auth: requireAuth(READ_ROLES),
    devAuth: true
  }))

  // JSON error handler AFTER the routes (Express only reaches error middleware
  // defined later in the stack), then the same API 404 as serverg.js.
  app.use('/api', (err, req, res, next) => {
    if (res.headersSent) return next(err)
    console.error('[timetable dev] API error:', err)
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' })
  })
  app.use('/api', (req, res) => {
    res.status(404).json({ error: `Cannot ${req.method} ${req.originalUrl}` })
  })

  // The module UI — the same files The Eye will mount at /timetable/.
  const uiDir = path.join(__dirname, 'public')
  app.use('/timetable', express.static(uiDir))
  app.use(express.static(uiDir))

  return app
}

function start() {
  const app = createApp({ persistPath: path.join(__dirname, 'dev-state.json') })
  return new Promise(resolve => {
    const server = app.listen(PORT, HOST, () => {
      console.log(`Timetable dev server: http://localhost:${PORT}/`)
      console.log(`  (bound to ${HOST}:${PORT}; data: timetable/dev-state.json, seeded tenants DEMO1 + DEMO2)`)
      resolve(server)
    })
  })
}

if (require.main === module) {
  start().catch(err => {
    console.error('Failed to start timetable dev server:', err)
    process.exitCode = 1
  })
}

module.exports = { createApp, start, DEV_USERS, signDevToken }
