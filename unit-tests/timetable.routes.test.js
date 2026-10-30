'use strict'

/**
 * HTTP-level tests for the timetable API.
 *
 * These run against the REAL dev server app (timetable/dev-server.js), which
 * mounts the REAL router with The Eye's REAL requireAuth middleware and the
 * memory store seeded with the two sample schools. Nothing is mocked.
 *
 * Run with:  npm run test:unit
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const jwt = require('jsonwebtoken')

// The dev server forces a dev-only JWT secret when this module is loaded.
const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET
const { createApp, DEV_USERS, signDevToken } = require('../timetable/dev-server')
const { createTimetableRouter, READ_ROLES } = require('../timetable/routes')
const { createMemoryStore } = require('../timetable/store')
const { sampleSchools } = require('../timetable/sample-data')
const express = require('express')

const devUser = (id) => DEV_USERS.find(u => u.user_id === id)

let server
let base

test.before(async () => {
  const app = createApp({ persistPath: null }) // fresh in-memory store per run
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', resolve)
  })
  base = `http://127.0.0.1:${server.address().port}/api/timetable`
})

test.after(() => server && server.close())

async function call(method, path, { token: tok, body } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (tok) headers.Authorization = 'Bearer ' + tok
  // fetch() refuses a body on GET/HEAD — only send one for methods that take it.
  const sendBody = body !== undefined && !['GET', 'HEAD'].includes(method.toUpperCase())
  const res = await fetch(base + path, {
    method,
    headers,
    body: sendBody ? JSON.stringify(body) : undefined
  })
  let data = {}
  try { data = await res.json() } catch (_) { /* empty */ }
  return { status: res.status, data }
}

const adminToken = () => signDevToken(devUser('dev_admin1'))
const teacherToken = () => signDevToken(devUser('dev_teacher1'))
const studentToken = () => signDevToken(devUser('dev_student1'))
const admin2Token = () => signDevToken(devUser('dev_admin2'))

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

test('meta is reachable without a token and reports dev mode', async () => {
  const { status, data } = await call('GET', '/meta')
  assert.equal(status, 200)
  assert.equal(data.module, 'timetable')
  assert.equal(data.devAuth, true)
  assert.deepEqual(data.writeRoles, ['super_admin', 'admin', 'coordinator'])
})

test('every protected route rejects a missing token with 401', async () => {
  for (const [method, path] of [
    ['GET', '/bootstrap'], ['GET', '/view?by=class'],
    ['PUT', '/entries'], ['POST', '/generate'], ['POST', '/publish']
  ]) {
    const { status } = await call(method, path, { body: {} })
    assert.equal(status, 401, `${method} ${path} should be 401 without a token`)
  }
})

test('a tampered token is rejected with 401', async () => {
  const forged = jwt.sign({ user_id: 'x', role: 'admin', tenant_id: 'DEMO1' }, 'wrong-secret')
  const { status } = await call('GET', '/bootstrap', { token: forged })
  assert.equal(status, 401)
})

test('a student role is refused by requireAuth with 403', async () => {
  const { status, data } = await call('GET', '/bootstrap', { token: studentToken() })
  assert.equal(status, 403)
  assert.equal(data.error, 'Forbidden')
})

// ---------------------------------------------------------------------------
// Bootstrap + tenant isolation
// ---------------------------------------------------------------------------

test('bootstrap returns the school-specific configuration for the JWT tenant', async () => {
  const { status, data } = await call('GET', '/bootstrap', { token: adminToken() })
  assert.equal(status, 200)
  assert.equal(data.tenant.id, 'DEMO1')
  assert.equal(data.config.classes.length, 6)
  assert.equal(data.config.days.length, 5)
  assert.equal(data.readOnly, false)
  assert.equal(data.timetable.status, 'draft')
  assert.deepEqual(data.timetable.entries, [])
})

test('a second school sees ITS OWN week shape, never the first school\'s', async () => {
  const { status, data } = await call('GET', '/bootstrap', { token: admin2Token() })
  assert.equal(status, 200)
  assert.equal(data.tenant.id, 'DEMO2')
  assert.equal(data.config.classes.length, 4)   // DEMO1 has 6
  assert.equal(data.config.days.length, 6)      // DEMO1 has 5
  assert.equal(data.config.periods.find(p => p.label === 'P7').kind, 'teaching')
  assert.equal(data.timetable.entries.length, 0)
})

test('entries saved by one school are invisible to the other school', async () => {
  // DEMO1 saves a generated timetable…
  const gen = await call('POST', '/generate', { token: adminToken(), body: { keepLocked: false } })
  assert.equal(gen.status, 200)
  assert.equal(gen.data.ok, true)
  const save = await call('PUT', '/entries', {
    token: adminToken(),
    body: { entries: gen.data.entries }
  })
  assert.equal(save.status, 200)

  // …DEMO2 still sees an empty draft, and DEMO1 sees its own.
  const other = await call('GET', '/bootstrap', { token: admin2Token() })
  assert.equal(other.data.timetable.entries.length, 0)
  assert.equal(other.data.timetable.status, 'draft')

  const mine = await call('GET', '/bootstrap', { token: adminToken() })
  assert.ok(mine.data.timetable.entries.length > 100, 'DEMO1 should see the lessons it saved')

  // Clean up so later tests start from a known state.
  await call('PUT', '/entries', { token: adminToken(), body: { entries: [] } })
})

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

test('a teacher can read but cannot write', async () => {
  const read = await call('GET', '/bootstrap', { token: teacherToken() })
  assert.equal(read.status, 200)
  assert.equal(read.data.readOnly, true)

  const write = await call('PUT', '/entries', { token: teacherToken(), body: { entries: [] } })
  assert.equal(write.status, 403)

  const gen = await call('POST', '/generate', { token: teacherToken(), body: {} })
  assert.equal(gen.status, 403)
})

test('a coordinator (write role) can save a draft', async () => {
  const coordToken = signDevToken(devUser('dev_coord1'))
  const { status } = await call('PUT', '/entries', { token: coordToken, body: { entries: [] } })
  assert.equal(status, 200)
})

// ---------------------------------------------------------------------------
// Automatic mode
// ---------------------------------------------------------------------------

test('automatic generation returns a complete, independently validated timetable without saving it', async () => {
  const { status, data } = await call('POST', '/generate', { token: adminToken(), body: { keepLocked: false } })
  assert.equal(status, 200)
  assert.equal(data.ok, true)
  assert.equal(data.saved, false)
  assert.equal(data.validation.ok, true)
  assert.equal(data.validation.hard.length, 0)
  assert.equal(data.validation.totals.scheduled, data.validation.totals.required)
  assert.equal(data.stats.scheduledLessons, data.stats.requiredLessons)

  // "Display for review before publication": nothing may be persisted yet.
  const boot = await call('GET', '/bootstrap', { token: adminToken() })
  assert.equal(boot.data.timetable.entries.length, 0)
})

test('generation preserves locked lessons across regeneration', async () => {
  const gen = await call('POST', '/generate', { token: adminToken(), body: { keepLocked: false } })
  assert.equal(gen.data.ok, true)

  // Lock one lesson of the generated set and save it as the draft.
  const locked = gen.data.entries.map((e, i) => (i === 0 ? { ...e, locked: true } : e))
  const anchor = locked[0]
  const save = await call('PUT', '/entries', { token: adminToken(), body: { entries: locked } })
  assert.equal(save.status, 200)

  const regen = await call('POST', '/generate', { token: adminToken(), body: { keepLocked: true } })
  assert.equal(regen.status, 200)
  assert.equal(regen.data.ok, true)
  assert.equal(regen.data.locksUsed, 1)
  const kept = regen.data.entries.find(e =>
    e.day === anchor.day && e.period === anchor.period && String(e.classId) === String(anchor.classId))
  assert.ok(kept, 'the locked cell must still exist after regeneration')
  assert.equal(String(kept.subjectId), String(anchor.subjectId))
  assert.equal(String(kept.teacherId), String(anchor.teacherId))

  await call('PUT', '/entries', { token: adminToken(), body: { entries: [] } })
})

test('an impossible configuration fails loudly instead of claiming success', async () => {
  // Ask for more periods than the school week can hold.
  const cfgRes = await call('GET', '/bootstrap', { token: adminToken() })
  const config = cfgRes.data.config
  const broken = {
    ...config,
    requirements: [{ classId: config.classes[0].id, subjectId: config.subjects[0].id, periodsPerWeek: 999 }]
  }
  const put = await call('PUT', '/config', { token: adminToken(), body: { config: broken } })
  assert.equal(put.status, 200)

  const gen = await call('POST', '/generate', { token: adminToken(), body: {} })
  assert.equal(gen.status, 200)
  assert.equal(gen.data.ok, false)
  assert.ok(gen.data.diagnostics.length > 0, 'must explain why no timetable exists')
  assert.ok(
    gen.data.diagnostics.join(' ').length > 20,
    'diagnostics must be a real explanation, not a bare code'
  )

  // Restore the real configuration for the remaining tests.
  const restore = await call('PUT', '/config', { token: adminToken(), body: { config } })
  assert.equal(restore.status, 200)
})

// ---------------------------------------------------------------------------
// Manual mode + validation failures
// ---------------------------------------------------------------------------

test('manual entry: saving a partial timetable is allowed (drafts may be incomplete)', async () => {
  const cfg = (await call('GET', '/bootstrap', { token: adminToken() })).data.config
  // Pick a teacher who is actually available at Monday P1 — t_m1 is explicitly
  // marked unavailable exactly there, and the backend (correctly) rejects that.
  const teacher = cfg.teachers.find(t =>
    t.subjectIds.includes(cfg.subjects[0].id) &&
    !(t.unavailableSlots || []).some(u => u.day === 'Monday' && u.period === 'P1'))
  assert.ok(teacher, 'fixture must offer an available teacher')
  const entry = {
    classId: cfg.classes[0].id,
    day: 0, period: 0,
    subjectId: cfg.subjects[0].id,
    teacherId: teacher.id
  }
  const { status, data } = await call('PUT', '/entries', {
    token: adminToken(), body: { entries: [entry] }
  })
  assert.equal(status, 200)
  assert.equal(data.timetable.status, 'draft')
  assert.equal(data.timetable.entries.length, 1)
  assert.ok(data.validation.hard.some(h => h.code === 'H_MISSING_LESSON'),
    'incomplete drafts are reported, not rejected')

  await call('PUT', '/entries', { token: adminToken(), body: { entries: [] } })
})

test('a teacher double-booking is rejected with a clear conflict message', async () => {
  const cfg = (await call('GET', '/bootstrap', { token: adminToken() })).data.config
  const teacher = cfg.teachers.find(t => t.subjectIds.length)
  const subjectId = teacher.subjectIds[0]
  const clash = [
    { classId: cfg.classes[0].id, day: 1, period: 1, subjectId, teacherId: teacher.id },
    { classId: cfg.classes[1].id, day: 1, period: 1, subjectId, teacherId: teacher.id }
  ]
  const { status, data } = await call('PUT', '/entries', {
    token: adminToken(), body: { entries: clash }
  })
  assert.equal(status, 409)
  assert.ok(data.violations.some(v => v.code === 'H_TEACHER_CLASH'))
  assert.match(data.violations.find(v => v.code === 'H_TEACHER_CLASH').message, /two classes at once/)

  // Nothing may have been saved.
  const boot = await call('GET', '/bootstrap', { token: adminToken() })
  assert.deepEqual(boot.data.timetable.entries, [])
})

test('an unqualified teacher is rejected', async () => {
  const cfg = (await call('GET', '/bootstrap', { token: adminToken() })).data.config
  const subject = cfg.subjects.find(s => !cfg.teachers.some(t => t.subjectIds.includes(s.id))) ||
    cfg.subjects[cfg.subjects.length - 1]
  const unqualified = cfg.teachers.find(t => !t.subjectIds.includes(subject.id))
  const { status, data } = await call('PUT', '/entries', {
    token: adminToken(),
    body: {
      entries: [{ classId: cfg.classes[0].id, day: 2, period: 2, subjectId: subject.id, teacherId: unqualified.id }]
    }
  })
  assert.equal(status, 409)
  assert.ok(data.violations.length > 0, 'at least one hard violation must be reported')
})

test('a lesson in a teacher\'s unavailable slot is rejected', async () => {
  const cfg = (await call('GET', '/bootstrap', { token: adminToken() })).data.config
  const t = cfg.teachers.find(x => (x.unavailableSlots || []).length)
  const slot = t.unavailableSlots[0]
  const day = cfg.days.indexOf(slot.day)
  const period = cfg.periods.findIndex(p => p.label === slot.period)
  const subjectId = t.subjectIds[0]
  const { status, data } = await call('PUT', '/entries', {
    token: adminToken(),
    body: { entries: [{ classId: cfg.classes[0].id, day, period, subjectId, teacherId: t.id }] }
  })
  assert.equal(status, 409)
  assert.ok(data.violations.some(v => /unavailable|availability/i.test(v.code + v.message)))
})

test('an entry referencing something that does not exist is a 400', async () => {
  const { status, data } = await call('PUT', '/entries', {
    token: adminToken(),
    body: { entries: [{ classId: 'nope', day: 0, period: 0, subjectId: 'x', teacherId: 'y' }] }
  })
  assert.equal(status, 400)
  assert.match(data.error, /unknown class/)
})

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

test('an incomplete timetable cannot be published', async () => {
  const cfg = (await call('GET', '/bootstrap', { token: adminToken() })).data.config
  const teacher = cfg.teachers.find(t => t.subjectIds.length)
  await call('PUT', '/entries', {
    token: adminToken(),
    body: {
      entries: [{ classId: cfg.classes[0].id, day: 0, period: 0, subjectId: teacher.subjectIds[0], teacherId: teacher.id }]
    }
  })

  const { status, data } = await call('POST', '/publish', { token: adminToken() })
  assert.equal(status, 409)
  assert.ok(data.validation.hard.some(h => h.code === 'H_MISSING_LESSON'))

  const boot = await call('GET', '/bootstrap', { token: adminToken() })
  assert.equal(boot.data.timetable.status, 'draft', 'must still be a draft after a failed publish')
})

test('a complete generated timetable can be published, and editing it demotes it back to draft', async () => {
  const gen = await call('POST', '/generate', { token: adminToken(), body: { keepLocked: false } })
  assert.equal(gen.data.ok, true)
  const save = await call('PUT', '/entries', { token: adminToken(), body: { entries: gen.data.entries } })
  assert.equal(save.status, 200)

  const pub = await call('POST', '/publish', { token: adminToken() })
  assert.equal(pub.status, 200)
  assert.equal(pub.data.timetable.status, 'published')

  // Remove one lesson -> editing must return it to draft and block publishing.
  const trimmed = gen.data.entries.slice(1)
  const edit = await call('PUT', '/entries', { token: adminToken(), body: { entries: trimmed } })
  assert.equal(edit.status, 200)
  assert.equal(edit.data.timetable.status, 'draft')

  const republish = await call('POST', '/publish', { token: adminToken() })
  assert.equal(republish.status, 409)

  await call('PUT', '/entries', { token: adminToken(), body: { entries: [] } })
})

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

test('teacher view reports loads; room and school views respond per tenant', async () => {
  const gen = await call('POST', '/generate', { token: adminToken(), body: { keepLocked: false } })
  await call('PUT', '/entries', { token: adminToken(), body: { entries: gen.data.entries } })

  const teachers = await call('GET', '/view?by=teacher', { token: adminToken() })
  assert.equal(teachers.status, 200)
  assert.ok(teachers.data.rows.length > 0)
  const totalLessons = teachers.data.rows.reduce((s, r) => s + r.lessons, 0)
  assert.equal(totalLessons, gen.data.entries.length, 'every lesson must appear in exactly one teacher row')
  assert.ok(teachers.data.rows.every(r => !r.overWeekLimit), 'generated timetable must respect weekly caps')

  const rooms = await call('GET', '/view?by=room', { token: adminToken() })
  assert.equal(rooms.status, 200)
  assert.ok(rooms.data.rows.length >= 1)

  const school = await call('GET', '/view?by=school', { token: adminToken() })
  assert.equal(school.status, 200)
  assert.equal(school.data.rows.length, 6)

  // The other school's teacher view must be empty (its own timetable is empty).
  const other = await call('GET', '/view?by=teacher', { token: admin2Token() })
  assert.equal(other.data.rows.reduce((s, r) => s + r.lessons, 0), 0)

  await call('PUT', '/entries', { token: adminToken(), body: { entries: [] } })
})

// ---------------------------------------------------------------------------
// Integration shape: mounting under The Eye's REAL requireAuth + feature flag
// ---------------------------------------------------------------------------

test('mounts under The Eye\'s requireAuth exactly as INTEGRATION.md documents', async () => {
  // Use the secret serverg.js would use in production (env or the same default
  // authMiddleware falls back to), so this proves the real middleware accepts
  // a real Eye-shaped token against our router.
  const secret = ORIGINAL_JWT_SECRET || 'theEye_Secret_2024_xK9mP2qR7vN'
  process.env.JWT_SECRET = secret
  try {
    const token = jwt.sign(
      { user_id: 42, role: 'admin', tenant_id: 'DEMO1', login_id: 'admin.greenwood', branch_id: null },
      secret
    )

    const app = express()
    app.use(express.json())
    const store = createMemoryStore(sampleSchools())
    app.use('/api/timetable', createTimetableRouter({
      store,
      auth: require('../authMiddleware').requireAuth(['super_admin', 'admin', 'coordinator', 'teacher']),
      featureEnabled: (tenant) => tenant !== 'DEMO1'   // flag OFF for DEMO1 here
    }))

    const srv = app.listen(0, '127.0.0.1')
    await new Promise(r => srv.once('listening', r))
    const url = `http://127.0.0.1:${srv.address().port}/api/timetable`

    // Valid Eye token, but the feature flag says no -> 403 feature disabled.
    const gated = await fetch(url + '/bootstrap', { headers: { Authorization: 'Bearer ' + token } })
    assert.equal(gated.status, 403)
    assert.match((await gated.json()).error, /not enabled/)

    // Same mount, flag ON -> works with no other change.
    const app2 = express()
    app2.use(express.json())
    app2.use('/api/timetable', createTimetableRouter({
      store: createMemoryStore(sampleSchools()),
      auth: require('../authMiddleware').requireAuth(['super_admin', 'admin', 'coordinator', 'teacher']),
      featureEnabled: () => true
    }))
    const srv2 = app2.listen(0, '127.0.0.1')
    await new Promise(r => srv2.once('listening', r))
    const ok = await fetch(`http://127.0.0.1:${srv2.address().port}/api/timetable/bootstrap`,
      { headers: { Authorization: 'Bearer ' + token } })
    assert.equal(ok.status, 200)
    const body = await ok.json()
    assert.equal(body.tenant.id, 'DEMO1')
    assert.equal(body.user.role, 'admin')

    srv.close(); srv2.close()
  } finally {
    process.env.JWT_SECRET = 'timetable-dev-only-not-for-production'
  }
})
