'use strict'

/**
 * tt2 — tests.
 *
 *   node --test timetable/tt2/test/
 *
 * Covers the three things that can silently break tt2:
 *   1. the wizard rules — what is allowed and what blocks generation
 *   2. the model mapping — wizard answers -> solver input -> grid, including
 *      the period-index arithmetic that breaks easily when breaks exist
 *   3. the API — generate, place a lesson by hand, clear it, export
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const path = require('path')

const { defaultConfig, normaliseConfig, validateConfig, STEPS } = require('../wizard')
const {
  buildPeriods,
  buildTimeLabels,
  buildSolverInput,
  buildGrids,
  gridToEntries,
  collectLocks,
  formatClock
} = require('../model')
const { createTt2Router } = require('../routes')
const { createFileStore } = require('../store')

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A small but realistic school: 2 classes, 6 subjects, 3 teachers. */
function sampleConfig(overrides = {}) {
  const config = {
    ...defaultConfig(),
    schoolName: 'Greenwood Academy',
    days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    startTime: '08:00',
    periodCount: 6,
    periodDuration: 40,
    breaks: [
      { id: 'b1', afterPeriod: 2, label: 'Short Break', duration: 15 },
      { id: 'b2', afterPeriod: 4, label: 'Lunch', duration: 30 }
    ],
    classes: [
      { id: 'c1', name: 'Grade 9A', studentCount: 28 },
      { id: 'c2', name: 'Grade 9B', studentCount: 30 }
    ],
    subjects: [
      { id: 's_math', name: 'Mathematics', difficult: 'medium', roomId: null },
      { id: 's_phys', name: 'Physics', difficult: 'difficult', roomId: null },
      { id: 's_eng', name: 'English', difficult: 'easy', roomId: null },
      { id: 's_hist', name: 'History', difficult: 'medium', roomId: null },
      { id: 's_bio', name: 'Biology', difficult: 'difficult', roomId: null },
      { id: 's_art', name: 'Art', difficult: 'easy', roomId: null }
    ],
    teachers: [
      { id: 't_a', name: 'Ayesha Khan', subjectIds: ['s_math', 's_phys'], maxPerDay: 5, maxPerWeek: 14, unavailableSlots: [] },
      { id: 't_b', name: 'Bilal Ahmed', subjectIds: ['s_eng', 's_hist'], maxPerDay: 5, maxPerWeek: 14, unavailableSlots: [] },
      { id: 't_c', name: 'Sana Malik', subjectIds: ['s_bio', 's_art'], maxPerDay: 5, maxPerWeek: 10, unavailableSlots: [] }
    ],
    curriculum: [
      { id: 'r1', classId: 'c1', subjectId: 's_math', periodsPerWeek: 3, teacherIds: [] },
      { id: 'r2', classId: 'c1', subjectId: 's_phys', periodsPerWeek: 3, teacherIds: [] },
      { id: 'r3', classId: 'c1', subjectId: 's_eng', periodsPerWeek: 3, teacherIds: [] },
      { id: 'r4', classId: 'c1', subjectId: 's_hist', periodsPerWeek: 3, teacherIds: [] },
      { id: 'r5', classId: 'c1', subjectId: 's_bio', periodsPerWeek: 2, teacherIds: [] },
      { id: 'r6', classId: 'c1', subjectId: 's_art', periodsPerWeek: 2, teacherIds: [] },
      { id: 'r7', classId: 'c2', subjectId: 's_math', periodsPerWeek: 3, teacherIds: [] },
      { id: 'r8', classId: 'c2', subjectId: 's_phys', periodsPerWeek: 3, teacherIds: [] },
      { id: 'r9', classId: 'c2', subjectId: 's_eng', periodsPerWeek: 3, teacherIds: [] },
      { id: 'r10', classId: 'c2', subjectId: 's_hist', periodsPerWeek: 3, teacherIds: [] },
      { id: 'r11', classId: 'c2', subjectId: 's_bio', periodsPerWeek: 2, teacherIds: [] },
      { id: 'r12', classId: 'c2', subjectId: 's_art', periodsPerWeek: 2, teacherIds: [] }
    ]
  }
  return { ...config, ...overrides }
}

// ---------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------

test('wizard: every step is described', () => {
  assert.ok(STEPS.length >= 9)
  for (const step of STEPS) {
    assert.ok(step.id && step.title && step.blurb, `step ${step.id} is incomplete`)
    assert.ok(Array.isArray(step.fields) && step.fields.length, `step ${step.id} lists no questions`)
  }
})

test('wizard: a complete configuration passes validation', () => {
  const result = validateConfig(sampleConfig())
  assert.deepEqual(result.errors, [])
  assert.equal(result.canGenerate, true)
})

test('wizard: a teacher may teach three subjects without complaint', () => {
  const config = sampleConfig()
  config.teachers[0].subjectIds = ['s_math', 's_phys', 's_hist']
  config.teachers[1].subjectIds = ['s_eng']
  config.teachers[2].subjectIds = ['s_bio', 's_art']
  // t_a now carries three subjects across both classes: 18 periods a week.
  config.teachers[0].maxPerWeek = 20
  config.teachers[0].maxPerDay = 6
  const result = validateConfig(config)
  assert.equal(result.canGenerate, true)
  assert.equal(result.errors.length, 0)
})

test('wizard: a teacher with no subject is an error', () => {
  const config = sampleConfig()
  config.teachers[0].subjectIds = []
  const result = validateConfig(config)
  assert.equal(result.canGenerate, false)
  assert.ok(result.errors.some(e => /Ayesha Khan.*no subject/i.test(e)))
})

test('wizard: a subject with no teacher is an error', () => {
  const config = sampleConfig()
  config.teachers = config.teachers.filter(t => t.id !== 't_c')
  const result = validateConfig(config)
  assert.equal(result.canGenerate, false)
  assert.ok(result.errors.some(e => /Biology.*no teacher/i.test(e)))
})

test('wizard: a teacher cannot be pinned to a subject they do not teach', () => {
  const config = sampleConfig()
  config.curriculum[0].teacherIds = ['t_c']
  const result = validateConfig(config)
  assert.equal(result.canGenerate, false)
  assert.ok(result.errors.some(e => /not qualified/i.test(e)))
})

test('wizard: over-subscribing a class is an error', () => {
  const config = sampleConfig()
  config.curriculum[0].periodsPerWeek = 40
  const result = validateConfig(config)
  assert.equal(result.canGenerate, false)
  assert.ok(result.errors.some(e => /only 30 teaching slots/i.test(e)))
})

test('wizard: exceeding a teacher weekly cap is an error', () => {
  const config = sampleConfig()
  config.teachers[0].maxPerWeek = 4
  const result = validateConfig(config)
  assert.equal(result.canGenerate, false)
  assert.ok(result.errors.some(e => /capped at 4/i.test(e)))
})

test('wizard: a break beyond the last period is an error', () => {
  const config = sampleConfig()
  config.breaks.push({ id: 'b3', afterPeriod: 9, label: 'Snack', duration: 15 })
  const result = validateConfig(config)
  assert.equal(result.canGenerate, false)
  assert.ok(result.errors.some(e => /only 6 periods/i.test(e)))
})

test('wizard: an unused subject is a warning, not an error', () => {
  const config = sampleConfig()
  config.subjects.push({ id: 's_geo', name: 'Geography', difficult: 'medium', roomId: null })
  config.teachers[0].subjectIds.push('s_geo')
  const result = validateConfig(config)
  assert.equal(result.canGenerate, true)
  assert.ok(result.warnings.some(w => /Geography.*not taught/i.test(w)))
})

test('wizard: normaliseConfig drops junk and fills defaults', () => {
  const config = normaliseConfig({ schoolName: '  Rose School  ', days: ['Monday', 'Nonsense'], classes: 'not-an-array' })
  assert.equal(config.schoolName, 'Rose School')
  assert.deepEqual(config.days, ['Monday'])
  assert.deepEqual(config.classes, [])
  assert.equal(config.periodCount, defaultConfig().periodCount)
})

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

test('model: breaks get their own column but do not count as periods', () => {
  const { periods, teachingIndex } = buildPeriods(sampleConfig())
  assert.equal(periods.filter(p => p.kind === 'teaching').length, 6)
  assert.equal(periods.filter(p => p.kind === 'break').length, 2)
  assert.equal(periods.length, 8)
  // P3 sits at column 3 because one break precedes it
  assert.equal(teachingIndex['1'], 0)
  assert.equal(teachingIndex['3'], 3)
  assert.equal(teachingIndex['6'], 7)
})

test('model: time labels run from the start time and honour durations', () => {
  const labels = buildTimeLabels(sampleConfig())
  assert.equal(labels[0].text, '8:00 AM – 8:40 AM')
  assert.equal(labels[1].text, '8:40 AM – 9:20 AM')
  // the 15-minute break sits between P2 and P3
  assert.equal(labels[2].kind, 'break')
  assert.equal(labels[2].text, '9:20 AM – 9:35 AM')
  // so P3 starts at 9:35
  assert.equal(labels[3].text, '9:35 AM – 10:15 AM')
  assert.equal(labels[3].kind, 'teaching')
})

test('model: formatClock renders 12-hour times', () => {
  assert.equal(formatClock(0), '12:00 AM')
  assert.equal(formatClock(12 * 60), '12:00 PM')
  assert.equal(formatClock(13 * 60 + 5), '1:05 PM')
})

test('model: a per-period duration override is applied', () => {
  const config = sampleConfig({ periodOverrides: { '1': 90 } })
  const labels = buildTimeLabels(config)
  assert.equal(labels[0].text, '8:00 AM – 9:30 AM')
})

test('model: solver input carries days, periods and requirements', () => {
  const input = buildSolverInput(sampleConfig())
  assert.equal(input.days.length, 5)
  assert.equal(input.periods.length, 8)
  assert.equal(input.classes.length, 2)
  assert.equal(input.subjects.length, 6)
  assert.equal(input.teachers.length, 3)
  assert.equal(input.requirements.length, 12)
  assert.equal(input.requirements[0].periodsPerWeek, 3)
  assert.equal(input.teachers[0].subjectIds.length, 2)
  // difficult is a boolean flag for the solver
  const physics = input.subjects.find(s => s.id === 's_phys')
  assert.equal(physics.difficult, true)
})

test('model: unavailable slots are translated to column indices', () => {
  const config = sampleConfig()
  config.teachers[0].unavailableSlots = [{ day: 0, period: 3 }]
  const input = buildSolverInput(config)
  assert.equal(input.teachers[0].unavailableSlots[0].day, 'Monday')
  // teaching period 3 is column 3 in this layout
  assert.equal(input.teachers[0].unavailableSlots[0].period, 3)
})

test('model: manual pins become solver locks', () => {
  const config = sampleConfig()
  const locks = [{ classId: 'c1', day: 0, teachingNumber: 2, subjectId: 's_math', teacherId: 't_a' }]
  const input = buildSolverInput(config, { locks })
  assert.equal(input.locks.length, 1)
  assert.equal(input.locks[0].classId, 'c1')
  assert.equal(input.locks[0].period, 1) // teaching period 2 is column 1
  assert.equal(input.locks[0].subjectId, 's_math')
})

test('model: a grid round-trips through entries without losing the teacher', () => {
  const config = sampleConfig()
  const entries = [{ classId: 'c1', day: 0, period: 0, subjectId: 's_math', teacherId: 't_a', roomId: null }]
  const grids = buildGrids(config, entries, {})
  const cell = grids.c1['c1|0|0']
  assert.equal(cell.subjectId, 's_math')
  assert.equal(cell.teacherId, 't_a')
  assert.equal(cell.teachingNumber, 1)
  assert.equal(cell.manual, false)

  const roundTrip = gridToEntries(grids)
  assert.equal(roundTrip.length, 1)
  assert.equal(roundTrip[0].teacherId, 't_a')
})

test('model: a manual cell overrides the solver for the same slot', () => {
  const config = sampleConfig()
  const entries = [{ classId: 'c1', day: 0, period: 0, subjectId: 's_math', teacherId: 't_a' }]
  const manual = {
    'c1|0|0': { classId: 'c1', day: 0, period: 0, subjectId: 's_eng', teacherId: 't_b', locked: true, manual: true }
  }
  const grids = buildGrids(config, entries, manual)
  const cell = grids.c1['c1|0|0']
  assert.equal(cell.subjectId, 's_eng')
  assert.equal(cell.locked, true)
  assert.equal(cell.manual, true)

  const locks = collectLocks(grids)
  assert.equal(locks.length, 1)
  assert.equal(locks[0].subjectId, 's_eng')
})

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

function makeApp() {
  const store = createFileStore({ persistPath: null })
  const app = express()
  app.use(express.json())
  app.use('/api/tt2', createTt2Router({ store, devAuth: true }))
  return { app, store }
}

let server
let base

test.before(async () => {
  const { app } = makeApp()
  server = app.listen(0)
  await new Promise(resolve => server.once('listening', resolve))
  base = `http://127.0.0.1:${server.address().port}/api/tt2`
})

test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve))
  try {
    const pool = require('../../../db')
    await pool.end()
  } catch (_) {}
})

async function post(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  return { status: res.status, body: await res.json() }
}

async function put(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  return { status: res.status, body: await res.json() }
}

test('api: /meta describes the wizard', async () => {
  const res = await fetch(`${base}/meta`)
  const data = await res.json()
  assert.equal(res.status, 200)
  assert.ok(data.steps.length >= 9)
  assert.equal(data.devAuth, true)
})

test('api: /check reports the outstanding questions', async () => {
  const res = await post('/check', { config: sampleConfig({ schoolName: '', periodCount: 0 }) })
  assert.equal(res.status, 200)
  assert.equal(res.body.canGenerate, false)
  assert.ok(res.body.errors.length >= 2)
})

test('api: creating, generating and reading a timetable', async () => {
  const created = await post('/timetables', { name: 'Autumn term', config: sampleConfig() })
  assert.equal(created.status, 201)
  const id = created.body.timetable.id

  const generated = await post(`/timetables/${id}/generate`, {})
  assert.equal(generated.status, 200)
  assert.equal(generated.body.report.ok, true, JSON.stringify(generated.body.report.diagnostics))

  const stats = generated.body.report.stats
  assert.equal(stats.requiredLessons, 32)
  assert.equal(stats.scheduledLessons, 32)
  assert.equal(stats.completenessPct, 100)

  const fetched = await fetch(`${base}/timetables/${id}`)
  const doc = (await fetched.json()).timetable
  assert.equal(Object.keys(doc.grids).length, 2)
  assert.equal(doc.validation.ok, true)
  assert.equal(doc.validation.totals.scheduled, 32)
})

test('api: generation is refused while questions are unanswered', async () => {
  const created = await post('/timetables', { config: sampleConfig({ schoolName: '' }) })
  const id = created.body.timetable.id
  const res = await post(`/timetables/${id}/generate`, {})
  assert.equal(res.status, 400)
  assert.ok(res.body.errors.length > 0)
})

test('api: a lesson can be placed by hand and cleared again', async () => {
  const created = await post('/timetables', { config: sampleConfig() })
  const id = created.body.timetable.id
  await post(`/timetables/${id}/generate`, {})

  // Monday, teaching period 1 (column 0)
  const placed = await post(`/timetables/${id}/place`, {
    classId: 'c1', day: 0, period: 0, subjectId: 's_math', teacherId: 't_a'
  })
  assert.equal(placed.status, 200)
  assert.equal(placed.body.cell.subjectId, 's_math')
  assert.equal(placed.body.cell.teacherId, 't_a')
  assert.equal(placed.body.cell.manual, true)

  const cleared = await fetch(`${base}/timetables/${id}/cell`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ classId: 'c1', day: 0, period: 0 })
  })
  assert.equal(cleared.status, 200)
  const doc = (await cleared.json()).timetable
  assert.equal(doc.grids.c1['c1|0|0'], undefined)
})

test('api: a teacher cannot be double-booked by hand', async () => {
  const created = await post('/timetables', { config: sampleConfig() })
  const id = created.body.timetable.id
  await post(`/timetables/${id}/generate`, {})

  const res = await post(`/timetables/${id}/place`, {
    classId: 'c2', day: 0, period: 0, subjectId: 's_math', teacherId: 't_a'
  })
  assert.equal(res.status, 409)
  assert.match(res.body.error, /already teaching another class/i)
})

test('api: placing into a break is refused', async () => {
  const created = await post('/timetables', { config: sampleConfig() })
  const id = created.body.timetable.id
  // column 1 is P2, column 2 is the Short Break
  const res = await post(`/timetables/${id}/place`, {
    classId: 'c1', day: 0, period: 2, subjectId: 's_math', teacherId: 't_a'
  })
  assert.equal(res.status, 400)
  assert.match(res.body.error, /break/i)
})

test('api: a hand-pinned lesson survives a regeneration', async () => {
  const created = await post('/timetables', { config: sampleConfig() })
  const id = created.body.timetable.id
  await post(`/timetables/${id}/generate`, {})

  // Column 1 (P2) is a slot where t_c is genuinely free. Column 0 is NOT:
  // the solver puts t_c on c2 there, so placing there is correctly refused
  // with a 409 and nothing would be pinned.
  const placed = await post(`/timetables/${id}/place`, {
    classId: 'c1', day: 2, period: 1, subjectId: 's_art', teacherId: 't_c'
  })
  assert.equal(placed.status, 200)
  assert.equal(placed.body.cell.manual, true)

  const regenerated = await post(`/timetables/${id}/generate`, {})
  assert.equal(regenerated.status, 200)
  const doc = regenerated.body.timetable
  const cell = doc.grids.c1['c1|2|1']
  assert.ok(cell, 'the pinned cell disappeared')
  assert.equal(cell.subjectId, 's_art')
  assert.equal(cell.manual, true)
})

test('api: CSV export produces one block per class', async () => {
  const created = await post('/timetables', { config: sampleConfig() })
  const id = created.body.timetable.id
  await post(`/timetables/${id}/generate`, {})

  const res = await fetch(`${base}/timetables/${id}/export.csv`)
  assert.equal(res.status, 200)
  const csv = await res.text()
  assert.match(csv, /Greenwood Academy - Grade 9A/)
  assert.match(csv, /Greenwood Academy - Grade 9B/)
  assert.match(csv, /Mathematics/)
  assert.match(csv, /Short Break/)
})

test('api: documents are isolated between tenants', async () => {
  const store = createFileStore({ persistPath: null })
  const a = store.create({ tenantId: 'A', config: sampleConfig() })
  store.create({ tenantId: 'B', config: sampleConfig() })
  assert.equal(store.list('A').length, 1)
  assert.equal(store.list('B').length, 1)
  assert.equal(store.get('B', a.id), null, 'tenant B can see tenant A\'s document')
})

test('api: the store persists to disk', async () => {
  const file = path.join(require('node:os').tmpdir(), `tt2-store-${Date.now()}.json`)
  const store = createFileStore({ persistPath: file })
  const doc = store.create({ tenantId: 'dev', config: sampleConfig() })
  const reopened = createFileStore({ persistPath: file })
  assert.equal(reopened.get('dev', doc.id).config.schoolName, 'Greenwood Academy')
  require('node:fs').unlinkSync(file)
})

test('wizard: duplicate class section is an error', () => {
  const cfg = sampleConfig()
  cfg.classes.push({ id: 'c3', name: 'Grade 9A', section: 'A' })
  cfg.classes[0].section = 'A'
  const res = validateConfig(cfg)
  assert.equal(res.canGenerate, false)
  assert.ok(res.errors.some(e => e.includes('Duplicate class')))
})

test('api: /existing-classes returns class templates', async () => {
  const res = await fetch(`${base}/existing-classes`)
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.ok, true)
  assert.ok(Array.isArray(data.classes) && data.classes.length > 0)
})

