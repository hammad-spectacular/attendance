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
    classes.set(String(c.id), { id: String(c.id), name: String(c.name || c.id) })
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

    if (!cls) hardList.push(hard('H_UNKNOWN_CLASS', `Entry references unknown class "${classId}".`, { classId }))
    if (!subj) hardList.push(hard('H_UNKNOWN_SUBJECT', `Entry references unknown subject "${subjectId}".`, { subjectId }))
    if (!tea) hardList.push(hard('H_UNKNOWN_TEACHER', `Entry references unknown teacher "${teacherId}".`, { teacherId }))
    if (roomId && !room) hardList.push(hard('H_UNKNOWN_ROOM', `Entry references unknown room "${roomId}".`, { roomId }))

    if (!Number.isInteger(day) || day < 0 || day >= days.length) {
      hardList.push(hard('H_UNKNOWN_DAY', `Entry has a day outside the working week (${day}).`, { day }))
    } else if (!Number.isInteger(period) || period < 0 || period >= periods.length) {
      hardList.push(hard('H_UNKNOWN_PERIOD', `Entry has an unknown period (${period}).`, { period }))
    } else if (!teachingSet.has(period)) {
      hardList.push(hard('H_NON_TEACHING_SLOT',
        `Lesson scheduled in "${periods[period].label}" which is a ${periods[period].kind}, not a teaching period.`,
        { day: days[day], period: periods[period].label }))
    }

    // Duplicate / clash detection
    const cKey = classSlotKey(classId, day, period)
    if (classSlot.has(cKey)) {
      hardList.push(hard('H_CLASS_CLASH',
        `Class ${cls ? cls.name : classId} has two lessons at once (${days[day] || day}, ${periods[period] ? periods[period].label : period}).`,
        { classId, day, period }))
    } else {
      classSlot.set(cKey, e)
    }

    const tKey = `${teacherId}#${day}#${period}`
    if (teacherSlot.has(tKey)) {
      hardList.push(hard('H_TEACHER_CLASH',
        `Teacher ${tea ? tea.name : teacherId} is scheduled for two classes at once (${days[day] || day}, ${periods[period] ? periods[period].label : period}).`,
        { teacherId, day, period }))
    } else {
      teacherSlot.set(tKey, e)
    }

    if (roomId) {
      const rKey = `${roomId}#${day}#${period}`
      if (roomSlot.has(rKey)) {
        hardList.push(hard('H_ROOM_CLASH',
          `Room ${room ? room.name : roomId} is booked twice at once (${days[day] || day}, ${periods[period] ? periods[period].label : period}).`,
          { roomId, day, period }))
      } else {
        roomSlot.set(rKey, e)
      }
    }

    // Requirement + eligibility
    const req = requirementByPair.get(`${classId}#${subjectId}`)
    if (!req) {
      hardList.push(hard('H_UNREQUIRED_SUBJECT',
        `${subj ? subj.name : subjectId} is not a required subject for ${cls ? cls.name : classId}.`,
        { classId, subjectId }))
    } else {
      if (!tea.subjectIds.has(subjectId)) {
        hardList.push(hard('H_NOT_ELIGIBLE',
          `Teacher ${tea ? tea.name : teacherId} is not qualified to teach ${subj ? subj.name : subjectId}.`,
          { teacherId, subjectId }))
      }
      if (req.teacherIds && !req.teacherIds.has(teacherId)) {
        hardList.push(hard('H_NOT_ASSIGNED',
          `Teacher ${tea ? tea.name : teacherId} is not assigned to ${subj ? subj.name : subjectId} for ${cls ? cls.name : classId}.`,
          { teacherId, classId, subjectId }))
      }
    }

    // Availability
    if (tea && Number.isInteger(day) && Number.isInteger(period) && tea.unavailable.has(slotKey(day, period))) {
      hardList.push(hard('H_TEACHER_UNAVAILABLE',
        `${tea.name} is marked unavailable at ${days[day] || day}, ${periods[period] ? periods[period].label : period}.`,
        { teacherId, day, period }))
    }
    if (room && Number.isInteger(day) && Number.isInteger(period) && room.unavailable.has(slotKey(day, period))) {
      hardList.push(hard('H_ROOM_UNAVAILABLE',
        `${room.name} is marked unavailable at ${days[day] || day}, ${periods[period] ? periods[period].label : period}.`,
        { roomId, day, period }))
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
        `${tea.name} has ${n} periods on ${days[Number(dayStr)] || dayStr} but the daily limit is ${tea.maxPerDay}.`,
        { teacherId, day: Number(dayStr), actual: n, limit: tea.maxPerDay }))
    }
  }
  for (const [teacherId, n] of teacherWeekCount) {
    const tea = teachers.get(teacherId)
    if (tea && tea.maxPerWeek !== null && n > tea.maxPerWeek) {
      hardList.push(hard('H_WORKLOAD_WEEK',
        `${tea.name} has ${n} periods this week but the weekly limit is ${tea.maxPerWeek}.`,
        { teacherId, actual: n, limit: tea.maxPerWeek }))
    }
  }

  // --- Pass 3: weekly requirement completeness ---------------------------------
  let required = 0
  for (const req of requirements) {
    const n = req.count
    if (!Number.isFinite(n) || n < 0) {
      hardList.push(hard('H_BAD_REQUIREMENT',
        `Requirement for ${req.classId}/${req.subjectId} has an invalid period count.`,
        { classId: req.classId, subjectId: req.subjectId }))
      continue
    }
    required += n
    const actual = counts.get(`${req.classId}#${req.subjectId}`) || 0
    if (actual < n) {
      hardList.push(hard('H_MISSING_LESSON',
        `${actual} of ${n} required periods scheduled for ${req.classId}/${req.subjectId} (${n - actual} missing).`,
        { classId: req.classId, subjectId: req.subjectId, required: n, scheduled: actual }))
    } else if (actual > n) {
      hardList.push(hard('H_EXTRA_LESSON',
        `${actual} periods scheduled for ${req.classId}/${req.subjectId} but only ${n} are required.`,
        { classId: req.classId, subjectId: req.subjectId, required: n, scheduled: actual }))
    }
  }

  // --- Pass 4: locks must survive ----------------------------------------------
  for (const lock of locks) {
    if (lock.day < 0 || lock.period < 0) continue // already an input problem, reported by caller
    const found = list.some(e =>
      e && String(e.classId) === lock.classId && e.day === lock.day && e.period === lock.period &&
      String(e.subjectId) === lock.subjectId && String(e.teacherId) === lock.teacherId)
    if (!found) {
      hardList.push(hard('H_LOCK_MISSING',
        `A locked lesson (${lock.classId}/${lock.subjectId} on ${days[lock.day]}, ${periods[lock.period].label}) was not kept.`,
        { classId: lock.classId, subjectId: lock.subjectId, day: lock.day, period: lock.period }))
    }
  }

  // --- Pass 5: soft preferences (never block publication) ----------------------
  let softScore = 0
  const maxPerDay = prefs.maxSameSubjectPerDay
  for (const [mapKey, n] of subjectDayCount) {
    if (n > maxPerDay) {
      const [, , dayStr] = mapKey.split('#')
      const penalty = (n - maxPerDay) * 10
      softScore += penalty
      softList.push({
        code: 'S_SAME_SUBJECT_DAY', penalty,
        message: `${n} periods of one subject on ${days[Number(dayStr)] || dayStr} (preferred maximum ${maxPerDay}).`,
        detail: { key: mapKey, count: n, limit: maxPerDay }
      })
    }
  }

  if (prefs.avoidConsecutiveDifficult) {
    for (const e of list) {
      if (!e) continue
      const subj = subjects.get(String(e.subjectId))
      if (!subj || !subj.difficult) continue
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
          message: `Two demanding subjects back to back for ${e.classId} on ${days[e.day] || e.day}.`,
          detail: { classId: e.classId, day: e.day, period: e.period }
        })
      }
    }
  }

  for (const [slotsKey, periodsForDay] of teacherDaySlots) {
    const [teacherId, dayStr] = slotsKey.split('#')
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
        message: `${teachers.get(teacherId) ? teachers.get(teacherId).name : teacherId} is split across ${blocks} separate lessons on ${days[Number(dayStr)] || dayStr}.`,
        detail: { teacherId, day: Number(dayStr), blocks }
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
