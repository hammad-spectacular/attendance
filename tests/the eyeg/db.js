require('dotenv').config()
const { Pool } = require('pg')

const connectionString = process.env.DATABASE_URL

console.log('Connection string exists:', !!connectionString)

const pool = new Pool({
  connectionString: connectionString,
  ssl: {
    rejectUnauthorized: false
  },
  // Keep connections warm so Neon's network path doesn't go cold between requests
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000
})

// Prevent the process from crashing on idle-client network errors
pool.on('error', (err) => {
  console.error('Idle DB client error (non-fatal):', err.code || '', err.message)
})

// --- Retry wrapper for transient network failures ---
// Neon (remote DB) connections can drop briefly (ECONNRESET, DNS blips, TLS resets).
// Retry those automatically so users see results instead of "Internal server error".
const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE'
])
const TRANSIENT_MESSAGES = [
  'Connection terminated unexpectedly',
  'Connection terminated due to connection timeout',
  'Client network socket disconnected before secure TLS connection was established',
  'SSL connection has been closed unexpectedly',
  'socket hang up',
  'terminating connection due to administrator command'
]

function isTransientError(err) {
  if (!err) return false
  if (TRANSIENT_CODES.has(err.code)) return true
  if (err.code === '57P01') return true // admin command terminating connection
  const msg = err.message || ''
  return TRANSIENT_MESSAGES.some((m) => msg.includes(m))
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const MAX_ATTEMPTS = 3
const BACKOFF_MS = [250, 750]

const originalQuery = pool.query.bind(pool)

pool.query = async function resilientQuery(...args) {
  let lastErr
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await originalQuery(...args)
    } catch (err) {
      lastErr = err
      if (attempt < MAX_ATTEMPTS && isTransientError(err)) {
        console.warn(
          `DB transient error (attempt ${attempt}/${MAX_ATTEMPTS}): ${err.code || ''} ${err.message} — retrying...`
        )
        await sleep(BACKOFF_MS[attempt - 1] || 750)
        continue
      }
      throw err
    }
  }
  throw lastErr
}

console.log('Pool created:', typeof pool)
console.log('Pool query:', typeof pool.query)

module.exports = pool
