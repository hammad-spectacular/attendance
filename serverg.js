const express = require('express')
const cors = require('cors')
const pool = require('./db')
const path = require('path')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const cookieParser = require('cookie-parser')
const crypto = require('crypto')
const nodemailer = require('nodemailer')
const rateLimit = require('express-rate-limit')
require('dotenv').config()
const { requireAuth, setPool } = require('./authMiddleware')

const app = express()
const JWT_SECRET = process.env.JWT_SECRET
console.log('JWT_SECRET loaded:', JWT_SECRET ? 'YES' : 'MISSING')
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Set it in Railway environment variables.')
  process.exit(1)
}
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || '12')
const JWT_EXPIRY = '8h'

// Inject pool into auth middleware so it can verify token_generation
setPool(pool)

// ============================================
// NODEMAILER SETUP
// ============================================
let mailTransporter = null
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  mailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: (process.env.SMTP_PORT || '587') === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  })
  console.log('Nodemailer transporter configured with SMTP_HOST:', process.env.SMTP_HOST)
} else {
  console.warn('SMTP not configured — email recovery is unavailable until SMTP is configured')
}

const APP_URL = process.env.APP_URL || 'http://localhost:3000'
const SMTP_FROM = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@theeye.app'
const RESET_TOKEN_EXPIRY_MINUTES = 30
const DEFAULT_STUDENT_LIMIT = Math.max(1, Number.parseInt(process.env.DEFAULT_STUDENT_LIMIT, 10) || 500)
const DEFAULT_TEACHER_LIMIT = Math.max(1, Number.parseInt(process.env.DEFAULT_TEACHER_LIMIT, 10) || 50)

// ============================================
// RATE LIMITER — forgot-password
// ============================================
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // 3 requests per IP per window
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
})

const adminRecoveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many recovery requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false
})

const bulkCreateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  message: { error: 'Too many bulk-create requests. Maximum 5 per minute.' },
  standardHeaders: true,
  legacyHeaders: false
})

const ACCOUNT_TABLES = {
  admin: 'admins',
  super_admin: 'admins',
  teacher: 'teachers',
  student: 'students'
}

function tableForRole(role) {
  return ACCOUNT_TABLES[role] || null
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase()
  if (!email) return null
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return undefined
  return email
}

function generateTempPassword() {
  const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const specials = '!@#$%^&*'
  const pick = source => source[crypto.randomInt(source.length)]
  const password = Array.from({ length: 14 }, () => pick(chars)).concat(pick(specials))
  for (let index = password.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1)
    ;[password[index], password[swapIndex]] = [password[swapIndex], password[index]]
  }
  return password.join('')
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char])
}

function parsePositiveLimit(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) return null
  return n
}

async function fetchCapacity(q, tenantId) {
  const result = await q.query(
    `SELECT student_limit, teacher_limit,
            (SELECT COUNT(*) FROM students WHERE tenant_id = o.school_code) AS student_count,
            (SELECT COUNT(*) FROM teachers WHERE tenant_id = o.school_code) AS teacher_count
     FROM organizations o WHERE o.school_code = $1`,
    [tenantId]
  )
  return result.rows[0] || null
}

// Amount to be collected for one month, derived from a fee structure.
// admission_fee is deliberately excluded: it is a one-time charge, so adding it
// to every month would re-bill it. Never returns a negative amount.
function monthlyAmountDue(fs) {
  if (!fs) return 0
  const monthly   = Number(fs.monthly_fee)   || 0
  const transport = Number(fs.transport_fee) || 0
  const discount  = Number(fs.discount)      || 0
  return Math.max(0, monthly + transport - discount)
}

// Rejects a roll number or full name that is already used by another student in
// the same school. excludeId lets the edit paths ignore the student being edited.
// Returns an error string, or null when the values are acceptable.
async function findStudentDuplicate(q, tenantId, { roll_no, name }, excludeId = null) {
  if (roll_no !== undefined && roll_no !== null && String(roll_no).trim()) {
    const dupeRoll = await q.query(
      `SELECT id, name FROM students
       WHERE tenant_id = $1
         AND lower(btrim(roll_no)) = lower(btrim($2))
         AND ($3::int IS NULL OR id <> $3::int)
       LIMIT 1`,
      [tenantId, String(roll_no).trim(), excludeId]
    )
    if (dupeRoll.rows.length) {
      return `Roll number "${String(roll_no).trim()}" is already used by another student in this school. Please choose a different one.`
    }
  }

  if (name !== undefined && name !== null && String(name).trim()) {
    const dupeName = await q.query(
      `SELECT id, roll_no FROM students
       WHERE tenant_id = $1
         AND lower(btrim(regexp_replace(name, '\\s+', ' ', 'g'))) = lower(btrim(regexp_replace($2, '\\s+', ' ', 'g')))
         AND ($3::int IS NULL OR id <> $3::int)
       LIMIT 1`,
      [tenantId, String(name).trim(), excludeId]
    )
    if (dupeName.rows.length) {
      return `A student named "${String(name).trim()}" already exists in this school. Names must be unique.`
    }
  }

  return null
}

async function capacityViolation(q, tenantId, type, batchSize = 1) {
  const cap = await fetchCapacity(q, tenantId)
  if (!cap) return null
  const isStudent = type === 'student'
  const limit = Number(cap[isStudent ? 'student_limit' : 'teacher_limit'])
  const current = Number(cap[isStudent ? 'student_count' : 'teacher_count'])
  const needing = Math.max(1, Math.floor(Number(batchSize) || 1))
  if (current + needing <= limit) return null
  const label = isStudent ? 'Student' : 'Teacher'
  if (needing === 1) return `${label} capacity reached (${limit}). Contact Super Admin to increase your capacity.`
  return `Not enough ${label.toLowerCase()} capacity: ${current} / ${limit} used, and this batch of ${needing} would exceed the limit. Contact Super Admin to increase your capacity.`
}

function parseFullId(full_id) {
  const value = String(full_id || '').trim().toUpperCase()
  if (!value) return { tenant_id: '', login_id: '', isValid: false }

  if (value === 'ADM' || value === 'SUPER-ADM') {
    return { tenant_id: 'SUPER', login_id: 'ADM', isValid: true }
  }

  const lastDash = value.lastIndexOf('-')
  if (lastDash <= 0 || lastDash === value.length - 1) {
    return { tenant_id: '', login_id: '', isValid: false }
  }

  const tenant_id = value.substring(0, lastDash)
  const login_id = value.substring(lastDash + 1)

  if (!tenant_id || !login_id) {
    return { tenant_id: '', login_id: '', isValid: false }
  }

  return { tenant_id, login_id, isValid: true }
}

function requireSameOrigin(req, res, next) {
  const origin = req.get('origin')
  const expectedOrigin = `${req.protocol}://${req.get('host')}`
  if (origin && origin !== expectedOrigin && origin !== APP_URL.replace(/\/$/, '')) {
    return res.status(403).send('Invalid request origin')
  }
  next()
}

async function issueEmailVerification(user) {
  if (!mailTransporter || !user.email) return false
  const rawToken = crypto.randomBytes(32).toString('hex')
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
  await pool.query(
    `UPDATE email_verification_tokens SET used = true
     WHERE user_id = $1 AND user_role = $2 AND used = false`,
    [user.id, user.role]
  )
  await pool.query(
    `INSERT INTO email_verification_tokens (user_id, user_role, token_hash, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '24 hours')`,
    [user.id, user.role, tokenHash]
  )
  const verificationUrl = `${APP_URL}/verify-email.html?token=${rawToken}`
  await mailTransporter.sendMail({
    from: SMTP_FROM,
    to: user.email,
    subject: 'Verify your recovery email — The Eye',
    text: `Verify this email address for password recovery: ${verificationUrl}\n\nThis link expires in 24 hours.`,
    html: `<p>Verify this email address for password recovery.</p><p><a href="${verificationUrl}">Verify email address</a></p><p>This link expires in 24 hours.</p>`
  })
  return true
}

app.use(cors({
  origin: (origin, callback) => {
    // Same-origin and server-to-server requests have no Origin header
    if (!origin) return callback(null, true)
    const allowed = [
      'https://theeye-beta.vercel.app',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://16.16.104.177',
      'http://13.50.106.16'
    ]
    if (allowed.includes(origin)) return callback(null, true)
    // Vercel preview deployments use unique subdomains
    if (/^https:\/\/[\w-]+\.vercel\.app$/.test(origin)) return callback(null, true)
    // Local dev servers (like Live Server on any port, localhost, or local IP)
    if (/^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$/.test(origin)) return callback(null, true)
    callback(null, false)
  },
  credentials: true
}))
app.use(express.json())
app.use(express.urlencoded({ extended: false }))
app.use(cookieParser())

app.use(express.static('public'))

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'))
})

// Catch-all for .html pages — only matches paths that look like page names,
// NOT API routes. API routes (all start with /api/) are defined after this
// section and take precedence because Express matches in definition order.
app.get('/:page.html', (req, res, next) => {
  // Skip API routes — they are handled by their own route handlers below
  if (req.params.page.startsWith('api/')) return next();
  const safePage = req.params.page.replace(/[^a-zA-Z0-9-_]/g, '');
  res.sendFile(path.join(__dirname, `${safePage}.html`), (err) => {
    if (err) next();
  });
})

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

    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS student_limit INTEGER NOT NULL DEFAULT ${DEFAULT_STUDENT_LIMIT};
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS teacher_limit INTEGER NOT NULL DEFAULT ${DEFAULT_TEACHER_LIMIT};
    UPDATE organizations SET student_limit = GREATEST(student_limit, (SELECT COUNT(*) FROM students s WHERE s.tenant_id = organizations.school_code));
    UPDATE organizations SET teacher_limit = GREATEST(teacher_limit, (SELECT COUNT(*) FROM teachers t WHERE t.tenant_id = organizations.school_code));

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
    ALTER TABLE teachers ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
    ALTER TABLE teachers ADD COLUMN IF NOT EXISTS is_frozen BOOLEAN DEFAULT false;
  `)

  await pool.query(`
    ALTER TABLE students ADD COLUMN IF NOT EXISTS login_id VARCHAR(50) UNIQUE;
    ALTER TABLE students ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
    ALTER TABLE students ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'student';
    ALTER TABLE students ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(10);
    ALTER TABLE students ADD COLUMN IF NOT EXISTS is_first_login BOOLEAN DEFAULT true;
    ALTER TABLE students ADD COLUMN IF NOT EXISTS is_frozen BOOLEAN DEFAULT false;
    ALTER TABLE students ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
  `)

  // Migrate roll_no uniqueness to be scoped to tenant_id
  await pool.query(`
    ALTER TABLE students DROP CONSTRAINT IF EXISTS students_roll_no_key;
    ALTER TABLE students DROP CONSTRAINT IF EXISTS students_tenant_roll_no_key;
  `)
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'students_tenant_roll_key') THEN
        ALTER TABLE students ADD CONSTRAINT students_tenant_roll_key UNIQUE (tenant_id, roll_no);
      END IF;
    END $$;
  `)

  await pool.query(`
    ALTER TABLE attendance ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(10);
    ALTER TABLE classes ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(10);
    ALTER TABLE homework ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(10);
    ALTER TABLE announcements ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(10);
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS contact_email VARCHAR(200);
  `)


  await pool.query(`
    CREATE TABLE IF NOT EXISTS fee_structures (
      id SERIAL PRIMARY KEY,
      type VARCHAR(20) NOT NULL,
      target_id INTEGER NOT NULL,
      monthly_fee NUMERIC(10, 2) DEFAULT 0,
      admission_fee NUMERIC(10, 2) DEFAULT 0,
      transport_fee NUMERIC(10, 2) DEFAULT 0,
      discount NUMERIC(10, 2) DEFAULT 0,
      tenant_id VARCHAR(10) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS fee_payments (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL,
      month VARCHAR(7) NOT NULL,
      amount_due NUMERIC(10, 2) DEFAULT 0,
      amount_paid NUMERIC(10, 2) DEFAULT 0,
      status VARCHAR(20) DEFAULT 'unpaid',
      payment_method VARCHAR(50),
      payment_date DATE,
      notes TEXT,
      tenant_id VARCHAR(10) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(student_id, month, tenant_id)
    );
  `)

  // Fix existing admin login_id values that were stored as the full concatenated ID
  await pool.query(`
    UPDATE admins SET login_id = 'ADM' WHERE tenant_id = 'SUPER' AND login_id = 'SUPER-ADM'
  `)

  // Fix existing regular admin login_id values that were stored with full concatenated IDs (e.g. 'HARV-ADM' -> 'ADM')
  await pool.query(`
    UPDATE admins 
    SET login_id = SUBSTRING(login_id FROM POSITION('-' IN login_id) + 1)
    WHERE login_id LIKE '%-%'
      AND role <> 'super_admin';
  `)

  // Fix existing teacher/student login_id values that were stored with full concatenated IDs (e.g. 'APSC-T001' -> 'T001')
  await pool.query(`
    UPDATE teachers 
    SET login_id = SUBSTRING(login_id FROM POSITION('-' IN login_id) + 1)
    WHERE login_id LIKE '%-%';

    UPDATE students 
    SET login_id = SUBSTRING(login_id FROM POSITION('-' IN login_id) + 1)
    WHERE login_id LIKE '%-%';
  `)

  // Fix global UNIQUE constraints on login_id to be scoped per tenant_id
  await pool.query(`
    ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_login_id_key;
    ALTER TABLE teachers DROP CONSTRAINT IF EXISTS teachers_login_id_key;
    ALTER TABLE students DROP CONSTRAINT IF EXISTS students_login_id_key;
  `)
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admins_tenant_login_key') THEN
        ALTER TABLE admins ADD CONSTRAINT admins_tenant_login_key UNIQUE (tenant_id, login_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teachers_tenant_login_key') THEN
        ALTER TABLE teachers ADD CONSTRAINT teachers_tenant_login_key UNIQUE (tenant_id, login_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'students_tenant_login_key') THEN
        ALTER TABLE students ADD CONSTRAINT students_tenant_login_key UNIQUE (tenant_id, login_id);
      END IF;
    END $$;
  `)

  // ============================================
  // PASSWORD RESET: email columns, token_generation, reset tokens table
  // ============================================
  await pool.query(`
    ALTER TABLE admins ADD COLUMN IF NOT EXISTS email VARCHAR(200);
    ALTER TABLE teachers ADD COLUMN IF NOT EXISTS email VARCHAR(200);
    ALTER TABLE students ADD COLUMN IF NOT EXISTS email VARCHAR(200);
    ALTER TABLE admins ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
    ALTER TABLE teachers ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
    ALTER TABLE students ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
  `)

  await pool.query(`
    ALTER TABLE admins ADD COLUMN IF NOT EXISTS token_generation INTEGER DEFAULT 0;
    ALTER TABLE teachers ADD COLUMN IF NOT EXISTS token_generation INTEGER DEFAULT 0;
    ALTER TABLE students ADD COLUMN IF NOT EXISTS token_generation INTEGER DEFAULT 0;
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      user_role VARCHAR(20) NOT NULL,
      token_hash VARCHAR(255) NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      used BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      user_role VARCHAR(20) NOT NULL,
      token_hash VARCHAR(255) NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS admin_password_reset_audit (
      id SERIAL PRIMARY KEY,
      actor_id INTEGER NOT NULL,
      actor_role VARCHAR(20) NOT NULL,
      target_id INTEGER NOT NULL,
      target_role VARCHAR(20) NOT NULL,
      tenant_id VARCHAR(10) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS password_reset_tokens_active_lookup_idx
      ON password_reset_tokens (user_id, user_role, used, expires_at);
    CREATE INDEX IF NOT EXISTS email_verification_tokens_active_lookup_idx
      ON email_verification_tokens (user_id, user_role, used, expires_at);
  `)

  // Ensure token_generation is initialized for existing users
  await pool.query(`UPDATE admins SET token_generation = 0 WHERE token_generation IS NULL`)
  await pool.query(`UPDATE teachers SET token_generation = 0 WHERE token_generation IS NULL`)
  await pool.query(`UPDATE students SET token_generation = 0 WHERE token_generation IS NULL`)

  // A class must have at most ONE assigned teacher. Without this, two teachers can
  // share a class_id, which duplicates every attendance row for that class and makes
  // the student portal show whichever teacher happens to have the lowest id.
  // Resolve existing conflicts by keeping the most recently created teacher.
  const dupeClasses = await pool.query(`
    SELECT class_id, tenant_id, COUNT(*) AS n,
           ARRAY_AGG(id ORDER BY id) AS teacher_ids
    FROM teachers
    WHERE class_id IS NOT NULL
    GROUP BY class_id, tenant_id
    HAVING COUNT(*) > 1
  `)
  if (dupeClasses.rows.length) {
    for (const row of dupeClasses.rows) {
      const keep = row.teacher_ids[row.teacher_ids.length - 1]
      const drop = row.teacher_ids.slice(0, -1)
      await pool.query(
        'UPDATE teachers SET class_id = NULL WHERE id = ANY($1::int[]) AND tenant_id = $2',
        [drop, row.tenant_id]
      )
      console.warn(
        `[migration] class ${row.class_id} had ${row.n} teachers; kept ${keep}, unassigned ${drop.join(', ')}`
      )
    }
  }

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS teachers_one_class_per_tenant_idx
      ON teachers (class_id) WHERE class_id IS NOT NULL
  `)

  console.log('Tables ready')
}


// ============================================
// HEALTH CHECK (used by frontend / deploy verification)
// ============================================
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'serverg', auth: true, ts: Date.now() })
})

// ============================================
// AUTH ROUTES
// ============================================

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { password, tenant_id: bodyTenantId, login_id: bodyLoginId } = req.body
    let full_id = (req.body.full_id || '').trim()
    if (!full_id && bodyTenantId && bodyLoginId) {
      full_id = `${bodyTenantId}-${bodyLoginId}`.trim()
    }
    if (!full_id && bodyLoginId) {
      full_id = String(bodyLoginId).trim()
    }
    const parsed = parseFullId(full_id)
    const tenant_id = parsed.tenant_id
    const login_id = parsed.login_id
    if (!parsed.isValid || !password) {
      return res.status(400).json({ error: 'Full ID and Password are required' })
    }

    const result = await pool.query(`
      SELECT id, password_hash, role, is_first_login, is_frozen, token_generation, 1 AS src_order
      FROM students
      WHERE tenant_id = $1 AND login_id = $2
      UNION ALL
      SELECT id, password_hash, role, is_first_login, COALESCE(is_frozen, false) AS is_frozen, token_generation, 2 AS src_order
      FROM teachers
      WHERE tenant_id = $1 AND login_id = $2
      UNION ALL
      SELECT id, password_hash, role, is_first_login, FALSE AS is_frozen, token_generation, 3 AS src_order
      FROM admins
      WHERE tenant_id = $1 AND login_id = $2
      ORDER BY src_order
      LIMIT 1
    `, [tenant_id, login_id])

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
    let redirect_url = redirectMap[user.role] || '/index.html'
    
    // If first login, redirect to change password page
    if (user.is_first_login) {
      redirect_url = '/change-password.html'
    }

    const token = jwt.sign(
      {
        user_id: user.id,
        role: user.role,
        tenant_id: tenant_id,
        login_id: login_id,
        is_first_login: user.is_first_login,
        token_generation: user.token_generation || 0
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    )

    const isProd = process.env.NODE_ENV === 'production'
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      path: '/',
      maxAge: 8 * 60 * 60 * 1000
    })

    return res.status(200).json({
      success: true,
      token,
      role: user.role,
      is_first_login: user.is_first_login,
      redirect_url
    })


  } catch (err) {
    console.error('Login error:', err)
    return res.status(500).json({ error: 'Internal server error: ' + err.message })
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

    if (new_password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' })
    }

    // Check for at least one special character
    const specialChars = /[!@#$%^&*(),.?":{}|<>]/
    if (!specialChars.test(new_password)) {
      return res.status(400).json({ error: 'Password must contain at least one special character (!@#$%^&*(),.?":{}|<>)' })
    }

    const { user_id, role, tenant_id, login_id } = req.user
    let selectQuery = ''
    let updateQuery = ''

    if (role === 'super_admin' || role === 'admin') {
      selectQuery = 'SELECT password_hash, token_generation, is_first_login FROM admins WHERE id = $1'
      updateQuery = 'UPDATE admins SET password_hash = $1, is_first_login = false, token_generation = COALESCE(token_generation, 0) + 1 WHERE id = $2 RETURNING token_generation'
    } else if (role === 'teacher') {
      selectQuery = 'SELECT password_hash, token_generation, is_first_login FROM teachers WHERE id = $1'
      updateQuery = 'UPDATE teachers SET password_hash = $1, is_first_login = false, token_generation = COALESCE(token_generation, 0) + 1 WHERE id = $2 RETURNING token_generation'
    } else if (role === 'student') {
      selectQuery = 'SELECT password_hash, token_generation, is_first_login FROM students WHERE id = $1'
      updateQuery = 'UPDATE students SET password_hash = $1, is_first_login = false, token_generation = COALESCE(token_generation, 0) + 1 WHERE id = $2 RETURNING token_generation'
    } else {
      return res.status(400).json({ error: 'Invalid role' })
    }

    const result = await pool.query(selectQuery, [user_id])

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' })
    }

    const user = result.rows[0]
    const isFirstLogin = user.is_first_login === true

    if (!isFirstLogin) {
      // Only require current password for non-first-time logins
      if (!current_password) {
        return res.status(400).json({ error: 'Please enter your current password' })
      }
      const validCurrent = await bcrypt.compare(current_password, user.password_hash)
      if (!validCurrent) {
        return res.status(400).json({ error: 'Current password is incorrect' })
      }
    }

    const newHash = await bcrypt.hash(new_password, BCRYPT_ROUNDS)

    const updateResult = await pool.query(updateQuery, [newHash, user_id])
    const tokenGeneration = updateResult.rows[0].token_generation

const token = jwt.sign(
        {
          user_id,
          role,
          tenant_id,
          login_id,
          is_first_login: false,
          token_generation: tokenGeneration
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRY }
      )

      const isProd = process.env.NODE_ENV === 'production'
      res.cookie('auth_token', token, {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? 'none' : 'lax',
        path: '/',
        maxAge: 8 * 60 * 60 * 1000
      })

      const redirectMap = { super_admin: '/super-admin.html', admin: '/admin.html', teacher: '/teacher.html', student: '/student.html' }
      const redirect_url = redirectMap[role] || '/'

    res.json({ success: true, token, redirect_url, message: 'Password changed successfully' })
  } catch (err) {
    console.error('Change password error:', err)
    res.status(500).json({ error: 'Server error: ' + err.message })
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

// ============================================
// POST /api/auth/forgot-password
// ============================================
app.post('/api/auth/forgot-password', forgotPasswordLimiter, async (req, res) => {
  const GENERIC_MSG = 'If a verified recovery email is registered for that account, a reset link has been sent. Otherwise, contact your administrator.'
  try {
    let full_id = (req.body.full_id || '').trim()
    if (!full_id) {
      return res.status(400).json({ error: 'Full ID is required' })
    }

    const parsed = parseFullId(full_id)
    const tenant_id = parsed.tenant_id
    const login_id = parsed.login_id

    if (!parsed.isValid) {
      // Don't reveal that the ID format is wrong — return generic message
      return res.json({ success: true, message: GENERIC_MSG })
    }

    // Look up user across all tables
    const result = await pool.query(`
      SELECT id, role, email, email_verified_at, 1 AS src_order FROM students WHERE tenant_id = $1 AND login_id = $2
      UNION ALL
      SELECT id, role, email, email_verified_at, 2 AS src_order FROM teachers WHERE tenant_id = $1 AND login_id = $2
      UNION ALL
      SELECT id, role, email, email_verified_at, 3 AS src_order FROM admins WHERE tenant_id = $1 AND login_id = $2
      ORDER BY src_order
      LIMIT 1
    `, [tenant_id, login_id])

    if (result.rows.length === 0) {
      return res.json({ success: true, message: GENERIC_MSG })
    }

    const user = result.rows[0]

    if (!user.email || !user.email_verified_at) {
      return res.json({ success: true, message: GENERIC_MSG })
    }

    // Generate cryptographically secure token
    const rawToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
    const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000)

    // Store only the hash
    await pool.query(
      `UPDATE password_reset_tokens SET used = true
       WHERE user_id = $1 AND user_role = $2 AND used = false`,
      [user.id, user.role]
    )
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, user_role, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [user.id, user.role, tokenHash, expiresAt]
    )

    const resetUrl = `${APP_URL}/reset-password.html?token=${rawToken}`

    // Send email
    if (mailTransporter) {
      try {
        await mailTransporter.sendMail({
          from: SMTP_FROM,
          to: user.email,
          subject: 'Password Reset — The Eye',
          text: `You requested a password reset.\n\nClick the link below to reset your password:\n${resetUrl}\n\nThis link expires in ${RESET_TOKEN_EXPIRY_MINUTES} minutes.\nIf you did not request this, ignore this email.`,
          html: `<p>You requested a password reset.</p><p><a href="${resetUrl}">Click here to reset your password</a></p><p>This link expires in ${RESET_TOKEN_EXPIRY_MINUTES} minutes.</p><p>If you did not request this, ignore this email.</p>`
        })
      } catch (emailErr) {
        console.error('Failed to send reset email:', emailErr.message)
      }
    }

    res.json({ success: true, message: GENERIC_MSG })
  } catch (err) {
    console.error('Forgot password error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

app.post('/api/auth/verify-email', async (req, res) => {
  const tokenHash = crypto.createHash('sha256').update(String(req.body.token || '')).digest('hex')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      `SELECT id, user_id, user_role FROM email_verification_tokens
       WHERE token_hash = $1 AND used = false AND expires_at > NOW() FOR UPDATE`,
      [tokenHash]
    )
    if (result.rows.length !== 1) {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'Invalid or expired verification link' })
    }
    const record = result.rows[0]
    const table = tableForRole(record.user_role)
    if (!table) throw new Error('Invalid verification role')
    await client.query(`UPDATE ${table} SET email_verified_at = NOW() WHERE id = $1`, [record.user_id])
    await client.query('UPDATE email_verification_tokens SET used = true WHERE id = $1', [record.id])
    await client.query('COMMIT')
    res.json({ success: true, message: 'Email verified. You can now use it for password recovery.' })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('Email verification error:', err.message)
    res.status(500).json({ error: 'Server error' })
  } finally {
    client.release()
  }
})

// ============================================
// POST /api/auth/reset-password
// ============================================
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, new_password, confirm_password } = req.body

    if (!token) {
      return res.status(400).json({ error: 'Reset token is required' })
    }

    if (!new_password || !confirm_password) {
      return res.status(400).json({ error: 'New password and confirmation are required' })
    }

    if (new_password !== confirm_password) {
      return res.status(400).json({ error: 'Passwords do not match' })
    }

    if (new_password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' })
    }

    const specialChars = /[!@#$%^&*(),.?":{}|<>]/
    if (!specialChars.test(new_password)) {
      return res.status(400).json({ error: 'Password must contain at least one special character' })
    }

    // Hash the provided token and look it up
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

    const newHash = await bcrypt.hash(new_password, BCRYPT_ROUNDS)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const tokenResult = await client.query(
        `SELECT id, user_id, user_role FROM password_reset_tokens
         WHERE token_hash = $1 AND used = false AND expires_at > NOW() FOR UPDATE`,
        [tokenHash]
      )
      if (tokenResult.rows.length !== 1) {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: 'Invalid or expired reset link' })
      }
      const resetRecord = tokenResult.rows[0]
      const role = resetRecord.user_role
      const table = tableForRole(role)
      if (!table) throw new Error('Invalid reset role')
      await client.query(
        `UPDATE ${table} SET password_hash = $1, is_first_login = false, token_generation = COALESCE(token_generation, 0) + 1 WHERE id = $2`,
        [newHash, resetRecord.user_id]
      )

      // Mark token as used
      await client.query(
        `UPDATE password_reset_tokens SET used = true WHERE id = $1`,
        [resetRecord.id]
      )

      await client.query('COMMIT')
    } catch (txErr) {
      await client.query('ROLLBACK')
      throw txErr
    } finally {
      client.release()
    }

    res.json({ success: true, message: 'Password has been reset successfully. You can now log in with your new password.' })
  } catch (err) {
    console.error('Reset password error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/auth/me
app.get('/api/auth/me', async (req, res) => {
  try {
    let token = null
    const authHeader = req.headers['authorization']
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7)
    } else if (req.cookies?.auth_token) {
      token = req.cookies.auth_token
    }

    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' })
    }

    const decoded = jwt.verify(token, JWT_SECRET)
    console.log('DEBUG /api/auth/me - decoded role:', decoded.role, 'user_id:', decoded.user_id)

    let table = ''
    if (decoded.role === 'super_admin' || decoded.role === 'admin') table = 'admins'
    else if (decoded.role === 'teacher') table = 'teachers'
    else if (decoded.role === 'student') table = 'students'

    let is_first_login = decoded.is_first_login
    let token_generation = decoded.token_generation || 0
    if (table) {
      const result = await pool.query(
        `SELECT is_first_login, token_generation FROM ${table} WHERE id = $1`,
        [decoded.user_id]
      )
      if (result.rows.length > 0) {
        is_first_login = result.rows[0].is_first_login
        token_generation = result.rows[0].token_generation || 0
      }

      // Reject tokens with stale generation (password was reset)
      if (decoded.token_generation !== undefined && decoded.token_generation !== token_generation) {
        return res.status(401).json({ error: 'Session invalidated. Please log in again.' })
      }
    }

    const freshToken = jwt.sign(
      {
        user_id: decoded.user_id,
        role: decoded.role,
        tenant_id: decoded.tenant_id,
        login_id: decoded.login_id,
        is_first_login,
        token_generation
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    )

    res.cookie('auth_token', freshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      path: '/',
      maxAge: 8 * 60 * 60 * 1000
    })

    return res.status(200).json({
      id: decoded.user_id,
      role: decoded.role,
      is_first_login,
      token: freshToken
    })

  } catch (err) {
    return res.status(401).json({ error: 'Session expired or invalid' })
  }
})

// POST /api/auth/create-teacher
app.post('/api/auth/create-teacher', requireAuth(['admin']), async (req, res) => {
  try {
    const { name, phone, class_id } = req.body
    const email = normalizeEmail(req.body.email)
    if (!name) return res.status(400).json({ error: 'Teacher name is required' })
    if (email === undefined) return res.status(400).json({ error: 'Enter a valid email address' })

    const tenant_id = req.user.tenant_id

    const capErr = await capacityViolation(pool, tenant_id, 'teacher')
    if (capErr) return res.status(400).json({ error: capErr })

    // One teacher per class: assigning a new teacher takes the class over.
    if (class_id) {
      const prevHolder = await pool.query(
        'SELECT id FROM teachers WHERE class_id = $1 AND tenant_id = $2',
        [class_id, tenant_id]
      )
      for (const h of prevHolder.rows) {
        await pool.query('UPDATE teachers SET class_id = NULL WHERE id = $1', [h.id])
      }
    }

    const highestResult = await pool.query(
      `SELECT login_id FROM teachers WHERE tenant_id = $1 AND (login_id LIKE 'T%' OR login_id LIKE $2) ORDER BY login_id DESC LIMIT 1`,
      [tenant_id, `${tenant_id}-T%`]
    )

    let nextNum = 1
    if (highestResult.rows.length > 0) {
      const lastId = highestResult.rows[0].login_id
      const match = lastId.match(/\d+$/)
      const numPart = match ? parseInt(match[0], 10) : NaN
      if (!isNaN(numPart)) nextNum = numPart + 1
    }

    const shortId = `T${String(nextNum).padStart(3, '0')}`
    const teacherId = `${tenant_id}-${shortId}`
    const tempPassword = generateTempPassword()
    const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS)

    const result = await pool.query(
      `INSERT INTO teachers (name, phone, class_id, login_id, password_hash, role, tenant_id, is_first_login, email, email_verified_at)
       VALUES ($1, $2, $3, $4, $5, 'teacher', $6, true, $7, NULL)
       RETURNING id, name, phone, class_id, login_id, role, tenant_id, is_first_login, email, email_verified_at`,
      [name, phone || null, class_id || null, shortId, passwordHash, tenant_id, email]
    )
    if (email) issueEmailVerification(result.rows[0]).catch(err => console.error('Verification email send failed:', err.message))
    res.json({ success: true, teacher_id: teacherId, teacher: result.rows[0], temp_password: tempPassword })
  } catch (err) {
    console.error('Create teacher error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/auth/create-student
app.post('/api/auth/create-student', requireAuth(['admin']), async (req, res) => {
  try {
    const { name, roll_no, phone, class_id } = req.body
    const email = normalizeEmail(req.body.email)
    if (!name) return res.status(400).json({ error: 'Student name is required' })
    if (email === undefined) return res.status(400).json({ error: 'Enter a valid email address' })

    const tenant_id = req.user.tenant_id

    const capErr = await capacityViolation(pool, tenant_id, 'student')
    if (capErr) return res.status(400).json({ error: capErr })

    const dupErr = await findStudentDuplicate(pool, tenant_id, { roll_no, name })
    if (dupErr) return res.status(400).json({ error: dupErr })

    const highestResult = await pool.query(
      `SELECT login_id FROM students WHERE tenant_id = $1 AND (login_id LIKE 'S%' OR login_id LIKE $2) ORDER BY login_id DESC LIMIT 1`,
      [tenant_id, `${tenant_id}-S%`]
    )

    let nextNum = 1
    if (highestResult.rows.length > 0) {
      const lastId = highestResult.rows[0].login_id
      const match = lastId.match(/\d+$/)
      const numPart = match ? parseInt(match[0], 10) : NaN
      if (!isNaN(numPart)) nextNum = numPart + 1
    }

    const shortId = `S${String(nextNum).padStart(3, '0')}`
    const studentId = `${tenant_id}-${shortId}`
    const tempPassword = generateTempPassword()
    const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS)

    const result = await pool.query(
      `INSERT INTO students (name, roll_no, phone, class_id, login_id, password_hash, role, tenant_id, is_first_login, email, email_verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'student', $7, true, $8, NULL)
       RETURNING id, name, roll_no, phone, class_id, login_id, role, tenant_id, is_first_login, email, email_verified_at`,
      [name, roll_no || null, phone || null, class_id || null, shortId, passwordHash, tenant_id, email]
    )
    if (email) issueEmailVerification(result.rows[0]).catch(err => console.error('Verification email send failed:', err.message))
    res.json({ success: true, student_id: studentId, student: result.rows[0], temp_password: tempPassword })
  } catch (err) {
    console.error('Create student error:', err)

    if (err.code === '23505' && err.constraint === 'students_tenant_roll_key') {
      return res.status(400).json({ error: `Roll number "${roll_no}" is already used by another student in this school. Please choose a different one.` })
    }

    res.status(500).json({ error: 'Something went wrong while creating the student. Please try again.' })
  }
})

// POST /api/auth/bulk-create-students
app.post('/api/auth/bulk-create-students', requireAuth(['admin', 'super_admin']), bulkCreateLimiter, async (req, res) => {
  let count = parseInt(req.body.count, 10);
  const class_id = req.body.class_id;
  if (isNaN(count) || count < 1) return res.status(400).json({ error: 'Valid count is required' });
  if (count > 500) return res.status(400).json({ error: 'Maximum 500 accounts per batch' });
  if (!class_id) return res.status(400).json({ error: 'class_id is required' });

  const tenant_id = req.user.tenant_id;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const capErr = await capacityViolation(client, tenant_id, 'student', count);
    if (capErr) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: capErr });
    }

    const highestResult = await client.query(
      `SELECT login_id FROM students WHERE tenant_id = $1 AND (login_id LIKE 'S%' OR login_id LIKE $2) ORDER BY login_id DESC LIMIT 1`,
      [tenant_id, `${tenant_id}-S%`]
    );

    let nextNum = 1;
    if (highestResult.rows.length > 0) {
      const lastId = highestResult.rows[0].login_id;
      const match = lastId.match(/\d+$/);
      const numPart = match ? parseInt(match[0], 10) : NaN;
      if (!isNaN(numPart)) nextNum = numPart + 1;
    }

    const createdAccounts = [];
    const values = [];
    let paramIndex = 1;
    const queryParams = [];

    for (let i = 0; i < count; i++) {
      const shortId = `S${String(nextNum + i).padStart(3, '0')}`;
      const tempPassword = generateTempPassword();
      const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
      const name = `Student ${i + 1}`;
      
      // name, roll_no, phone, class_id, login_id, password_hash, role, tenant_id, is_first_login, email
      queryParams.push(name, null, null, class_id, shortId, passwordHash, tenant_id);
      values.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, 'student', $${paramIndex++}, true, NULL)`);
      createdAccounts.push({ login_id: `${tenant_id}-${shortId}`, db_login_id: shortId, temp_password: tempPassword, name });
    }

    const insertQuery = `
      INSERT INTO students (name, roll_no, phone, class_id, login_id, password_hash, role, tenant_id, is_first_login, email)
      VALUES ${values.join(', ')}
      RETURNING id, login_id
    `;

    const insertResult = await client.query(insertQuery, queryParams);
    await client.query('COMMIT');

    // Map generated ids back onto the accounts by login_id (robust against row order).
    const idByLoginId = new Map();
    for (const row of insertResult.rows) {
      idByLoginId.set(row.login_id, row.id);
    }
    for (const acct of createdAccounts) {
      acct.id = idByLoginId.get(acct.db_login_id) ?? null;
      delete acct.db_login_id;
    }
    
    res.json({ success: true, accounts: createdAccounts });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Bulk create student error:', err);
    res.status(500).json({ error: 'Server error during bulk creation' });
  } finally {
    client.release();
  }
});

// POST /api/auth/bulk-create-teachers
app.post('/api/auth/bulk-create-teachers', requireAuth(['admin', 'super_admin']), bulkCreateLimiter, async (req, res) => {
  let count = parseInt(req.body.count, 10);
  if (isNaN(count) || count < 1) return res.status(400).json({ error: 'Valid count is required' });
  if (count > 500) return res.status(400).json({ error: 'Maximum 500 accounts per batch' });

  const tenant_id = req.user.tenant_id;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const capErr = await capacityViolation(client, tenant_id, 'teacher', count);
    if (capErr) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: capErr });
    }

    const highestResult = await client.query(
      `SELECT login_id FROM teachers WHERE tenant_id = $1 AND (login_id LIKE 'T%' OR login_id LIKE $2) ORDER BY login_id DESC LIMIT 1`,
      [tenant_id, `${tenant_id}-T%`]
    );

    let nextNum = 1;
    if (highestResult.rows.length > 0) {
      const lastId = highestResult.rows[0].login_id;
      const match = lastId.match(/\d+$/);
      const numPart = match ? parseInt(match[0], 10) : NaN;
      if (!isNaN(numPart)) nextNum = numPart + 1;
    }

    const createdAccounts = [];
    const values = [];
    let paramIndex = 1;
    const queryParams = [];

    for (let i = 0; i < count; i++) {
      const shortId = `T${String(nextNum + i).padStart(3, '0')}`;
      const tempPassword = generateTempPassword();
      const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
      const name = `Teacher ${i + 1}`;
      
      // name, phone, class_id, login_id, password_hash, role, tenant_id, is_first_login, email
      queryParams.push(name, null, null, shortId, passwordHash, tenant_id);
      values.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, 'teacher', $${paramIndex++}, true, NULL)`);
      createdAccounts.push({ login_id: `${tenant_id}-${shortId}`, temp_password: tempPassword, name });
    }

    const insertQuery = `
      INSERT INTO teachers (name, phone, class_id, login_id, password_hash, role, tenant_id, is_first_login, email)
      VALUES ${values.join(', ')}
    `;

    await client.query(insertQuery, queryParams);
    await client.query('COMMIT');
    
    res.json({ success: true, accounts: createdAccounts });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Bulk create teacher error:', err);
    res.status(500).json({ error: 'Server error during bulk creation' });
  } finally {
    client.release();
  }
});

// This endpoint intentionally renders a one-time, no-store HTML document instead
// of returning a password in a JSON API response. It is opened by an authorized
// administrator in a separate window after they have verified the user offline.
app.post('/admin/recovery-reveal', requireAuth(['admin', 'super_admin']), requireSameOrigin, adminRecoveryLimiter, async (req, res) => {
  const targetId = Number.parseInt(req.body.target_id, 10)
  const targetRole = String(req.body.target_role || '')
  const table = tableForRole(targetRole)
  if (!Number.isInteger(targetId) || !table || targetRole === 'super_admin') {
    return res.status(400).send('Invalid recovery request')
  }
  if (req.user.role === 'admin' && !['student', 'teacher'].includes(targetRole)) {
    return res.status(403).send('You are not permitted to reset this account')
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const scope = req.user.role === 'admin' ? ' AND tenant_id = $2' : ''
    const params = req.user.role === 'admin' ? [targetId, req.user.tenant_id] : [targetId]
    const target = await client.query(
      `SELECT id, name, tenant_id FROM ${table} WHERE id = $1${scope} FOR UPDATE`,
      params
    )
    if (target.rows.length !== 1) {
      await client.query('ROLLBACK')
      return res.status(404).send('Account not found')
    }
    const temporaryPassword = generateTempPassword()
    const passwordHash = await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS)
    await client.query(
      `UPDATE ${table}
       SET password_hash = $1, is_first_login = true, token_generation = COALESCE(token_generation, 0) + 1
       WHERE id = $2`,
      [passwordHash, targetId]
    )
    await client.query(
      `UPDATE password_reset_tokens SET used = true WHERE user_id = $1 AND user_role = $2 AND used = false`,
      [targetId, targetRole]
    )
    await client.query(
      `INSERT INTO admin_password_reset_audit (actor_id, actor_role, target_id, target_role, tenant_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.user_id, req.user.role, targetId, targetRole, target.rows[0].tenant_id]
    )
    await client.query('COMMIT')

    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      Pragma: 'no-cache',
      'Referrer-Policy': 'no-referrer',
      'Content-Type': 'text/html; charset=utf-8'
    })
    return res.send(`<!doctype html><title>Temporary password</title><meta name="robots" content="noindex"><style>body{font-family:system-ui;max-width:560px;margin:48px auto;padding:24px;color:#172033}code{display:block;padding:18px;background:#f1f5f9;border-radius:8px;font-size:22px;word-break:break-all}.warn{color:#9a6700}</style><h1>Temporary password</h1><p>Provide this password to <strong>${escapeHtml(target.rows[0].name || 'the user')}</strong> through an approved private channel. It is shown only in this window.</p><code>${escapeHtml(temporaryPassword)}</code><p class="warn">They must change it on first login. Close this window after recording it.</p><script>window.addEventListener('pagehide',()=>document.body.textContent='Temporary password closed.');</script>`)
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('Admin recovery error:', err.message)
    res.status(500).send('Unable to reset the password')
  } finally {
    client.release()
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

    const existing = await pool.query(
      'SELECT id, status FROM school_requests WHERE contact_email = $1',
      [contact_email]
    )
    if (existing.rows.length > 0) {
      const status = existing.rows[0].status
      if (status === 'pending') {
        return res.status(400).json({ error: 'A request with this email is already pending review.' })
      }
      if (status === 'approved') {
        return res.status(400).json({ error: 'This email has already been approved. Please check your login details.' })
      }
      // if rejected, allow resubmission by deleting the old rejected request first
      await pool.query('DELETE FROM school_requests WHERE id = $1', [existing.rows[0].id])
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
    const { request_id, school_code, school_name, student_limit, teacher_limit } = req.body

    if (!request_id || !school_code || !school_name) {
      return res.status(400).json({ error: 'All fields are required' })
    }

    const code = school_code.toUpperCase()
    if (!/^[A-Z]{4}$/.test(code)) {
      return res.status(400).json({ error: 'School code must be exactly 4 uppercase letters' })
    }

    const parsedStudentLimit = parsePositiveLimit(student_limit, DEFAULT_STUDENT_LIMIT)
    const parsedTeacherLimit = parsePositiveLimit(teacher_limit, DEFAULT_TEACHER_LIMIT)
    if (parsedStudentLimit === null) {
      return res.status(400).json({ error: 'Student capacity must be a positive whole number' })
    }
    if (parsedTeacherLimit === null) {
      return res.status(400).json({ error: 'Teacher capacity must be a positive whole number' })
    }

    const requestResult = await pool.query('SELECT contact_person, contact_email FROM school_requests WHERE id = $1', [request_id])
    if (requestResult.rows.length === 0) {
      return res.status(404).json({ error: 'School request not found' })
    }

    const contactEmail = requestResult.rows[0].contact_email
    const contactPerson = requestResult.rows[0].contact_person || 'Admin'

    const existing = await pool.query('SELECT id FROM organizations WHERE school_code = $1', [code])
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'School code already taken' })
    }

    let tempPasswordToReturn = ''

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      await client.query(
        'INSERT INTO organizations (school_code, school_name, contact_email, status, student_limit, teacher_limit) VALUES ($1, $2, $3, $4, $5, $6)',
        [code, school_name, contactEmail, 'active', parsedStudentLimit, parsedTeacherLimit]
      )

      tempPasswordToReturn = generateTempPassword()
      const passwordHash = await bcrypt.hash(tempPasswordToReturn, BCRYPT_ROUNDS)

      await client.query(
        `INSERT INTO admins (login_id, name, email, password_hash, role, tenant_id, is_first_login, email_verified_at)
         VALUES ('ADM', $1, $2, $3, 'admin', $4, true, NULL)`,
        [contactPerson, normalizeEmail(contactEmail), passwordHash, code]
      )

      await client.query('UPDATE school_requests SET status = $1 WHERE id = $2', ['approved', request_id])

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    res.json({ success: true, admin_id: `${code}-ADM`, temp_password: tempPasswordToReturn })
  } catch (err) {
    console.error('Approve school error:', err)
    res.status(500).json({ error: 'An unexpected error occurred while approving the school. Please try again or contact support.' })
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
      `SELECT o.*,
              (SELECT COUNT(*) FROM students s WHERE s.tenant_id = o.school_code) AS student_count,
              (SELECT COUNT(*) FROM teachers t WHERE t.tenant_id = o.school_code) AS teacher_count
       FROM organizations o WHERE o.status = 'active' ORDER BY o.created_at DESC`
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/auth/update-school-capacity
app.post('/api/auth/update-school-capacity', requireAuth(['super_admin']), async (req, res) => {
  try {
    const { school_code, student_limit, teacher_limit } = req.body
    const code = String(school_code || '').trim().toUpperCase()
    if (!/^[A-Z]{4}$/.test(code)) {
      return res.status(400).json({ error: 'Valid 4-letter school code is required' })
    }

    const hasStudent = !(student_limit === undefined || student_limit === null || student_limit === '')
    const hasTeacher = !(teacher_limit === undefined || teacher_limit === null || teacher_limit === '')
    if (!hasStudent && !hasTeacher) {
      return res.status(400).json({ error: 'Provide at least one capacity value' })
    }
    const parsedStudent = hasStudent ? parsePositiveLimit(student_limit, null) : undefined
    const parsedTeacher = hasTeacher ? parsePositiveLimit(teacher_limit, null) : undefined
    if (parsedStudent === null) return res.status(400).json({ error: 'Student capacity must be a positive whole number' })
    if (parsedTeacher === null) return res.status(400).json({ error: 'Teacher capacity must be a positive whole number' })

    const sets = []
    const params = []
    let index = 1
    if (parsedStudent !== undefined) {
      sets.push(`student_limit = $${index++}`)
      params.push(parsedStudent)
    }
    if (parsedTeacher !== undefined) {
      sets.push(`teacher_limit = $${index++}`)
      params.push(parsedTeacher)
    }
    params.push(code)

    const result = await pool.query(
      `UPDATE organizations SET ${sets.join(', ')} WHERE school_code = $${index} RETURNING school_code, student_limit, teacher_limit`,
      params
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'School not found' })
    }
    res.json({ success: true, school: result.rows[0] })
  } catch (err) {
    console.error('Update school capacity error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/auth/capacity
app.get('/api/auth/capacity', requireAuth(['admin']), async (req, res) => {
  try {
    const cap = await fetchCapacity(pool, req.user.tenant_id)
    if (!cap) {
      return res.status(404).json({ error: 'School not found' })
    }
    res.json(cap)
  } catch (err) {
    console.error('Fetch capacity error:', err)
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
app.get('/api/classes/me', requireAuth(['student']), async (req, res) => {
  const tenant_id = req.user.tenant_id
  const studentResult = await pool.query(
    'SELECT class_id FROM students WHERE id = $1 AND tenant_id = $2',
    [req.user.user_id, tenant_id]
  )

  if (studentResult.rows.length === 0) {
    return res.status(404).json({ error: 'Student not found' })
  }

  const classId = studentResult.rows[0].class_id
  if (!classId) {
    return res.status(404).json({ error: 'No class assigned' })
  }

  const result = await pool.query(
    'SELECT * FROM classes WHERE id = $1 AND tenant_id = $2',
    [classId, tenant_id]
  )

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Class not found' })
  }

  res.json(result.rows[0])
})

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

// Assign a teacher to a class. The class<->teacher link lives on teachers.class_id,
// so this clears any previous holder of the class and points the new teacher at it.
app.post('/api/classes/:id/assign-teacher', requireAuth(['admin', 'super_admin']), async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id
    const classId = parseInt(req.params.id, 10)
    if (!classId) return res.status(400).json({ error: 'Invalid class id' })

    const classCheck = await pool.query(
      'SELECT id FROM classes WHERE id = $1 AND tenant_id = $2', [classId, tenant_id]
    )
    if (classCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Class not found' })
    }

    const rawTeacherId = req.body ? req.body.teacher_id : null
    const teacherId = rawTeacherId === null || rawTeacherId === undefined || rawTeacherId === ''
      ? null
      : parseInt(rawTeacherId, 10)

    if (teacherId !== null) {
      if (Number.isNaN(teacherId)) return res.status(400).json({ error: 'Invalid teacher id' })
      const teacherCheck = await pool.query(
        'SELECT id FROM teachers WHERE id = $1 AND tenant_id = $2', [teacherId, tenant_id]
      )
      if (teacherCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Teacher not found' })
      }
    }

    await pool.query(
      'UPDATE teachers SET class_id = NULL WHERE class_id = $1 AND tenant_id = $2',
      [classId, tenant_id]
    )

    if (teacherId !== null) {
      await pool.query(
        'UPDATE teachers SET class_id = $1 WHERE id = $2 AND tenant_id = $3',
        [classId, teacherId, tenant_id]
      )
    }

    res.json({ success: true, class_id: classId, teacher_id: teacherId })
  } catch (err) {
    console.error('Error assigning teacher to class:', err)
    res.status(500).json({ error: 'Failed to assign teacher: ' + err.message })
  }
})

// Update a class (name and optional section).
app.put('/api/classes/:id', requireAuth(['admin', 'super_admin']), async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id
    const classId = parseInt(req.params.id, 10)
    if (!classId) return res.status(400).json({ error: 'Invalid class id' })

    const { name } = req.body
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Class name is required' })
    }

    const result = await pool.query(
      'UPDATE classes SET name = $1 WHERE id = $2 AND tenant_id = $3 RETURNING *',
      [String(name).trim(), classId, tenant_id]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Class not found' })
    }
    res.json(result.rows[0])
  } catch (err) {
    console.error('Error updating class:', err)
    res.status(500).json({ error: 'Failed to update class: ' + err.message })
  }
})

// TEACHERS
app.get('/api/teachers', requireAuth(['admin', 'teacher', 'student', 'super_admin']), async (req, res) => {
  const tenant_id = req.user.tenant_id
  const { class_id } = req.query
  let effectiveClassId = class_id

  if (req.user.role === 'student') {
    if (!class_id) {
      return res.status(400).json({ error: 'class_id is required' })
    }

    const studentResult = await pool.query(
      'SELECT class_id FROM students WHERE id = $1 AND tenant_id = $2',
      [req.user.user_id, tenant_id]
    )

    if (studentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' })
    }

    const studentClassId = studentResult.rows[0].class_id
    if (Number(class_id) !== Number(studentClassId)) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    // Always scope students to their own class, regardless of what was passed in.
    effectiveClassId = studentClassId
  }

  const params = [tenant_id]
  // Students only need display details for their own class teacher.
  const columns = req.user.role === 'student'
    ? `teachers.id, teachers.name, teachers.phone, teachers.class_id, classes.name as class_name`
    : `teachers.id, teachers.name, teachers.phone, teachers.class_id, teachers.login_id,
           teachers.role, teachers.tenant_id, teachers.is_first_login, teachers.email,
           teachers.email_verified_at, teachers.created_at, teachers.is_frozen, classes.name as class_name`

  let query = `
    SELECT ${columns}
    FROM teachers 
    LEFT JOIN classes ON teachers.class_id = classes.id 
    WHERE teachers.tenant_id = $1
  `

  if (effectiveClassId) {
    query += ' AND teachers.class_id = $2'
    params.push(effectiveClassId)
  }

  query += ' ORDER BY teachers.id'

  const result = await pool.query(query, params)
  res.json(result.rows)
})

app.post('/api/teachers', requireAuth(['admin', 'super_admin']), async (req, res) => {
  try {
    const { name, phone, class_id } = req.body
    const tenant_id = req.user.tenant_id
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Teacher name is required' })
    const capErr = await capacityViolation(pool, tenant_id, 'teacher')
    if (capErr) return res.status(400).json({ error: capErr })

    // One teacher per class.
    if (class_id) {
      const prev = await pool.query(
        'SELECT id FROM teachers WHERE class_id = $1 AND tenant_id = $2', [class_id, tenant_id]
      )
      for (const h of prev.rows) {
        await pool.query('UPDATE teachers SET class_id = NULL WHERE id = $1', [h.id])
      }
    }

    const result = await pool.query(
      'INSERT INTO teachers (name, phone, class_id, tenant_id) VALUES ($1, $2, $3, $4) RETURNING *',
      [String(name).trim(), phone, class_id || null, tenant_id]
    )
    res.json(result.rows[0])
  } catch (err) {
    if (err.code === '23505' && String(err.constraint || '').includes('one_class_per_tenant')) {
      return res.status(400).json({ error: 'That class already has a teacher assigned.' })
    }
    console.error('Error creating teacher:', err)
    res.status(500).json({ error: 'Failed to create teacher: ' + err.message })
  }
})

app.put('/api/teachers/:id', requireAuth(['admin', 'super_admin']), async (req, res) => {
  try {
    const { name, phone, class_id, is_frozen } = req.body
    const rawEmail = req.body.email
    // Only call normalizeEmail when the field is a non-empty string (not null/undefined/empty)
    // normalizeEmail(String(null)) = "null" → fails regex → undefined ❌
    // normalizeEmail(undefined)  = "undefined" → fails regex → undefined ❌
    let email = null
    if (typeof rawEmail === 'string' && rawEmail.trim()) {
      const normalized = normalizeEmail(rawEmail)
      if (normalized === undefined) return res.status(400).json({ error: 'Enter a valid email address' })
      email = normalized
    }
    const tenant_id = req.user.tenant_id

    // One teacher per class: hand the class over rather than creating a second holder.
    if (class_id) {
      const prev = await pool.query(
        'SELECT id FROM teachers WHERE class_id = $1 AND tenant_id = $2 AND id <> $3',
        [class_id, tenant_id, req.params.id]
      )
      for (const h of prev.rows) {
        await pool.query('UPDATE teachers SET class_id = NULL WHERE id = $1', [h.id])
      }
    }

    const result = await pool.query(
      `UPDATE teachers SET name=$1, phone=$2, class_id=$3, email=$4::text,
     is_frozen=$7,
     email_verified_at = CASE WHEN email IS NOT DISTINCT FROM $4::text THEN email_verified_at ELSE NULL END
     WHERE id=$5 AND tenant_id=$6
     RETURNING id, name, phone, class_id, login_id, role, tenant_id, is_first_login, email, email_verified_at, is_frozen, created_at`,
      [name, phone, class_id || null, email, req.params.id, tenant_id, is_frozen === true]
    )
    if (result.rows[0]?.email && !result.rows[0].email_verified_at) issueEmailVerification(result.rows[0]).catch(err => console.error('Verification email send failed:', err.message))
    res.json(result.rows[0])
  } catch (err) {
    if (err.code === '23505' && String(err.constraint || '').includes('one_class_per_tenant')) {
      return res.status(400).json({ error: 'That class already has a teacher assigned.' })
    }
    console.error('Error updating teacher:', err)
    res.status(500).json({ error: 'Failed to update teacher: ' + err.message })
  }
})

app.delete('/api/teachers/:id', requireAuth(['admin', 'super_admin']), async (req, res) => {
  const tenant_id = req.user.tenant_id
  await pool.query('DELETE FROM teachers WHERE id = $1 AND tenant_id = $2', [req.params.id, tenant_id])
  res.json({ success: true })
})

// STUDENTS
app.get('/api/students/me', requireAuth(['student']), async (req, res) => {
  const tenant_id = req.user.tenant_id
  const result = await pool.query(
    'SELECT id, name, roll_no, phone, class_id, login_id, role, tenant_id, is_first_login, email, email_verified_at, is_frozen, created_at FROM students WHERE id = $1 AND tenant_id = $2',
    [req.user.user_id, tenant_id]
  )

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Student not found' })
  }

  res.json(result.rows[0])
})

app.get('/api/students', requireAuth(['admin', 'teacher', 'student', 'super_admin']), async (req, res) => {
  const tenant_id = req.user.tenant_id
  const { class_id } = req.query
  let result
  if (class_id) {
    result = await pool.query(
      'SELECT id, name, roll_no, phone, class_id, login_id, role, tenant_id, is_first_login, email, email_verified_at, is_frozen, created_at FROM students WHERE tenant_id = $1 AND class_id = $2 ORDER BY id',
      [tenant_id, class_id]
    )
  } else {
    result = await pool.query(
      'SELECT id, name, roll_no, phone, class_id, login_id, role, tenant_id, is_first_login, email, email_verified_at, is_frozen, created_at FROM students WHERE tenant_id = $1 ORDER BY id',
      [tenant_id]
    )
  }
  res.json(result.rows)
})

app.get('/api/students/:id', requireAuth(['admin', 'teacher', 'super_admin']), async (req, res) => {
  const tenant_id = req.user.tenant_id
  const result = await pool.query('SELECT id, name, roll_no, phone, class_id, login_id, role, tenant_id, is_first_login, email, email_verified_at, is_frozen, created_at FROM students WHERE id = $1 AND tenant_id = $2', [req.params.id, tenant_id])
  if (result.rows.length === 0) return res.status(404).json({ error: 'Student not found' })
  res.json(result.rows[0])
})

app.post('/api/students', requireAuth(['admin', 'super_admin']), async (req, res) => {
  try {
    const { name, roll_no, phone, class_id } = req.body
    const tenant_id = req.user.tenant_id
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Student name is required' })
    const capErr = await capacityViolation(pool, tenant_id, 'student')
    if (capErr) return res.status(400).json({ error: capErr })

    const dupErr = await findStudentDuplicate(pool, tenant_id, { roll_no, name })
    if (dupErr) return res.status(400).json({ error: dupErr })

    const result = await pool.query(
      'INSERT INTO students (name, roll_no, phone, class_id, tenant_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [String(name).trim(), roll_no, phone, class_id, tenant_id]
    )
    res.json(result.rows[0])
  } catch (err) {
    if (err.code === '23505' && String(err.constraint || '').includes('roll')) {
      return res.status(400).json({ error: `Roll number "${roll_no}" is already used by another student in this school. Please choose a different one.` })
    }
    console.error('Error creating student:', err)
    res.status(500).json({ error: 'Failed to create student: ' + err.message })
  }
})

app.put('/api/students/:id', requireAuth(['admin', 'super_admin']), async (req, res) => {
  try {
    const { name, roll_no, phone, class_id, is_frozen } = req.body
    const rawEmail = req.body.email
    // Only call normalizeEmail when the field is a non-empty string (not null/undefined/empty)
    // normalizeEmail(String(null)) = "null" → fails regex → undefined ❌
    // normalizeEmail(undefined)  = "undefined" → fails regex → undefined ❌
    let email = null
    if (typeof rawEmail === 'string' && rawEmail.trim()) {
      const normalized = normalizeEmail(rawEmail)
      if (normalized === undefined) return res.status(400).json({ error: 'Enter a valid email address' })
      email = normalized
    }
    const tenant_id = req.user.tenant_id
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid student id' })
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Student name is required' })

    // Ignore this student's own row so re-saving unchanged values is allowed.
    const dupErr = await findStudentDuplicate(pool, tenant_id, { roll_no, name }, id)
    if (dupErr) return res.status(400).json({ error: dupErr })

    const result = await pool.query(
      `UPDATE students SET name=$1, roll_no=$2, phone=$3, class_id=$4, email=$5::text,
     is_frozen=$8,
     email_verified_at = CASE WHEN email IS NOT DISTINCT FROM $5::text THEN email_verified_at ELSE NULL END
     WHERE id=$6 AND tenant_id=$7
     RETURNING id, name, roll_no, phone, class_id, login_id, role, tenant_id, is_first_login, email, email_verified_at, is_frozen, created_at`,
      [String(name).trim(), roll_no, phone, class_id, email, id, tenant_id, is_frozen === true]
    )
    if (result.rows[0]?.email && !result.rows[0].email_verified_at) issueEmailVerification(result.rows[0]).catch(err => console.error('Verification email send failed:', err.message))
    res.json(result.rows[0])
  } catch (err) {
    if (err.code === '23505' && String(err.constraint || '').includes('roll')) {
      return res.status(400).json({ error: `Roll number "${roll_no}" is already used by another student in this school. Please choose a different one.` })
    }
    console.error('Error updating student:', err)
    res.status(500).json({ error: 'Failed to update student: ' + err.message })
  }
})

// Name-only update. Unlike PUT /api/students/:id (a full replace that would clobber
// is_frozen / email / roll_no / class_id), this touches the name column alone.
app.put('/api/students/:id/name', requireAuth(['admin', 'super_admin']), async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid student id' })

    const name = typeof req.body.name === 'string' ? req.body.name.trim().replace(/\s+/g, ' ') : ''
    if (!name) return res.status(400).json({ error: 'Name is required' })
    if (name.length > 100) return res.status(400).json({ error: 'Name must be 100 characters or fewer' })

    const dupErr = await findStudentDuplicate(pool, tenant_id, { name }, id)
    if (dupErr) return res.status(400).json({ error: dupErr })

    const result = await pool.query(
      'UPDATE students SET name = $1 WHERE id = $2 AND tenant_id = $3 RETURNING id, name',
      [name, id, tenant_id]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' })
    }
    res.json(result.rows[0])
  } catch (err) {
    console.error('Error renaming student:', err)
    res.status(500).json({ error: 'Failed to rename student: ' + err.message })
  }
})

app.delete('/api/students/:id', requireAuth(['admin', 'super_admin']), async (req, res) => {
  const tenant_id = req.user.tenant_id
  const studentId = req.params.id
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // fee_payments has no foreign key to students, so deleting a student used to
    // leave the payment rows behind. They then vanished from the fee list (which
    // joins students) while the money was still counted as never collected.
    // attendance does have a FK with NO ACTION, so clear it first to avoid a
    // constraint error. Both scoped to the caller's tenant.
    await client.query('DELETE FROM fee_payments WHERE student_id = $1 AND tenant_id = $2', [studentId, tenant_id])
    await client.query('DELETE FROM attendance WHERE student_id = $1 AND tenant_id = $2', [studentId, tenant_id])
    const result = await client.query('DELETE FROM students WHERE id = $1 AND tenant_id = $2', [studentId, tenant_id])
    await client.query('COMMIT')
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Student not found' })
    }
    res.json({ success: true })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Error deleting student:', err)
    res.status(500).json({ error: 'Failed to delete student: ' + err.message })
  } finally {
    client.release()
  }
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

app.get('/api/attendance/me', requireAuth(['student']), async (req, res) => {
  const tenant_id = req.user.tenant_id
  const studentResult = await pool.query(
    'SELECT id, class_id FROM students WHERE id = $1 AND tenant_id = $2',
    [req.user.user_id, tenant_id]
  )

  if (studentResult.rows.length === 0) {
    return res.status(404).json({ error: 'Student not found' })
  }

  const student = studentResult.rows[0]
  const result = await pool.query(`
    SELECT attendance.*, students.name, students.phone, students.roll_no, students.class_id, classes.name as class_name
    FROM attendance
    JOIN students ON attendance.student_id = students.id
    LEFT JOIN classes ON students.class_id = classes.id
    WHERE attendance.student_id = $1 AND attendance.tenant_id = $2
    ORDER BY attendance.date DESC, students.name ASC
  `, [student.id, tenant_id])

  res.json(result.rows)
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
    JOIN students ON attendance.student_id = students.id AND students.tenant_id = $1
    LEFT JOIN classes ON students.class_id = classes.id
    LEFT JOIN teachers marking_teacher ON attendance.teacher_id = marking_teacher.id
    LEFT JOIN LATERAL (
      SELECT t.id, t.name FROM teachers t
      WHERE t.class_id = students.class_id AND t.tenant_id = $1
      ORDER BY t.id DESC LIMIT 1
    ) assigned_teacher ON TRUE
    WHERE attendance.tenant_id = $1
    ORDER BY attendance.date DESC, classes.name ASC NULLS LAST, students.name ASC
  `, [tenant_id])
  res.json(result.rows)
})

app.post('/api/attendance/submit', requireAuth(['teacher', 'admin']), async (req, res) => {
  try {
    const { date, teacher_id, records } = req.body
    const tenant_id = req.user.tenant_id

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'A valid date (YYYY-MM-DD) is required' })
    }
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'No attendance records supplied' })
    }
    if (records.length > 1000) {
      return res.status(400).json({ error: 'Too many records in one submission' })
    }

    const validStatuses = ['Present', 'Absent', 'Leave']
    for (const record of records) {
      if (!record || record.student_id === undefined || record.student_id === null) {
        return res.status(400).json({ error: 'Each record needs a student_id' })
      }
      if (!validStatuses.includes(record.status)) {
        return res.status(400).json({ error: `Invalid attendance status: ${record.status}` })
      }
    }

    // Only touch students that actually belong to the caller's tenant.
    const studentIds = [...new Set(records.map(r => parseInt(r.student_id, 10)).filter(n => !Number.isNaN(n)))]
    if (studentIds.length === 0) {
      return res.status(400).json({ error: 'No valid student ids supplied' })
    }
    const allowed = await pool.query(
      'SELECT id FROM students WHERE id = ANY($1::int[]) AND tenant_id = $2',
      [studentIds, tenant_id]
    )
    const allowedIds = new Set(allowed.rows.map(r => r.id))
    const rejected = studentIds.filter(id => !allowedIds.has(id))
    if (rejected.length) {
      return res.status(403).json({ error: `Student(s) not found in your school: ${rejected.join(', ')}` })
    }

    const client = await pool.connect()
    let saved = 0
    try {
      await client.query('BEGIN')
      for (const record of records) {
        const studentId = parseInt(record.student_id, 10)
        // tenant_id is part of the match so a submit can never claim another
        // school's row (which would then vanish from that school's stats).
        const updated = await client.query(
          `UPDATE attendance
           SET teacher_id = $1, status = $2, tenant_id = $3
           WHERE student_id = $4 AND date = $5 AND tenant_id = $6`,
          [teacher_id || null, record.status, tenant_id, studentId, date, tenant_id]
        )
        if (updated.rowCount === 0) {
          await client.query(
            `INSERT INTO attendance (student_id, teacher_id, date, status, tenant_id)
             VALUES ($1, $2, $3, $4, $5)`,
            [studentId, teacher_id || null, date, record.status, tenant_id]
          )
        }
        saved++
      }
      await client.query('COMMIT')
    } catch (txErr) {
      await client.query('ROLLBACK')
      throw txErr
    } finally {
      client.release()
    }

    res.json({ success: true, saved })
  } catch (err) {
    console.error('Error submitting attendance:', err)
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
// FEE MANAGEMENT ROUTES
// ============================================

// GET /api/fees/structures - List all fee structures for the tenant
app.get('/api/fees/structures', requireAuth(['admin', 'teacher']), async (req, res) => {
  const tenant_id = req.user.tenant_id
  const result = await pool.query(
    `SELECT fee_structures.*, 
      CASE 
        WHEN fee_structures.type = 'class' THEN classes.name 
        WHEN fee_structures.type = 'student' THEN students.name 
      END as target_name
     FROM fee_structures
     LEFT JOIN classes ON fee_structures.type = 'class' AND fee_structures.target_id = classes.id AND classes.tenant_id = fee_structures.tenant_id
     LEFT JOIN students ON fee_structures.type = 'student' AND fee_structures.target_id = students.id AND students.tenant_id = fee_structures.tenant_id
     WHERE fee_structures.tenant_id = $1
     ORDER BY fee_structures.created_at DESC`,
    [tenant_id]
  )
  res.json(result.rows)
})

// POST /api/fees/structures - Create a new fee structure
app.post('/api/fees/structures', requireAuth(['admin']), async (req, res) => {
  try {
    const { type, target_id, monthly_fee, admission_fee, transport_fee, discount } = req.body
    const tenant_id = req.user.tenant_id

    if (!type || !target_id) {
      return res.status(400).json({ error: 'type and target_id are required' })
    }

    // Validate fee amounts are valid numbers
    const monthlyFee = Number(monthly_fee)
    const admissionFee = Number(admission_fee)
    const transportFee = Number(transport_fee)
    const discountFee = Number(discount)

    if (isNaN(monthlyFee) || monthlyFee < 0) {
      return res.status(400).json({ error: 'monthly_fee must be a valid non-negative number' })
    }
    if (isNaN(admissionFee) || admissionFee < 0) {
      return res.status(400).json({ error: 'admission_fee must be a valid non-negative number' })
    }
    if (isNaN(transportFee) || transportFee < 0) {
      return res.status(400).json({ error: 'transport_fee must be a valid non-negative number' })
    }
    if (isNaN(discountFee) || discountFee < 0) {
      return res.status(400).json({ error: 'discount must be a valid non-negative number' })
    }

    const result = await pool.query(
      `INSERT INTO fee_structures (type, target_id, monthly_fee, admission_fee, transport_fee, discount, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [type, target_id, monthlyFee, admissionFee, transportFee, discountFee, tenant_id]
    )
    res.json(result.rows[0])
  } catch (err) {
    console.error('Error creating fee structure:', err)
    res.status(500).json({ error: 'Failed to save fee structure: ' + err.message })
  }
})

// PUT /api/fees/structures/:id - Update an existing fee structure
app.put('/api/fees/structures/:id', requireAuth(['admin']), async (req, res) => {
  try {
    const { type, target_id, monthly_fee, admission_fee, transport_fee, discount } = req.body
    const tenant_id = req.user.tenant_id

    // Validate fee amounts are valid numbers
    const monthlyFee = Number(monthly_fee)
    const admissionFee = Number(admission_fee)
    const transportFee = Number(transport_fee)
    const discountFee = Number(discount)

    if (isNaN(monthlyFee) || monthlyFee < 0) {
      return res.status(400).json({ error: 'monthly_fee must be a valid non-negative number' })
    }
    if (isNaN(admissionFee) || admissionFee < 0) {
      return res.status(400).json({ error: 'admission_fee must be a valid non-negative number' })
    }
    if (isNaN(transportFee) || transportFee < 0) {
      return res.status(400).json({ error: 'transport_fee must be a valid non-negative number' })
    }
    if (isNaN(discountFee) || discountFee < 0) {
      return res.status(400).json({ error: 'discount must be a valid non-negative number' })
    }

    const result = await pool.query(
      `UPDATE fee_structures 
       SET type = $1, target_id = $2, monthly_fee = $3, admission_fee = $4, transport_fee = $5, discount = $6, updated_at = CURRENT_TIMESTAMP
       WHERE id = $7 AND tenant_id = $8
       RETURNING *`,
      [type, target_id, monthlyFee, admissionFee, transportFee, discountFee, req.params.id, tenant_id]
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Fee structure not found' })
    }

    res.json(result.rows[0])
  } catch (err) {
    console.error('Error updating fee structure:', err)
    res.status(500).json({ error: 'Failed to update fee structure: ' + err.message })
  }
})

// GET /api/fees/payments - List fee payments with filters
app.get('/api/fees/payments', requireAuth(['admin', 'teacher']), async (req, res) => {
  const tenant_id = req.user.tenant_id
  const { mode, month, year, class_id, status, search } = req.query

  // Default mode: LEFT JOIN from students so every student appears.
  // Students without a payment record get status='not_set_up'.
  // mode=records uses the old INNER JOIN (only students with actual payments).
  // A year with no month means "every month of that year", which the per-student
  // LEFT JOIN cannot express because it joins on a single month, so fall back to
  // the recorded-rows view.
  if (mode === 'records' || (year && !month)) {
    let query = `
      SELECT fee_payments.*, students.name as student_name, students.roll_no, classes.name as class_name
      FROM fee_payments
      JOIN students ON fee_payments.student_id = students.id AND fee_payments.tenant_id = students.tenant_id
      LEFT JOIN classes ON students.class_id = classes.id AND students.tenant_id = classes.tenant_id
      WHERE fee_payments.tenant_id = $1
    `
    const params = [tenant_id]
    let paramIndex = 2

    if (month) {
      query += ` AND fee_payments.month = $${paramIndex}`
      params.push(month)
      paramIndex++
    } else if (year) {
      query += ` AND fee_payments.month LIKE $${paramIndex}`
      params.push(`${year}-%`)
      paramIndex++
    }
    if (class_id) {
      query += ` AND students.class_id = $${paramIndex}`
      params.push(class_id)
      paramIndex++
    }
    if (status) {
      query += ` AND fee_payments.status = $${paramIndex}`
      params.push(status)
      paramIndex++
    }
    if (search) {
      query += ` AND (students.name ILIKE $${paramIndex} OR students.roll_no ILIKE $${paramIndex})`
      params.push(`%${search}%`)
      paramIndex++
    }

    query += ` ORDER BY fee_payments.month DESC, students.name ASC`
    const result = await pool.query(query, params)
    return res.json(result.rows)
  }

  // Default: LEFT JOIN — all students, with payments if they exist for the month
  const targetMonth = month || new Date().toISOString().slice(0, 7)
  let query = `
    SELECT 
      students.id as student_id,
      students.name as student_name,
      students.roll_no,
      students.class_id,
      classes.name as class_name,
      fee_payments.id as payment_id,
      fee_payments.month as month_year,
      fee_payments.amount_due,
      fee_payments.amount_paid,
      COALESCE(fee_payments.status, 'not_set_up') as status,
      fee_payments.payment_date,
      fee_payments.payment_method,
      fee_payments.notes
    FROM students
    LEFT JOIN fee_payments ON students.id = fee_payments.student_id AND fee_payments.tenant_id = students.tenant_id AND fee_payments.month = $2
    LEFT JOIN classes ON students.class_id = classes.id AND students.tenant_id = classes.tenant_id
    WHERE students.tenant_id = $1
  `
  const params = [tenant_id, targetMonth]
  let paramIdx = 3

  if (class_id) {
    query += ` AND students.class_id = $${paramIdx}`
    params.push(class_id)
    paramIdx++
  }
  if (search) {
    query += ` AND (students.name ILIKE $${paramIdx} OR students.roll_no ILIKE $${paramIdx})`
    params.push(`%${search}%`)
    paramIdx++
  }

  query += ` ORDER BY students.name ASC`
  let result = await pool.query(query, params)
  let rows = result.rows

  // For students with no payment row, look up their applicable fee structure
  // (student-specific first, class-level fallback) in one batched query.
  const noPaymentRows = rows.filter(r => r.payment_id == null)
  if (noPaymentRows.length > 0) {
    const studentIds = noPaymentRows.map(r => r.student_id)
    const classIds   = [...new Set(noPaymentRows.map(r => r.class_id).filter(Boolean))]

    const fsResult = await pool.query(
      `SELECT type, target_id, monthly_fee, transport_fee, discount
       FROM fee_structures
       WHERE tenant_id = $1
         AND (
           (type = 'student' AND target_id = ANY($2::int[]))
           OR
           (type = 'class'   AND target_id = ANY($3::int[]))
         )`,
      [tenant_id, studentIds, classIds.length > 0 ? classIds : [0]]
    )

    // Index by type for O(1) lookup
    const studentStructures = {}
    const classStructures   = {}
    for (const fs of fsResult.rows) {
      if (fs.type === 'student') studentStructures[fs.target_id] = fs
      if (fs.type === 'class')   classStructures[fs.target_id]   = fs
    }

    rows = rows.map(r => {
      if (r.payment_id != null) return r  // has a real payment — leave untouched

      // Student-specific override first, class fallback second
      const fs = studentStructures[r.student_id] || classStructures[r.class_id] || null

      if (fs) {
        return { ...r, amount_due: monthlyAmountDue(fs), amount_paid: 0, status: 'unpaid', month_year: targetMonth }
      }
      // No fee structure — keep not_set_up
      return { ...r, amount_due: 0, amount_paid: 0, month_year: targetMonth }
    })
  }

  // Filter by status in JS after query (COALESCE can't be used in WHERE easily)
  if (status) {
    rows = rows.filter(r => r.status === status)
  }

  res.json(rows)
})

// POST /api/fees/payments - Upsert fee payment record
app.post('/api/fees/payments', requireAuth(['admin']), async (req, res) => {
  try {
    const { student_id, month, amount_due, amount_paid, payment_method, payment_date, notes } = req.body
    const tenant_id = req.user.tenant_id

    if (!student_id || !month) {
      return res.status(400).json({ error: 'student_id and month are required' })
    }

    // Validate amount_due and amount_paid are valid numbers
    const due = Number(amount_due)
    const paid = Number(amount_paid)

    if (isNaN(due) || due < 0) {
      return res.status(400).json({ error: 'amount_due must be a valid non-negative number' })
    }
    if (isNaN(paid) || paid < 0) {
      return res.status(400).json({ error: 'amount_paid must be a valid non-negative number' })
    }

    // Auto-calculate status
    let status = 'unpaid'
    if (paid >= due) {
      status = 'paid'
    } else if (paid > 0) {
      status = 'partial'
    }

    // Check if record exists
    const existing = await pool.query(
      'SELECT id FROM fee_payments WHERE student_id = $1 AND month = $2 AND tenant_id = $3',
      [student_id, month, tenant_id]
    )

    let result
    if (existing.rows.length > 0) {
      // Update existing
      result = await pool.query(
        `UPDATE fee_payments 
         SET amount_due = $1, amount_paid = $2, status = $3, payment_method = $4, payment_date = $5, notes = $6, updated_at = CURRENT_TIMESTAMP
         WHERE student_id = $7 AND month = $8 AND tenant_id = $9
         RETURNING *`,
        [due, paid, status, payment_method, payment_date, notes, student_id, month, tenant_id]
      )
    } else {
      // Insert new
      result = await pool.query(
        `INSERT INTO fee_payments (student_id, month, amount_due, amount_paid, status, payment_method, payment_date, notes, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [student_id, month, due, paid, status, payment_method, payment_date, notes, tenant_id]
      )
    }

    res.json(result.rows[0])
  } catch (err) {
    console.error('Error saving fee payment:', err)
    res.status(500).json({ error: 'Failed to save payment: ' + err.message })
  }
})

// GET /api/fees/stats - Get fee statistics for a month
app.get('/api/fees/stats', requireAuth(['admin', 'teacher']), async (req, res) => {
  const tenant_id = req.user.tenant_id
  const { month } = req.query

  let monthFilter = ''
  const params = [tenant_id]
  let paramIndex = 2

  if (month) {
    monthFilter = ` AND fee_payments.month = $${paramIndex}`
    params.push(month)
    paramIndex++
  }

  const stats = await pool.query(
    `SELECT 
      COUNT(DISTINCT students.id) as total_students,
      COALESCE(SUM(fee_payments.amount_due), 0) as total_due,
      COALESCE(SUM(fee_payments.amount_paid), 0) as total_collected
     FROM students
     LEFT JOIN fee_payments ON students.id = fee_payments.student_id AND fee_payments.tenant_id = students.tenant_id${monthFilter}
     WHERE students.tenant_id = $1`,
    params
  )

  const data = stats.rows[0]
  const totalStudents = Number(data.total_students) || 0
  const totalDue = Number(data.total_due) || 0
  const totalCollected = Number(data.total_collected) || 0
  const collectionRate = totalDue > 0 ? Math.round((totalCollected / totalDue) * 100) : 0

  res.json({
    total_students: totalStudents,
    total_due: totalDue,
    total_collected: totalCollected,
    collection_rate: collectionRate
  })
})

// GET /api/fees/me - Get current student's fee records
app.get('/api/fees/me', requireAuth(['student']), async (req, res) => {
  const tenant_id = req.user.tenant_id
  const student_id = req.user.user_id
  const { month } = req.query

  // Look up student's class and name
  const studentInfo = await pool.query(
    `SELECT s.name as student_name, s.class_id, c.name as class_name
     FROM students s
     LEFT JOIN classes c ON s.class_id = c.id AND s.tenant_id = c.tenant_id
     WHERE s.id = $1 AND s.tenant_id = $2`,
    [student_id, tenant_id]
  )
  const student = studentInfo.rows[0] || { student_name: '', class_name: '' }

  // Find fee structure — student override first, then class default (same as getStudentMonthlyFee)
  let monthlyFee = 0
  let feeStructureExists = false
  let feeStructure = null
  const studentFs = await pool.query(
    `SELECT type, monthly_fee, admission_fee, transport_fee, discount
     FROM fee_structures WHERE type = 'student' AND target_id = $1 AND tenant_id = $2`,
    [student_id, tenant_id]
  )
  if (studentFs.rows.length > 0) {
    feeStructure = studentFs.rows[0]
  } else {
    const classFs = await pool.query(
      `SELECT type, monthly_fee, admission_fee, transport_fee, discount
       FROM fee_structures WHERE type = 'class' AND target_id = $1 AND tenant_id = $2`,
      [student.class_id || 0, tenant_id]
    )
    feeStructure = classFs.rows[0] || null
  }
  if (feeStructure) {
    monthlyFee = monthlyAmountDue(feeStructure)
    feeStructureExists = true
  }

  // Get all payment records for this student
  let paymentQuery = `
    SELECT fp.id, fp.student_id, fp.month as month_year, fp.amount_due, fp.amount_paid, fp.status, fp.payment_date, fp.payment_method, fp.notes,
           students.name as student_name, classes.name as class_name
    FROM fee_payments fp
    JOIN students ON fp.student_id = students.id AND fp.tenant_id = students.tenant_id
    LEFT JOIN classes ON students.class_id = classes.id AND students.tenant_id = classes.tenant_id
    WHERE fp.student_id = $1 AND fp.tenant_id = $2
  `
  const params = [student_id, tenant_id]

  if (month) {
    paymentQuery += ` AND fp.month = $3`
    params.push(month)
  }

  paymentQuery += ` ORDER BY fp.month DESC`
  const paymentResult = await pool.query(paymentQuery, params)
  const records = paymentResult.rows

  // If the requested month has no payment record, create a synthetic one
  const targetMonth = month || new Date().toISOString().slice(0, 7)
  const hasRequestedMonth = records.some(r => r.month_year === targetMonth)

  if (!hasRequestedMonth) {
    records.unshift({
      id: null,
      student_id,
      month_year: targetMonth,
      amount_due: monthlyFee,
      amount_paid: 0,
      status: feeStructureExists ? 'unpaid' : 'not_set_up',
      payment_date: null,
      payment_method: null,
      notes: null,
      student_name: student.student_name,
      class_name: student.class_name,
    })
  }

  res.json({ records, structure: feeStructure })
})


// ============================================
// JSON ERROR HANDLER — ensures API routes always
// return JSON, never HTML (Express 5 default
// error handler sends HTML in development mode)
// ============================================
app.use('/api', (err, req, res, next) => {
  console.error('API error:', err)
  if (res.headersSent) return next(err)
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' })
})

// Catch-all: return 404 JSON for any unmatched /api routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: `Cannot ${req.method} ${req.originalUrl}` })
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
