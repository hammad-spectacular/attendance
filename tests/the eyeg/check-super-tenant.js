require('dotenv').config();
const pool = require('./db.js');

async function checkSuperTenant() {
  try {
    const result = await pool.query(
      "SELECT id, login_id, name, role, tenant_id, email FROM admins WHERE tenant_id = 'SUPER'"
    );
    console.log('Accounts with SUPER tenant:', result.rows.length);
    console.log(JSON.stringify(result.rows, null, 2));
    
    const orgResult = await pool.query(
      "SELECT * FROM organizations WHERE school_code = 'SUPER'"
    );
    console.log('\nOrganizations with SUPER code:', orgResult.rows.length);
    console.log(JSON.stringify(orgResult.rows, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

checkSuperTenant();
