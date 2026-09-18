require('dotenv').config();
const pool = require('./db.js');

async function findAllAdmins() {
  try {
    const result = await pool.query(
      'SELECT id, login_id, name, role, tenant_id, email FROM admins'
    );
    console.log('All admin accounts found:', result.rows.length);
    console.log(JSON.stringify(result.rows, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

findAllAdmins();
