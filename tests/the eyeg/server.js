/**
 * Legacy entry point — always boot serverg.js (auth + multi-tenant API).
 * Prevents "Connection error" on login when Railway accidentally runs server.js,
 * which has no /api/auth/login route and returns HTML 404 instead of JSON.
 */
require('./serverg.js')
