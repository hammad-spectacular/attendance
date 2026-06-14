const express = require('express')
const cors = require('cors')
const pool = require('./db')
const path = require('path')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const cookieParser = require('cookie-parser')
require('dotenv').config()
const { requireAuth } = require('./authMiddleware')

const app = express()
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-me'
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || '12')
const JWT_EXPIRY = '8h'

app.use(cors({
  origin: ['https://theeye-beta.vercel.app', 'http://localhost:3000'],
  credentials: true
}))
app.use(express.json())
app.use(cookieParser())

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
      teacher_id INTEGER REFERENCES teachers(id),
      date DATE NOT NULL,
      status VARCHAR(20) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(student_id, date)
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
  await pool.query(`
    ALTER TABLE attendance
      ADD COLUMN IF NOT EXISTS teacher_id INTEGER REFERENCES teachers(id),
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS organizations (
      id SERIAL PRIMARY KEY,
      school_code VARCHAR(4) UNIQUE NOT NULL,
      school_name VARCHAR(200) NOT NULL,
      contact_email VARCHAR(200),
      status VARCHAR(20) DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS school_requests (
      id SERIAL PRIMARY KEY,
      school_name VARCHAR(200) NOT NULL,
      contact_person VARCHAR(100) NOT NULL,
      contact_email VARCHAR(200) NOT NULL,
      message TEXT,
      status VARCHAR(20) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      login_id VARCHAR(50) UNIQUE NOT NULL,
      name VARCHAR(100) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(20) DEFAULT 'admin',
      tenant_id VARCHAR(10) NOT NULL,
      is_first_login BOOLEAN DEFAULT true,
      phone VARCHAR(20),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `)

  await pool.query(`
    ALTER TABLE teachers ADD COLUMN IF NOT EXISTS login_id VARCHAR(50) UNIQUE;
    ALTER TABLE teachers ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
    ALTER TABLE teachers ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'teacher';
    ALTER TABLE teachers ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(10);
    ALTER TABLE teachers ADD COLUMN IF NOT EXISTS is_first_login BOOLEAN DEFAULT true;
  `)

  await pool.query(`
    ALTER TABLE students ADD COLUMN IF NOT EXISTS login_id VARCHAR(50) UNIQUE;
    ALTER TABLE students ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
    ALTER TABLE students ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'student';
    ALTER TABLE students ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(10);
    ALTER TABLE students ADD COLUMN IF NOT EXISTS is_first_login BOOLEAN DEFAULT true;
    ALTER TABLE students ADD COLUMN IF NOT EXISTS is_frozen BOOLEAN DEFAULT false;
  `)

  await pool.query(`
    ALTER TABLE attendance ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(10);
    ALTER TABLE classes ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(10);
    ALTER TABLE homework ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(10);
    ALTER TABLE announcements ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(10);
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS contact_email VARCHAR(200);
  `)

  // Fix existing admin login_id values that were stored as the full concatenated ID
  await pool.query(`
    UPDATE admins SET login_id = 'ADM' WHERE tenant_id = 'SUPER' AND login_id = 'SUPER-ADM'
  `)

  console.log('Tables ready')
}


// ============================================
// UTILITY: Generate random password
// ============================================
function generateTempPassword() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const specials = '!@#$%^&*'
  let pw = ''
  for (let i = 0; i < 6; i++) {
    pw += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  pw += specials.charAt(Math.floor(Math.random() * specials.length))
  pw += chars.charAt(Math.floor(Math.random() * chars.length))
  return pw.split('').sort(() => Math.random() - 0.5).join('')
}


// ============================================
// AUTH ROUTES
// ============================================

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { password } = req.body
    const full_id = req.body.full_id || req.body.login_id
    const lastDash = full_id.lastIndexOf('-')
    const tenant_id = full_id.substring(0, lastDash).toUpperCase()
    const login_id = full_id.substring(lastDash + 1)

    if (!full_id || !password) {
      return res.status(400).json({ error: 'Full ID and Password are required' })
    }

    console.log('full_id received:', full_id)
    console.log('tenant_id (split):', tenant_id)
    console.log('login_id (split):', login_id)

    const result = await pool.query(`
      SELECT id, password_hash, role, is_first_login, is_frozen 
      FROM students 
      WHERE tenant_id = $1 AND login_id = $2
      UNION
      SELECT id, password_hash, role, is_first_login, FALSE as is_frozen 
      FROM teachers 
      WHERE tenant_id = $1 AND login_id = $2
      UNION
      SELECT id, password_hash, role, is_first_login, FALSE as is_frozen 
      FROM admins 
      WHERE tenant_id = $1 AND login_id = $2
    `, [tenant_id, login_id])

    console.log('query result rows:', result.rows.length)
    if (result.rows.length > 0) {
      console.log('found user role:', result.rows[0].role)
      console.log('password_hash from db:', result.rows[0].password_hash)
      console.log('bcrypt result:', await bcrypt.compare(password, result.rows[0].password_hash))
    }

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid Organization, ID, or Password' })
    }

    const user = result.rows[0]

    const passwordMatch = await bcrypt.compare(password, user.password_hash)
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid Organization, ID, or Password' })
    }

    if (user.is_frozen === true) {
      return res.status(403).json({ error: 'Your account has been frozen. Please contact administration.' })
    }

    const redirectMap = {
      super_admin: '/super-admin.html',
      admin: '/admin.html',
      teacher: '/teacher.html',
      student: '/student.html'
    }
    const redirect_url = redirectMap[user.role] || '/index.html'

    const token = jwt.sign(
      {
        user_id: user.id,
        role: user.role,
        tenant_id: tenant_id,
        login_id: login_id,
        is_first_login: user.is_first_login
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    )

    const isProd = process.env.NODE_ENV === 'production'
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: 8 * 60 * 60 * 1000
    })

    return res.status(200).json({
      success: true,
      role: user.role,
      is_first_login: user.is_first_login,
      redirect_url
    })


  } catch (err) {
    console.error('Login error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /api/auth/change-password
app.post('/api/auth/change-password', requireAuth(), async (req, res) => {
  try {
    const { current_password, new_password, confirm_password } = req.body

    if (!new_password || !confirm_password) {
      return res.status(400).json({ error: 'New password and confirmation are required' })
    }

    if (new_password !== confirm_password) {
      return res.status(400).json({ error: 'New passwords do not match' })
    }

    if (new_password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' })
    }

    const { user_id, role, tenant_id, login_id } = req.user
    let selectQuery = ''
    let updateQuery = ''

    if (role === 'super_admin' || role === 'admin') {
      selectQuery = 'SELECT * FROM admins WHERE id = $1'
      updateQuery = 'UPDATE admins SET password_hash = $1, is_first_login = false WHERE id = $2'
    } else if (role === 'teacher') {
      selectQuery = 'SELECT * FROM teachers WHERE id = $1'
      updateQuery = 'UPDATE teachers SET password_hash = $1, is_first_login = false WHERE id = $2'
    } else if (role === 'student') {
      selectQuery = 'SELECT * FROM students WHERE id = $1'
      updateQuery = 'UPDATE students SET password_hash = $1, is_first_login = false WHERE id = $2'
    } else {
      return res.status(400).json({ error: 'Invalid role' })
    }

    const result = await pool.query(selectQuery, [user_id])

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' })
    }

    const user = result.rows[0]

    if (!user.is_first_login) {
      if (!current_password) {
        return res.status(400).json({ error: 'Current password is required' })
      }
      const validCurrent = await bcrypt.compare(current_password, user.password_hash)
      if (!validCurrent) {
        return res.status(400).json({ error: 'Current password is incorrect' })
      }
    }

    const newHash = await bcrypt.hash(new_password, BCRYPT_ROUNDS)

    await pool.query(updateQuery, [newHash, user_id])

const token = jwt.sign(
        {
          user_id,
          role,
          tenant_id,
          login_id,
          is_first_login: false
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRY }
      )

      const isProd = process.env.NODE_ENV === 'production'
      res.cookie('auth_token', token, {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? 'none' : 'lax',
        maxAge: 8 * 60 * 60 * 1000
      })

      res.json({ success: true, message: 'Password changed successfully' })
  } catch (err) {
    console.error('Change password error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => {
  const isProd = process.env.NODE_ENV === 'production'
  res.clearCookie('auth_token', {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: '/'
  })
  return res.status(200).json({ success: true })
})

// GET /api/auth/me
app.get('/api/auth/me', async (req, res) => {
  try {
    const token = req.cookies.auth_token
    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' })
    }

    const decoded = jwt.verify(token, JWT_SECRET)
    return res.status(200).json({
      user_id: decoded.user_id,
      role: decoded.role,
      tenant_id: decoded.tenant_id,
      login_id: decoded.login_id,
      is_first_login: decoded.is_first_login
    })

  } catch (err) {
    return res.status(401).json({ error: 'Session expired or invalid' })
  }
})

// POST /api/auth/create-teacher
app.post('/api/auth/create-teacher', requireAuth(['admin']), async (req, res) => {
  try {
    const { name, phone, class_id } = req.body
    if (!name) return res.status(400).json({ error: 'Teacher name is required' })

    const tenant_id = req.user.tenant_id

    const highestResult = await pool.query(
      `SELECT login_id FROM teachers WHERE tenant_id = $1 AND login_id LIKE $2 ORDER BY login_id DESC LIMIT 1`,
      [tenant_id, `${tenant_id}-T%`]
    )

    let nextNum = 1
    if (highestResult.rows.length > 0) {
      const lastId = highestResult.rows[0].login_id
      const numPart = parseInt(lastId.replace(`${tenant_id}-T`, ''), 10)
      if (!isNaN(numPart)) nextNum = numPart + 1
    }

    const teacherId = `${tenant_id}-T${String(nextNum).padStart(3, '0')}`
    const tempPassword = generateTempPassword()
    const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS)

    await pool.query(
      `INSERT INTO teachers (name, phone, class_id, login_id, password_hash, role, tenant_id, is_first_login)
       VALUES ($1, $2, $3, $4, $5, 'teacher', $6, true)`,
      [name, phone || null, class_id || null, teacherId, passwordHash, tenant_id]
    )

    res.json({ success: true, teacher_id: teacherId, temp_password: tempPassword })
  } catch (err) {
    console.error('Create teacher error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/auth/create-student
app.post('/api/auth/create-student', requireAuth(['admin']), async (req, res) => {
  try {
    const { name, roll_no, phone, class_id } = req.body
    if (!name) return res.status(400).json({ error: 'Student name is required' })

    const tenant_id = req.user.tenant_id

    const highestResult = await pool.query(
      `SELECT login_id FROM students WHERE tenant_id = $1 AND login_id LIKE $2 ORDER BY login_id DESC LIMIT 1`,
      [tenant_id, `${tenant_id}-S%`]
    )

    let nextNum = 1
    if (highestResult.rows.length > 0) {
      const lastId = highestResult.rows[0].login_id
      const numPart = parseInt(lastId.replace(`${tenant_id}-S`, ''), 10)
      if (!isNaN(numPart)) nextNum = numPart + 1
    }

    const studentId = `${tenant_id}-S${String(nextNum).padStart(3, '0')}`
    const tempPassword = generateTempPassword()
    const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS)

    await pool.query(
      `INSERT INTO students (name, roll_no, phone, class_id, login_id, password_hash, role, tenant_id, is_first_login)
       VALUES ($1, $2, $3, $4, $5, $6, 'student', $7, true)`,
      [name, roll_no || null, phone || null, class_id || null, studentId, passwordHash, tenant_id]
    )

    res.json({ success: true, student_id: studentId, temp_password: tempPassword })
  } catch (err) {
    console.error('Create student error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/auth/register-school
app.post('/api/auth/register-school', async (req, res) => {
  try {
    const { school_name, contact_person, role, contact_email, message } = req.body

    const normalizedContactPerson = String(contact_person || '').trim()
    const normalizedContactRole = String(role || '').trim()

    if (!school_name || !normalizedContactPerson || !normalizedContactRole || !contact_email) {
      return res.status(400).json({ error: 'School name, contact person, role, and email are required' })
    }

    const contactPersonValue = `${normalizedContactPerson} (${normalizedContactRole})`

    await pool.query(
      `INSERT INTO school_requests (school_name, contact_person, contact_email, message, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [school_name, contactPersonValue, contact_email, message || null]
    )

    res.json({ success: true, message: 'Your request has been received. You will be contacted shortly.' })
  } catch (err) {
    console.error('Register school error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/auth/approve-school
app.post('/api/auth/approve-school', requireAuth(['super_admin']), async (req, res) => {
  try {
    const { request_id, school_code, school_name } = req.body

    if (!request_id || !school_code || !school_name) {
      return res.status(400).json({ error: 'All fields are required' })
    }

    const code = school_code.toUpperCase()
    if (!/^[A-Z]{4}$/.test(code)) {
      return res.status(400).json({ error: 'School code must be exactly 4 uppercase letters' })
    }

    const requestResult = await pool.query('SELECT contact_email FROM school_requests WHERE id = $1', [request_id])
    if (requestResult.rows.length === 0) {
      return res.status(404).json({ error: 'School request not found' })
    }

    const contactEmail = requestResult.rows[0].contact_email

    const existing = await pool.query('SELECT id FROM organizations WHERE school_code = $1', [code])
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'School code already taken' })
    }

    await pool.query(
      'INSERT INTO organizations (school_code, school_name, contact_email, status) VALUES ($1, $2, $3, $4)',
      [code, school_name, contactEmail, 'active']
    )

    const adminId = `${code}-ADM`
    const tempPassword = generateTempPassword()
    const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS)

    await pool.query(
      `INSERT INTO admins (login_id, password_hash, role, tenant_id, is_first_login)
       VALUES ($1, $2, 'admin', $3, true)`,
      [adminId, passwordHash, code]
    )

    console.log('Updating request_id:', request_id)
    await pool.query('UPDATE school_requests SET status = $1 WHERE id = $2', ['approved', request_id])

    res.json({ success: true, admin_id: adminId, temp_password: tempPassword })
  } catch (err) {
    console.error('Approve school error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/auth/reject-school
app.post('/api/auth/reject-school', requireAuth(['super_admin']), async (req, res) => {
  try {
    const { request_id } = req.body
    await pool.query('UPDATE school_requests SET status = $1 WHERE id = $2', ['rejected', request_id])
    res.json({ success: true })
  } catch (err) {
    console.error('Reject school error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET super admin data
app.get('/api/auth/pending-requests', requireAuth(['super_admin']), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM school_requests WHERE status = $1 ORDER BY created_at DESC',
      ['pending']
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

app.get('/api/auth/active-schools', requireAuth(['super_admin']), async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM organizations WHERE status = 'active' ORDER BY created_at DESC"
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

app.get('/api/auth/suspended-schools', requireAuth(['super_admin']), async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM organizations WHERE status = 'suspended' ORDER BY created_at DESC"
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

app.post('/api/auth/suspend-school', requireAuth(['super_admin']), async (req, res) => {
  try {
    const { school_id } = req.body
    await pool.query("UPDATE organizations SET status = 'suspended' WHERE id = $1", [school_id])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

app.post('/api/auth/reactivate-school', requireAuth(['super_admin']), async (req, res) => {
  try {
    const { school_id } = req.body
    await pool.query("UPDATE organizations SET status = 'active' WHERE id = $1", [school_id])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})


// ============================================
// PROTECTED EXISTING ROUTES
// ============================================

// CLASSES
app.get('/api/classes', requireAuth(['admin', 'teacher', 'super_admin']), async (req, res) => {
  const tenant_id = req.user.tenant_id
  const result = await pool.query('SELECT * FROM classes WHERE tenant_id = $1 ORDER BY id', [tenant_id])
  res.json(result.rows)
})

app.post('/api/classes', requireAuth(['admin', 'super_admin']), async (req, res) => {
  const { name } = req.body
  const tenant_id = req.user.tenant_id
  const result = await pool.query(
    'INSERT INTO classes (name, tenant_id) VALUES ($1, $2) RETURNING *', [name, tenant_id]
  )
  res.json(result.rows[0])
})

app.delete('/api/classes/:id', requireAuth(['admin', 'super_admin']), async (req, res) => {
  const tenant_id = req.user.tenant_id
  await pool.query('DELETE FROM classes WHERE id = $1 AND tenant_id = $2', [req.params.id, tenant_id])
  res.json({ success: true })
})

// TEACHERS
app.get('/api/teachers', requireAuth(['admin', 'teacher', 'super_admin']), async (req, res) => {
  const tenant_id = req.user.tenant_id
  const result = await pool.query(`
    SELECT teachers.*, classes.name as class_name 
    FROM teachers 
    LEFT JOIN classes ON teachers.class_id = classes.id 
    WHERE teachers.tenant_id = $1
    ORDER BY teachers.id
  `, [tenant_id])
  res.json(result.rows)
})

app.post('/api/teachers', requireAuth(['admin', 'super_admin']), async (req, res) => {
  const { name, phone, class_id } = req.body
  const tenant_id = req.user.tenant_id
  const result = await pool.query(
    'INSERT INTO teachers (name, phone, class_id, tenant_id) VALUES ($1, $2, $3, $4) RETURNING *',
    [name, phone, class_id, tenant_id]
  )
  res.json(result.rows[0])
})

app.put('/api/teachers/:id', requireAuth(['admin', 'super_admin']), async (req, res) => {
  const { name, phone, class_id } = req.body
  const tenant_id = req.user.tenant_id
  const result = await pool.query(
    'UPDATE teachers SET name=$1, phone=$2, class_id=$3 WHERE id=$4 AND tenant_id=$5 RETURNING *',
    [name, phone, class_id, req.params.id, tenant_id]
  )
  res.json(result.rows[0])
})

app.delete('/api/teachers/:id', requireAuth(['admin', 'super_admin']), async (req, res) => {
  const tenant_id = req.user.tenant_id
  await pool.query('DELETE FROM teachers WHERE id = $1 AND tenant_id = $2', [req.params.id, tenant_id])
  res.json({ success: true })
})

// STUDENTS
app.get('/api/students', requireAuth(['admin', 'teacher', 'student', 'super_admin']), async (req, res) => {
  const tenant_id = req.user.tenant_id
  const { class_id } = req.query
  let result
  if (class_id) {
    result = await pool.query(
      'SELECT * FROM students WHERE tenant_id = $1 AND class_id = $2 ORDER BY id',
      [tenant_id, class_id]
    )
  } else {
    result = await pool.query(
      'SELECT * FROM students WHERE tenant_id = $1 ORDER BY id',
      [tenant_id]
    )
  }
  res.json(result.rows)
})

app.get('/api/students/:id', requireAuth(['admin', 'teacher', 'super_admin']), async (req, res) => {
  const tenant_id = req.user.tenant_id
  const result = await pool.query('SELECT * FROM students WHERE id = $1 AND tenant_id = $2', [req.params.id, tenant_id])
  if (result.rows.length === 0) return res.status(404).json({ error: 'Student not found' })
  res.json(result.rows[0])
})

app.post('/api/students', requireAuth(['admin', 'super_admin']), async (req, res) => {
  const { name, roll_no, phone, class_id } = req.body
  const tenant_id = req.user.tenant_id
  const result = await pool.query(
    'INSERT INTO students (name, roll_no, phone, class_id, tenant_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [name, roll_no, phone, class_id, tenant_id]
  )
  res.json(result.rows[0])
})

app.put('/api/students/:id', requireAuth(['admin', 'super_admin']), async (req, res) => {
  const { name, roll_no, phone, class_id } = req.body
  const tenant_id = req.user.tenant_id
  const result = await pool.query(
    'UPDATE students SET name=$1, roll_no=$2, phone=$3, class_id=$4 WHERE id=$5 AND tenant_id=$6 RETURNING *',
    [name, roll_no, phone, class_id, req.params.id, tenant_id]
  )
  res.json(result.rows[0])
})

app.delete('/api/students/:id', requireAuth(['admin', 'super_admin']), async (req, res) => {
  const tenant_id = req.user.tenant_id
  await pool.query('DELETE FROM students WHERE id = $1 AND tenant_id = $2', [req.params.id, tenant_id])
  res.json({ success: true })
})

// ATTENDANCE
app.post('/api/attendance', requireAuth(['teacher', 'admin']), async (req, res) => {
  const { date, records } = req.body
  const tenant_id = req.user.tenant_id
  for (const record of records) {
    await pool.query(
      `INSERT INTO attendance (student_id, date, status, tenant_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [record.student_id, date, record.status, tenant_id]
    )
  }
  res.json({ success: true })
})

app.get('/api/attendance', requireAuth(['admin', 'teacher', 'student', 'super_admin']), async (req, res) => {
  const tenant_id = req.user.tenant_id
  const { date, class_id } = req.query
  const result = await pool.query(`
    SELECT attendance.*, students.name, students.phone, students.roll_no
    FROM attendance
    JOIN students ON attendance.student_id = students.id
    WHERE attendance.date = $1 AND students.class_id = $2 AND attendance.tenant_id = $3
    ORDER BY students.id
  `, [date, class_id, tenant_id])
  res.json(result.rows)
})

app.get('/api/attendance/all', requireAuth(['admin', 'super_admin']), async (req, res) => {
  const tenant_id = req.user.tenant_id
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
    WHERE attendance.tenant_id = $1
    ORDER BY attendance.date DESC, classes.name ASC, students.name ASC
  `, [tenant_id])
  res.json(result.rows)
})

app.post('/api/attendance/submit', requireAuth(['teacher', 'admin']), async (req, res) => {
  try {
    const { date, teacher_id, records } = req.body
    const tenant_id = req.user.tenant_id

    for (const record of records) {
      const updated = await pool.query(
        `UPDATE attendance
         SET teacher_id = $1, status = $2, tenant_id = $3
         WHERE student_id = $4 AND date = $5`,
        [teacher_id || null, record.status, tenant_id, record.student_id, date]
      )
      if (updated.rowCount === 0) {
        await pool.query(
          `INSERT INTO attendance (student_id, teacher_id, date, status, tenant_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [record.student_id, teacher_id || null, date, record.status, tenant_id]
        )
      }
    }

    res.json({ success: true, saved: records.length })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// HOMEWORK
app.get('/api/homework', requireAuth(['admin', 'teacher', 'student', 'super_admin']), async (req, res) => {
  const { class_id } = req.query
  const tenant_id = req.user.tenant_id
  let result

  if (class_id) {
    result = await pool.query(`
      SELECT homework.*, classes.name as class_name, teachers.name as teacher_name
      FROM homework
      LEFT JOIN classes ON homework.class_id = classes.id
      LEFT JOIN teachers ON homework.teacher_id = teachers.id
      WHERE homework.class_id = $1 AND homework.tenant_id = $2
      ORDER BY homework.created_at DESC
    `, [class_id, tenant_id])
  } else {
    result = await pool.query(`
      SELECT homework.*, classes.name as class_name, teachers.name as teacher_name
      FROM homework
      LEFT JOIN classes ON homework.class_id = classes.id
      LEFT JOIN teachers ON homework.teacher_id = teachers.id
      WHERE homework.tenant_id = $1
      ORDER BY homework.created_at DESC
    `, [tenant_id])
  }

  res.json(result.rows)
})

app.post('/api/homework', requireAuth(['teacher', 'admin']), async (req, res) => {
  const { subject, task, class_id, teacher_id } = req.body
  const tenant_id = req.user.tenant_id
  if (!subject || !task) return res.status(400).json({ error: 'Subject and task are required' })

  const result = await pool.query(
    'INSERT INTO homework (subject, task, class_id, teacher_id, tenant_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [subject, task, class_id || null, teacher_id || null, tenant_id]
  )
  res.json(result.rows[0])
})

app.delete('/api/homework/:id', requireAuth(['teacher', 'admin']), async (req, res) => {
  const tenant_id = req.user.tenant_id
  await pool.query('DELETE FROM homework WHERE id = $1 AND tenant_id = $2', [req.params.id, tenant_id])
  res.json({ success: true })
})

// ANNOUNCEMENTS
app.get('/api/announcements', requireAuth(['admin', 'teacher', 'student', 'super_admin']), async (req, res) => {
  const { class_id } = req.query
  const tenant_id = req.user.tenant_id
  let result

  if (class_id) {
    result = await pool.query(`
      SELECT announcements.*, classes.name as class_name, teachers.name as teacher_name
      FROM announcements
      LEFT JOIN classes ON announcements.class_id = classes.id
      LEFT JOIN teachers ON announcements.teacher_id = teachers.id
      WHERE (announcements.class_id IS NULL OR announcements.class_id = $1) AND announcements.tenant_id = $2
      ORDER BY announcements.created_at DESC
    `, [class_id, tenant_id])
  } else {
    result = await pool.query(`
      SELECT announcements.*, classes.name as class_name, teachers.name as teacher_name
      FROM announcements
      LEFT JOIN classes ON announcements.class_id = classes.id
      LEFT JOIN teachers ON announcements.teacher_id = teachers.id
      WHERE announcements.tenant_id = $1
      ORDER BY announcements.created_at DESC
    `, [tenant_id])
  }

  res.json(result.rows)
})

app.post('/api/announcements', requireAuth(['admin', 'teacher', 'super_admin']), async (req, res) => {
  const { title, message, class_id, teacher_id, author } = req.body
  const tenant_id = req.user.tenant_id
  if (!message) return res.status(400).json({ error: 'Announcement message is required' })

  const result = await pool.query(
    'INSERT INTO announcements (title, message, class_id, teacher_id, author, tenant_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [title || null, message, class_id || null, teacher_id || null, author || null, tenant_id]
  )
  res.json(result.rows[0])
})

app.delete('/api/announcements/:id', requireAuth(['admin', 'teacher', 'super_admin']), async (req, res) => {
  const tenant_id = req.user.tenant_id
  await pool.query('DELETE FROM announcements WHERE id = $1 AND tenant_id = $2', [req.params.id, tenant_id])
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
