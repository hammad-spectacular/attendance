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

  console.log(`Testing as admin: ${user.login_id} (Tenant: ${user.tenant_id})`);

  // Try creating 3 teachers
  console.log('\n--- Bulk Create 3 Teachers ---');
  let res = await fetch('http://localhost:3000/api/auth/bulk-create-teachers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ count: 3 })
  });
  let data = await res.json();
  console.log('Status:', res.status);
  console.log('Response:', data);
  if (data.accounts) {
    const ids = data.accounts.map(a => a.login_id);
    console.log('Generated IDs:', ids);
    // Verify they have the tenant_id prefix
    if (!ids[0].startsWith(user.tenant_id + '-')) {
      console.error('ERROR: Tenant ID not properly prefixed in generated IDs!');
    } else {
      console.log('Tenant ID properly prefixed.');
    }
  }

  // Get a class_id
  let cls = await pool.query("SELECT id FROM classes WHERE tenant_id = $1 LIMIT 1", [user.tenant_id]);
  if (!cls.rows.length) {
    await pool.query("INSERT INTO classes (name, tenant_id) VALUES ('Test Class', $1)", [user.tenant_id]);
    cls = await pool.query("SELECT id FROM classes WHERE tenant_id = $1 LIMIT 1", [user.tenant_id]);
  }
  
  console.log('\n--- Bulk Create 3 Students ---');
  res = await fetch('http://localhost:3000/api/auth/bulk-create-students', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ count: 3, class_id: cls.rows[0].id })
  });
  data = await res.json();
  console.log('Status:', res.status);
  console.log('Response:', data);
  if (data.accounts) {
    const ids = data.accounts.map(a => a.login_id);
    console.log('Generated IDs:', ids);
    if (!ids[0].startsWith(user.tenant_id + '-')) {
      console.error('ERROR: Tenant ID not properly prefixed in generated IDs!');
    } else {
      console.log('Tenant ID properly prefixed.');
    }
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
});

