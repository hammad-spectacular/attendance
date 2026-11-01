'use strict'

/**
 * Independent timetable validator.
 *
 * This module deliberately does NOT import anything from solver.js. It takes the
 * original, raw configuration object and a plain list of timetable entries and
 * re-derives every constraint from scratch. That is what makes it a genuine
 * second opinion: if the solver has a bug, the validator still judges the output
 * by the rules, not by the solver's own bookkeeping.
 *
 * Entry shape:
 *   { classId, day: <index into config.days>, period: <index into config.periods>,
 *     subjectId, teacherId, roomId? }
 *
 * Input shape (see SOLVER_DESIGN.md):
 *   {
 *     days: ['Monday', ...],
 *     periods: [{ label, kind: 'teaching'|'break'|'lunch' }],
 *     classes: [{ id, name }],
 *     subjects: [{ id, name, difficult? }],
 *     teachers: [{ id, subjectIds, unavailableSlots, maxPerDay, maxPerWeek }],
 *     requirements: [{ classId, subjectId, periodsPerWeek, teacherIds?, roomId? }],
 *     rooms: [{ id, unavailableSlots }],           // optional
 *     locks: [{ classId, day, period, subjectId, teacherId, roomId? }],  // optional
 *     preferences: { maxSameSubjectPerDay, avoidConsecutiveDifficult }    // optional
 *   }
 *
 * Returns:
 *   { ok, hard: [violation], soft: [penalty], totals: { required, scheduled } }
 */

const DEFAULT_PREFERENCES = {
  maxSameSubjectPerDay: 1,
  avoidConsecutiveDifficult: true
}

function slotKey(day, period) {
  return day * 1000 + period
}

function classSlotKey(classId, day, period) {
  return `${classId}#${day}#${period}`
}

function num(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/** Resolve a day given as index, number-string or name. Returns -1 when unknown. */
function resolveDay(days, value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < days.length) {
    return value
  }
  if (value === undefined || value === null) return -1
  const raw = String(value).trim().toLowerCase()
  if (!raw) return -1
  const byName = days.findIndex(d => String(d).trim().toLowerCase() === raw)
  if (byName >= 0) return byName
  const asNum = Number(raw)
  if (Number.isInteger(asNum) && asNum >= 0 && asNum < days.length) return asNum
  return -1
}

/** Resolve a period given as index or label. Returns -1 when unknown. */
function resolvePeriod(periods, value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < periods.length) {
    return value
  }
  if (value === undefined || value === null) return -1
  const raw = String(value).trim().toLowerCase()
  if (!raw) return -1
  const byLabel = periods.findIndex(p => String(p.label).trim().toLowerCase() === raw)
  if (byLabel >= 0) return byLabel
  const asNum = Number(raw)
  if (Number.isInteger(asNum) && asNum >= 0 && asNum < periods.length) return asNum
  return -1
}

/**
 * Build an independent index of the configuration. Returns { index, errors }.
 * Any structural problem in the configuration is an error: a timetable judged
 * against a broken config proves nothing.
 */
function buildIndex(input) {
  const errors = []
  const src = input || {}

  const days = Array.isArray(src.days) ? src.days.map(d => String(d)) : []
  if (days.length === 0) errors.push({ code: 'CFG_NO_DAYS', message: 'No working days are configured.' })

  const periods = (Array.isArray(src.periods) ? src.periods : []).map((p, i) => ({
    index: i,
    label: String((p && (p.label || p.name)) || `P${i + 1}`),
    kind: String((p && p.kind) || 'teaching')
  }))
  if (periods.length === 0) errors.push({ code: 'CFG_NO_PERIODS', message: 'No periods are configured.' })

  const teachingPeriods = periods.filter(p => p.kind === 'teaching').map(p => p.index)
  const teachingSet = new Set(teachingPeriods)

  const classes = new Map()
  for (const c of (Array.isArray(src.classes) ? src.classes : [])) {
    if (c === undefined || c === null || c.id === undefined || c.id === null) continue
    const baseName = String(c.name || 'Class')
    const section = c.section ? String(c.section).trim() : ''
    const fullName = section ? `${baseName} (${section})` : baseName
    classes.set(String(c.id), { id: String(c.id), name: fullName, baseName, section })
  }
  if (classes.size === 0) errors.push({ code: 'CFG_NO_CLASSES', message: 'No classes are configured.' })

  const subjects = new Map()
  for (const s of (Array.isArray(src.subjects) ? src.subjects : [])) {
    if (s === undefined || s === null || s.id === undefined || s.id === null) continue
    subjects.set(String(s.id), { id: String(s.id), name: String(s.name || s.id), difficult: !!s.difficult })
  }

  const teachers = new Map()
  for (const t of (Array.isArray(src.teachers) ? src.teachers : [])) {
    if (t === undefined || t === null || t.id === undefined || t.id === null) continue
    const unavailable = new Set()
    for (const slot of (Array.isArray(t.unavailableSlots) ? t.unavailableSlots : [])) {
      if (!slot) continue
      const d = resolveDay(days, slot.day)
      const p = resolvePeriod(periods, slot.period)
      if (d >= 0 && p >= 0) unavailable.add(slotKey(d, p))
    }
    teachers.set(String(t.id), {
      id: String(t.id),
      name: String(t.name || t.id),
      subjectIds: new Set((Array.isArray(t.subjectIds) ? t.subjectIds : []).map(String)),
      unavailable,
      maxPerDay: t.maxPerDay === undefined || t.maxPerDay === null ? null : num(t.maxPerDay, null),
      maxPerWeek: t.maxPerWeek === undefined || t.maxPerWeek === null ? null : num(t.maxPerWeek, null)
    })
  }

  const rooms = new Map()
  for (const r of (Array.isArray(src.rooms) ? src.rooms : [])) {
    if (r === undefined || r === null || r.id === undefined || r.id === null) continue
    const unavailable = new Set()
    for (const slot of (Array.isArray(r.unavailableSlots) ? r.unavailableSlots : [])) {
      if (!slot) continue
      const d = resolveDay(days, slot.day)
      const p = resolvePeriod(periods, slot.period)
      if (d >= 0 && p >= 0) unavailable.add(slotKey(d, p))
    }
    rooms.set(String(r.id), { id: String(r.id), name: String(r.name || r.id), unavailable })
  }

  const requirements = []
  const requirementByPair = new Map()
  for (const r of (Array.isArray(src.requirements) ? src.requirements : [])) {
    if (!r) continue
    const classId = r.classId === undefined || r.classId === null ? '' : String(r.classId)
    const subjectId = r.subjectId === undefined || r.subjectId === null ? '' : String(r.subjectId)
    const count = num(r.periodsPerWeek, NaN)
    const req = {
      classId,
      subjectId,
      count,
      teacherIds: Array.isArray(r.teacherIds) && r.teacherIds.length ? new Set(r.teacherIds.map(String)) : null,
      roomId: r.roomId === undefined || r.roomId === null || r.roomId === '' ? null : String(r.roomId)
    }
    requirements.push(req)
    requirementByPair.set(`${classId}#${subjectId}`, req)
  }
  if (requirements.length === 0) {
    errors.push({ code: 'CFG_NO_REQUIREMENTS', message: 'No subject requirements are configured.' })
  }

  const locks = []
  for (const l of (Array.isArray(src.locks) ? src.locks : [])) {
    if (!l) continue
    locks.push({
      classId: l.classId === undefined || l.classId === null ? '' : String(l.classId),
      subjectId: l.subjectId === undefined || l.subjectId === null ? '' : String(l.subjectId),
      teacherId: l.teacherId === undefined || l.teacherId === null ? '' : String(l.teacherId),
      roomId: l.roomId === undefined || l.roomId === null || l.roomId === '' ? null : String(l.roomId),
      day: resolveDay(days, l.day),
      period: resolvePeriod(periods, l.period)
    })
  }

  const prefs = {
    maxSameSubjectPerDay: Math.max(1, num((src.preferences || {}).maxSameSubjectPerDay, DEFAULT_PREFERENCES.maxSameSubjectPerDay)),
    avoidConsecutiveDifficult: (src.preferences || {}).avoidConsecutiveDifficult === undefined
      ? DEFAULT_PREFERENCES.avoidConsecutiveDifficult
      : !!(src.preferences || {}).avoidConsecutiveDifficult
  }

  return {
    index: {
      days, periods, teachingPeriods, teachingSet, classes, subjects, teachers, rooms,
      requirements, requirementByPair, locks, prefs,
      teachingSlotCount: teachingPeriods.length * days.length
    },
    errors
  }
}

function hard(hardCode, message, detail) {
  return { code: hardCode, message, detail: detail || null }
}

/**
 * Validate a timetable.
 *
 * @param {object} input raw configuration
 * @param {Array} entries timetable entries to judge
 * @returns {{ok:boolean, hard:Array, soft:Array, totals:{required:number, scheduled:number}}}
 */
function validateTimetable(input, entries) {
  const { index, errors } = buildIndex(input)
  const hardList = errors.map(e => hard(e.code, e.message, e.detail || null))
  const softList = []
  const list = Array.isArray(entries) ? entries : []

  const {
    days, periods, teachingSet, classes, subjects, teachers, rooms,
    requirements, requirementByPair, locks, prefs
  } = index

  // --- Pass 1: every entry must reference real, schedulable things -------------
  const classSlot = new Map()
  const teacherSlot = new Map()
  const roomSlot = new Map()
  const teacherDayCount = new Map()
  const teacherWeekCount = new Map()
  const counts = new Map()          // `${classId}#${subjectId}` -> n
  const subjectDayCount = new Map() // `${classId}#${subjectId}#${day}` -> n
  const teacherDaySlots = new Map() // `${teacherId}#${day}` -> sorted period list

  for (const e of list) {
    if (!e) continue
    const classId = String(e.classId)
    const subjectId = String(e.subjectId)
    const teacherId = String(e.teacherId)
    const roomId = e.roomId === undefined || e.roomId === null || e.roomId === '' ? null : String(e.roomId)
    const day = e.day
    const period = e.period

    const cls = classes.get(classId)
    const subj = subjects.get(subjectId)
    const tea = teachers.get(teacherId)
    const room = roomId ? rooms.get(roomId) : null

    const className = cls ? cls.name : 'Unknown Class'
    const subjectName = subj ? subj.name : 'Unknown Subject'
    const teacherName = tea ? tea.name : 'Unknown Teacher'
    const roomName = room ? room.name : 'Unknown Room'

    if (!cls) hardList.push(hard('H_UNKNOWN_CLASS', 'Entry references an unknown class. Please assign a valid class.', { classId, className }))
    if (!subj) hardList.push(hard('H_UNKNOWN_SUBJECT', 'Entry references an unknown subject. Please assign a valid subject.', { subjectId, subjectName }))
    if (!tea) hardList.push(hard('H_UNKNOWN_TEACHER', 'Entry references an unknown teacher. Please assign a valid teacher.', { teacherId, teacherName }))
    if (roomId && !room) hardList.push(hard('H_UNKNOWN_ROOM', 'Entry references an unknown room. Please assign a valid room.', { roomId, roomName }))

    if (!Number.isInteger(day) || day < 0 || day >= days.length) {
      hardList.push(hard('H_UNKNOWN_DAY', `Entry has a day outside the working week (${day}). Move lesson to a configured school day.`, { day }))
    } else if (!Number.isInteger(period) || period < 0 || period >= periods.length) {
      hardList.push(hard('H_UNKNOWN_PERIOD', `Entry has an unconfigured period time. Move lesson to a valid period.`, { period }))
    } else if (!teachingSet.has(period)) {
      hardList.push(hard('H_NON_TEACHING_SLOT',
        `Lesson scheduled in "${periods[period].label}" which is a ${periods[period].kind}, not a teaching period. Move lesson to a teaching period.`,
        { day: days[day], period: periods[period].label }))
    }

    // Duplicate / clash detection
    const cKey = classSlotKey(classId, day, period)
    if (classSlot.has(cKey)) {
      hardList.push(hard('H_CLASS_CLASH',
        `${className} has two lessons scheduled at once (${days[day] || day}, ${periods[period] ? periods[period].label : period}). Move or remove one lesson.`,
        { classId, day, period, className }))
    } else {
      classSlot.set(cKey, e)
    }

    const tKey = `${teacherId}#${day}#${period}`
    if (teacherSlot.has(tKey)) {
      hardList.push(hard('H_TEACHER_CLASH',
        `${teacherName} is scheduled for two classes at once (${days[day] || day}, ${periods[period] ? periods[period].label : period}). Move one lesson or assign another teacher.`,
        { teacherId, day, period, teacherName }))
    } else {
      teacherSlot.set(tKey, e)
    }

    if (roomId) {
      const rKey = `${roomId}#${day}#${period}`
      if (roomSlot.has(rKey)) {
        hardList.push(hard('H_ROOM_CLASH',
          `${roomName} is booked twice at once (${days[day] || day}, ${periods[period] ? periods[period].label : period}). Move one lesson to another room.`,
          { roomId, day, period, roomName }))
      } else {
        roomSlot.set(rKey, e)
      }
    }

    // Requirement + eligibility
    const req = requirementByPair.get(`${classId}#${subjectId}`)
    if (!req) {
      hardList.push(hard('H_UNREQUIRED_SUBJECT',
        `${subjectName} is not in the curriculum for ${className}. Remove this lesson or update the curriculum.`,
        { classId, subjectId, className, subjectName }))
    } else {
      if (!tea.subjectIds.has(subjectId)) {
        hardList.push(hard('H_NOT_ELIGIBLE',
          `${teacherName} is not qualified to teach ${subjectName}. Assign a qualified teacher.`,
          { teacherId, subjectId, teacherName, subjectName }))
      }
      if (req.teacherIds && !req.teacherIds.has(teacherId)) {
        hardList.push(hard('H_NOT_ASSIGNED',
          `${teacherName} is not assigned to ${subjectName} for ${className}. Update the teacher assignment in the Curriculum.`,
          { teacherId, classId, subjectId, teacherName, className, subjectName }))
      }
    }

    // Availability
    if (tea && Number.isInteger(day) && Number.isInteger(period) && tea.unavailable.has(slotKey(day, period))) {
      hardList.push(hard('H_TEACHER_UNAVAILABLE',
        `${teacherName} is marked unavailable at ${days[day] || day}, ${periods[period] ? periods[period].label : period}. Move lesson to an available period.`,
        { teacherId, day, period, teacherName }))
    }
    if (room && Number.isInteger(day) && Number.isInteger(period) && room.unavailable.has(slotKey(day, period))) {
      hardList.push(hard('H_ROOM_UNAVAILABLE',
        `${roomName} is marked unavailable at ${days[day] || day}, ${periods[period] ? periods[period].label : period}. Move lesson to an available period.`,
        { roomId, day, period, roomName }))
    }

    // Counting for workload + requirements
    counts.set(`${classId}#${subjectId}`, (counts.get(`${classId}#${subjectId}`) || 0) + 1)
    subjectDayCount.set(`${classId}#${subjectId}#${day}`, (subjectDayCount.get(`${classId}#${subjectId}#${day}`) || 0) + 1)

    const tdWeek = `${teacherId}`
    teacherWeekCount.set(tdWeek, (teacherWeekCount.get(tdWeek) || 0) + 1)
    const tdDay = `${teacherId}#${day}`
    teacherDayCount.set(tdDay, (teacherDayCount.get(tdDay) || 0) + 1)

    const slotsKey = `${teacherId}#${day}`
    if (!teacherDaySlots.has(slotsKey)) teacherDaySlots.set(slotsKey, [])
    teacherDaySlots.get(slotsKey).push(period)
  }

  // --- Pass 2: workload limits -------------------------------------------------
  for (const [tdDay, n] of teacherDayCount) {
    const [teacherId, dayStr] = tdDay.split('#')
    const tea = teachers.get(teacherId)
    if (tea && tea.maxPerDay !== null && n > tea.maxPerDay) {
      hardList.push(hard('H_WORKLOAD_DAY',
        `${tea.name} has ${n} periods on ${days[Number(dayStr)] || dayStr}, but the daily limit is ${tea.maxPerDay}. Reduce by ${n - tea.maxPerDay} period${n - tea.maxPerDay === 1 ? '' : 's'} or raise daily limit.`,
        { teacherId, day: Number(dayStr), actual: n, limit: tea.maxPerDay, teacherName: tea.name }))
    }
  }
  for (const [teacherId, n] of teacherWeekCount) {
    const tea = teachers.get(teacherId)
    if (tea && tea.maxPerWeek !== null && n > tea.maxPerWeek) {
      hardList.push(hard('H_WORKLOAD_WEEK',
        `${tea.name} has ${n} periods this week, but the weekly limit is ${tea.maxPerWeek}. Reduce by ${n - tea.maxPerWeek} period${n - tea.maxPerWeek === 1 ? '' : 's'} or raise weekly limit.`,
        { teacherId, actual: n, limit: tea.maxPerWeek, teacherName: tea.name }))
    }
  }

  // --- Pass 3: weekly requirement completeness ---------------------------------
  let required = 0
  for (const req of requirements) {
    const n = req.count
    const cls = classes.get(req.classId)
    const subj = subjects.get(req.subjectId)
    const className = cls ? cls.name : 'Unknown Class'
    const subjectName = subj ? subj.name : 'Unknown Subject'
    
    if (!Number.isFinite(n) || n < 0) {
      hardList.push(hard('H_BAD_REQUIREMENT',
        `Requirement for ${className} – ${subjectName} has an invalid period count. Set a valid number of periods in the Curriculum.`,
        { classId: req.classId, subjectId: req.subjectId, className, subjectName }))
      continue
    }
    required += n
    const actual = counts.get(`${req.classId}#${req.subjectId}`) || 0
    if (actual < n) {
      hardList.push(hard('H_MISSING_LESSON',
        `${className} – ${subjectName}: ${actual} of ${n} required periods have been scheduled. Add ${n - actual} more period${n - actual === 1 ? '' : 's'}.`,
        { classId: req.classId, subjectId: req.subjectId, required: n, scheduled: actual, missing: n - actual, className, subjectName }))
    } else if (actual > n) {
      hardList.push(hard('H_EXTRA_LESSON',
        `${className} – ${subjectName}: ${actual} periods have been scheduled, but only ${n} are required. Remove ${actual - n} period${actual - n === 1 ? '' : 's'}.`,
        { classId: req.classId, subjectId: req.subjectId, required: n, scheduled: actual, extra: actual - n, className, subjectName }))
    }
  }

  // --- Pass 4: locks must survive ----------------------------------------------
  for (const lock of locks) {
    if (lock.day < 0 || lock.period < 0) continue // already an input problem, reported by caller
    const cls = classes.get(lock.classId)
    const subj = subjects.get(lock.subjectId)
    const tea = teachers.get(lock.teacherId)
    const className = cls ? cls.name : 'Unknown Class'
    const subjectName = subj ? subj.name : 'Unknown Subject'
    const teacherName = tea ? tea.name : 'Unknown Teacher'
    
    const found = list.some(e =>
      e && String(e.classId) === lock.classId && e.day === lock.day && e.period === lock.period &&
      String(e.subjectId) === lock.subjectId && String(e.teacherId) === lock.teacherId)
    if (!found) {
      hardList.push(hard('H_LOCK_MISSING',
        `A locked lesson (${className} – ${subjectName} on ${days[lock.day]}, ${periods[lock.period] ? periods[lock.period].label : lock.period}) was not kept. Reschedule this lesson.`,
        { classId: lock.classId, subjectId: lock.subjectId, day: lock.day, period: lock.period, className, subjectName, teacherName }))
    }
  }

  // --- Pass 5: soft preferences (never block publication) ----------------------
  let softScore = 0
  const maxPerDay = prefs.maxSameSubjectPerDay
  for (const [mapKey, n] of subjectDayCount) {
    if (n > maxPerDay) {
      const [classId, subjectId, dayStr] = mapKey.split('#')
      const cls = classes.get(classId)
      const subj = subjects.get(subjectId)
      const className = cls ? cls.name : 'Unknown Class'
      const subjectName = subj ? subj.name : 'Unknown Subject'
      const penalty = (n - maxPerDay) * 10
      softScore += penalty
      softList.push({
        code: 'S_SAME_SUBJECT_DAY', penalty,
        message: `${className} – ${subjectName}: ${n} periods on ${days[Number(dayStr)] || dayStr} (preferred maximum is ${maxPerDay}). Spread lessons across other days.`,
        detail: { key: mapKey, count: n, limit: maxPerDay, classId, subjectId, day: Number(dayStr), className, subjectName }
      })
    }
  }

  if (prefs.avoidConsecutiveDifficult) {
    for (const e of list) {
      if (!e) continue
      const subj = subjects.get(String(e.subjectId))
      if (!subj || !subj.difficult) continue
      const cls = classes.get(String(e.classId))
      const className = cls ? cls.name : 'Unknown Class'
      // Only report once per pair: look at the next teaching period only.
      const nextTeach = nextTeachingPeriod(periods, e.period)
      if (nextTeach < 0) continue
      const neighbour = list.find(x => x && String(x.classId) === String(e.classId) && x.day === e.day && x.period === nextTeach)
      if (!neighbour) continue
      const nSubj = subjects.get(String(neighbour.subjectId))
      if (nSubj && nSubj.difficult) {
        softScore += 15
        softList.push({
          code: 'S_CONSECUTIVE_DIFFICULT', penalty: 15,
          message: `${className}: Two demanding subjects scheduled back to back on ${days[e.day] || e.day}. Separate them with another subject or break.`,
          detail: { classId: e.classId, day: e.day, period: e.period, className }
        })
      }
    }
  }

  for (const [slotsKey, periodsForDay] of teacherDaySlots) {
    const [teacherId, dayStr] = slotsKey.split('#')
    const tea = teachers.get(teacherId)
    const teacherName = tea ? tea.name : 'Unknown Teacher'
    const sorted = [...periodsForDay].sort((a, b) => a - b)
    let blocks = 0
    let prev = null
    for (const p of sorted) {
      if (prev === null || !isAdjacentTeachingPeriod(periods, prev, p)) blocks++
      prev = p
    }
    if (blocks > 1) {
      const penalty = (blocks - 1) * 5
      softScore += penalty
      softList.push({
        code: 'S_TEACHER_FRAGMENTATION', penalty,
        message: `${teacherName} is split across ${blocks} separate lessons with gaps on ${days[Number(dayStr)] || dayStr}. Group lessons closer together.`,
        detail: { teacherId, day: Number(dayStr), blocks, teacherName }
      })
    }
  }

  const scheduled = list.filter(Boolean).length
  return {
    ok: hardList.length === 0,
    hard: hardList,
    soft: softList,
    score: softScore,
    totals: { required, scheduled }
  }
}

function nextTeachingPeriod(periods, period) {
  for (let i = period + 1; i < periods.length; i++) {
    if (periods[i].kind === 'teaching') return i
  }
  return -1
}

function isAdjacentTeachingPeriod(periods, a, b) {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  for (let i = lo + 1; i < hi; i++) {
    if (periods[i].kind === 'teaching') return false
  }
  return true
}

module.exports = { validateTimetable, buildIndex, resolveDay, resolvePeriod, slotKey, classSlotKey }
