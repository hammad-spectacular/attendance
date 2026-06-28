const jwt = require('jsonwebtoken')

function requireAuth(allowedRoles = []) {
  return (req, res, next) => {
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
      console.log('Auth middleware JWT_SECRET:', secret ? 'YES' : 'MISSING')
      const decoded = jwt.verify(token, secret)
      req.user = {
        user_id: decoded.user_id,
        role: decoded.role,
        tenant_id: decoded.tenant_id,
        login_id: decoded.login_id
      }

      if (allowedRoles.length > 0 && !allowedRoles.includes(decoded.role)) {
        console.log('403 triggered - decoded.role:', decoded.role, 'allowedRoles:', allowedRoles)
        return res.status(403).json({ error: 'Forbidden' })
      }

      next()
    } catch (err) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }
}

module.exports = { requireAuth }
