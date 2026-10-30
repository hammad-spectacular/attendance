'use strict'

/**
 * Shared fixtures for the timetable unit tests and the benchmark script.
 * Everything here is in-memory: no database, no network.
 */

/** A realistic primary/secondary week: 5 days, 8 teaching periods, breaks. */
function realisticSchool() {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
  const periods = [
    { label: 'P1', kind: 'teaching' },
    { label: 'P2', kind: 'teaching' },
    { label: 'P3', kind: 'teaching' },
    { label: 'Break', kind: 'break' },
    { label: 'P4', kind: 'teaching' },
    { label: 'P5', kind: 'teaching' },
    { label: 'P6', kind: 'teaching' },
    { label: 'Lunch', kind: 'lunch' },
    { label: 'P7', kind: 'teaching' },
    { label: 'P8', kind: 'teaching' }
  ]

  const classes = Array.from({ length: 8 }, (_, i) => ({ id: `c${i + 1}`, name: `Class ${i + 1}` }))

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
    id, name, subjectIds, maxPerDay: 5, maxPerWeek: 25, unavailableSlots: [], ...extra
  })

  const teachers = [
    teacher('t_m1', 'Ms. Ayesha (Math)', ['math'], { unavailableSlots: [{ day: 'Monday', period: 'P1' }] }),
    teacher('t_m2', 'Mr. Bilal (Math)', ['math']),
    teacher('t_m3', 'Ms. Hina (Math)', ['math']),
    teacher('t_p1', 'Mr. Danish (Physics)', ['physics']),
    teacher('t_p2', 'Ms. Sana (Physics)', ['physics'], { unavailableSlots: [{ day: 'Thursday', period: 'P7' }] }),
    teacher('t_c1', 'Mr. Owais (Chem)', ['chem']),
    teacher('t_c2', 'Ms. Rabia (Chem)', ['chem']),
    teacher('t_b1', 'Mr. Faisal (Bio)', ['bio']),
    teacher('t_b2', 'Ms. Zara (Bio)', ['bio']),
    teacher('t_e1', 'Ms. Maria (English)', ['eng'], {
      unavailableSlots: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'].map(p => ({ day: 'Friday', period: p }))
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

  const perClass = { math: 6, physics: 5, chem: 4, bio: 4, eng: 5, urdu: 4, social: 3, cs: 3 }

  const requirements = []
  for (const cls of classes) {
    for (const [subjectId, count] of Object.entries(perClass)) {
      requirements.push({ classId: cls.id, subjectId, periodsPerWeek: count })
    }
  }

  return {
    input: {
      days, periods, classes, subjects, teachers, requirements,
      preferences: { maxSameSubjectPerDay: 1, avoidConsecutiveDifficult: true }
    },
    expectedTotal: classes.length * Object.values(perClass).reduce((a, b) => a + b, 0)
  }
}

/**
 * Scale the realistic school up to `n` classes. Each subject gets as many
 * teachers as it needs to stay feasible under the 5-periods/day, 25/week caps
 * (5 days x 5 periods = 25 per teacher per week).
 */
function scaledSchool(n) {
  const base = realisticSchool()
  const { input } = base
  const classes = Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, name: `Class ${i + 1}` }))

  const perClass = { math: 6, physics: 5, chem: 4, bio: 4, eng: 5, urdu: 4, social: 3, cs: 3 }
  const subjectNames = {
    math: 'Mathematics', physics: 'Physics', chem: 'Chemistry', bio: 'Biology',
    eng: 'English', urdu: 'Urdu', social: 'Social Studies', cs: 'Computer Science'
  }
  const pool = { math: 'M', physics: 'P', chem: 'C', bio: 'B', eng: 'E', urdu: 'U', social: 'S', cs: 'K' }

  const teachers = []
  const requirements = []
  for (const [subjectId, per] of Object.entries(perClass)) {
    const needed = Math.ceil((per * n) / 25)
    for (let i = 1; i <= needed; i++) {
      teachers.push({
        id: `t_${pool[subjectId]}${i}`,
        name: `${subjectNames[subjectId]} Teacher ${i}`,
        subjectIds: [subjectId],
        maxPerDay: 5,
        maxPerWeek: 25,
        unavailableSlots: []
      })
    }
    for (const cls of classes) {
      requirements.push({ classId: cls.id, subjectId, periodsPerWeek: per })
    }
  }

  return {
    input: { ...input, classes, teachers, requirements },
    expectedTotal: classes.length * Object.values(perClass).reduce((a, b) => a + b, 0)
  }
}

/** Tiny single-day-per-slot week used by the impossible-schedule tests. */
function tinyWeek(extra = {}) {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
  const periods = [{ label: 'P1', kind: 'teaching' }]
  return { days, periods, ...extra }
}

function countClashes(entries, field) {
  const seen = new Map()
  let clashes = 0
  for (const e of entries) {
    const key = `${e[field]}#${e.day}#${e.period}`
    if (seen.has(key)) clashes++
    seen.set(key, true)
  }
  return clashes
}

module.exports = { realisticSchool, scaledSchool, tinyWeek, countClashes }
