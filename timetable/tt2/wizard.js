'use strict'

/**
 * tt2 — wizard schema.
 *
 * Single source of truth for the questions that MUST be answered before a
 * timetable can be generated, plus the validation that decides whether the
 * "Generate" button is allowed to fire.
 *
 * The questions are grouped into steps. The UI renders the steps; the review
 * screen summarises them; `validateConfig` decides what is still missing.
 *
 * The data model follows Timetablely's concept (tutors / courses / sessions)
 * but is shaped to feed The Eye's existing solver (`timetable/solver.js`),
 * which expects:
 *
 *   days        string[]                    working days
 *   periods     [{ label, kind }]           kind: 'teaching' | 'break'
 *   classes     [{ id, name }]              a group of students
 *   subjects    [{ id, name, difficult }]   a course
 *   teachers    [{ id, name, subjectIds, unavailableSlots, maxPerDay, maxPerWeek }]
 *   rooms       [{ id, name }]
 *   requirements[{ classId, subjectId, periodsPerWeek, teacherIds }]
 *   locks       [{ classId, subjectId, teacherId, roomId, day, period }]
 *   preferences { ... }
 */

const ALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const DIFFICULTIES = ['easy', 'medium', 'difficult']

/** Maximum subjects one teacher may teach before we warn about overload. */
const SOFT_SUBJECT_LIMIT_PER_TEACHER = 3

/**
 * How many periods a week each difficulty level normally needs.
 *
 * These are STARTING POINTS, not rules — the suggestion engine uses them to
 * pre-fill the curriculum and the teacher then walks through the numbers and
 * adjusts whatever does not match their school.
 */
const BASE_PERIODS_PER_WEEK = {
  easy: 2,
  medium: 3,
  difficult: 4
}

/** Never suggest more than this many periods of one subject in a week. */
const MAX_SUGGESTED_PERIODS = 5

function defaultConfig() {
  return {
    // -- Step 1: identity -------------------------------------------------
    schoolName: '',
    branchName: '',

    // -- Step 2: the shape of the week ------------------------------------
    days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    startTime: '08:00',
    periodCount: 6,          // TEACHING periods per day (breaks are extra columns)
    periodDuration: 40,      // minutes, default length of one class
    breaks: [
      { afterPeriod: 2, label: 'Short Break', duration: 15 },
      { afterPeriod: 4, label: 'Lunch', duration: 30 }
    ],
    periodOverrides: {},     // { '3': 50 } — per teaching-period duration in minutes

    // -- Step 3: classes (who is being taught) ----------------------------
    classes: [],             // [{ id, name, studentCount }]

    // -- Step 4: subjects --------------------------------------------------
    subjects: [],            // [{ id, name, difficult, roomId }]

    // -- Step 5: teachers and what they teach -----------------------------
    teachers: [],            // [{ id, name, subjectIds, maxPerDay, maxPerWeek, unavailableSlots }]

    // -- Step 6: rooms (optional) ------------------------------------------
    rooms: [],               // [{ id, name }]

    // -- Step 7: curriculum ------------------------------------------------
    // [{ classId, subjectId, periodsPerWeek, teacherIds }]
    curriculum: [],

    // -- Step 8: preferences -----------------------------------------------
    preferences: {
      maxSameSubjectPerDay: 1,
      avoidConsecutiveDifficult: true,
      balanceClassDays: true,
      balanceTeacherDays: true
    }
  }
}

/**
 * The wizard steps. `id` is the step key used by the UI; `title` and `blurb`
 * are shown in the step header; `fields` documents the questions so the review
 * screen can list exactly what was asked and what was answered.
 */
const STEPS = [
  {
    id: 'identity',
    title: 'School & Branch',
    blurb: 'Who is this timetable for?',
    fields: [
      { key: 'schoolName', question: 'School name', type: 'text', required: true },
      { key: 'branchName', question: 'Branch / campus (optional)', type: 'text', required: false }
    ]
  },
  {
    id: 'week',
    title: 'Working Days',
    blurb: 'Which days does the school operate?',
    fields: [
      { key: 'days', question: 'Working days', type: 'multi-select', required: true }
    ]
  },
  {
    id: 'periods',
    title: 'Periods & Duration',
    blurb: 'How long is a class, and how many are there in a day?',
    fields: [
      { key: 'periodCount', question: 'Teaching periods per day', type: 'number', required: true },
      { key: 'periodDuration', question: 'Class duration (minutes)', type: 'number', required: true },
      { key: 'startTime', question: 'School start time', type: 'time', required: true },
      { key: 'breaks', question: 'Breaks & lunch', type: 'break-list', required: false },
      { key: 'periodOverrides', question: 'Per-period duration overrides', type: 'duration-list', required: false }
    ]
  },
  {
    id: 'classes',
    title: 'Classes',
    blurb: 'Which groups of students need a timetable?',
    fields: [
      { key: 'classes', question: 'Classes and their student counts', type: 'class-list', required: true }
    ]
  },
  {
    id: 'subjects',
    title: 'Subjects',
    blurb: 'What is taught? Mark difficult subjects so they are not scheduled back to back.',
    fields: [
      { key: 'subjects', question: 'Subjects, difficulty, special room', type: 'subject-list', required: true }
    ]
  },
  {
    id: 'teachers',
    title: 'Teachers & Their Subjects',
    blurb: 'Who teaches what? One teacher may teach two or three subjects.',
    fields: [
      { key: 'teachers', question: 'Teachers, subjects taught, daily and weekly workload caps', type: 'teacher-list', required: true }
    ]
  },
  {
    id: 'rooms',
    title: 'Rooms (Optional)',
    blurb: 'Only needed for schools with more than one room or specialist labs.',
    fields: [
      { key: 'rooms', question: 'Rooms and labs', type: 'room-list', required: false }
    ]
  },
  {
    id: 'curriculum',
    title: 'Curriculum',
    blurb: 'For each class, how many periods of each subject per week?',
    fields: [
      { key: 'curriculum', question: 'Periods per week per class and subject', type: 'curriculum-matrix', required: true }
    ]
  },
  {
    id: 'preferences',
    title: 'Preferences',
    blurb: 'How should the generator balance the week?',
    fields: [
      { key: 'preferences.maxSameSubjectPerDay', question: 'Maximum periods of one subject in a day', type: 'number', required: true },
      { key: 'preferences.avoidConsecutiveDifficult', question: 'Avoid two difficult subjects back to back', type: 'boolean', required: true },
      { key: 'preferences.balanceClassDays', question: 'Spread each class evenly across the week', type: 'boolean', required: true },
      { key: 'preferences.balanceTeacherDays', question: 'Spread each teacher evenly across the week', type: 'boolean', required: true }
    ]
  }
]

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function asNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Normalise a teacher's workload cap.
 *
 * Blank means "no limit". So does 0: a cap of zero periods would mean the
 * teacher can never teach anything, which is never what leaving the field
 * empty was meant to say — the UI shows blank as "auto".
 *
 * @returns {number|null} the cap, or null for "no limit"
 */
function workloadCap(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Math.round(asNumber(value, 0))
  return n > 0 ? n : null
}

function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Coerce whatever came off the wire into a complete, well-typed config.
 * Unknown keys are dropped; missing keys get defaults. This is deliberately
 * forgiving so a half-finished wizard can be saved and resumed.
 */
function normaliseConfig(raw) {
  const base = defaultConfig()
  const input = raw && typeof raw === 'object' ? raw : {}

  const days = asArray(input.days)
    .map(d => String(d))
    .filter(d => ALL_DAYS.includes(d))

  const breaks = asArray(input.breaks)
    .map((b, i) => ({
      id: asTrimmedString(b && b.id) || `break_${i + 1}`,
      afterPeriod: Math.max(0, Math.round(asNumber(b && b.afterPeriod, 0))),
      label: asTrimmedString(b && b.label) || 'Break',
      duration: Math.max(0, Math.round(asNumber(b && b.duration, 15)))
    }))
    .filter(b => b.afterPeriod > 0)

  const periodOverrides = {}
  const overrides = input.periodOverrides && typeof input.periodOverrides === 'object' ? input.periodOverrides : {}
  for (const key of Object.keys(overrides)) {
    const idx = Math.round(asNumber(key, NaN))
    if (!Number.isFinite(idx) || idx < 1) continue
    const mins = Math.round(asNumber(overrides[key], NaN))
    if (!Number.isFinite(mins) || mins <= 0) continue
    periodOverrides[String(idx)] = mins
  }

  const classes = asArray(input.classes)
    .map((c, i) => ({
      id: asTrimmedString(c && c.id) || `class_${i + 1}`,
      name: asTrimmedString(c && c.name) || `Class ${i + 1}`,
      studentCount: Math.max(0, Math.round(asNumber(c && c.studentCount, 0)))
    }))
    .filter(c => c.name)

  const rooms = asArray(input.rooms)
    .map((r, i) => ({
      id: asTrimmedString(r && r.id) || `room_${i + 1}`,
      name: asTrimmedString(r && r.name) || `Room ${i + 1}`
    }))
    .filter(r => r.name)

  const subjects = asArray(input.subjects)
    .map((s, i) => ({
      id: asTrimmedString(s && s.id) || `subject_${i + 1}`,
      name: asTrimmedString(s && s.name) || `Subject ${i + 1}`,
      difficult: DIFFICULTIES.includes(String(s && s.difficult)) ? String(s.difficult) : 'medium',
      roomId: asTrimmedString(s && s.roomId) || null
    }))
    .filter(s => s.name)

  const teachers = asArray(input.teachers)
    .map((t, i) => ({
      id: asTrimmedString(t && t.id) || `teacher_${i + 1}`,
      name: asTrimmedString(t && t.name) || `Teacher ${i + 1}`,
      subjectIds: Array.from(new Set(asArray(t && t.subjectIds).map(String))),
      maxPerDay: workloadCap(t && t.maxPerDay),
      maxPerWeek: workloadCap(t && t.maxPerWeek),
      unavailableSlots: asArray(t && t.unavailableSlots)
        .map(slot => ({
          day: Math.round(asNumber(slot && slot.day, -1)),
          period: Math.round(asNumber(slot && slot.period, -1))   // TEACHING-period index, 1-based
        }))
        .filter(slot => slot.day >= 0 && slot.period >= 1)
    }))
    .filter(t => t.name)

  const curriculum = asArray(input.curriculum)
    .map((r, i) => ({
      id: asTrimmedString(r && r.id) || `req_${i + 1}`,
      classId: asTrimmedString(r && r.classId),
      subjectId: asTrimmedString(r && r.subjectId),
      periodsPerWeek: Math.max(0, Math.round(asNumber(r && r.periodsPerWeek, 0))),
      teacherIds: Array.from(new Set(asArray(r && r.teacherIds).map(String)))
    }))
    .filter(r => r.classId && r.subjectId)

  const prefs = input.preferences && typeof input.preferences === 'object' ? input.preferences : {}

  return {
    schoolName: asTrimmedString(input.schoolName) || base.schoolName,
    branchName: asTrimmedString(input.branchName) || base.branchName,
    days: days.length ? days : base.days,
    startTime: /^\d{1,2}:\d{2}$/.test(String(input.startTime)) ? String(input.startTime) : base.startTime,
    periodCount: Math.max(0, Math.round(asNumber(input.periodCount, base.periodCount))),
    periodDuration: Math.max(0, Math.round(asNumber(input.periodDuration, base.periodDuration))),
    breaks,
    periodOverrides,
    classes,
    subjects,
    teachers,
    rooms,
    curriculum,
    preferences: {
      maxSameSubjectPerDay: Math.max(1, Math.round(asNumber(prefs.maxSameSubjectPerDay, base.preferences.maxSameSubjectPerDay))),
      avoidConsecutiveDifficult: prefs.avoidConsecutiveDifficult === undefined
        ? base.preferences.avoidConsecutiveDifficult
        : !!prefs.avoidConsecutiveDifficult,
      balanceClassDays: prefs.balanceClassDays === undefined
        ? base.preferences.balanceClassDays
        : !!prefs.balanceClassDays,
      balanceTeacherDays: prefs.balanceTeacherDays === undefined
        ? base.preferences.balanceTeacherDays
        : !!prefs.balanceTeacherDays
    }
  }
}

// ---------------------------------------------------------------------------
// Validation — what stands between the user and the Generate button
// ---------------------------------------------------------------------------

/**
 * @returns {{errors: string[], warnings: string[], canGenerate: boolean}}
 */
function validateConfig(raw) {
  const config = normaliseConfig(raw)
  const errors = []
  const warnings = []

  if (!config.schoolName) errors.push('School name is required.')

  if (!config.days.length) errors.push('Select at least one working day.')
  if (!config.periodCount) errors.push('Set how many teaching periods there are in a day.')
  if (!config.periodDuration) errors.push('Set the class duration in minutes.')
  else if (config.periodDuration < 15) errors.push('Class duration must be at least 15 minutes.')
  else if (config.periodDuration > 180) errors.push('Class duration must be 180 minutes or less.')

  for (const [key, mins] of Object.entries(config.periodOverrides)) {
    if (mins < 15) errors.push(`Period ${key} duration must be at least 15 minutes.`)
    if (mins > 180) errors.push(`Period ${key} duration must be 180 minutes or less.`)
  }

  for (const b of config.breaks) {
    if (b.afterPeriod > config.periodCount) {
      errors.push(`Break "${b.label}" is placed after period ${b.afterPeriod}, but there are only ${config.periodCount} periods.`)
    }
  }

  if (!config.classes.length) errors.push('Add at least one class.')
  if (!config.subjects.length) errors.push('Add at least one subject.')
  if (!config.teachers.length) errors.push('Add at least one teacher.')

  // -- Teacher sanity -------------------------------------------------------
  for (const t of config.teachers) {
    if (!t.subjectIds.length) {
      errors.push(`Teacher "${t.name}" has no subject assigned.`)
    }
    if (t.subjectIds.length > SOFT_SUBJECT_LIMIT_PER_TEACHER) {
      warnings.push(`Teacher "${t.name}" teaches ${t.subjectIds.length} subjects. Teachers usually handle 2–3.`)
    }
    if (t.maxPerDay !== null && t.maxPerDay > config.periodCount) {
      warnings.push(`Teacher "${t.name}" can teach ${t.maxPerDay} periods a day, more than the ${config.periodCount} periods in the day.`)
    }
  }

  // -- Every subject needs a qualified teacher ------------------------------
  for (const s of config.subjects) {
    const qualified = config.teachers.filter(t => t.subjectIds.includes(s.id))
    if (!qualified.length) {
      errors.push(`Subject "${s.name}" has no teacher. Assign it to at least one teacher.`)
    }
  }

  // -- Curriculum ------------------------------------------------------------
  if (!config.curriculum.length) {
    errors.push('Set the curriculum: for each class, how many periods of each subject per week.')
  }

  const classIds = new Set(config.classes.map(c => c.id))
  const subjectIds = new Set(config.subjects.map(s => s.id))
  const teacherIds = new Set(config.teachers.map(t => t.id))

  for (const r of config.curriculum) {
    if (!classIds.has(r.classId)) {
      errors.push(`Curriculum row references unknown class "${r.classId}".`)
      continue
    }
    if (!subjectIds.has(r.subjectId)) {
      errors.push(`Curriculum row references unknown subject "${r.subjectId}".`)
      continue
    }
    if (r.periodsPerWeek <= 0) {
      errors.push(`"${r.subjectId}" in "${r.classId}" has ${r.periodsPerWeek} periods per week. Use 0 to remove it.`)
    }
    if (r.teacherIds.length) {
      for (const id of r.teacherIds) {
        if (!teacherIds.has(id)) {
          errors.push(`Curriculum row references unknown teacher "${id}".`)
        } else {
          const teacher = config.teachers.find(t => t.id === id)
          if (teacher && !teacher.subjectIds.includes(r.subjectId)) {
            errors.push(`Teacher "${teacher.name}" is not qualified for "${r.subjectId}" but is assigned to it.`)
          }
        }
      }
    }
  }

  // -- Capacity checks -------------------------------------------------------
  const teachingSlotsPerWeek = config.periodCount * config.days.length

  for (const cls of config.classes) {
    const total = config.curriculum
      .filter(r => r.classId === cls.id)
      .reduce((sum, r) => sum + r.periodsPerWeek, 0)
    if (total > teachingSlotsPerWeek) {
      errors.push(`Class "${cls.name}" needs ${total} periods a week but only ${teachingSlotsPerWeek} teaching slots exist.`)
    }
    if (total === 0) {
      warnings.push(`Class "${cls.name}" has no subjects assigned yet.`)
    }
  }

  for (const s of config.subjects) {
    const total = config.curriculum
      .filter(r => r.subjectId === s.id)
      .reduce((sum, r) => sum + r.periodsPerWeek, 0)
    if (total === 0) {
      warnings.push(`Subject "${s.name}" is not taught to any class.`)
    }
  }

  // -- Teacher load ----------------------------------------------------------
  for (const t of config.teachers) {
    const load = config.curriculum
      .filter(r => r.subjectId && t.subjectIds.includes(r.subjectId))
      .filter(r => !r.teacherIds.length || r.teacherIds.includes(t.id))
      .reduce((sum, r) => sum + r.periodsPerWeek, 0)

    if (t.maxPerWeek !== null && load > t.maxPerWeek) {
      errors.push(`Teacher "${t.name}" would teach ${load} periods a week but is capped at ${t.maxPerWeek}. Raise the weekly limit in the Teachers step, or reduce the periods in the Curriculum step.`)
    }
    if (t.maxPerDay !== null && load > t.maxPerDay * config.days.length) {
      errors.push(`Teacher "${t.name}" would teach ${load} periods a week but can only teach ${t.maxPerDay} a day. With ${config.days.length} working days that is ${t.maxPerDay * config.days.length} periods — raise the daily limit or reduce their load.`)
    }
  }

  return { errors, warnings, canGenerate: errors.length === 0 }
}

module.exports = {
  ALL_DAYS,
  DIFFICULTIES,
  SOFT_SUBJECT_LIMIT_PER_TEACHER,
  STEPS,
  defaultConfig,
  normaliseConfig,
  validateConfig
}
