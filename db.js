require('dotenv').config()
const { Pool } = require('pg')

const connectionString = process.env.DATABASE_URL

const pool = new Pool({
  connectionString: connectionString,
  ssl: process.env.LOCAL_DB ? false : { rejectUnauthorized: false }
})

module.exports = pool
