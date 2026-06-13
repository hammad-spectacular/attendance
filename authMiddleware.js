const jwt = require('jsonwebtoken')

function requireAuth(allowedRoles = []) {
  return (req, res, next) => {
    const token = req.cookies?.auth_token

    if (!token) {
      console.debug('requireAuth: missing auth_token cookie')
      return res.status(401).json({ error: 'Unauthorized' })
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret-change-me')
      req.user = {
        user_id: decoded.user_id,
        role: decoded.role,
        tenant_id: decoded.tenant_id,
        login_id: decoded.login_id
      }

      if (allowedRoles.length > 0 && !allowedRoles.includes(decoded.role)) {
        console.debug('requireAuth: role not allowed', decoded.role)
        return res.status(403).json({ error: 'Forbidden' })
      }

      next()
    } catch (err) {
      console.debug('requireAuth: token verification failed', err && err.message)
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }
}

module.exports = { requireAuth }
