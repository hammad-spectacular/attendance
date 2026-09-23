require('dotenv').config();
const pool = require('./db');

async function check() {
  const t = await pool.query("SELECT login_id FROM teachers WHERE tenant_id = 'TEST' AND (login_id LIKE 'T%' OR login_id LIKE 'TEST-T%') ORDER BY login_id DESC");
  console.log('Teachers:', t.rows.map(r => r.login_id));
  
  const s = await pool.query("SELECT login_id FROM students WHERE tenant_id = 'TEST' AND (login_id LIKE 'S%' OR login_id LIKE 'TEST-S%') ORDER BY login_id DESC");
  console.log('Students:', s.rows.map(r => r.login_id));
  
  await pool.end();
}
check();
