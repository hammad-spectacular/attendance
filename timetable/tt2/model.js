'use strict'

/**
 * tt2 — model layer.
 *
 * Translates the wizard's answers into the plain configuration object that
 * `timetable/solver.js` and `timetable/validator.js` understand, and translates
 * the solver's output back into a renderable grid.
 *
 * Coordinate convention (important — the solver and the validator both index
 * `period` against the FULL column list, breaks included):
 *
 *   period        = index into the full column list (0-based)  <- canonical
 *   teachingNumber = 1..periodCount, teaching periods only   <- for display
 *
 * `buildPeriods()` produces the `teachingIndex` map that converts between the
 * two. Every grid cell carries BOTH so the UI can render "P3" while the solver
 * keeps using raw column indices.
 *
 * Everything here is pure and dependency-free so it can be unit tested without
 * a server, a database, or a browser.
 */

const { normaliseConfig } = require('./wizard')

// ---------------------------------------------------------------------------
// Periods, breaks and time labels
// ---------------------------------------------------------------------------

/**
 * Build the full column list for one day.
 *
 * Teaching periods are numbered 1..periodCount. Breaks are inserted after the
 * teaching period named by `break.afterPeriod`, so they occupy their own
 * column but never count towards the "how many periods" answer.
 *
 * @returns {{periods: Array, teachingIndex: Object<string, number>}}
 *          `teachingIndex` maps a 1-based teaching period number to its index
 *          inside the full column list.
 */
function buildPeriods(rawConfig) {
  const config = normaliseConfig(rawConfig)
  const periods = []
  const teachingIndex = {}

  const breaksByAfter = new Map()
  for (const b of config.breaks) {
    if (b.afterPeriod < 1 || b.afterPeriod > config.periodCount) continue
    if (!breaksByAfter.has(b.afterPeriod)) breaksByAfter.set(b.afterPeriod, [])
    breaksByAfter.get(b.afterPeriod).push(b)
  }

  for (let i = 1; i <= config.periodCount; i++) {
    teachingIndex[String(i)] = periods.length
    const override = config.periodOverrides[String(i)]
    periods.push({
      index: periods.length,
      label: `P${i}`,
      kind: 'teaching',
      teachingNumber: i,
      duration: override && override > 0 ? override : config.periodDuration
    })

    for (const b of breaksByAfter.get(i) || []) {
      periods.push({
        index: periods.length,
        label: b.label,
        kind: 'break',
        teachingNumber: null,
        duration: b.duration
      })
    }
  }

  return { periods, teachingIndex }
}

/** "08:00" -> minutes past midnight. */
function parseClock(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim())
  if (!match) return 8 * 60
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 8 * 60
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return 8 * 60
  return hours * 60 + minutes
}

/** 480 -> "8:00 AM" */
function formatClock(minutes) {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440
  const hours = Math.floor(total / 60)
  const mins = total % 60
  const suffix = hours >= 12 ? 'PM' : 'AM'
  const displayHour = hours % 12 === 0 ? 12 : hours % 12
  return mins === 0 ? `${displayHour}:00 ${suffix}` : `${displayHour}:${String(mins).padStart(2, '0')} ${suffix}`
}

/**
 * Compute the clock range of every column for one day.
 * @returns {Array<{index:number,label:string,kind:string,duration:number,start:number,end:number,text:string}>}
 */
function buildTimeLabels(rawConfig) {
  const config = normaliseConfig(rawConfig)
  const { periods } = buildPeriods(config)
  let cursor = parseClock(config.startTime)

  return periods.map(p => {
    const start = cursor
    const end = start + p.duration
    cursor = end
    return {
      index: p.index,
      label: p.label,
      kind: p.kind,
      teachingNumber: p.teachingNumber,
      duration: p.duration,
      start,
      end,
      text: `${formatClock(start)} – ${formatClock(end)}`
    }
  })
}

// ---------------------------------------------------------------------------
// Solver input
// ---------------------------------------------------------------------------

/**
 * Build the plain object the solver consumes.
 *
 * @param {object} rawConfig
 * @param {object} [opts]
 * @param {Array} [opts.locks] manual, pinned cells from the grid editor.
 *        Each lock carries `classId`, `day` (day index), `teachingNumber`
 *        (1-based) and the chosen subject/teacher.
 */
function buildSolverInput(rawConfig, opts = {}) {
  const config = normaliseConfig(rawConfig)
  const { periods, teachingIndex } = buildPeriods(config)

  const solverInput = {
    days: config.days.slice(),
    periods: periods.map(p => ({ label: p.label, kind: p.kind })),
    classes: config.classes.map(c => ({ id: c.id, name: c.name })),
    subjects: config.subjects.map(s => ({
      id: s.id,
      name: s.name,
      difficult: s.difficult === 'difficult'
    })),
    teachers: config.teachers.map(t => ({
      id: t.id,
      name: t.name,
      subjectIds: t.subjectIds.slice(),
      maxPerDay: t.maxPerDay,
      maxPerWeek: t.maxPerWeek,
      // The solver wants a day/period pair; period is a COLUMN INDEX.
      unavailableSlots: t.unavailableSlots
        .filter(s => teachingIndex[String(s.period)] !== undefined)
        .map(s => ({
          day: config.days[s.day] || s.day,
          period: teachingIndex[String(s.period)]
        }))
    })),
    rooms: config.rooms.map(r => ({ id: r.id, name: r.name })),
    requirements: config.curriculum
      .filter(r => r.periodsPerWeek > 0)
      .map(r => ({
        classId: r.classId,
        subjectId: r.subjectId,
        periodsPerWeek: r.periodsPerWeek,
        teacherIds: r.teacherIds.length ? r.teacherIds.slice() : undefined
      })),
    locks: [],
    preferences: {
      maxSameSubjectPerDay: config.preferences.maxSameSubjectPerDay,
      avoidConsecutiveDifficult: config.preferences.avoidConsecutiveDifficult,
      balanceClassDays: config.preferences.balanceClassDays,
      balanceTeacherDays: config.preferences.balanceTeacherDays
    }
  }

  // Manual pins become solver locks so a hand-placed lesson survives a re-run.
  for (const lock of opts.locks || []) {
    if (!lock || !lock.subjectId || !lock.classId) continue
    const day = Number(lock.day)
    const column = teachingIndex[String(Number(lock.teachingNumber))]
    if (!Number.isFinite(day) || column === undefined) continue

    solverInput.locks.push({
      classId: lock.classId,
      subjectId: lock.subjectId,
      teacherId: lock.teacherId || '',
      roomId: lock.roomId || null,
      day: config.days[day] || day,
      period: column
    })
  }

  return solverInput
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

/** Cell key used everywhere in the grid: class + day + column index. */
function cellKey(classId, day, column) {
  return `${classId}|${day}|${column}`
}

/**
 * Merge solver entries and manual cells into a per-class grid.
 *
 * Manual cells win over solver output for the same slot — the user dragged
 * something into place, that is the truth.
 *
 * @returns {Object<string, Object<string, object>>} grids keyed by classId
 */
function buildGrids(rawConfig, entries, manualCells) {
  const config = normaliseConfig(rawConfig)
  const { periods } = buildPeriods(config)

  const grids = {}
  for (const cls of config.classes) grids[cls.id] = {}

  for (const entry of entries || []) {
    const grid = grids[entry.classId]
    if (!grid) continue
    const column = Number(entry.period)
    const period = periods[column]
    if (!period || period.kind !== 'teaching') continue
    const key = cellKey(entry.classId, entry.day, column)
    grid[key] = {
      classId: entry.classId,
      day: Number(entry.day),
      period: column,
      teachingNumber: period.teachingNumber,
      subjectId: entry.subjectId,
      teacherId: entry.teacherId || null,
      roomId: entry.roomId || null,
      locked: false,
      manual: false
    }
  }

  for (const [key, cell] of Object.entries(manualCells || {})) {
    const grid = grids[cell.classId]
    if (!grid) continue
    if (cell.cleared) {
      delete grid[key]
      continue
    }
    const column = Number(cell.period)
    const period = periods[column]
    grid[key] = {
      ...cell,
      day: Number(cell.day),
      period: column,
      teachingNumber: period ? period.teachingNumber : cell.teachingNumber,
      locked: true,
      manual: true
    }
  }

  return grids
}

/**
 * Turn a grid into the flat entry list the validator understands.
 */
function gridToEntries(grids) {
  const entries = []
  for (const grid of Object.values(grids || {})) {
    for (const cell of Object.values(grid || {})) {
      if (!cell.subjectId) continue
      entries.push({
        classId: cell.classId,
        day: Number(cell.day),
        period: Number(cell.period),
        subjectId: cell.subjectId,
        teacherId: cell.teacherId || '',
        roomId: cell.roomId || null
      })
    }
  }
  entries.sort((a, b) =>
    String(a.classId).localeCompare(String(b.classId)) || a.day - b.day || a.period - b.period)
  return entries
}

/**
 * Collect the manual pins so they can be handed back to the solver as locks.
 */
function collectLocks(grids) {
  const locks = []
  for (const grid of Object.values(grids || {})) {
    for (const cell of Object.values(grid || {})) {
      if (!cell.locked || !cell.subjectId) continue
      locks.push({
        classId: cell.classId,
        day: Number(cell.day),
        teachingNumber: cell.teachingNumber,
        subjectId: cell.subjectId,
        teacherId: cell.teacherId || null,
        roomId: cell.roomId || null
      })
    }
  }
  return locks
}

module.exports = {
  buildPeriods,
  buildTimeLabels,
  buildSolverInput,
  buildGrids,
  gridToEntries,
  collectLocks,
  cellKey,
  parseClock,
  formatClock
}
