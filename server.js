require('dotenv').config()
const express = require('express')
const cors = require('cors')
const { Pool } = require('pg')
const path = require('path')
const { sendVeevoSMS } = require('./veevotech-sms')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
}) // THEN load db — now DATABASE_URL exists
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
      teacher_id INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
      date DATE NOT NULL,
      status VARCHAR(20) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(student_id, date)
    );

    CREATE TABLE IF NOT EXISTS homework (
      id SERIAL PRIMARY KEY,
      subject VARCHAR(120) NOT NULL,
      task TEXT NOT NULL,
      class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
      teacher_id INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id SERIAL PRIMARY KEY,
      title VARCHAR(120),
      message TEXT NOT NULL,
      class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
      teacher_id INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
      author VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `)
  await pool.query(`
    ALTER TABLE attendance
      ADD COLUMN IF NOT EXISTS teacher_id INTEGER REFERENCES teachers(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
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

app.post('/api/classes/:id/assign-teacher', async (req, res) => {
  try {
    const classId = req.params.id
    const { teacher_id } = req.body

    // First unassign any teacher currently assigned to this class
    await pool.query(
      'UPDATE teachers SET class_id = NULL WHERE class_id = $1',
      [classId]
    )

    // Then assign the new teacher
    if (teacher_id) {
      await pool.query(
        'UPDATE teachers SET class_id = $1 WHERE id = $2',
        [classId, teacher_id]
      )
    }

    res.json({ success: true })
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

app.get('/api/students/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM students WHERE id = $1', [req.params.id])
    if (result.rows.length === 0) return res.status(404).json({ error: 'Student not found' })
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
      SELECT
        attendance.*,
        students.name,
        students.phone,
        students.roll_no,
        students.class_id,
        classes.name as class_name,
        COALESCE(marking_teacher.name, assigned_teacher.name) as marked_by,
        COALESCE(marking_teacher.id, assigned_teacher.id) as marked_by_id
      FROM attendance
      JOIN students ON attendance.student_id = students.id
      JOIN classes ON students.class_id = classes.id
      LEFT JOIN teachers marking_teacher ON attendance.teacher_id = marking_teacher.id
      LEFT JOIN teachers assigned_teacher ON assigned_teacher.class_id = students.class_id
      ORDER BY attendance.date DESC, classes.name ASC, students.name ASC
    `)
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/attendance/submit', async (req, res) => {
  try {
    const { date, class_id, teacher_id, records } = req.body
    // records = [{student_id, name, phone, status}]

    // Save each record to database
    for (const record of records) {
      const updated = await pool.query(
        `UPDATE attendance
         SET teacher_id = $1, status = $2
         WHERE student_id = $3 AND date = $4`,
        [teacher_id || null, record.status, record.student_id, date]
      )
      if (updated.rowCount === 0) {
        await pool.query(
          `INSERT INTO attendance (student_id, teacher_id, date, status)
           VALUES ($1, $2, $3, $4)`,
          [record.student_id, teacher_id || null, date, record.status]
        )
      }
    }

    // Send SMS to absent students
    const absentees = records.filter(r => r.status === 'Absent')
    const smsResults = []

    for (const student of absentees) {
      if (student.phone) {
        // Format phone for Pakistan numbers
        let phone = student.phone.replace(/\s/g, '')
        if (phone.startsWith('0')) {
          phone = '+92' + phone.substring(1)
        }
        const message = `Dear Parent, your child ${student.name} was absent today ${date}. - The Eye School System`
        const result = await sendVeevoSMS(phone, message, student.name)
        smsResults.push({ name: student.name, ...result })
      }
    }

    res.json({
      success: true,
      saved: records.length,
      sms_sent: smsResults.filter(r => r.success).length,
      results: smsResults
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ============================================
// HOMEWORK
// ============================================
app.get('/api/homework', async (req, res) => {
  try {
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
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/homework', async (req, res) => {
  try {
    const { subject, task, class_id, teacher_id } = req.body
    if (!subject || !task) return res.status(400).json({ error: 'Subject and task are required' })

    const result = await pool.query(
      'INSERT INTO homework (subject, task, class_id, teacher_id) VALUES ($1, $2, $3, $4) RETURNING *',
      [subject, task, class_id || null, teacher_id || null]
    )
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/homework/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM homework WHERE id = $1', [req.params.id])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ============================================
// ANNOUNCEMENTS
// ============================================
app.get('/api/announcements', async (req, res) => {
  try {
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
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/announcements', async (req, res) => {
  try {
    const { title, message, class_id, teacher_id, author } = req.body
    if (!message) return res.status(400).json({ error: 'Announcement message is required' })

    const result = await pool.query(
      'INSERT INTO announcements (title, message, class_id, teacher_id, author) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [title || null, message, class_id || null, teacher_id || null, author || null]
    )
    res.json(result.rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/announcements/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM announcements WHERE id = $1', [req.params.id])
    res.json({ success: true })
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
