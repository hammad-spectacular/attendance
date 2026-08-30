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
        if (decoded.role === 'super_admin' || decoded.role === 'admin') table = 'admins'
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
        login_id: decoded.login_id
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

module.exports = { requireAuth, setPool }
