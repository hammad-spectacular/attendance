require('dotenv').config()
const { Pool } = require('pg')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
  connectionTimeoutMillis: 15000
})

async function main() {
  try {
    const r = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('branches', 'tenant_features', 'tenant_grants')
    `)
    console.log('Tables found:', JSON.stringify(r.rows, null, 2))
  } catch (e) {
    console.error('DB Error:', e.message)
  } finally {
    await pool.end()
  }
}

main()
