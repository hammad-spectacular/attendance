require('dotenv').config();
const pool = require('./db');
const jwt = require('jsonwebtoken');

async function main() {
  const admin = await pool.query(
    "SELECT id, role, tenant_id, login_id, token_generation FROM admins WHERE role = 'admin' LIMIT 1"
  );
  if (!admin.rows.length) {
    console.log('No admin account found to test with');
    await pool.end();
    return;
  }
  const user = admin.rows[0];
  const token = jwt.sign(
    {
      user_id: user.id,
      role: user.role,
      tenant_id: user.tenant_id,
      login_id: user.login_id,
      token_generation: user.token_generation || 0,
    },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );

  for (const path of ['/api/teachers', '/api/classes', '/api/students', '/api/attendance/all']) {
    const res = await fetch('http://localhost:3000' + path, {
      headers: { Authorization: 'Bearer ' + token },
    });
    const text = await res.text();
    console.log(path, res.status, res.headers.get('content-type'));
    if (!res.headers.get('content-type')?.includes('json')) {
      console.log('  body preview:', text.slice(0, 120));
    }
  }
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
});
