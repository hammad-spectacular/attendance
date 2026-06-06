const jwt = require('jsonwebtoken')

function requireAuth(allowedRoles = []) {
  return (req, res, next) => {
    const token = req.cookies?.auth_token

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET)
      req.user = {
        user_id: decoded.user_id,
        role: decoded.role,
        tenant_id: decoded.tenant_id
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

module.exports = { requireAuth }
