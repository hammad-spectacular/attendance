const jwt = require('jsonwebtoken')

let _pool = null

/** Inject the pg pool so requireAuth can verify token_generation against the DB */
function setPool(pool) {
  _pool = pool
}

function requireAuth(allowedRoles = []) {
  return async (req, res, next) => {
    // Support both Authorization header (Bearer token) and cookie fallback
    let token = null

    const authHeader = req.headers['authorization']
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7)
    } else if (req.cookies?.auth_token) {
      token = req.cookies.auth_token
    }

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    try {
      const secret = process.env.JWT_SECRET || 'theEye_Secret_2024_xK9mP2qR7vN'
      const decoded = jwt.verify(token, secret)

      // --- Token generation check: invalidate JWTs after password reset ---
      if (_pool && decoded.token_generation !== undefined) {
        let table = ''
        if (decoded.role === 'super_admin' || decoded.role === 'admin' || decoded.role === 'coordinator') table = 'admins'
        else if (decoded.role === 'teacher') table = 'teachers'
        else if (decoded.role === 'student') table = 'students'

        if (table) {
          try {
            const result = await _pool.query(
              `SELECT token_generation FROM ${table} WHERE id = $1`,
              [decoded.user_id]
            )
            if (result.rows.length > 0) {
              const currentGen = result.rows[0].token_generation || 0
              if (decoded.token_generation !== currentGen) {
                return res.status(401).json({ error: 'Session invalidated. Please log in again.' })
              }
            }
          } catch (dbErr) {
            console.error('requireAuth generation check DB error:', dbErr.message)
            // Don't block auth on transient DB errors — fall through
          }
        }
      }

      req.user = {
        user_id: decoded.user_id,
        role: decoded.role,
        tenant_id: decoded.tenant_id,
        login_id: decoded.login_id,
        // Branch scope. A coordinator is always tied to one branch and must be
        // confined to it; school admins keep branch_id null so they see the
        // whole tenant. Grants decide which modules actually render for them.
        branch_id: decoded.branch_id === undefined ? null : decoded.branch_id,
        grant_management: decoded.grant_management === true,
        grant_credentials: decoded.grant_credentials === true
      }

      if (allowedRoles.length > 0 && !allowedRoles.includes(decoded.role)) {
        return res.status(403).json({ error: 'Forbidden' })
      }

      next()
    } catch (err) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }
}

/** A coordinator is confined to exactly one branch. Everyone else is tenant-wide. */
function isCoordinator(user) {
  return !!user && user.role === 'coordinator'
}

/**
 * The branch a query must filter by, or null when the caller is not branch-scoped.
 * Use this in every query a coordinator can reach so the branch is enforced by
 * the database filter, not by whatever the UI happened to send.
 */
function branchFilter(user) {
  return isCoordinator(user) ? user.branch_id : null
}

/**
 * Blocks data entry into a branch the Super Admin has deactivated. Reads are
 * deliberately still allowed: deactivating a branch freezes it, it does not
 * erase it, so a coordinator can still read what was already recorded.
 */
function requireWritableBranch() {
  const writeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
  return async (req, res, next) => {
    if (!isCoordinator(req.user)) return next()
    if (!writeMethods.has(req.method)) return next()
    if (!_pool) return next()
  try {
    // A school-wide coordinator (no branch) has nothing to check here.
    if (!req.user.branch_id) return next()
    const result = await _pool.query(
      'SELECT id, name, status FROM branches WHERE id = $1 AND school_id = $2',
      [req.user.branch_id, req.user.tenant_id]
    )
      if (result.rows.length === 0) {
        return res.status(403).json({ error: 'Your branch is no longer available. Contact your admin.' })
      }
      if (result.rows[0].status === 'deactivated') {
        return res.status(403).json({
          error: `Branch "${result.rows[0].name}" has been deactivated by the Super Admin. You can still view existing records, but no new ones can be added.`
        })
      }
      req.branch = result.rows[0]
      next()
    } catch (err) {
      console.error('requireWritableBranch error:', err.message)
      next()
    }
  }
}

module.exports = { requireAuth, setPool, isCoordinator, branchFilter, requireWritableBranch }
