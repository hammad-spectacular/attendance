require('dotenv').config();
const pool = require('./db');

async function main() {
  const cols = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'teachers' ORDER BY 1"
  );
  console.log('teachers columns:', cols.rows.map((x) => x.column_name).join(', '));

  try {
    await pool.query(`
      SELECT teachers.id, teachers.name, teachers.phone, teachers.class_id, teachers.login_id,
             teachers.role, teachers.tenant_id, teachers.is_first_login, teachers.email,
             teachers.email_verified_at, teachers.created_at, classes.name as class_name
      FROM teachers
      LEFT JOIN classes ON teachers.class_id = classes.id
      WHERE teachers.tenant_id = $1
      ORDER BY teachers.id
      LIMIT 1
    `, ['TEST']);
    console.log('teachers query: OK');
  } catch (err) {
    console.log('teachers query FAILED:', err.message);
  }

  const studentCols = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'students' ORDER BY 1"
  );
  console.log('students columns:', studentCols.rows.map((x) => x.column_name).join(', '));

  try {
    await pool.query(`
      SELECT id, name, roll_no, phone, class_id, login_id, role, tenant_id, is_first_login, email, email_verified_at, is_frozen, created_at
      FROM students WHERE tenant_id = $1 ORDER BY id LIMIT 1
    `, ['TEST']);
    console.log('students query: OK');
  } catch (err) {
    console.log('students query FAILED:', err.message);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  pool.end();
});
