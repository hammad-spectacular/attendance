const express = require('express')
const cors = require('cors')
const pool = require('./db')
const path = require('path')
require('dotenv').config()

const app = express()

app.use(cors({
  origin: ['https://theeye-beta.vercel.app', 'http://localhost:3000']
}))
app.use(express.json())

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'))
})
app.get('/:page.html', (req, res, next) => {
  const safePage = req.params.page.replace(/[^a-zA-Z0-9-_]/g, '');
  res.sendFile(path.join(__dirname, `${safePage}.html`), (err) => {
    if (err) next();
  });
})

app.use(express.static('public'))

// ============================================
// CREATE TABLES ON STARTUP
// ============================================
async function createTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS classes (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS teachers (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      phone VARCHAR(20),
      class_id INTEGER REFERENCES classes(id)
    );

    CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      roll_no VARCHAR(50),
      phone VARCHAR(20),
      class_id INTEGER REFERENCES classes(id)
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id SERIAL PRIMARY KEY,
      student_id INTEGER REFERENCES students(id),
      date DATE NOT NULL,
      status VARCHAR(20) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS homework (
      id SERIAL PRIMARY KEY,
      subject VARCHAR(120) NOT NULL,
      task TEXT NOT NULL,
      class_id INTEGER REFERENCES classes(id),
      teacher_id INTEGER REFERENCES teachers(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id SERIAL PRIMARY KEY,
      title VARCHAR(120),
      message TEXT NOT NULL,
      class_id INTEGER REFERENCES classes(id),
      teacher_id INTEGER REFERENCES teachers(id),
      author VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `)
  console.log('Tables ready')
}

// ============================================
// CLASSES
// ============================================
app.get('/api/classes', async (req, res) => {
  const result = await pool.query('SELECT * FROM classes ORDER BY id')
  res.json(result.rows)
})

app.post('/api/classes', async (req, res) => {
  const { name } = req.body
  const result = await pool.query(
    'INSERT INTO classes (name) VALUES ($1) RETURNING *', [name]
  )
  res.json(result.rows[0])
})

app.delete('/api/classes/:id', async (req, res) => {
  await pool.query('DELETE FROM classes WHERE id = $1', [req.params.id])
  res.json({ success: true })
})

// ============================================
// TEACHERS
// ============================================
app.get('/api/teachers', async (req, res) => {
  const result = await pool.query(`
    SELECT teachers.*, classes.name as class_name 
    FROM teachers 
    LEFT JOIN classes ON teachers.class_id = classes.id 
    ORDER BY teachers.id
  `)
  res.json(result.rows)
})

app.post('/api/teachers', async (req, res) => {
  const { name, phone, class_id } = req.body
  const result = await pool.query(
    'INSERT INTO teachers (name, phone, class_id) VALUES ($1, $2, $3) RETURNING *',
    [name, phone, class_id]
  )
  res.json(result.rows[0])
})

app.put('/api/teachers/:id', async (req, res) => {
  const { name, phone, class_id } = req.body
  const result = await pool.query(
    'UPDATE teachers SET name=$1, phone=$2, class_id=$3 WHERE id=$4 RETURNING *',
    [name, phone, class_id, req.params.id]
  )
  res.json(result.rows[0])
})

app.delete('/api/teachers/:id', async (req, res) => {
  await pool.query('DELETE FROM teachers WHERE id = $1', [req.params.id])
  res.json({ success: true })
})

// ============================================
// STUDENTS
// ============================================
app.get('/api/students', async (req, res) => {
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
})

app.get('/api/students/:id', async (req, res) => {
  const result = await pool.query('SELECT * FROM students WHERE id = $1', [req.params.id])
  if (result.rows.length === 0) return res.status(404).json({ error: 'Student not found' })
  res.json(result.rows[0])
})

app.post('/api/students', async (req, res) => {
  const { name, roll_no, phone, class_id } = req.body
  const result = await pool.query(
    'INSERT INTO students (name, roll_no, phone, class_id) VALUES ($1, $2, $3, $4) RETURNING *',
    [name, roll_no, phone, class_id]
  )
  res.json(result.rows[0])
})

app.put('/api/students/:id', async (req, res) => {
  const { name, roll_no, phone, class_id } = req.body
  const result = await pool.query(
    'UPDATE students SET name=$1, roll_no=$2, phone=$3, class_id=$4 WHERE id=$5 RETURNING *',
    [name, roll_no, phone, class_id, req.params.id]
  )
  res.json(result.rows[0])
})

app.delete('/api/students/:id', async (req, res) => {
  await pool.query('DELETE FROM students WHERE id = $1', [req.params.id])
  res.json({ success: true })
})

// ============================================
// ATTENDANCE
// ============================================
app.post('/api/attendance', async (req, res) => {
  const { date, records } = req.body
  // records = [{student_id, status}]
  for (const record of records) {
    await pool.query(
      `INSERT INTO attendance (student_id, date, status)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [record.student_id, date, record.status]
    )
  }
  res.json({ success: true })
})

app.get('/api/attendance', async (req, res) => {
  const { date, class_id } = req.query
  const result = await pool.query(`
    SELECT attendance.*, students.name, students.phone, students.roll_no
    FROM attendance
    JOIN students ON attendance.student_id = students.id
    WHERE attendance.date = $1 AND students.class_id = $2
    ORDER BY students.id
  `, [date, class_id])
  res.json(result.rows)
})

app.get('/api/attendance/all', async (req, res) => {
  const result = await pool.query(`
    SELECT attendance.*, students.name, students.roll_no, classes.name as class_name
    FROM attendance
    JOIN students ON attendance.student_id = students.id
    JOIN classes ON students.class_id = classes.id
    ORDER BY attendance.date DESC
  `)
  res.json(result.rows)
})

// ============================================
// HOMEWORK
// ============================================
app.get('/api/homework', async (req, res) => {
  const { class_id } = req.query
  let result

  if (class_id) {
    result = await pool.query(`
      SELECT homework.*, classes.name as class_name, teachers.name as teacher_name
      FROM homework
      LEFT JOIN classes ON homework.class_id = classes.id
      LEFT JOIN teachers ON homework.teacher_id = teachers.id
      WHERE homework.class_id = $1
      ORDER BY homework.created_at DESC
    `, [class_id])
  } else {
    result = await pool.query(`
      SELECT homework.*, classes.name as class_name, teachers.name as teacher_name
      FROM homework
      LEFT JOIN classes ON homework.class_id = classes.id
      LEFT JOIN teachers ON homework.teacher_id = teachers.id
      ORDER BY homework.created_at DESC
    `)
  }

  res.json(result.rows)
})

app.post('/api/homework', async (req, res) => {
  const { subject, task, class_id, teacher_id } = req.body
  if (!subject || !task) return res.status(400).json({ error: 'Subject and task are required' })

  const result = await pool.query(
    'INSERT INTO homework (subject, task, class_id, teacher_id) VALUES ($1, $2, $3, $4) RETURNING *',
    [subject, task, class_id || null, teacher_id || null]
  )
  res.json(result.rows[0])
})

app.delete('/api/homework/:id', async (req, res) => {
  await pool.query('DELETE FROM homework WHERE id = $1', [req.params.id])
  res.json({ success: true })
})

// ============================================
// ANNOUNCEMENTS
// ============================================
app.get('/api/announcements', async (req, res) => {
  const { class_id } = req.query
  let result

  if (class_id) {
    result = await pool.query(`
      SELECT announcements.*, classes.name as class_name, teachers.name as teacher_name
      FROM announcements
      LEFT JOIN classes ON announcements.class_id = classes.id
      LEFT JOIN teachers ON announcements.teacher_id = teachers.id
      WHERE announcements.class_id IS NULL OR announcements.class_id = $1
      ORDER BY announcements.created_at DESC
    `, [class_id])
  } else {
    result = await pool.query(`
      SELECT announcements.*, classes.name as class_name, teachers.name as teacher_name
      FROM announcements
      LEFT JOIN classes ON announcements.class_id = classes.id
      LEFT JOIN teachers ON announcements.teacher_id = teachers.id
      ORDER BY announcements.created_at DESC
    `)
  }

  res.json(result.rows)
})

app.post('/api/announcements', async (req, res) => {
  const { title, message, class_id, teacher_id, author } = req.body
  if (!message) return res.status(400).json({ error: 'Announcement message is required' })

  const result = await pool.query(
    'INSERT INTO announcements (title, message, class_id, teacher_id, author) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [title || null, message, class_id || null, teacher_id || null, author || null]
  )
  res.json(result.rows[0])
})

app.delete('/api/announcements/:id', async (req, res) => {
  await pool.query('DELETE FROM announcements WHERE id = $1', [req.params.id])
  res.json({ success: true })
})

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 3000
createTables().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
  })
})
