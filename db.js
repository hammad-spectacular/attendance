require('dotenv').config()
const { Pool } = require('pg')

const connectionString = process.env.DATABASE_URL

console.log('Connection string exists:', !!connectionString)

const pool = new Pool({
  connectionString: connectionString,
  ssl: {
    rejectUnauthorized: false
  }
})

console.log('Pool created:', typeof pool)
console.log('Pool query:', typeof pool.query)

module.exports = pool