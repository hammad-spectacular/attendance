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

const { normaliseConfig, ALL_DAYS } = require('./wizard')

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
 * Build column and time list for a specific day.
 * If dayTimingMode is 'custom' and dayOverrides has settings for this day,
 * it uses that day's duration and break timing.
 */
function buildDayPeriods(rawConfig, dayName) {
  const config = normaliseConfig(rawConfig)
  const isCustom = config.dayTimingMode === 'custom' &&
    config.dayOverrides &&
    dayName &&
    config.dayOverrides[dayName]
  const dVal = isCustom ? config.dayOverrides[dayName] : null

  const periodDuration = (dVal && dVal.periodDuration > 0) ? dVal.periodDuration : config.periodDuration
  const startTime = (dVal && dVal.startTime) ? dVal.startTime : config.startTime
  const breakDuration = (dVal && dVal.breakDuration !== undefined) ? dVal.breakDuration : null

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
      duration: override && override > 0 ? override : periodDuration
    })

    for (const b of breaksByAfter.get(i) || []) {
      periods.push({
        index: periods.length,
        label: b.label,
        kind: 'break',
        teachingNumber: null,
        duration: breakDuration !== null ? breakDuration : b.duration
      })
    }
  }

  let cursor = parseClock(startTime)
  const labelledPeriods = periods.map(p => {
    const start = cursor
    const end = start + p.duration
    cursor = end
    return {
      ...p,
      start,
      end,
      text: `${formatClock(start)} – ${formatClock(end)}`
    }
  })

  return {
    periods: labelledPeriods,
    teachingIndex,
    startTime: formatClock(parseClock(startTime)),
    endTime: formatClock(cursor),
    isCustom: Boolean(isCustom)
  }
}

/**
 * Compute the clock range of every column for one day.
 * @returns {Array<{index:number,label:string,kind:string,duration:number,start:number,end:number,text:string}>}
 */
function buildTimeLabels(rawConfig, dayName) {
  if (dayName) {
    return buildDayPeriods(rawConfig, dayName).periods
  }
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
// PHASE 1: Date-aware timing resolution
// ---------------------------------------------------------------------------

/**
 * Resolve timing configuration for a specific date.
 * Priority: date override > recurring day override > default
 *
 * @param {object} rawConfig
 * @param {string} dateString - YYYY-MM-DD format
 * @returns {{timing: object, source: 'date'|'recurring'|'default'}}
 */
function resolveTiming(rawConfig, dateString) {
  const config = normaliseConfig(rawConfig)

  // 1. Check date-specific override (highest priority)
  if (config.dateOverrides && config.dateOverrides[dateString]) {
    return {
      timing: config.dateOverrides[dateString],
      source: 'date'
    }
  }

  // 2. Check recurring day override
  const date = new Date(dateString)
  const dayIndex = date.getDay() // 0 = Sunday, 1 = Monday, etc.
  // Map Date.getDay() to ALL_DAYS index (Monday=0 in ALL_DAYS, but getDay()=1 for Monday)
  const dayMapping = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 0: null } // Sunday maps to null (not in ALL_DAYS)
  const allDaysIndex = dayMapping[dayIndex]
  const dayName = allDaysIndex !== null ? ALL_DAYS[allDaysIndex] : null

  if (dayName && config.dayTimingMode === 'custom' && config.dayOverrides && config.dayOverrides[dayName]) {
    return {
      timing: config.dayOverrides[dayName],
      source: 'recurring'
    }
  }

  // 3. Use default timing
  return {
    timing: {
      periodDuration: config.periodDuration,
      startTime: config.startTime,
      breakDuration: null
    },
    source: 'default'
  }
}

/**
 * Build periods for a specific calendar date with date-aware timing.
 * Uses priority: date override > recurring day override > default
 *
 * @param {object} rawConfig
 * @param {string} dateString - YYYY-MM-DD format
 * @returns {{periods: Array, teachingIndex: Object, source: string, startTime: string, endTime: string}}
 */
function buildPeriodsForDate(rawConfig, dateString) {
  const config = normaliseConfig(rawConfig)
  const { timing, source } = resolveTiming(config, dateString)

  const periodDuration = timing.periodDuration
  const startTime = timing.startTime
  const breakDuration = timing.breakDuration

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
      duration: override && override > 0 ? override : periodDuration
    })

    for (const b of breaksByAfter.get(i) || []) {
      periods.push({
        index: periods.length,
        label: b.label,
        kind: 'break',
        teachingNumber: null,
        duration: breakDuration !== null ? breakDuration : b.duration
      })
    }
  }

  let cursor = parseClock(startTime)
  const labelledPeriods = periods.map(p => {
    const start = cursor
    const end = start + p.duration
    cursor = end
    return {
      ...p,
      start,
      end,
      text: `${formatClock(start)} – ${formatClock(end)}`
    }
  })

  return {
    periods: labelledPeriods,
    teachingIndex,
    source,
    startTime: formatClock(parseClock(startTime)),
    endTime: formatClock(cursor)
  }
}

// ---------------------------------------------------------------------------
// PHASE 1: Locked lesson validation
// ---------------------------------------------------------------------------

/**
 * Verify that locked cells remain valid after timing changes.
 * Returns { valid: boolean, invalidCells: [], warnings: [] }
 *
 * @param {object} rawConfig - The new config with timing changes
 * @param {object} grids - Existing timetable grids with locked cells
 * @param {Array} oldPeriods - Period structure before timing change
 * @param {Array} newPeriods - Period structure after timing change
 * @returns {{valid: boolean, invalidCells: Array, warnings: Array}}
 */
function validateLockedCells(rawConfig, grids, oldPeriods, newPeriods) {
  const invalidCells = []
  const warnings = []

  for (const grid of Object.values(grids || {})) {
    for (const [key, cell] of Object.entries(grid || {})) {
      if (!cell.locked) continue
      
      const oldPeriod = oldPeriods[cell.period]
      const newPeriod = newPeriods[cell.period]
      
      // Check if period still exists
      if (!newPeriod) {
        invalidCells.push({
          cell,
          reason: `Period ${cell.teachingNumber} no longer exists after timing change`
        })
        continue
      }
      
      // Check if period kind changed (teaching -> break)
      if (oldPeriod && oldPeriod.kind === 'teaching' && newPeriod.kind !== 'teaching') {
        invalidCells.push({
          cell,
          reason: `Period ${cell.teachingNumber} is now a ${newPeriod.kind}, not a teaching period`
        })
        continue
      }
      
      // Warning if duration changed significantly (more than 10 minutes)
      if (oldPeriod && newPeriod && Math.abs(oldPeriod.duration - newPeriod.duration) > 10) {
        warnings.push({
          cell,
          reason: `Period duration changed from ${oldPeriod.duration} to ${newPeriod.duration} minutes`
        })
      }
    }
  }
  
  return {
    valid: invalidCells.length === 0,
    invalidCells,
    warnings
  }
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
    classes: config.classes.map(c => ({ id: c.id, name: c.name, section: c.section || null })),
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
  buildDayPeriods,
  buildTimeLabels,
  buildSolverInput,
  buildGrids,
  gridToEntries,
  collectLocks,
  cellKey,
  parseClock,
  formatClock,
  resolveTiming,
  buildPeriodsForDate,
  validateLockedCells
}
