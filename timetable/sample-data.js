'use strict'

/**
 * Sample schools for standalone timetable testing.
 *
 * Two tenants are seeded on purpose: every standalone test of tenant isolation
 * needs a second school with a DIFFERENT week shape, different subjects and
 * different requirements. If both schools produced the same timetable the
 * isolation tests could pass while leaking data.
 *
 * The shape here is exactly the solver/validator input contract documented in
 * SOLVER_DESIGN.md, so the same objects can be handed to the production pg store
 * after the migration in PROPOSED_SCHEMA.sql is applied.
 */

// ---------------------------------------------------------------------------
// Tenant DEMO1 — Greenwood Public School (5-day week, 8 periods)
// ---------------------------------------------------------------------------

function greenwood() {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']

  const periods = [
    { label: 'P1', kind: 'teaching', start: '08:00', end: '08:40' },
    { label: 'P2', kind: 'teaching', start: '08:40', end: '09:20' },
    { label: 'P3', kind: 'teaching', start: '09:20', end: '10:00' },
    { label: 'Break', kind: 'break', start: '10:00', end: '10:20' },
    { label: 'P4', kind: 'teaching', start: '10:20', end: '11:00' },
    { label: 'P5', kind: 'teaching', start: '11:00', end: '11:40' },
    { label: 'P6', kind: 'teaching', start: '11:40', end: '12:20' },
    { label: 'Lunch', kind: 'lunch', start: '12:20', end: '13:00' },
    { label: 'P7', kind: 'teaching', start: '13:00', end: '13:40' },
    { label: 'P8', kind: 'teaching', start: '13:40', end: '14:20' }
  ]

  const classes = [
    { id: 'c6a', name: 'Grade 6', section: 'A' },
    { id: 'c6b', name: 'Grade 6', section: 'B' },
    { id: 'c7a', name: 'Grade 7', section: 'A' },
    { id: 'c7b', name: 'Grade 7', section: 'B' },
    { id: 'c8a', name: 'Grade 8', section: 'A' },
    { id: 'c8b', name: 'Grade 8', section: 'B' }
  ]

  const subjects = [
    { id: 'math', name: 'Mathematics', difficult: true },
    { id: 'physics', name: 'Physics', difficult: true },
    { id: 'chem', name: 'Chemistry' },
    { id: 'bio', name: 'Biology' },
    { id: 'eng', name: 'English' },
    { id: 'urdu', name: 'Urdu' },
    { id: 'social', name: 'Social Studies' },
    { id: 'cs', name: 'Computer Science' }
  ]

  const teacher = (id, name, subjectIds, extra = {}) => ({
    id, name, subjectIds,
    maxPerDay: 5, maxPerWeek: 25, unavailableSlots: [], ...extra
  })

  const teachers = [
    teacher('t_m1', 'Ms. Ayesha (Math)', ['math'], {
      unavailableSlots: [{ day: 'Monday', period: 'P1' }]
    }),
    teacher('t_m2', 'Mr. Bilal (Math)', ['math']),
    teacher('t_m3', 'Ms. Hina (Math)', ['math']),
    teacher('t_p1', 'Mr. Danish (Physics)', ['physics']),
    teacher('t_p2', 'Ms. Sana (Physics)', ['physics'], {
      unavailableSlots: [{ day: 'Thursday', period: 'P7' }]
    }),
    teacher('t_c1', 'Mr. Owais (Chem)', ['chem']),
    teacher('t_c2', 'Ms. Rabia (Chem)', ['chem']),
    teacher('t_b1', 'Mr. Faisal (Bio)', ['bio']),
    teacher('t_b2', 'Ms. Zara (Bio)', ['bio']),
    teacher('t_e1', 'Ms. Maria (English)', ['eng'], {
      unavailableSlots: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']
        .map(p => ({ day: 'Friday', period: p }))
    }),
    teacher('t_e2', 'Mr. Adnan (English)', ['eng']),
    teacher('t_u1', 'Ms. Nabila (Urdu)', ['urdu']),
    teacher('t_u2', 'Mr. Kamran (Urdu)', ['urdu']),
    teacher('t_s1', 'Mr. Shahid (Social)', ['social']),
    teacher('t_s2', 'Ms. Iqra (Social)', ['social'], {
      unavailableSlots: ['Monday', 'Tuesday'].flatMap(d =>
        ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'].map(p => ({ day: d, period: p })))
    }),
    teacher('t_k1', 'Mr. Umair (CS)', ['cs']),
    teacher('t_k2', 'Ms. Alya (CS)', ['cs'])
  ]

  const rooms = [
    { id: 'lab_it', name: 'Computer Lab', unavailableSlots: [{ day: 'Friday', period: 'P7' }, { day: 'Friday', period: 'P8' }] },
    { id: 'lab_sci', name: 'Science Lab', unavailableSlots: [] },
    { id: 'library', name: 'Library', unavailableSlots: [] }
  ]

  // 34 teaching periods per class against 5 x 8 = 40 slots in the week.
  const perClass = { math: 6, physics: 5, chem: 4, bio: 4, eng: 5, urdu: 4, social: 3, cs: 3 }
  const requirements = []
  for (const cls of classes) {
    for (const [subjectId, count] of Object.entries(perClass)) {
      const req = { classId: cls.id, subjectId, periodsPerWeek: count }
      if (subjectId === 'cs') req.roomId = 'lab_it' // room booking demo
      requirements.push(req)
    }
  }

  return {
    name: 'Greenwood Public School',
    config: {
      days, periods, classes, subjects, teachers, rooms, requirements,
      preferences: { maxSameSubjectPerDay: 1, avoidConsecutiveDifficult: true }
    }
  }
}

// ---------------------------------------------------------------------------
// Tenant DEMO2 — Sunrise Academy (6-day week, different subjects, rooms)
// ---------------------------------------------------------------------------

function sunrise() {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

  const periods = [
    { label: 'P1', kind: 'teaching', start: '07:45', end: '08:25' },
    { label: 'P2', kind: 'teaching', start: '08:25', end: '09:05' },
    { label: 'P3', kind: 'teaching', start: '09:05', end: '09:45' },
    { label: 'Break', kind: 'break', start: '09:45', end: '10:00' },
    { label: 'P4', kind: 'teaching', start: '10:00', end: '10:40' },
    { label: 'P5', kind: 'teaching', start: '10:40', end: '11:20' },
    { label: 'P6', kind: 'teaching', start: '11:20', end: '12:00' },
    { label: 'Lunch', kind: 'lunch', start: '12:00', end: '12:40' },
    { label: 'P7', kind: 'teaching', start: '12:40', end: '13:20' }
  ]

  const classes = [
    { id: 'g5', name: 'Grade 5', section: 'Blue' },
    { id: 'g6', name: 'Grade 6', section: 'Blue' },
    { id: 'g7', name: 'Grade 7', section: 'Blue' },
    { id: 'g8', name: 'Grade 8', section: 'Blue' }
  ]

  const subjects = [
    { id: 'maths', name: 'Mathematics', difficult: true },
    { id: 'eng', name: 'English' },
    { id: 'sci', name: 'Science', difficult: true },
    { id: 'soc', name: 'Social Studies' },
    { id: 'art', name: 'Art' },
    { id: 'pe', name: 'Physical Education' },
    { id: 'ict', name: 'ICT' }
  ]

  const teacher = (id, name, subjectIds, extra = {}) => ({
    id, name, subjectIds,
    maxPerDay: 6, maxPerWeek: 24, unavailableSlots: [], ...extra
  })

  const teachers = [
    teacher('s_m1', 'Mrs. Farah (Maths)', ['maths'], { maxPerDay: 5 }),
    teacher('s_m2', 'Mr. Imran (Maths)', ['maths']),
    teacher('s_e1', 'Miss Clara (English)', ['eng']),
    teacher('s_e2', 'Mr. Hassan (English)', ['eng']),
    teacher('s_s1', 'Dr. Nadia (Science)', ['sci'], {
      unavailableSlots: [{ day: 'Saturday', period: 'P1' }]
    }),
    teacher('s_s2', 'Mr. Tariq (Science)', ['sci']),
    teacher('s_o1', 'Mr. Rehan (Social)', ['soc']),
    teacher('s_a1', 'Ms. Laila (Art)', ['art'], {
      unavailableSlots: [{ day: 'Monday', period: 'P7' }, { day: 'Monday', period: 'P6' }]
    }),
    teacher('s_p1', 'Coach Asim (PE)', ['pe']),
    teacher('s_k1', 'Mr. Junaid (ICT)', ['ict'])
  ]

  const rooms = [
    { id: 'ground', name: 'Sports Ground', unavailableSlots: [{ day: 'Saturday', period: 'P7' }] },
    { id: 'art_room', name: 'Art Room', unavailableSlots: [] }
  ]

  // 28 teaching periods per class against 6 x 7 = 42 slots in the week.
  const perClass = { maths: 5, eng: 5, sci: 5, soc: 4, art: 3, pe: 3, ict: 3 }
  const requirements = []
  for (const cls of classes) {
    for (const [subjectId, count] of Object.entries(perClass)) {
      const req = { classId: cls.id, subjectId, periodsPerWeek: count }
      if (subjectId === 'pe') req.roomId = 'ground'
      if (subjectId === 'art') req.roomId = 'art_room'
      requirements.push(req)
    }
  }

  return {
    name: 'Sunrise Academy',
    config: {
      days, periods, classes, subjects, teachers, rooms, requirements,
      preferences: { maxSameSubjectPerDay: 2, avoidConsecutiveDifficult: true }
    }
  }
}

/** All seed tenants, keyed by tenant_id (school_code) exactly like The Eye. */
function sampleSchools() {
  return {
    DEMO1: greenwood(),
    DEMO2: sunrise()
  }
}

module.exports = { sampleSchools, greenwood, sunrise }
