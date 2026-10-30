'use strict'

/**
 * tt2 — standalone dev server. For local testing only.
 *
 *   node timetable/tt2/dev-server.js      ->   http://localhost:4011/
 *
 * What is REAL here:
 *   - tt2/routes.js          the actual API router
 *   - tt2/store.js           the actual store (file driver)
 *   - tt2/model.js           the actual wizard -> solver mapping
 *   - ../solver.js           the actual solver (The Eye's)
 *   - ../validator.js        the actual independent validator (The Eye's)
 *
 * What is DEV-ONLY here:
 *   - no authentication: every request is attributed to the single
 *     development tenant "dev"
 *   - state is written to timetable/tt2/dev-state.json so drafts survive a
 *     restart
 *
 * tt2 deliberately does NOT mount The Eye's requireAuth: this module is a
 * standalone build of the Timetablely concept, and the auth story is decided
 * when it is wired into The Eye. The router already supports the injected-auth
 * path — see tt2/routes.js.
 */

const express = require('express')
const path = require('path')
const { createFileStore } = require('./store')
const { createTt2Router } = require('./routes')

const PORT = Number(process.env.TT2_PORT) || 4011
const HOST = process.env.TT2_HOST || '127.0.0.1'

/**
 * @param {{ persistPath?: string|null }} [opts]
 */
function createApp(opts = {}) {
  const store = createFileStore({ persistPath: opts.persistPath || null })

  const app = express()
  app.use(express.json())

  app.use('/api/tt2', createTt2Router({ store, devAuth: true }))

  // JSON error handler AFTER the routes (Express only reaches error middleware
  // defined later in the stack), then a plain 404 for anything else.
  app.use('/api', (err, req, res, next) => {
    if (res.headersSent) return next(err)
    console.error('[tt2 dev] API error:', err)
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' })
  })
  app.use('/api', (req, res) => {
    res.status(404).json({ error: `Cannot ${req.method} ${req.originalUrl}` })
  })

  const uiDir = path.join(__dirname, 'public')
  app.use('/tt2', express.static(uiDir))
  app.use('/', express.static(uiDir))

  return app
}

function start() {
  const app = createApp({ persistPath: path.join(__dirname, 'dev-state.json') })
  return new Promise(resolve => {
    const server = app.listen(PORT, HOST, () => {
      console.log(`tt2 timetable dev server: http://localhost:${PORT}/`)
      console.log(`  (bound to ${HOST}:${PORT}; data: timetable/tt2/dev-state.json)`)
      resolve(server)
    })
  })
}

if (require.main === module) {
  start().catch(err => {
    console.error('Failed to start tt2 dev server:', err)
    process.exitCode = 1
  })
}

module.exports = { createApp, start }
