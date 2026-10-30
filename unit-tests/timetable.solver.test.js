'use strict'

/**
 * Unit tests for the timetable solver and the independent validator.
 *
 * Run with:  npm run test:unit     (node --test unit-tests/)
 *
 * These tests use in-memory fixtures only: no database, no server, no network.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { generateTimetable } = require('../timetable/solver')
const { validateTimetable } = require('../timetable/validator')
const { realisticSchool, tinyWeek, countClashes } = require('./fixtures')

// ---------------------------------------------------------------------------
// Successful generation
// ---------------------------------------------------------------------------

test('realistic school: generates a complete, valid timetable', () => {
  const { input, expectedTotal } = realisticSchool()
  const result = generateTimetable(input)

  assert.equal(result.ok, true, `expected success, got diagnostics: ${JSON.stringify(result.diagnostics, null, 2)}`)
  assert.equal(result.stats.requiredLessons, expectedTotal)
  assert.equal(result.stats.scheduledLessons, expectedTotal)
  assert.equal(result.stats.completenessPct, 100)
  assert.equal(result.entries.length, expectedTotal)
  assert.deepEqual(result.violations, [])
  assert.equal(result.violations.length, 0, 'an ok timetable must have zero hard violations')
  assert.ok(result.stats.generationMs >= 0)
  assert.ok(result.stats.generationMs < 5000, `generation took ${result.stats.generationMs} ms`)
})

test('realistic school: no teacher and no class is ever double-booked', () => {
  const { input } = realisticSchool()
  const result = generateTimetable(input)
  assert.equal(countClashes(result.entries, 'teacherId'), 0, 'teacher clash found')
  assert.equal(countClashes(result.entries, 'classId'), 0, 'class clash found')
})

test('realistic school: weekly requirement per class/subject is met exactly', () => {
  const { input } = realisticSchool()
  const result = generateTimetable(input)
  const counts = new Map()
  for (const e of result.entries) {
    const key = `${e.classId}#${e.subjectId}`
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  for (const req of input.requirements) {
    const actual = counts.get(`${req.classId}#${req.subjectId}`) || 0
    assert.equal(actual, req.periodsPerWeek,
      `${req.classId}/${req.subjectId}: expected ${req.periodsPerWeek}, got ${actual}`)
  }
})

test('realistic school: teacher availability, workload limits and breaks are respected', () => {
  const { input } = realisticSchool()
  const result = generateTimetable(input)

  const unavailable = new Map()
  for (const t of input.teachers) {
    for (const slot of t.unavailableSlots) {
      unavailable.set(`${t.id}#${input.days.indexOf(slot.day)}#${input.periods.findIndex(p => p.label === slot.period)}`, true)
    }
  }
  const teaching = new Set(input.periods.map((p, i) => (p.kind === 'teaching' ? i : -1)).filter(i => i >= 0))

  const perTeacherDay = new Map()
  const perTeacherWeek = new Map()
  for (const e of result.entries) {
    assert.ok(teaching.has(e.period), 'lesson placed in a break or lunch period')
    assert.ok(!unavailable.has(`${e.teacherId}#${e.day}#${e.period}`), 'lesson placed in a teacher-unavailable slot')
    const dayKey = `${e.teacherId}#${e.day}`
    perTeacherDay.set(dayKey, (perTeacherDay.get(dayKey) || 0) + 1)
    perTeacherWeek.set(e.teacherId, (perTeacherWeek.get(e.teacherId) || 0) + 1)
  }

  for (const t of input.teachers) {
    for (const [key, n] of perTeacherDay) {
      if (key.startsWith(`${t.id}#`)) assert.ok(n <= t.maxPerDay, `${t.name} has ${n} periods in one day`)
    }
    const week = perTeacherWeek.get(t.id) || 0
    assert.ok(week <= t.maxPerWeek, `${t.name} has ${week} periods in the week`)
  }
})

test('realistic school: more than one teacher teaches the same subject', () => {
  const { input } = realisticSchool()
  const result = generateTimetable(input)
  const bySubject = new Map()
  for (const e of result.entries) {
    if (!bySubject.has(e.subjectId)) bySubject.set(e.subjectId, new Set())
    bySubject.get(e.subjectId).add(e.teacherId)
  }
  for (const subjectId of ['math', 'physics', 'eng', 'urdu']) {
    assert.ok(bySubject.get(subjectId).size >= 2,
      `expected several teachers for ${subjectId}, got ${bySubject.get(subjectId).size}`)
  }
})

test('realistic school: generation is deterministic', () => {
  const { input } = realisticSchool()
  const a = generateTimetable(input)
  const b = generateTimetable(input)
  assert.equal(a.ok, true)
  assert.equal(b.ok, true)
  assert.deepEqual(a.entries, b.entries)
})

test('stats report generation time and node count', () => {
  const { input } = realisticSchool()
  const result = generateTimetable(input)
  assert.ok(Number.isFinite(result.stats.generationMs))
  assert.ok(result.stats.nodeCount > 0)
  assert.equal(result.stats.aborted, null)
})

// ---------------------------------------------------------------------------
// Soft preferences never block a valid timetable
// ---------------------------------------------------------------------------

test('soft preferences are reported but do not fail an otherwise valid timetable', () => {
  const input = {
    days: ['Monday'],
    periods: [{ label: 'P1', kind: 'teaching' }, { label: 'P2', kind: 'teaching' }],
    classes: [{ id: 'c1', name: 'Class 1' }],
    subjects: [{ id: 'x', name: 'Advanced Maths', difficult: true }, { id: 'y', name: 'Physics', difficult: true }],
    teachers: [{ id: 't1', name: 'Teacher 1', subjectIds: ['x', 'y'] }],
    requirements: [
      { classId: 'c1', subjectId: 'x', periodsPerWeek: 1 },
      { classId: 'c1', subjectId: 'y', periodsPerWeek: 1 }
    ],
    preferences: { maxSameSubjectPerDay: 1, avoidConsecutiveDifficult: true }
  }
  const result = generateTimetable(input)
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics))
  assert.deepEqual(result.violations, [])
  assert.ok(result.softPenalties.some(p => p.code === 'S_CONSECUTIVE_DIFFICULT'),
    'two demanding subjects back to back should be flagged as a soft penalty')
})

test('two periods of one subject on one day are flagged as a soft penalty only', () => {
  const input = {
    days: ['Monday'],
    periods: [{ label: 'P1', kind: 'teaching' }, { label: 'P2', kind: 'teaching' }],
    classes: [{ id: 'c1', name: 'Class 1' }],
    subjects: [{ id: 'z', name: 'Reading' }],
    teachers: [{ id: 't1', name: 'Teacher 1', subjectIds: ['z'] }],
    requirements: [{ classId: 'c1', subjectId: 'z', periodsPerWeek: 2 }]
  }
  const result = generateTimetable(input)
  assert.equal(result.ok, true)
  assert.ok(result.softPenalties.some(p => p.code === 'S_SAME_SUBJECT_DAY'))
})

// ---------------------------------------------------------------------------
// Impossible configurations must fail loudly, with an explanation
// ---------------------------------------------------------------------------

test('class needs more periods than the school week has: fails with an explanation', () => {
  const input = {
    ...tinyWeek(),
    classes: [{ id: 'c1', name: 'Class 1' }],
    subjects: [{ id: 'a', name: 'Algebra' }],
    teachers: [{ id: 't1', name: 'Teacher 1', subjectIds: ['a'] }],
    requirements: [{ classId: 'c1', subjectId: 'a', periodsPerWeek: 12 }]
  }
  const result = generateTimetable(input)
  assert.equal(result.ok, false)
  assert.equal(result.stats.completenessPct, 0)
  const codes = result.diagnostics.map(d => d.code)
  assert.ok(codes.includes('D_CLASS_OVERFLOW'), JSON.stringify(result.diagnostics))
  const msg = result.diagnostics.find(d => d.code === 'D_CLASS_OVERFLOW').message
  assert.match(msg, /12 periods a week/)
  assert.match(msg, /5 teaching periods/)
})

test('sole eligible teacher is over capacity: fails with a named teacher', () => {
  const input = {
    ...tinyWeek(),
    classes: [{ id: 'c1', name: 'Class 1' }, { id: 'c2', name: 'Class 2' }],
    subjects: [{ id: 'u', name: 'Urdu' }],
    teachers: [{ id: 't1', name: 'Mr. Kamran', subjectIds: ['u'], maxPerDay: 5, maxPerWeek: 6 }],
    requirements: [
      { classId: 'c1', subjectId: 'u', periodsPerWeek: 4 },
      { classId: 'c2', subjectId: 'u', periodsPerWeek: 4 }
    ]
  }
  const result = generateTimetable(input)
  assert.equal(result.ok, false)
  const diag = result.diagnostics.find(d => d.code === 'D_TEACHER_OVERLOAD')
  assert.ok(diag, JSON.stringify(result.diagnostics))
  assert.match(diag.message, /Mr\. Kamran/)
  assert.match(diag.message, /8 periods/)
})

test('subject with no qualified teacher: fails before searching', () => {
  const input = {
    ...tinyWeek(),
    classes: [{ id: 'c1', name: 'Class 1' }],
    subjects: [{ id: 'a', name: 'Algebra' }],
    teachers: [{ id: 't1', name: 'Teacher 1', subjectIds: ['physics'] }],
    requirements: [{ classId: 'c1', subjectId: 'a', periodsPerWeek: 1 }]
  }
  const result = generateTimetable(input)
  assert.equal(result.ok, false)
  assert.ok(result.diagnostics.some(d => d.code === 'D_NO_TEACHER'), JSON.stringify(result.diagnostics))
})

test('teacher marked unavailable for the whole week: fails with an availability message', () => {
  const input = {
    ...tinyWeek(),
    classes: [{ id: 'c1', name: 'Class 1' }],
    subjects: [{ id: 'a', name: 'Algebra' }],
    teachers: [{
      id: 't1', name: 'Teacher 1', subjectIds: ['a'],
      unavailableSlots: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map(d => ({ day: d, period: 'P1' }))
    }],
    requirements: [{ classId: 'c1', subjectId: 'a', periodsPerWeek: 1 }]
  }
  const result = generateTimetable(input)
  assert.equal(result.ok, false)
  assert.ok(result.diagnostics.length > 0, 'a failed run must explain itself')
  assert.ok(result.diagnostics.some(d => /only \d+ fitting slots exist/.test(d.message)),
    JSON.stringify(result.diagnostics))
})

test('impossible arrangement found only by the search: fails and explains why', () => {
  // Aggregates all look fine here (5 periods needed, 5 slots, capacity enough),
  // but a locked Monday lesson leaves no room for the Monday-only teacher.
  const input = {
    ...tinyWeek(),
    classes: [{ id: 'c1', name: 'Class 1' }],
    subjects: [{ id: 'a', name: 'Algebra' }, { id: 'b', name: 'Music' }],
    teachers: [
      { id: 'ta', name: 'Teacher A', subjectIds: ['a'] },
      { id: 'tb', name: 'Teacher B', subjectIds: ['b'], unavailableSlots: ['Tuesday', 'Wednesday', 'Thursday', 'Friday'].map(d => ({ day: d, period: 'P1' })) }
    ],
    requirements: [
      { classId: 'c1', subjectId: 'a', periodsPerWeek: 4 },
      { classId: 'c1', subjectId: 'b', periodsPerWeek: 1 }
    ],
    locks: [{ classId: 'c1', day: 'Monday', period: 0, subjectId: 'a', teacherId: 'ta' }]
  }
  const result = generateTimetable(input)
  assert.equal(result.ok, false, 'this configuration is impossible and must not report success')
  assert.ok(result.stats.scheduledLessons < result.stats.requiredLessons)
  const codes = result.diagnostics.map(d => d.code)
  assert.ok(codes.includes('S_NO_FEASIBLE_SLOT'), JSON.stringify(result.diagnostics))
  assert.ok(codes.includes('S_INCOMPLETE'), JSON.stringify(result.diagnostics))
  const msg = result.diagnostics.find(d => d.code === 'S_NO_FEASIBLE_SLOT').message
  assert.match(msg, /Music/)
  assert.match(msg, /Class 1/)
})

test('impossible configuration never reports success or 100% completeness', () => {
  const cases = []
  cases.push({
    ...tinyWeek(),
    classes: [{ id: 'c1' }],
    subjects: [{ id: 'a', name: 'A' }],
    teachers: [{ id: 't1', name: 'T', subjectIds: ['a'] }],
    requirements: [{ classId: 'c1', subjectId: 'a', periodsPerWeek: 99 }]
  })
  cases.push({
    ...tinyWeek(),
    classes: [{ id: 'c1' }],
    subjects: [{ id: 'a', name: 'A' }],
    teachers: [{ id: 't1', name: 'T', subjectIds: [] }],
    requirements: [{ classId: 'c1', subjectId: 'a', periodsPerWeek: 1 }]
  })
  for (const input of cases) {
    const result = generateTimetable(input)
    assert.equal(result.ok, false)
    assert.ok(result.stats.completenessPct < 100)
    assert.ok(result.diagnostics.length > 0, 'every failure must carry diagnostics')
  }
})

test('search budgets are reported rather than silently truncated', () => {
  const { input } = realisticSchool()
  const result = generateTimetable(input, { nodeBudget: 1 })
  assert.equal(result.ok, false)
  const codes = result.diagnostics.map(d => d.code)
  assert.ok(codes.includes('S_SEARCH_BUDGET') || codes.includes('S_TIME_BUDGET'), JSON.stringify(codes))
  assert.equal(result.stats.aborted, 'node_budget')
})

// ---------------------------------------------------------------------------
// Locks
// ---------------------------------------------------------------------------

test('locked lessons are kept and counted toward the weekly requirement', () => {
  const days = ['Monday', 'Tuesday', 'Wednesday']
  const periods = [{ label: 'P1', kind: 'teaching' }, { label: 'P2', kind: 'teaching' }]
  const input = {
    days, periods,
    classes: [{ id: 'c1', name: 'Class 1' }],
    subjects: [{ id: 'a', name: 'Algebra' }, { id: 'b', name: 'Biology' }],
    teachers: [
      { id: 't1', name: 'Teacher 1', subjectIds: ['a'] },
      { id: 't2', name: 'Teacher 2', subjectIds: ['b'] }
    ],
    requirements: [
      { classId: 'c1', subjectId: 'a', periodsPerWeek: 3 },
      { classId: 'c1', subjectId: 'b', periodsPerWeek: 3 }
    ],
    locks: [{ classId: 'c1', day: 'Monday', period: 0, subjectId: 'b', teacherId: 't2' }]
  }
  const result = generateTimetable(input)
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics))
  const kept = result.entries.find(e => e.locked)
  assert.ok(kept, 'the locked lesson must appear in the output')
  assert.equal(kept.day, 0)
  assert.equal(kept.period, 0)
  assert.equal(kept.subjectId, 'b')
  assert.equal(kept.teacherId, 't2')
  // The lock consumed one of b's three periods; b must not be scheduled 4 times.
  const bCount = result.entries.filter(e => e.subjectId === 'b').length
  assert.equal(bCount, 3)
})

test('two colliding locks are rejected with an explanation', () => {
  const input = {
    ...tinyWeek(),
    classes: [{ id: 'c1', name: 'Class 1' }],
    subjects: [{ id: 'a', name: 'Algebra' }, { id: 'b', name: 'Biology' }],
    teachers: [
      { id: 't1', name: 'Teacher 1', subjectIds: ['a', 'b'] },
      { id: 't2', name: 'Teacher 2', subjectIds: ['a'] }
    ],
    requirements: [
      { classId: 'c1', subjectId: 'a', periodsPerWeek: 2 },
      { classId: 'c1', subjectId: 'b', periodsPerWeek: 1 }
    ],
    locks: [
      { classId: 'c1', day: 'Monday', period: 0, subjectId: 'a', teacherId: 't1' },
      { classId: 'c1', day: 'Monday', period: 0, subjectId: 'b', teacherId: 't1' }
    ]
  }
  const result = generateTimetable(input)
  assert.equal(result.ok, false)
  assert.ok(result.diagnostics.some(d => d.code === 'D_LOCK_CLASH'), JSON.stringify(result.diagnostics))
})

test('a lock in a break period is rejected', () => {
  const input = {
    days: ['Monday'],
    periods: [{ label: 'P1', kind: 'teaching' }, { label: 'Break', kind: 'break' }],
    classes: [{ id: 'c1', name: 'Class 1' }],
    subjects: [{ id: 'a', name: 'Algebra' }],
    teachers: [{ id: 't1', name: 'Teacher 1', subjectIds: ['a'] }],
    requirements: [{ classId: 'c1', subjectId: 'a', periodsPerWeek: 1 }],
    locks: [{ classId: 'c1', day: 'Monday', period: 1, subjectId: 'a', teacherId: 't1' }]
  }
  const result = generateTimetable(input)
  assert.equal(result.ok, false)
  assert.ok(result.diagnostics.some(d => d.code === 'D_LOCK_NON_TEACHING'), JSON.stringify(result.diagnostics))
})

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

test('rooms are respected: no two classes share a room in the same period', () => {
  const input = {
    days: ['Monday', 'Tuesday', 'Wednesday'],
    periods: [{ label: 'P1', kind: 'teaching' }],
    classes: [{ id: 'c1', name: 'Class 1' }, { id: 'c2', name: 'Class 2' }],
    subjects: [{ id: 'lab', name: 'Lab Work' }],
    teachers: [{ id: 't1', name: 'Lab Teacher', subjectIds: ['lab'] }],
    rooms: [{
      id: 'lab1', name: 'Science Lab',
      unavailableSlots: [{ day: 'Wednesday', period: 'P1' }]
    }],
    requirements: [
      { classId: 'c1', subjectId: 'lab', periodsPerWeek: 1, roomId: 'lab1' },
      { classId: 'c2', subjectId: 'lab', periodsPerWeek: 1, roomId: 'lab1' }
    ]
  }
  const result = generateTimetable(input)
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics))
  assert.equal(countClashes(result.entries, 'roomId'), 0, 'room booked twice at once')
  for (const e of result.entries) assert.notEqual(e.day, 2, 'room was unavailable on Wednesday')
})

test('more lab classes than usable room slots fails with an explanation', () => {
  const input = {
    days: ['Monday', 'Tuesday'],
    periods: [{ label: 'P1', kind: 'teaching' }],
    classes: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }],
    subjects: [{ id: 'lab', name: 'Lab Work' }],
    teachers: [{ id: 't1', name: 'Lab Teacher', subjectIds: ['lab'] }],
    rooms: [{ id: 'lab1', name: 'Science Lab' }],
    requirements: [1, 2, 3].map(n => ({ classId: `c${n}`, subjectId: 'lab', periodsPerWeek: 2, roomId: 'lab1' }))
  }
  const result = generateTimetable(input)
  assert.equal(result.ok, false)
  assert.ok(result.diagnostics.some(d => d.code === 'D_REQUIREMENT_CAPACITY' || d.code === 'D_POOL_OVERLOAD'),
    JSON.stringify(result.diagnostics))
})

// ---------------------------------------------------------------------------
// The independent validator
// ---------------------------------------------------------------------------

test('validator catches a teacher double-booked by a manual edit', () => {
  const { input } = realisticSchool()
  const good = generateTimetable(input)
  assert.equal(good.ok, true)

  const edited = good.entries.map(e => ({ ...e }))
  const donor = edited[0]
  // Move another lesson of the same teacher into the same slot as `donor`.
  const victim = edited.find(e => e.teacherId === donor.teacherId && e !== donor)
  assert.ok(victim, 'fixture should contain two lessons for the same teacher')
  victim.day = donor.day
  victim.period = donor.period

  const report = validateTimetable(input, edited)
  assert.equal(report.ok, false, 'a teacher clash must be reported')
  assert.ok(report.hard.some(v => v.code === 'H_TEACHER_CLASH'), JSON.stringify(report.hard.map(v => v.code)))

  const regen = generateTimetable(input)
  assert.equal(regen.ok, true, 'validator findings belong to the manual edit, not the solver')
})

test('validator catches a class double-booked by a manual edit', () => {
  const { input } = realisticSchool()
  const good = generateTimetable(input)
  const edited = good.entries.map(e => ({ ...e }))
  const donor = edited[0]
  const victim = edited.find(e => e.classId === donor.classId && e !== donor)
  victim.day = donor.day
  victim.period = donor.period

  const report = validateTimetable(input, edited)
  assert.equal(report.ok, false)
  assert.ok(report.hard.some(v => v.code === 'H_CLASS_CLASH'))
})

test('validator catches a lesson deleted by a manual edit', () => {
  const { input, expectedTotal } = realisticSchool()
  const good = generateTimetable(input)
  const edited = good.entries.slice(0, expectedTotal - 3).map(e => ({ ...e }))

  const report = validateTimetable(input, edited)
  assert.equal(report.ok, false)
  const missing = report.hard.filter(v => v.code === 'H_MISSING_LESSON')
  assert.ok(missing.length > 0, 'removed lessons must be reported as missing')
  assert.equal(report.totals.scheduled, expectedTotal - 3)
})

test('validator catches a lesson moved into a lunch period', () => {
  const { input } = realisticSchool()
  const good = generateTimetable(input)
  const edited = good.entries.map(e => ({ ...e }))
  edited[0].period = 7 // Lunch
  const report = validateTimetable(input, edited)
  assert.equal(report.ok, false)
  assert.ok(report.hard.some(v => v.code === 'H_NON_TEACHING_SLOT'))
})

test('validator catches a lesson assigned to an unqualified teacher', () => {
  const { input } = realisticSchool()
  const good = generateTimetable(input)
  const edited = good.entries.map(e => ({ ...e }))
  const mathLesson = edited.find(e => e.subjectId === 'math')
  const englishTeacher = input.teachers.find(t => t.subjectIds.includes('eng'))
  mathLesson.teacherId = englishTeacher.id
  const report = validateTimetable(input, edited)
  assert.equal(report.ok, false)
  assert.ok(report.hard.some(v => v.code === 'H_NOT_ELIGIBLE'), JSON.stringify(report.hard.map(v => v.code)))
})

test('validator catches a lesson placed in a teacher-unavailable slot', () => {
  const { input } = realisticSchool()
  const good = generateTimetable(input)
  const edited = good.entries.map(e => ({ ...e }))
  // Ms. Ayesha is unavailable Monday P1.
  const lesson = edited.find(e => e.teacherId === 't_m1')
  lesson.day = 0
  lesson.period = 0
  const report = validateTimetable(input, edited)
  assert.ok(report.hard.some(v => v.code === 'H_TEACHER_UNAVAILABLE' || v.code === 'H_TEACHER_CLASH'),
    JSON.stringify(report.hard.map(v => v.code)))
})

test('validator catches workload limits broken by a manual edit', () => {
  const { input } = realisticSchool()
  const good = generateTimetable(input)
  const edited = good.entries.map(e => ({ ...e }))
  // Force six lessons of one teacher onto Monday (limit is 5/day).
  const teacherId = edited[0].teacherId
  const sameTeacher = edited.filter(e => e.teacherId === teacherId)
  const donors = sameTeacher.slice(0, 6)
  donors.forEach((e, i) => {
    e.day = 0
    e.period = i * 1 // P1..P6 are teaching periods, except index 3 (Break) -> use valid ones
  })
  donors[3].period = 4
  donors[4].period = 5
  donors[5].period = 6
  const report = validateTimetable(input, edited)
  assert.ok(report.hard.some(v => v.code === 'H_WORKLOAD_DAY' || v.code === 'H_TEACHER_CLASH' || v.code === 'H_CLASS_CLASH'),
    JSON.stringify(report.hard.map(v => v.code)))
})

test('validator accepts an untouched generated timetable', () => {
  const { input } = realisticSchool()
  const good = generateTimetable(input)
  const report = validateTimetable(input, good.entries)
  assert.equal(report.ok, true, JSON.stringify(report.hard.slice(0, 5)))
  assert.equal(report.hard.length, 0)
})

// ---------------------------------------------------------------------------
// Tenant-facing shape: results are plain serialisable data
// ---------------------------------------------------------------------------

test('results are JSON-serialisable (safe to store and return over the API)', () => {
  const { input } = realisticSchool()
  const result = generateTimetable(input)
  const round = JSON.parse(JSON.stringify(result))
  assert.equal(round.ok, true)
  assert.equal(round.entries.length, result.entries.length)
  assert.equal(typeof round.stats.generationMs, 'number')
})
