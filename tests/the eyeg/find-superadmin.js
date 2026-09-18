require('dotenv').config();
const pool = require('./db.js');

async function findSuperAdmin() {
  try {
    const result = await pool.query(
      'SELECT id, login_id, name, role, tenant_id, email FROM admins WHERE role = $1',
      ['super_admin']
    );
    console.log('Superadmin accounts found:', result.rows.length);
    console.log(JSON.stringify(result.rows, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

findSuperAdmin();
