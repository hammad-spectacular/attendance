'use strict'

/**
 * Timetable solver for The Eye.
 *
 * Deterministic constraint solver: forward checking + most-constrained-variable
 * ordering + heuristic value ordering, then an independent validation pass of its
 * own output (timetable/validator.js). There is no randomness anywhere: the same
 * configuration always produces the same timetable.
 *
 * No dependencies, no database access. Input is a plain configuration object,
 * output is a plain result object:
 *
 *   {
 *     ok: boolean,                 // only true when 100% complete AND validator-clean
 *     entries: [...],              // { classId, day, period, subjectId, teacherId, roomId? }
 *     stats: { generationMs, nodeCount, requiredLessons, scheduledLessons,
 *              completenessPct, aborted },
 *     violations: [...],           // hard violations found by the independent validator
 *     softPenalties: [...],        // preferences that could not be honoured
 *     diagnostics: [...],          // why generation failed (empty when ok)
 *     score: number                // soft penalty total, lower is better
 *   }
 *
 * ok is NEVER true when a required lesson is missing or a hard constraint is
 * broken. A failed run always carries human-readable diagnostics.
 */

const { validateTimetable } = require('./validator')

const DEFAULT_OPTIONS = {
  nodeBudget: 300000,   // maximum placement attempts
  timeBudgetMs: 5000    // wall-clock ceiling so a request can never hang
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

function resolveDay(days, value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < days.length) return value
  if (value === undefined || value === null) return -1
  const raw = String(value).trim().toLowerCase()
  if (!raw) return -1
  const byName = days.findIndex(d => String(d).trim().toLowerCase() === raw)
  if (byName >= 0) return byName
  const asNum = Number(raw)
  if (Number.isInteger(asNum) && asNum >= 0 && asNum < days.length) return asNum
  return -1
}

function resolvePeriod(periods, value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < periods.length) return value
  if (value === undefined || value === null) return -1
  const raw = String(value).trim().toLowerCase()
  if (!raw) return -1
  const byLabel = periods.findIndex(p => String(p.label).trim().toLowerCase() === raw)
  if (byLabel >= 0) return byLabel
  const asNum = Number(raw)
  if (Number.isInteger(asNum) && asNum >= 0 && asNum < periods.length) return asNum
  return -1
}

// ---------------------------------------------------------------------------
// Configuration parsing
// ---------------------------------------------------------------------------

function buildModel(raw, options) {
  const input = raw || {}
  const errors = []
  const days = Array.isArray(input.days) ? input.days.map(d => String(d)) : []
  if (!days.length) errors.push({ code: 'CFG_NO_DAYS', message: 'No working days are configured.' })

  const periods = (Array.isArray(input.periods) ? input.periods : []).map((p, i) => ({
    index: i,
    label: String((p && (p.label || p.name)) || `P${i + 1}`),
    kind: String((p && p.kind) || 'teaching')
  }))
  if (!periods.length) errors.push({ code: 'CFG_NO_PERIODS', message: 'No periods are configured.' })

  const teachingPeriods = periods.filter(p => p.kind === 'teaching').map(p => p.index)
  const teachingSet = new Set(teachingPeriods)

  const teachingSlots = []
  for (let d = 0; d < days.length; d++) {
    for (const p of teachingPeriods) teachingSlots.push({ day: d, period: p })
  }

  // Adjacent teaching periods (breaks and lunch do not separate lessons for the
  // "no two demanding subjects back to back" preference).
  const prevTeach = new Map()
  const nextTeach = new Map()
  for (const p of teachingPeriods) {
    let prev = -1
    for (let i = p - 1; i >= 0; i--) {
      if (teachingSet.has(i)) { prev = i; break }
    }
    let next = -1
    for (let i = p + 1; i < periods.length; i++) {
      if (teachingSet.has(i)) { next = i; break }
    }
    prevTeach.set(p, prev)
    nextTeach.set(p, next)
  }

  const classes = []
  for (const c of (Array.isArray(input.classes) ? input.classes : [])) {
    if (!c || c.id === undefined || c.id === null) continue
    classes.push({ id: String(c.id), name: String(c.name || c.id) })
  }
  if (!classes.length) errors.push({ code: 'CFG_NO_CLASSES', message: 'No classes are configured.' })
  const classIds = new Set(classes.map(c => c.id))

  const subjects = new Map()
  for (const s of (Array.isArray(input.subjects) ? input.subjects : [])) {
    if (!s || s.id === undefined || s.id === null) continue
    subjects.set(String(s.id), { id: String(s.id), name: String(s.name || s.id), difficult: !!s.difficult })
  }

  const teachers = new Map()
  for (const t of (Array.isArray(input.teachers) ? input.teachers : [])) {
    if (!t || t.id === undefined || t.id === null) continue
    const unavailable = new Set()
    for (const slot of (Array.isArray(t.unavailableSlots) ? t.unavailableSlots : [])) {
      if (!slot) continue
      const d = resolveDay(days, slot.day)
      const p = resolvePeriod(periods, slot.period)
      if (d >= 0 && p >= 0) unavailable.add(slotKey(d, p))
    }
    let availableSlots = 0
    for (const s of teachingSlots) {
      if (!unavailable.has(slotKey(s.day, s.period))) availableSlots++
    }
    const maxPerDay = t.maxPerDay === undefined || t.maxPerDay === null ? null : num(t.maxPerDay, null)
    const maxPerWeek = t.maxPerWeek === undefined || t.maxPerWeek === null ? null : num(t.maxPerWeek, null)
    teachers.set(String(t.id), {
      id: String(t.id),
      name: String(t.name || t.id),
      subjectIds: new Set((Array.isArray(t.subjectIds) ? t.subjectIds : []).map(String)),
      unavailable,
      maxPerDay,
      maxPerWeek,
      availableSlots,
      capacity: Math.min(
        availableSlots,
        maxPerWeek === null ? Infinity : maxPerWeek,
        maxPerDay === null ? Infinity : maxPerDay * days.length
      )
    })
  }

  const rooms = new Map()
  for (const r of (Array.isArray(input.rooms) ? input.rooms : [])) {
    if (!r || r.id === undefined || r.id === null) continue
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
  for (const r of (Array.isArray(input.requirements) ? input.requirements : [])) {
    if (!r) continue
    const classId = r.classId === undefined || r.classId === null ? '' : String(r.classId)
    const subjectId = r.subjectId === undefined || r.subjectId === null ? '' : String(r.subjectId)
    const count = num(r.periodsPerWeek, NaN)
    const req = { classId, subjectId, count }
    if (!classIds.has(classId)) {
      errors.push({ code: 'CFG_UNKNOWN_CLASS', message: `Requirement references unknown class "${classId}".` })
    }
    if (!subjects.has(subjectId)) {
      errors.push({ code: 'CFG_UNKNOWN_SUBJECT', message: `Requirement references unknown subject "${subjectId}".` })
    }
    if (!Number.isFinite(count) || count < 0 || !Number.isInteger(count)) {
      errors.push({ code: 'CFG_BAD_COUNT', message: `Requirement ${classId}/${subjectId} has an invalid period count.` })
    }
    if (Array.isArray(r.teacherIds) && r.teacherIds.length) {
      req.teacherIds = new Set(r.teacherIds.map(String))
    } else {
      req.teacherIds = null
    }
    req.roomId = r.roomId === undefined || r.roomId === null || r.roomId === '' ? null : String(r.roomId)
    requirements.push(req)
  }
  if (!requirements.length) {
    errors.push({ code: 'CFG_NO_REQUIREMENTS', message: 'No subject requirements are configured.' })
  }

  // Eligible teachers: explicit assignment list, otherwise every teacher qualified
  // for the subject. More than one teacher per subject/class is fully supported.
  for (const req of requirements) {
    const qualified = [...teachers.values()]
      .filter(t => t.subjectIds.has(req.subjectId))
      .map(t => t.id)
    if (req.teacherIds) {
      req.eligible = [...req.teacherIds].filter(id => teachers.has(id))
      for (const id of [...req.teacherIds]) {
        const t = teachers.get(id)
        if (!t) {
          errors.push({ code: 'CFG_UNKNOWN_TEACHER', message: `Requirement ${req.classId}/${req.subjectId} references unknown teacher "${id}".` })
        } else if (!t.subjectIds.has(req.subjectId)) {
          errors.push({
            code: 'CFG_TEACHER_NOT_QUALIFIED',
            message: `${t.name} is assigned to ${req.subjectId} but is not qualified for that subject.`
          })
        }
      }
    } else {
      req.eligible = qualified
    }
    if (req.roomId && !rooms.has(req.roomId)) {
      errors.push({ code: 'CFG_UNKNOWN_ROOM', message: `Requirement ${req.classId}/${req.subjectId} references unknown room "${req.roomId}".` })
    }
  }

  const locks = []
  for (const l of (Array.isArray(input.locks) ? input.locks : [])) {
    if (!l) continue
    const classId = l.classId === undefined || l.classId === null ? '' : String(l.classId)
    const subjectId = l.subjectId === undefined || l.subjectId === null ? '' : String(l.subjectId)
    const teacherId = l.teacherId === undefined || l.teacherId === null ? '' : String(l.teacherId)
    locks.push({
      classId, subjectId, teacherId,
      roomId: l.roomId === undefined || l.roomId === null || l.roomId === '' ? null : String(l.roomId),
      day: resolveDay(days, l.day),
      period: resolvePeriod(periods, l.period)
    })
  }

  const prefs = {
    maxSameSubjectPerDay: Math.max(1, num((input.preferences || {}).maxSameSubjectPerDay, 1)),
    avoidConsecutiveDifficult: (input.preferences || {}).avoidConsecutiveDifficult === undefined
      ? true
      : !!(input.preferences || {}).avoidConsecutiveDifficult,
    balanceClassDays: (input.preferences || {}).balanceClassDays === undefined ? true : !!input.preferences.balanceClassDays,
    balanceTeacherDays: (input.preferences || {}).balanceTeacherDays === undefined ? true : !!input.preferences.balanceTeacherDays
  }

  // Numeric indexes keep the search hot loop free of string allocation.
  const classIndex = new Map(classes.map((c, i) => [c.id, i]))
  const subjectIndex = new Map([...subjects.keys()].map((id, i) => [id, i]))
  const teacherIndex = new Map([...teachers.keys()].map((id, i) => [id, i]))
  const roomIndex = new Map([...rooms.keys()].map((id, i) => [id, i]))

  return {
    model: {
      days, periods, teachingPeriods, teachingSet, teachingSlots, prevTeach, nextTeach,
      classes, subjects, teachers, rooms, requirements, locks, prefs,
      classIndex, subjectIndex, teacherIndex, roomIndex,
      options: {
        nodeBudget: Math.max(1, num(options.nodeBudget, DEFAULT_OPTIONS.nodeBudget)),
        timeBudgetMs: Math.max(50, num(options.timeBudgetMs, DEFAULT_OPTIONS.timeBudgetMs))
      }
    },
    errors
  }
}

// ---------------------------------------------------------------------------
// Preflight diagnostics — cheap, deterministic impossibility checks that run
// before the search so users get a real explanation instead of a timeout.
// ---------------------------------------------------------------------------

function preflight(model) {
  const out = []
  const { days, teachingSlots, classes, subjects, teachers, requirements, locks, rooms } = model

  // 1. Every class needs enough teaching slots for its whole week.
  const demandByClass = new Map()
  for (const r of requirements) {
    demandByClass.set(r.classId, (demandByClass.get(r.classId) || 0) + (Number.isFinite(r.count) ? r.count : 0))
  }
  for (const [classId, demand] of demandByClass) {
    if (demand > teachingSlots.length) {
      const cls = classes.find(c => c.id === classId)
      out.push({
        code: 'D_CLASS_OVERFLOW',
        message: `${cls ? cls.name : classId} needs ${demand} periods a week but the school only has ${teachingSlots.length} teaching periods. Reduce subject periods or add teaching periods.`,
        detail: { classId, demand, available: teachingSlots.length, shortfall: demand - teachingSlots.length }
      })
    }
  }

  // 2. Every requirement needs at least one teacher who can actually teach it.
  for (const r of requirements) {
    if (r.eligible.length === 0) {
      out.push({
        code: 'D_NO_TEACHER',
        message: `No qualified teacher is available for ${r.subjectId} in ${r.classId}.`,
        detail: { classId: r.classId, subjectId: r.subjectId }
      })
      continue
    }
    if (!Number.isFinite(r.count)) continue

    // 3. Per-requirement capacity: (slot, teacher) pairs that are actually usable.
    let usablePairs = 0
    const usableSlots = new Set()
    for (const s of teachingSlots) {
      if (r.roomId) {
        const room = rooms.get(r.roomId)
        if (room && room.unavailable.has(slotKey(s.day, s.period))) continue
      }
      for (const tid of r.eligible) {
        const t = teachers.get(tid)
        if (!t) continue
        if (t.unavailable.has(slotKey(s.day, s.period))) continue
        usablePairs++
        usableSlots.add(slotKey(s.day, s.period))
      }
    }
    if (r.count > usableSlots.size) {
      const subj = subjects.get(r.subjectId)
      const cls = classes.find(c => c.id === r.classId)
      out.push({
        code: 'D_REQUIREMENT_CAPACITY',
        message: `${cls ? cls.name : r.classId} needs ${r.count} periods of ${subj ? subj.name : r.subjectId}, but only ${usableSlots.size} fitting slots exist for its eligible teachers${r.roomId ? ` in room ${r.roomId}` : ''}.`,
        detail: { classId: r.classId, subjectId: r.subjectId, demand: r.count, usableSlots: usableSlots.size }
      })
    }
  }

  // 4. A teacher who is the ONLY eligible teacher for work must fit its capacity.
  const soleLoad = new Map()
  const soleGroups = new Map()
  for (const r of requirements) {
    if (r.eligible.length !== 1 || !Number.isFinite(r.count)) continue
    const tid = r.eligible[0]
    soleLoad.set(tid, (soleLoad.get(tid) || 0) + r.count)
    if (!soleGroups.has(tid)) soleGroups.set(tid, [])
    soleGroups.get(tid).push(`${r.classId}/${r.subjectId}`)
  }
  for (const [tid, load] of soleLoad) {
    const t = teachers.get(tid)
    if (!t) continue
    if (load > t.capacity) {
      out.push({
        code: 'D_TEACHER_OVERLOAD',
        message: `${t.name} is the only eligible teacher for ${load} periods a week, but can work at most ${t.capacity} (${soleGroups.get(tid).join(', ')}). Assign another qualified teacher or reduce periods.`,
        detail: { teacherId: tid, demand: load, capacity: t.capacity, groups: soleGroups.get(tid) }
      })
    }
  }

  // 5. Combined demand vs combined capacity for groups sharing the same teacher pool.
  const byPool = new Map()
  for (const r of requirements) {
    if (!Number.isFinite(r.count) || !r.eligible.length) continue
    const poolKey = [...r.eligible].sort().join('|')
    if (!byPool.has(poolKey)) byPool.set(poolKey, { demand: 0, pairs: new Set(), groups: [] })
    const pool = byPool.get(poolKey)
    pool.demand += r.count
    pool.groups.push(`${r.classId}/${r.subjectId}`)
    for (const s of teachingSlots) {
      for (const tid of r.eligible) {
        const t = teachers.get(tid)
        if (!t || t.unavailable.has(slotKey(s.day, s.period))) continue
        if (r.roomId) {
          const room = rooms.get(r.roomId)
          if (room && room.unavailable.has(slotKey(s.day, s.period))) continue
        }
        pool.pairs.add(`${tid}@${s.day}.${s.period}`)
      }
    }
  }
  for (const [poolKey, pool] of byPool) {
    if (pool.pairs.size < pool.demand) {
      out.push({
        code: 'D_POOL_OVERLOAD',
        message: `The lessons sharing teachers [${poolKey.split('|').join(', ')}] total ${pool.demand} periods a week but only ${pool.pairs.size} teacher-slots are available (${pool.groups.join(', ')}).`,
        detail: { pool: poolKey, demand: pool.demand, capacity: pool.pairs.size, groups: pool.groups }
      })
    }
  }

  // 6. Locks must be internally consistent before anything else is attempted.
  const seenClass = new Map()
  const seenTeacher = new Map()
  for (const lock of locks) {
    const where = `${lock.classId} on ${model.days[lock.day] || lock.day}, ${model.periods[lock.period] ? model.periods[lock.period].label : lock.period}`
    if (lock.day < 0 || lock.period < 0) {
      out.push({ code: 'D_BAD_LOCK', message: `A locked lesson for ${lock.classId} points at a day or period that does not exist.`, detail: { lock } })
      continue
    }
    if (!model.teachingSet.has(lock.period)) {
      out.push({ code: 'D_LOCK_NON_TEACHING', message: `A locked lesson for ${lock.classId} sits in a break or lunch period (${where}).`, detail: { lock } })
    }
    const subject = model.subjects.get(lock.subjectId)
    const teacher = model.teachers.get(lock.teacherId)
    if (!subject) out.push({ code: 'D_BAD_LOCK', message: `A locked lesson for ${lock.classId} references unknown subject "${lock.subjectId}".`, detail: { lock } })
    if (!teacher) {
      out.push({ code: 'D_BAD_LOCK', message: `A locked lesson for ${lock.classId} references unknown teacher "${lock.teacherId}".`, detail: { lock } })
    } else {
      if (!teacher.subjectIds.has(lock.subjectId)) {
        out.push({ code: 'D_LOCK_INELIGIBLE', message: `Locked lesson: ${teacher.name} is not qualified for ${lock.subjectId}.`, detail: { lock } })
      }
      if (teacher.unavailable.has(slotKey(lock.day, lock.period))) {
        out.push({ code: 'D_LOCK_UNAVAILABLE', message: `Locked lesson: ${teacher.name} is unavailable at ${where}.`, detail: { lock } })
      }
      const tKey = `${lock.teacherId}#${lock.day}#${lock.period}`
      if (seenTeacher.has(tKey)) {
        out.push({ code: 'D_LOCK_CLASH', message: `Two locked lessons put ${teacher.name} in two places at once (${where}).`, detail: { lock, conflictsWith: seenTeacher.get(tKey) } })
      } else {
        seenTeacher.set(tKey, lock)
      }
    }
    const cKey = `${lock.classId}#${lock.day}#${lock.period}`
    if (seenClass.has(cKey)) {
      out.push({ code: 'D_LOCK_CLASH', message: `Two locked lessons collide for class ${lock.classId} (${where}).`, detail: { lock, conflictsWith: seenClass.get(cKey) } })
    } else {
      seenClass.set(cKey, lock)
    }
    if (lock.roomId) {
      const room = rooms.get(lock.roomId)
      if (!room) out.push({ code: 'D_BAD_LOCK', message: `A locked lesson references unknown room "${lock.roomId}".`, detail: { lock } })
      else if (room.unavailable.has(slotKey(lock.day, lock.period))) {
        out.push({ code: 'D_LOCK_UNAVAILABLE', message: `Locked lesson: room ${room.name} is unavailable at ${where}.`, detail: { lock } })
      }
    }
  }

  // 7. Locks that do not correspond to any requirement would never validate.
  for (const lock of locks) {
    if (lock.day < 0 || lock.period < 0) continue
    const req = requirements.find(r => r.classId === lock.classId && r.subjectId === lock.subjectId)
    if (!req) {
      out.push({
        code: 'D_LOCK_NO_REQUIREMENT',
        message: `A locked lesson for ${lock.classId}/${lock.subjectId} has no matching subject requirement, so it could never be validated.`,
        detail: { lock }
      })
      continue
    }
    const lockedCount = locks.filter(l => l.classId === lock.classId && l.subjectId === lock.subjectId && l.day >= 0 && l.period >= 0).length
    if (lockedCount > req.count) {
      out.push({
        code: 'D_LOCK_OVERFLOW',
        message: `${lockedCount} periods of ${lock.subjectId} are locked for ${lock.classId} but only ${req.count} are required.`,
        detail: { classId: lock.classId, subjectId: lock.subjectId, locked: lockedCount, required: req.count }
      })
    }
  }

  return out
}

// ---------------------------------------------------------------------------
// Search state
// ---------------------------------------------------------------------------

function createState(model) {
  const state = {
    entries: [],
    classBusy: new Set(),        // classIdx * 1e6 + day * 1000 + period
    classBusyCount: new Map(),   // classIdx -> filled teaching slots
    teacherBusy: new Set(),      // teacherIdx * 1e6 + day * 1000 + period
    roomBusy: new Set(),         // roomIdx * 1e6 + day * 1000 + period
    teacherDay: new Map(),
    teacherWeek: new Map(),
    classDay: new Map(),
    subjDay: new Map(),
    entryAt: new Map(),          // classIdx * 1000 + day -> Map(period -> entry)
    groups: [],
    // Cached feasibility counts, invalidated precisely when a placement can
    // change them: same class, same teacher, or same room.
    groupsByClass: new Map(),
    groupsByTeacher: new Map(),
    groupsByRoom: new Map()
  }

  for (const r of model.requirements) {
    const subject = model.subjects.get(r.subjectId)
    const classIdx = model.classIndex.get(r.classId)
    const group = {
      classId: r.classId,
      subjectId: r.subjectId,
      classIdx,
      subjIdx: model.subjectIndex.get(r.subjectId),
      subjDifficult: !!(subject && subject.difficult),
      eligible: r.eligible,
      roomId: r.roomId,
      roomIdx: r.roomId ? (model.roomIndex.get(r.roomId) ?? -1) : -1,
      count: Number.isFinite(r.count) ? r.count : 0,
      remaining: Number.isFinite(r.count) ? r.count : 0,
      feasible: null              // cached domain size, null = unknown
    }
    state.groups.push(group)

    if (!state.groupsByClass.has(classIdx)) state.groupsByClass.set(classIdx, [])
    state.groupsByClass.get(classIdx).push(group)
    for (const tid of group.eligible) {
      const tIdx = model.teacherIndex.get(tid)
      if (tIdx === undefined) continue
      if (!state.groupsByTeacher.has(tIdx)) state.groupsByTeacher.set(tIdx, [])
      state.groupsByTeacher.get(tIdx).push(group)
    }
    if (group.roomIdx >= 0) {
      if (!state.groupsByRoom.has(group.roomIdx)) state.groupsByRoom.set(group.roomIdx, [])
      state.groupsByRoom.get(group.roomIdx).push(group)
    }
  }

  // Locked lessons are placed first: they are fixed and must be honoured.
  for (const lock of model.locks) {
    if (lock.day < 0 || lock.period < 0) continue
    const group = state.groups.find(g => g.classId === lock.classId && g.subjectId === lock.subjectId)
    const entry = {
      classId: lock.classId,
      day: lock.day,
      period: lock.period,
      subjectId: lock.subjectId,
      teacherId: lock.teacherId,
      roomId: lock.roomId || undefined,
      locked: true
    }
    applyPlacement(model, state, entry)
    state.entries.push(entry)
    if (group) group.remaining = Math.max(0, group.remaining - 1)
  }

  return state
}

/** Invalidate the cached domain sizes a placement can possibly change. */
function invalidate(state, classIdx, teacherIdx, roomIdx) {
  const byClass = state.groupsByClass.get(classIdx)
  if (byClass) for (const g of byClass) g.feasible = null
  const byTeacher = state.groupsByTeacher.get(teacherIdx)
  if (byTeacher) for (const g of byTeacher) g.feasible = null
  if (roomIdx >= 0) {
    const byRoom = state.groupsByRoom.get(roomIdx)
    if (byRoom) for (const g of byRoom) g.feasible = null
  }
}

function applyPlacement(model, state, entry) {
  const classIdx = model.classIndex.get(entry.classId)
  const teacherIdx = model.teacherIndex.get(entry.teacherId)
  const roomIdx = entry.roomId ? (model.roomIndex.get(entry.roomId) ?? -1) : -1
  const slot = entry.day * 1000 + entry.period

  state.classBusy.add(classIdx * 1000000 + slot)
  state.classBusyCount.set(classIdx, (state.classBusyCount.get(classIdx) || 0) + 1)
  state.teacherBusy.add(teacherIdx * 1000000 + slot)
  if (roomIdx >= 0) state.roomBusy.add(roomIdx * 1000000 + slot)

  const tDay = teacherIdx * 1000 + entry.day
  state.teacherDay.set(tDay, (state.teacherDay.get(tDay) || 0) + 1)
  state.teacherWeek.set(teacherIdx, (state.teacherWeek.get(teacherIdx) || 0) + 1)

  const cDay = classIdx * 1000 + entry.day
  state.classDay.set(cDay, (state.classDay.get(cDay) || 0) + 1)

  const sDay = classIdx * 1000000 + model.subjectIndex.get(entry.subjectId) * 1000 + entry.day
  state.subjDay.set(sDay, (state.subjDay.get(sDay) || 0) + 1)

  const atKey = classIdx * 1000 + entry.day
  if (!state.entryAt.has(atKey)) state.entryAt.set(atKey, new Map())
  state.entryAt.get(atKey).set(entry.period, entry)

  invalidate(state, classIdx, teacherIdx, roomIdx)
}

function undoPlacement(model, state, entry) {
  const classIdx = model.classIndex.get(entry.classId)
  const teacherIdx = model.teacherIndex.get(entry.teacherId)
  const roomIdx = entry.roomId ? (model.roomIndex.get(entry.roomId) ?? -1) : -1
  const slot = entry.day * 1000 + entry.period

  state.classBusy.delete(classIdx * 1000000 + slot)
  const cBusy = (state.classBusyCount.get(classIdx) || 1) - 1
  if (cBusy > 0) state.classBusyCount.set(classIdx, cBusy); else state.classBusyCount.delete(classIdx)
  state.teacherBusy.delete(teacherIdx * 1000000 + slot)
  if (roomIdx >= 0) state.roomBusy.delete(roomIdx * 1000000 + slot)

  const tDay = teacherIdx * 1000 + entry.day
  const tDayN = (state.teacherDay.get(tDay) || 1) - 1
  if (tDayN > 0) state.teacherDay.set(tDay, tDayN); else state.teacherDay.delete(tDay)

  const tWeekN = (state.teacherWeek.get(teacherIdx) || 1) - 1
  if (tWeekN > 0) state.teacherWeek.set(teacherIdx, tWeekN); else state.teacherWeek.delete(teacherIdx)

  const cDay = classIdx * 1000 + entry.day
  const cDayN = (state.classDay.get(cDay) || 1) - 1
  if (cDayN > 0) state.classDay.set(cDay, cDayN); else state.classDay.delete(cDay)

  const sDay = classIdx * 1000000 + model.subjectIndex.get(entry.subjectId) * 1000 + entry.day
  const sDayN = (state.subjDay.get(sDay) || 1) - 1
  if (sDayN > 0) state.subjDay.set(sDay, sDayN); else state.subjDay.delete(sDay)

  const atKey = classIdx * 1000 + entry.day
  const at = state.entryAt.get(atKey)
  if (at) {
    at.delete(entry.period)
    if (at.size === 0) state.entryAt.delete(atKey)
  }

  invalidate(state, classIdx, teacherIdx, roomIdx)
}

/**
 * Feasible (slot, teacher) pairs for one requirement.
 *
 *   'count'   — fast path used by forward checking: allocates nothing
 *   'build'   — materialise the values together with their heuristic scores
 *   'explain' — additionally count why nothing fits, for the failure message
 */
function computeDomain(model, state, group, mode) {
  const build = mode === 'build'
  const explain = mode === 'explain'
  const values = build ? [] : null
  const reasons = explain
    ? { classFull: 0, roomBusy: 0, roomUnavailable: 0, teacherUnavailable: 0, teacherBusy: 0, teacherWeekLimit: 0, teacherDayLimit: 0, noTeacher: 0 }
    : null
  let count = 0

  const classBase = group.classIdx * 1000000
  const subjDayBase = classBase + group.subjIdx * 1000
  const room = group.roomId ? model.rooms.get(group.roomId) : null

  for (const s of model.teachingSlots) {
    const slot = s.day * 1000 + s.period
    if (state.classBusy.has(classBase + slot)) {
      if (reasons) reasons.classFull++
      continue
    }
    if (group.roomIdx >= 0) {
      if (room && room.unavailable.has(slot)) {
        if (reasons) reasons.roomUnavailable++
        continue
      }
      if (state.roomBusy.has(group.roomIdx * 1000000 + slot)) {
        if (reasons) reasons.roomBusy++
        continue
      }
    }

    let anyTeacher = false
    for (const tid of group.eligible) {
      const t = model.teachers.get(tid)
      if (!t) continue
      const tIdx = model.teacherIndex.get(tid)
      if (t.unavailable.has(slot)) {
        if (reasons) reasons.teacherUnavailable++
        continue
      }
      if (state.teacherBusy.has(tIdx * 1000000 + slot)) {
        if (reasons) reasons.teacherBusy++
        continue
      }
      const week = state.teacherWeek.get(tIdx) || 0
      if (t.maxPerWeek !== null && week >= t.maxPerWeek) {
        if (reasons) reasons.teacherWeekLimit++
        continue
      }
      const dayLoad = state.teacherDay.get(tIdx * 1000 + s.day) || 0
      if (t.maxPerDay !== null && dayLoad >= t.maxPerDay) {
        if (reasons) reasons.teacherDayLimit++
        continue
      }
      anyTeacher = true
      count++
      if (build) {
        values.push({
          day: s.day,
          period: s.period,
          teacherId: tid,
          score: scoreValue(model, state, group, tIdx, subjDayBase, s.day, s.period)
        })
      }
    }
    if (reasons && !anyTeacher && group.eligible.length) reasons.noTeacher++
  }

  if (explain && count === 0) {
    // Cheap summary of why nothing fits, used for the failure explanation.
    let filled = 0
    for (const s of model.teachingSlots) {
      if (state.classBusy.has(classBase + s.day * 1000 + s.period)) filled++
    }
    reasons.classBusySlots = filled
    reasons.totalSlots = model.teachingSlots.length
  }

  return { count, values, reasons }
}

function adjacentDifficult(model, state, classIdx, day, period) {
  const at = state.entryAt.get(classIdx * 1000 + day)
  if (!at) return false
  const prev = model.prevTeach.get(period)
  const next = model.nextTeach.get(period)
  let entry = prev >= 0 ? at.get(prev) : undefined
  if (!entry) entry = next >= 0 ? at.get(next) : undefined
  if (!entry) return false
  const other = model.subjects.get(entry.subjectId)
  return !!(other && other.difficult)
}

/** Heuristic value ordering: lower is better. Purely a tie-breaker — it never
 *  overrides a hard constraint, and it contains no randomness. */
function scoreValue(model, state, group, tIdx, subjDayBase, day, period) {
  let score = (state.subjDay.get(subjDayBase + day) || 0) * 100
  if (model.prefs.avoidConsecutiveDifficult && group.subjDifficult &&
      adjacentDifficult(model, state, group.classIdx, day, period)) {
    score += 150
  }
  if (model.prefs.balanceClassDays) score += (state.classDay.get(group.classIdx * 1000 + day) || 0) * 8
  if (model.prefs.balanceTeacherDays) score += (state.teacherDay.get(tIdx * 1000 + day) || 0) * 6
  score += day * 0.5 + period * 0.25
  return score
}

function describeBlocker(model, group, reasons) {
  const cls = model.classes.find(c => c.id === group.classId)
  const subj = model.subjects.get(group.subjectId)
  const parts = []
  if (reasons.classBusySlots > 0) {
    parts.push(`${reasons.classBusySlots} of ${reasons.totalSlots} teaching periods for ${cls ? cls.name : group.classId} were already filled`)
  }
  if (reasons.teacherBusy) parts.push(`${reasons.teacherBusy} teacher-clash rejections`)
  if (reasons.teacherUnavailable) parts.push(`${reasons.teacherUnavailable} availability rejections`)
  if (reasons.teacherDayLimit) parts.push(`${reasons.teacherDayLimit} daily workload-limit rejections`)
  if (reasons.teacherWeekLimit) parts.push(`${reasons.teacherWeekLimit} weekly workload-limit rejections`)
  if (reasons.roomBusy) parts.push(`${reasons.roomBusy} room clashes`)
  if (reasons.roomUnavailable) parts.push(`${reasons.roomUnavailable} room unavailable slots`)
  if (reasons.noTeacher) parts.push(`${reasons.noTeacher} periods with no eligible teacher free`)
  return `Could not place ${group.remaining} remaining period(s) of ${subj ? subj.name : group.subjectId} for ${cls ? cls.name : group.classId}: ` +
    (parts.length ? parts.join('; ') + '.' : 'no compatible slot remained.')
}

// ---------------------------------------------------------------------------
// Search: forward checking + MRV, deterministic throughout
// ---------------------------------------------------------------------------

function search(model, state, stats) {
  if (stats.nodeCount >= model.options.nodeBudget) {
    stats.aborted = 'node_budget'
    return false
  }
  if (Date.now() >= stats.deadline) {
    stats.aborted = 'time_budget'
    return false
  }

  // Forward checking: pick the requirement with the fewest options (MRV). If any
  // requirement has none, this branch is provably dead — report it upward.
  // Domain sizes are cached and invalidated precisely (same class / teacher /
  // room), so a node normally recomputes only the handful that changed.
  let bestGroup = null
  let bestCount = Infinity
  let deadGroup = null

  for (const group of state.groups) {
    if (group.remaining <= 0) continue
    if ((state.classBusyCount.get(group.classIdx) || 0) >= model.teachingSlots.length) {
      deadGroup = group
      break
    }
    if (group.feasible === null) {
      group.feasible = computeDomain(model, state, group, 'count').count
    }
    if (group.feasible === 0) {
      deadGroup = group
      break
    }
    if (group.feasible < bestCount) {
      bestCount = group.feasible
      bestGroup = group
      if (bestCount === 1) break // cannot be beaten
    }
  }

  if (deadGroup) {
    const { reasons } = computeDomain(model, state, deadGroup, 'explain')
    const importance = deadGroup.remaining
    if (!stats.blocker || importance > stats.blocker.importance) {
      stats.blocker = { group: deadGroup, importance }
      stats.blocker.message = describeBlocker(model, deadGroup, { ...reasons, importance })
    }
    return false
  }

  if (!bestGroup) return true // everything is scheduled

  stats.nodeCount++
  const { values: bestValues } = computeDomain(model, state, bestGroup, 'build')
  bestValues.sort((a, b) =>
    a.score - b.score ||
    a.day - b.day ||
    a.period - b.period ||
    (a.teacherId < b.teacherId ? -1 : a.teacherId > b.teacherId ? 1 : 0))

  for (const value of bestValues) {
    const entry = {
      classId: bestGroup.classId,
      day: value.day,
      period: value.period,
      subjectId: bestGroup.subjectId,
      teacherId: value.teacherId,
      roomId: bestGroup.roomId || undefined,
      locked: false
    }
    applyPlacement(model, state, entry)
    state.entries.push(entry)
    bestGroup.remaining--

    if (search(model, state, stats)) return true

    bestGroup.remaining++
    state.entries.pop()
    undoPlacement(model, state, entry)

    if (stats.aborted) return false
  }
  return false
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

function generateTimetable(rawInput, options = {}) {
  const started = Date.now()
  const stats = {
    generationMs: 0,
    nodeCount: 0,
    requiredLessons: 0,
    scheduledLessons: 0,
    completenessPct: 0,
    aborted: null
  }

  const { model, errors } = buildModel(rawInput, options)
  if (errors.length) {
    stats.generationMs = Date.now() - started
    return {
      ok: false, entries: [], stats, violations: [], softPenalties: [],
      diagnostics: errors, score: 0
    }
  }

  const requiredTotal = model.requirements.reduce((sum, r) => sum + (Number.isFinite(r.count) ? r.count : 0), 0)
  stats.requiredLessons = requiredTotal

  const diagnostics = preflight(model)
  if (diagnostics.length) {
    stats.generationMs = Date.now() - started
    stats.scheduledLessons = 0
    stats.completenessPct = 0
    return {
      ok: false, entries: [], stats, violations: [], softPenalties: [],
      diagnostics, score: 0
    }
  }

  const state = createState(model)
  const placedByLock = state.entries.length
  stats.scheduledLessons = placedByLock

  const searchStats = { nodeCount: 0, aborted: null, blocker: null, deadline: Date.now() + model.options.timeBudgetMs }
  const solved = search(model, state, searchStats)
  stats.nodeCount = searchStats.nodeCount
  stats.aborted = searchStats.aborted
  stats.generationMs = Date.now() - started

  const entries = [...state.entries].sort((a, b) =>
    a.classId.localeCompare(b.classId) || a.day - b.day || a.period - b.period)

  stats.scheduledLessons = entries.length
  stats.completenessPct = requiredTotal === 0
    ? 100
    : Math.round((entries.length / requiredTotal) * 10000) / 100

  // The independent verdict. ok requires a complete schedule AND a clean report.
  const report = validateTimetable(rawInput, entries)
  const complete = entries.length === requiredTotal && stats.completenessPct === 100

  const failureDiagnostics = []
  if (!solved) {
    if (stats.aborted === 'node_budget') {
      failureDiagnostics.push({
        code: 'S_SEARCH_BUDGET',
        message: `Generation stopped after exploring ${stats.nodeCount} placement options without finding a complete timetable. The configuration is very tight — reduce required periods or relax availability.`
      })
    } else if (stats.aborted === 'time_budget') {
      failureDiagnostics.push({
        code: 'S_TIME_BUDGET',
        message: `Generation ran for ${model.options.timeBudgetMs} ms without finishing. The configuration is very tight — reduce required periods or relax availability.`
      })
    }
    if (searchStats.blocker) {
      failureDiagnostics.push({ code: 'S_NO_FEASIBLE_SLOT', message: searchStats.blocker.message, detail: null })
    }
    if (!failureDiagnostics.length) {
      failureDiagnostics.push({
        code: 'S_UNSCHEDULABLE',
        message: 'No valid timetable exists for this configuration. The requirements over-subscribe at least one class, teacher or room.'
      })
    }
    if (stats.scheduledLessons < requiredTotal) {
      failureDiagnostics.push({
        code: 'S_INCOMPLETE',
        message: `${stats.scheduledLessons} of ${requiredTotal} required lessons were scheduled; ${requiredTotal - stats.scheduledLessons} could not be placed.`,
        detail: { scheduled: stats.scheduledLessons, required: requiredTotal }
      })
    }
  }

  for (const violation of report.hard) {
    failureDiagnostics.push({ code: violation.code, message: violation.message, detail: violation.detail })
  }

  const ok = solved && complete && report.ok

  return {
    ok,
    entries,
    stats,
    violations: report.hard,
    softPenalties: report.soft,
    diagnostics: failureDiagnostics,
    score: report.score
  }
}

module.exports = { generateTimetable, preflight, buildModel, DEFAULT_OPTIONS }
