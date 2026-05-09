require('dotenv').config()
const express = require('express')
const cors = require('cors')
const { Pool } = require('pg')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
}) // THEN load db — now DATABASE_URL exists
const app = express()

app.use(cors({
  origin: 'https://theeye-beta.vercel.app'
}))
app.use(express.json())
app.use(express.static('public'))

// ============================================
// CREATE TABLES ON STARTUP
// ============================================
async function createTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS classes (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS teachers (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      phone VARCHAR(20),
      class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      roll_no VARCHAR(50) UNIQUE,
      phone VARCHAR(20),
      class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id SERIAL PRIMARY KEY,
      student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      status VARCHAR(20) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `)
  console.log('✅ Tables ready')
}

// ============================================
// CLASSES
// ============================================
app.get('/api/classes', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM classes ORDER BY id')
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/classes', async (req, res) => {
  try {
    const { name } = req.body
    if (!name) return res.status(400).json({ error: 'Class name is required' })
    const result = await pool.query(
      'INSERT INTO classes (name) VALUES ($1) RETURNING *', [name]
    )
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/classes/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM classes WHERE id = $1', [req.params.id])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.put('/api/classes/:id', async (req, res) => {
  try {
    const { name } = req.body
    const result = await pool.query(
      'UPDATE classes SET name=$1 WHERE id=$2 RETURNING *',
      [name, req.params.id]
    )
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ============================================
// TEACHERS
// ============================================
app.get('/api/teachers', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT teachers.*, classes.name as class_name 
      FROM teachers 
      LEFT JOIN classes ON teachers.class_id = classes.id 
      ORDER BY teachers.id
    `)
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/teachers', async (req, res) => {
  try {
    const { name, phone, class_id } = req.body
    if (!name) return res.status(400).json({ error: 'Teacher name is required' })
    const result = await pool.query(
      'INSERT INTO teachers (name, phone, class_id) VALUES ($1, $2, $3) RETURNING *',
      [name, phone, class_id || null]
    )
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.put('/api/teachers/:id', async (req, res) => {
  try {
    const { name, phone, class_id } = req.body
    const result = await pool.query(
      'UPDATE teachers SET name=$1, phone=$2, class_id=$3 WHERE id=$4 RETURNING *',
      [name, phone, class_id || null, req.params.id]
    )
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/teachers/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM teachers WHERE id = $1', [req.params.id])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ============================================
// STUDENTS
// ============================================
app.get('/api/students', async (req, res) => {
  try {
    const { class_id } = req.query
    let result
    if (class_id) {
      result = await pool.query(
        'SELECT * FROM students WHERE class_id = $1 ORDER BY id',
        [class_id]
      )
    } else {
      result = await pool.query('SELECT * FROM students ORDER BY id')
    }
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/students', async (req, res) => {
  try {
    const { name, roll_no, phone, class_id } = req.body
    if (!name) return res.status(400).json({ error: 'Student name is required' })
    if (phone && phone.replace(/\D/g, '').length !== 11) {
      return res.status(400).json({ error: 'Phone number must be 11 digits' })
    }
    const result = await pool.query(
      'INSERT INTO students (name, roll_no, phone, class_id) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, roll_no || null, phone || null, class_id || null]
    )
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.put('/api/students/:id', async (req, res) => {
  try {
    const { name, roll_no, phone, class_id } = req.body
    if (phone && phone.replace(/\D/g, '').length !== 11) {
      return res.status(400).json({ error: 'Phone number must be 11 digits' })
    }
    const result = await pool.query(
      'UPDATE students SET name=$1, roll_no=$2, phone=$3, class_id=$4 WHERE id=$5 RETURNING *',
      [name, roll_no || null, phone || null, class_id || null, req.params.id]
    )
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/students/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM students WHERE id = $1', [req.params.id])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ============================================
// ATTENDANCE
// ============================================
app.post('/api/attendance', async (req, res) => {
  try {
    const { date, records } = req.body
    for (const record of records) {
      await pool.query(
        `INSERT INTO attendance (student_id, date, status)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [record.student_id, date, record.status]
      )
    }
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/attendance', async (req, res) => {
  try {
    const { date, class_id } = req.query
    const result = await pool.query(`
      SELECT attendance.*, students.name, students.phone, students.roll_no
      FROM attendance
      JOIN students ON attendance.student_id = students.id
      WHERE attendance.date = $1 AND students.class_id = $2
      ORDER BY students.id
    `, [date, class_id])
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/attendance/all', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT attendance.*, students.name, students.roll_no, classes.name as class_name
      FROM attendance
      JOIN students ON attendance.student_id = students.id
      JOIN classes ON students.class_id = classes.id
      ORDER BY attendance.date DESC
    `)
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 3000
createTables().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`)
  })
}).catch(err => {
  console.error('❌ Failed to start:', err.message)
})
