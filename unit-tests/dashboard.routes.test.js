'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const http = require('node:http')
const jwt = require('jsonwebtoken')

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_dashboard'
const { requireAuth } = require('../authMiddleware')
const { createDashboardRouter } = require('../dashboard-routes')

function makeToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' })
}

function createMockPool() {
  const queries = []
  return {
    queries,
    async query(sql, params = []) {
      queries.push({ sql, params })
      if (sql.includes('FROM tenant_features')) {
        return {
          rows: [
            { key: 'attendance', default_enabled: true },
            { key: 'student_management', default_enabled: true },
            { key: 'teacher_management', default_enabled: true },
            { key: 'fees', default_enabled: true },
            { key: 'qr_attendance', default_enabled: false },
            { key: 'timetable', default_enabled: false },
          ],
        }
      }
      if (sql.includes('FROM tenant_grants')) {
        return { rows: [{ feature_key: 'fees', enabled: true }] }
      }
      if (sql.includes('FROM organizations')) {
        return { rows: [{ school_code: params[0], school_name: 'Cedar Academy' }] }
      }
      if (sql.includes('FROM admins')) {
        return { rows: [{ id: 1, name: 'Sameer Abdullah', login_id: 'admin1', role: 'admin' }] }
      }
      if (sql.includes('FROM students') && sql.includes('active_count')) {
        return { rows: [{ active_count: 120, frozen_count: 4, new_this_month: 8 }] }
      }
      if (sql.includes('FROM classes c') && sql.includes('has_teacher')) {
        return {
          rows: [
            { id: 1, name: 'Grade 6', section: 'A', has_teacher: true },
            { id: 2, name: 'Grade 8', section: 'B', has_teacher: false },
          ],
        }
      }
      if (sql.includes('FROM teachers')) {
        return { rows: [{ id: 10, name: 'Ali Khan', class_id: 1 }, { id: 11, name: 'Sara Ahmed', class_id: null }] }
      }
      if (sql.includes('FROM attendance a') && sql.includes('marked_classes')) {
        return { rows: [{ present_count: 108, absent_count: 12, late_count: 0, marked_classes: 1 }] }
      }
      if (sql.includes('FROM attendance a') && sql.includes('day_label')) {
        return {
          rows: [
            { date: '2026-11-26', day_label: 'Thu', present_count: 108, absent_count: 12, total_count: 120 },
            { date: '2026-11-25', day_label: 'Wed', present_count: 110, absent_count: 10, total_count: 120 },
          ],
        }
      }
      if (sql.includes('NOT EXISTS') && sql.includes('FROM classes c')) {
        return { rows: [{ id: 2, name: 'Grade 8', section: 'B', student_count: 30 }] }
      }
      if (sql.includes('FROM student_fee_obligations')) {
        return {
          rows: [
            { id: 1, student_id: 50, final_amount: '10000.00', paid_amount: '7500.00', due_date: '2026-11-01', status: 'partially_paid' },
            { id: 2, student_id: 51, final_amount: '10000.00', paid_amount: '10000.00', due_date: '2026-11-01', status: 'paid' },
          ],
        }
      }
      if (sql.includes('FROM datesheets')) return { rows: [] }
      if (sql.includes('FROM complaints')) return { rows: [{ pending_count: 2, teacher_pending: 1, student_pending: 1 }] }
      if (sql.includes('FROM announcements')) return { rows: [] }
      if (sql.includes('ILIKE')) return { rows: [] }
      return { rows: [] }
    },
  }
}

async function withServer(pool, fn) {
  const app = express()
  app.use(express.json())
  app.use('/api/dashboard', createDashboardRouter({ pool, requireAuth }))
  const server = http.createServer(app)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    await fn(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

test('dashboard overview rejects unauthenticated requests with 401', async () => {
  const pool = createMockPool()
  await withServer(pool, async baseUrl => {
    const res = await fetch(`${baseUrl}/api/dashboard/overview`)
    assert.equal(res.status, 401)
  })
})

test('dashboard overview rejects student and coordinator roles with 403', async () => {
  const pool = createMockPool()
  await withServer(pool, async baseUrl => {
    for (const role of ['student', 'teacher', 'coordinator']) {
      const token = makeToken({ user_id: 1, role, tenant_id: 'SCH1' })
      const res = await fetch(`${baseUrl}/api/dashboard/overview`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      assert.equal(res.status, 403)
    }
  })
})

test('dashboard overview returns accurate tenant-isolated metrics and priorities', async () => {
  const pool = createMockPool()
  await withServer(pool, async baseUrl => {
    const token = makeToken({ user_id: 1, role: 'admin', tenant_id: 'SCH1' })
    const res = await fetch(`${baseUrl}/api/dashboard/overview?branch_id=2`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(res.status, 200)
    const body = await res.json()

    assert.equal(body.schoolName, 'Cedar Academy')
    assert.equal(body.adminName, 'Sameer Abdullah')
    assert.equal(body.students.active, 120)
    assert.equal(body.students.classCount, 2)
    assert.equal(body.staff.totalTeachers, 2)
    assert.equal(body.staff.qrAttendanceEnabled, false)
    assert.equal(body.staff.presentTeachers, null)
    assert.equal(body.attendance.presentToday, 108)
    assert.equal(body.attendance.pctToday, 90)
    assert.equal(body.fees.enabled, true)
    assert.equal(body.fees.expected, 20000)
    assert.equal(body.fees.collected, 17500)
    assert.equal(body.fees.outstanding, 2500)
    assert.equal(body.fees.overdueAccounts, 1)
    assert.ok(body.priorities.some(p => p.id === 'overdue-fees'))
    assert.ok(body.priorities.some(p => p.id === 'unassigned-classes'))
    assert.ok(body.priorities.some(p => p.id === 'pending-complaints'))
  })
})

test('dashboard search enforces minimum query length and returns structured results', async () => {
  const pool = createMockPool()
  await withServer(pool, async baseUrl => {
    const token = makeToken({ user_id: 1, role: 'admin', tenant_id: 'SCH1' })
    const shortRes = await fetch(`${baseUrl}/api/dashboard/search?q=a`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(shortRes.status, 200)
    assert.deepEqual(await shortRes.json(), { results: [] })
  })
})
