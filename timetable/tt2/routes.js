'use strict'

/**
 * tt2 — API routes.
 *
 * Exports a ROUTER FACTORY, not a server. The identical router runs in the
 * standalone dev server (tt2/dev-server.js) and can be mounted inside The Eye
 * later. Authentication is INJECTED, never duplicated:
 *
 *   app.use('/api/tt2', requireAuth(ROLES), createTt2Router({ store, ... }))
 *
 * Conventions mirrored from serverg.js and timetable/routes.js:
 *   - res.status(4xx).json({ error }) for failures, JSON for everything
 *   - tenant scope comes from req.user.tenant_id, never from the request body
 *   - the dev server mounts with `devAuth: true`, which means NO auth runs and
 *     every request is attributed to a single development tenant
 *
 * The timetable ENGINE is not re-implemented here: tt2 reuses
 * timetable/solver.js and timetable/validator.js directly.
 */

const { generateTimetable } = require('../solver')
const { validateTimetable } = require('../validator')
const { STEPS, ALL_DAYS, DIFFICULTIES, defaultConfig, normaliseConfig, validateConfig } = require('./wizard')
const {
  buildPeriods,
  buildDayPeriods,
  buildTimeLabels,
  buildSolverInput,
  buildGrids,
  gridToEntries,
  collectLocks,
  cellKey
} = require('./model')

const READ_ROLES = ['super_admin', 'admin', 'coordinator', 'teacher']
const WRITE_ROLES = ['super_admin', 'admin', 'coordinator']

const DEFAULT_GENERATE_OPTIONS = { nodeBudget: 300000, timeBudgetMs: 8000 }
const MAX_GENERATE_OPTIONS = { nodeBudget: 2000000, timeBudgetMs: 20000 }

function asArray(value) {
  if (Array.isArray(value)) return value
  if (value === null || value === undefined) return []
  return [value]
}

/** The tenant a request belongs to. In dev mode there is exactly one. */
function tenantOf(req, devAuth) {
  if (devAuth) return 'dev'
  return (req.user && req.user.tenant_id) || null
}

// ---------------------------------------------------------------------------
// Teacher helpers — used to place a lesson by hand without double-booking
// ---------------------------------------------------------------------------

/**
 * Teachers qualified for a subject, honouring a curriculum row that pins
 * specific teachers. Falls back to every qualified teacher when no pin is set.
 */
function qualifiedTeachers(config, subjectId, classId) {
  const all = config.teachers.filter(t => t.subjectIds.includes(subjectId))
  const req = config.curriculum.find(r => r.classId === classId && r.subjectId === subjectId)
  if (req && req.teacherIds.length) {
    const pinned = all.filter(t => req.teacherIds.includes(t.id))
    if (pinned.length) return pinned
  }
  return all
}

/** Is this teacher already teaching another class in this slot? */
function teacherBusy(grids, teacherId, day, column, ignoreKey) {
  for (const grid of Object.values(grids || {})) {
    for (const [key, cell] of Object.entries(grid || {})) {
      if (key === ignoreKey) continue
      if (!cell.teacherId || cell.teacherId !== teacherId) continue
      if (Number(cell.day) === Number(day) && Number(cell.period) === Number(column)) return true
    }
  }
  return false
}

/** Is the teacher marked unavailable for this day/period? */
function teacherUnavailable(config, teacher, day, column) {
  const { teachingIndex } = buildPeriods(config)
  const teachingNumber = Object.keys(teachingIndex)
    .find(k => teachingIndex[k] === column)
  if (teachingNumber === undefined) return false
  return teacher.unavailableSlots.some(s =>
    Number(s.day) === Number(day) && Number(s.period) === Number(teachingNumber))
}

/** How many lessons a teacher already has, overall and on the given day. */
function teacherLoad(grids, teacherId, day) {
  let week = 0
  let onDay = 0
  for (const grid of Object.values(grids || {})) {
    for (const cell of Object.values(grid || {})) {
      if (!cell.teacherId || cell.teacherId !== teacherId) continue
      week += 1
      if (Number(cell.day) === Number(day)) onDay += 1
    }
  }
  return { week, onDay }
}

/**
 * Choose the least-loaded qualified teacher who is free in the slot.
 * @returns {{teacher: object|null, reason: string}}
 */
function pickTeacher(config, subjectId, classId, day, column, grids, ignoreKey) {
  const candidates = qualifiedTeachers(config, subjectId, classId)
  if (!candidates.length) {
    return { teacher: null, reason: `No teacher is qualified for this subject.` }
  }

  const free = []
  let unavailable = 0
  let busy = 0
  let overCap = 0

  for (const teacher of candidates) {
    if (teacherUnavailable(config, teacher, day, column)) { unavailable += 1; continue }
    if (teacherBusy(grids, teacher.id, day, column, ignoreKey)) { busy += 1; continue }
    const load = teacherLoad(grids, teacher.id, day)
    if (teacher.maxPerDay !== null && load.onDay >= teacher.maxPerDay) { overCap += 1; continue }
    if (teacher.maxPerWeek !== null && load.week >= teacher.maxPerWeek) { overCap += 1; continue }
    free.push({ teacher, load })
  }

  if (!free.length) {
    const reasons = []
    if (unavailable) reasons.push(`${unavailable} marked unavailable`)
    if (busy) reasons.push(`${busy} already teaching another class`)
    if (overCap) reasons.push(`${overCap} already at their workload limit`)
    return {
      teacher: null,
      reason: `Every qualified teacher is unavailable (${reasons.join(', ') || 'no candidates'}).`
    }
  }

  free.sort((a, b) => a.load.week - b.load.week || a.load.onDay - b.load.onDay)
  return { teacher: free[0].teacher, reason: '' }
}

// ---------------------------------------------------------------------------
// Document shaping
// ---------------------------------------------------------------------------

/** Everything the client needs to render one timetable document. */
function describeDocument(doc) {
  const config = normaliseConfig(doc.config)
  const periods = buildTimeLabels(config)
  const dayPeriods = {}
  for (const day of config.days) {
    dayPeriods[day] = buildDayPeriods(config, day)
  }
  const solverInput = buildSolverInput(config)
  const entries = gridToEntries(doc.grids)
  const validation = validateTimetable(solverInput, entries)

  return {
    id: doc.id,
    name: doc.name,
    config,
    grids: doc.grids || {},
    report: doc.report || null,
    periods,
    dayPeriods,
    days: config.days,
    validation: {
      ok: validation.ok,
      hard: validation.hard,
      soft: validation.soft,
      score: validation.score,
      totals: validation.totals
    },
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    generatedAt: doc.generatedAt || null
  }
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

/**
 * @param {{ store: object,
 *           auth?: Function|Function[],
 *           devAuth?: boolean,
 *           featureEnabled?: (tenantId: string) => (boolean|Promise<boolean>),
 *           guards?: Function[] }} options
 */
function createTt2Router(options = {}) {
  const express = require('express')
  const { store } = options
  if (!store) throw new Error('createTt2Router requires a store')

  const devAuth = options.devAuth === true
  const authChain = asArray(options.auth || [])
  if (!devAuth && !authChain.length) {
    throw new Error('createTt2Router requires an auth middleware unless devAuth is set')
  }

  const router = express.Router()
  const guards = asArray(options.guards || [])
  const featureEnabled = typeof options.featureEnabled === 'function' ? options.featureEnabled : null

  // -- meta is public: it only describes the wizard ------------------------
  router.get('/meta', (req, res) => {
    res.json({
      ok: true,
      steps: STEPS,
      defaults: defaultConfig(),
      allDays: ALL_DAYS,
      difficulties: DIFFICULTIES,
      devAuth
    })
  })

  // -- everything below is gated -------------------------------------------
  router.use((req, res, next) => {
    if (devAuth) return next()
    let idx = 0
    const runAuth = (err) => {
      if (err) return next(err)
      if (res.headersSent) return
      if (idx < authChain.length) {
        const middleware = authChain[idx++]
        return middleware(req, res, runAuth)
      }
      return next()
    }
    return runAuth()
  })

  router.use((req, res, next) => {
    if (!featureEnabled) return next()
    Promise.resolve(featureEnabled(tenantOf(req, devAuth)))
      .then(enabled => {
        if (enabled) return next()
        return res.status(403).json({ error: 'The timetable feature is not enabled for this school.' })
      })
      .catch(next)
  })

  for (const guard of guards) {
    router.use(guard)
  }

  router.get('/existing-classes', async (req, res) => {
    if (Array.isArray(options.mockClasses)) {
      return res.json({ ok: true, classes: options.mockClasses })
    }
    try {
      let pool = options.pool
      if (!pool) {
        try { pool = require('../../db') } catch (_) {}
      }
      if (pool) {
        const tenantId = tenantOf(req, devAuth)
        let q = null
        if (tenantId && tenantId !== 'dev') {
          q = await pool.query(
            'SELECT id, name, section FROM classes WHERE tenant_id = $1 ORDER BY name, section, id',
            [tenantId]
          )
        } else {
          // Dev / devAuth mode: look for classes for 'dev' or fetch existing school classes
          q = await pool.query(
            'SELECT id, name, section FROM classes WHERE tenant_id = $1 ORDER BY name, section, id',
            ['dev']
          )
          if (!q.rows || !q.rows.length) {
            q = await pool.query(
              'SELECT id, name, section FROM classes ORDER BY name, section, id LIMIT 100'
            )
          }
        }
        if (q && q.rows && q.rows.length) {
          return res.json({ ok: true, classes: q.rows })
        }
      }
    } catch (err) {
      console.warn('[tt2] /existing-classes query error:', err.message)
    }
    res.json({ ok: true, classes: [] })
  })

  // -- list / create -------------------------------------------------------

  router.get('/timetables', (req, res) => {
    res.json({ ok: true, timetables: store.list(tenantOf(req, devAuth)) })
  })

  router.post('/timetables', (req, res) => {
    const body = req.body || {}
    const config = normaliseConfig(body.config)
    const doc = store.create({
      tenantId: tenantOf(req, devAuth),
      name: body.name,
      config
    })
    res.status(201).json({ ok: true, timetable: describeDocument(doc) })
  })

  // -- read one ------------------------------------------------------------

  router.get('/timetables/:id', (req, res) => {
    const doc = store.get(tenantOf(req, devAuth), req.params.id)
    if (!doc) return res.status(404).json({ error: 'Timetable not found.' })
    res.json({ ok: true, timetable: describeDocument(doc) })
  })

  // -- update config / name ------------------------------------------------

  router.put('/timetables/:id', (req, res) => {
    const tenantId = tenantOf(req, devAuth)
    const doc = store.get(tenantId, req.params.id)
    if (!doc) return res.status(404).json({ error: 'Timetable not found.' })

    const body = req.body || {}
    const patch = {}
    if (body.name !== undefined) patch.name = String(body.name)
    if (body.config !== undefined) patch.config = normaliseConfig(body.config)

    const updated = store.update(tenantId, req.params.id, patch)
    res.json({ ok: true, timetable: describeDocument(updated) })
  })

  router.delete('/timetables/:id', (req, res) => {
    const removed = store.remove(tenantOf(req, devAuth), req.params.id)
    if (!removed) return res.status(404).json({ error: 'Timetable not found.' })
    res.json({ ok: true })
  })

  // -- live readiness check for the wizard ----------------------------------
  // The browser never re-implements the validation rules: it posts the current
  // answers here and renders whatever comes back.

  router.post('/check', (req, res) => {
    const body = req.body || {}
    const config = normaliseConfig(body.config)
    const check = validateConfig(config)
    res.json({
      ok: true,
      errors: check.errors,
      warnings: check.warnings,
      canGenerate: check.canGenerate
    })
  })

  // -- validation without generating ---------------------------------------

  router.post('/timetables/:id/validate', (req, res) => {
    const tenantId = tenantOf(req, devAuth)
    const doc = store.get(tenantId, req.params.id)
    if (!doc) return res.status(404).json({ error: 'Timetable not found.' })

    const config = normaliseConfig(doc.config)
    const check = validateConfig(config)
    const described = describeDocument(doc)
    res.json({
      ok: true,
      config: check,
      validation: described.validation
    })
  })

  // -- generate ------------------------------------------------------------

  router.post('/timetables/:id/generate', (req, res) => {
    const tenantId = tenantOf(req, devAuth)
    const doc = store.get(tenantId, req.params.id)
    if (!doc) return res.status(404).json({ error: 'Timetable not found.' })

    const config = normaliseConfig(doc.config)
    const check = validateConfig(config)
    if (!check.canGenerate) {
      return res.status(400).json({
        error: 'The timetable is not ready to generate yet.',
        errors: check.errors,
        warnings: check.warnings
      })
    }

    const body = req.body || {}
    const requested = body.options || {}
    const generateOptions = {
      nodeBudget: Math.min(MAX_GENERATE_OPTIONS.nodeBudget,
        Math.max(1, Number(requested.nodeBudget) || DEFAULT_GENERATE_OPTIONS.nodeBudget)),
      timeBudgetMs: Math.min(MAX_GENERATE_OPTIONS.timeBudgetMs,
        Math.max(50, Number(requested.timeBudgetMs) || DEFAULT_GENERATE_OPTIONS.timeBudgetMs))
    }

    // Manual pins become solver locks so hand-placed lessons survive.
    const locks = collectLocks(doc.grids)
    const solverInput = buildSolverInput(config, { locks })

    const result = generateTimetable(solverInput, generateOptions)

    // Manual cells are re-applied over the solver output (a solver lock may
    // have moved a lesson elsewhere, the user's pin wins).
    const manualCells = {}
    for (const grid of Object.values(doc.grids || {})) {
      for (const [key, cell] of Object.entries(grid || {})) {
        if (cell.locked) manualCells[key] = cell
      }
    }
    const merged = buildGrids(config, result.entries, manualCells)

    const report = {
      ok: result.ok,
      stats: result.stats,
      violations: result.violations || [],
      softPenalties: result.softPenalties || [],
      diagnostics: result.diagnostics || [],
      score: result.score
    }

    const updated = store.update(tenantId, req.params.id, {
      grids: merged,
      report,
      generatedAt: new Date().toISOString()
    })

    res.json({ ok: true, timetable: describeDocument(updated), report })
  })

  // -- manual placement ----------------------------------------------------

  router.post('/timetables/:id/place', (req, res) => {
    const tenantId = tenantOf(req, devAuth)
    const doc = store.get(tenantId, req.params.id)
    if (!doc) return res.status(404).json({ error: 'Timetable not found.' })

    const body = req.body || {}
    const config = normaliseConfig(doc.config)
    const { periods } = buildPeriods(config)

    const classId = String(body.classId || '')
    const subjectId = String(body.subjectId || '')
    const day = Number(body.day)
    const column = Number(body.period)

    if (!config.classes.some(c => c.id === classId)) {
      return res.status(400).json({ error: 'Unknown class.' })
    }
    if (!config.subjects.some(s => s.id === subjectId)) {
      return res.status(400).json({ error: 'Unknown subject.' })
    }
    if (!Number.isInteger(day) || day < 0 || day >= config.days.length) {
      return res.status(400).json({ error: 'Unknown day.' })
    }
    if (!Number.isInteger(column) || !periods[column]) {
      return res.status(400).json({ error: 'Unknown period.' })
    }
    if (periods[column].kind !== 'teaching') {
      return res.status(400).json({ error: `"${periods[column].label}" is a break, not a teaching period.` })
    }

    const key = cellKey(classId, day, column)

    // Placing into a slot that already holds a lesson REPLACES it — the user
    // clicked that cell and chose a subject, so the previous occupant goes.
    // The old teacher is freed automatically because the cell is overwritten.

    // Teacher: honour an explicit choice, otherwise pick the least loaded.
    let teacher = null
    let reason = ''
    if (body.teacherId) {
      teacher = config.teachers.find(t => t.id === String(body.teacherId)) || null
      if (!teacher) return res.status(400).json({ error: 'Unknown teacher.' })
      if (!teacher.subjectIds.includes(subjectId)) {
        return res.status(400).json({ error: `${teacher.name} is not qualified for that subject.` })
      }
      if (teacherBusy(doc.grids, teacher.id, day, column, key)) {
        return res.status(409).json({ error: `${teacher.name} is already teaching another class in this slot.` })
      }
      if (teacherUnavailable(config, teacher, day, column)) {
        return res.status(409).json({ error: `${teacher.name} is marked unavailable in this slot.` })
      }
    } else {
      const picked = pickTeacher(config, subjectId, classId, day, column, doc.grids, key)
      teacher = picked.teacher
      reason = picked.reason
      if (!teacher) return res.status(409).json({ error: reason })
    }

    const subject = config.subjects.find(s => s.id === subjectId)
    const cell = {
      classId,
      day,
      period: column,
      teachingNumber: periods[column].teachingNumber,
      subjectId,
      teacherId: teacher.id,
      roomId: (subject && subject.roomId) || null,
      locked: true,
      manual: true
    }

    const grids = { ...(doc.grids || {}) }
    const grid = { ...(grids[classId] || {}) }
    grid[key] = cell
    grids[classId] = grid

    const updated = store.update(tenantId, req.params.id, { grids })
    res.json({ ok: true, cell, timetable: describeDocument(updated) })
  })

  // -- clear a cell --------------------------------------------------------

  router.delete('/timetables/:id/cell', (req, res) => {
    const tenantId = tenantOf(req, devAuth)
    const doc = store.get(tenantId, req.params.id)
    if (!doc) return res.status(404).json({ error: 'Timetable not found.' })

    const body = req.body || {}
    const classId = String(body.classId || '')
    const day = Number(body.day)
    const column = Number(body.period)
    const key = cellKey(classId, day, column)

    const grids = { ...(doc.grids || {}) }
    const grid = { ...(grids[classId] || {}) }
    delete grid[key]
    grids[classId] = grid

    const updated = store.update(tenantId, req.params.id, { grids })
    res.json({ ok: true, timetable: describeDocument(updated) })
  })

  // -- date overrides -------------------------------------------------------

  /**
   * Retrieve all date-specific overrides for a timetable.
   * GET /timetables/:id/date-overrides
   */
  router.get('/timetables/:id/date-overrides', (req, res) => {
    const tenantId = tenantOf(req, devAuth)
    const doc = store.get(tenantId, req.params.id)
    if (!doc) return res.status(404).json({ error: 'Timetable not found.' })

    const config = normaliseConfig(doc.config)
    res.json({
      ok: true,
      dateOverrides: config.dateOverrides || {}
    })
  })

  /**
   * Create or update a date-specific override.
   * POST /timetables/:id/date-overrides
   */
  router.post('/timetables/:id/date-overrides', (req, res) => {
    const tenantId = tenantOf(req, devAuth)
    const doc = store.get(tenantId, req.params.id)
    if (!doc) return res.status(404).json({ error: 'Timetable not found.' })

    const body = req.body || {}
    const date = String(body.date || '').trim()
    const timing = body.timing || {}

    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Date must be in YYYY-MM-DD format.' })
    }

    // Validate date is a real calendar date
    const dateObj = new Date(date)
    if (isNaN(dateObj.getTime())) {
      return res.status(400).json({ error: 'Invalid date.' })
    }

    const config = normaliseConfig(doc.config)

    // Check if date falls on a configured school day
    // Map Date.getDay() to ALL_DAYS index (Monday=0 in ALL_DAYS, but getDay()=1 for Monday)
    const dayIndex = dateObj.getDay() // 0=Sunday, 1=Monday, ...
    const dayMapping = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 0: null }
    const allDaysIndex = dayMapping[dayIndex]
    const dayName = allDaysIndex !== null ? ALL_DAYS[allDaysIndex] : null
    if (!dayName || !config.days.includes(dayName)) {
      return res.status(400).json({
        error: `${dayName || 'Unknown'} is not a configured school day.`,
        details: `Current school days: ${config.days.join(', ')}`
      })
    }

    // Validate timing structure using the same normalisation as wizard
    const testConfig = {
      ...config,
      dateOverrides: {
        ...config.dateOverrides,
        [date]: timing
      }
    }
    const normalised = normaliseConfig(testConfig)
    const check = validateConfig(normalised)

    if (!check.canGenerate) {
      return res.status(400).json({
        error: 'Invalid timing configuration for this date.',
        details: check.errors
      })
    }

    // Apply the override (dateOverrides are separate from dayOverrides)
    const updatedConfig = {
      ...config,
      dateOverrides: {
        ...config.dateOverrides,
        [date]: normalised.dateOverrides[date]
      }
    }

    const updated = store.update(tenantId, req.params.id, { config: updatedConfig })
    res.json({
      ok: true,
      timetable: describeDocument(updated),
      dateOverrides: updatedConfig.dateOverrides
    })
  })

  /**
   * Delete a date-specific override.
   * DELETE /timetables/:id/date-overrides/:date
   */
  router.delete('/timetables/:id/date-overrides/:date', (req, res) => {
    const tenantId = tenantOf(req, devAuth)
    const doc = store.get(tenantId, req.params.id)
    if (!doc) return res.status(404).json({ error: 'Timetable not found.' })

    const date = String(req.params.date || '').trim()

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Date must be in YYYY-MM-DD format.' })
    }

    const config = normaliseConfig(doc.config)

    // Check if override exists
    if (!config.dateOverrides || !config.dateOverrides[date]) {
      return res.status(404).json({ error: 'No override found for this date.' })
    }

    // Remove the override (does not affect dayOverrides)
    const updatedConfig = {
      ...config,
      dateOverrides: { ...config.dateOverrides }
    }
    delete updatedConfig.dateOverrides[date]

    const updated = store.update(tenantId, req.params.id, { config: updatedConfig })
    res.json({
      ok: true,
      timetable: describeDocument(updated),
      dateOverrides: updatedConfig.dateOverrides
    })
  })

  /**
   * Apply timing settings to multiple selected weekdays in one request.
   * POST /timetables/:id/apply-batch-timing
   */
  router.post('/timetables/:id/apply-batch-timing', (req, res) => {
    const tenantId = tenantOf(req, devAuth)
    const doc = store.get(tenantId, req.params.id)
    if (!doc) return res.status(404).json({ error: 'Timetable not found.' })

    const body = req.body || {}
    const weekdays = body.weekdays || []
    const timing = body.timing || {}

    const config = normaliseConfig(doc.config)

    // Validate weekdays array
    if (!Array.isArray(weekdays) || weekdays.length === 0) {
      return res.status(400).json({ error: 'At least one weekday must be selected.' })
    }

    // Only update selected weekdays, preserve others
    const updatedDayOverrides = { ...config.dayOverrides }
    let updatedCount = 0
    const skippedDays = []

    for (const day of weekdays) {
      if (!ALL_DAYS.includes(day)) {
        skippedDays.push({ day, reason: 'Not a valid weekday' })
        continue
      }

      if (!config.days.includes(day)) {
        skippedDays.push({ day, reason: 'Not a configured school day' })
        continue
      }

      // Apply timing only to selected days
      const rawDuration = timing.durationType || body.durationType
      const durationType = ['week', 'month', 'indefinite'].includes(rawDuration) ? rawDuration : 'indefinite'
      let expiresAt = timing.expiresAt || body.expiresAt || null
      if (!expiresAt && durationType === 'week') {
        expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      } else if (!expiresAt && durationType === 'month') {
        expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      }
      updatedDayOverrides[day] = {
        periodDuration: timing.periodDuration !== undefined ? Number(timing.periodDuration) : config.periodDuration,
        startTime: timing.startTime || config.startTime,
        breakDuration: timing.breakDuration !== undefined ? Number(timing.breakDuration) : null,
        durationType,
        expiresAt,
        createdAt: new Date().toISOString()
      }
      updatedCount++
    }

    // Set dayTimingMode to custom if any overrides exist
    const hasOverrides = Object.keys(updatedDayOverrides).length > 0
    const newConfig = {
      ...config,
      dayTimingMode: hasOverrides ? 'custom' : 'all',
      dayOverrides: updatedDayOverrides
    }

    // Validate the new configuration
    const check = validateConfig(newConfig)
    if (!check.canGenerate) {
      return res.status(400).json({
        error: 'Invalid timing configuration.',
        details: check.errors
      })
    }

    const updated = store.update(tenantId, req.params.id, { config: newConfig })
    res.json({
      ok: true,
      timetable: describeDocument(updated),
      updatedCount,
      skippedDays,
      message: `Applied timing to ${updatedCount} day(s).`
    })
  })

  // -- CSV export ----------------------------------------------------------

  router.get('/timetables/:id/export.csv', (req, res) => {
    const tenantId = tenantOf(req, devAuth)
    const doc = store.get(tenantId, req.params.id)
    if (!doc) return res.status(404).json({ error: 'Timetable not found.' })

    const config = normaliseConfig(doc.config)
    const { periods } = buildPeriods(config)
    const grids = doc.grids || {}

    const subjectName = id => {
      const s = config.subjects.find(x => x.id === id)
      return s ? s.name : (id || '')
    }
    const teacherName = id => {
      const t = config.teachers.find(x => x.id === id)
      return t ? t.name : ''
    }

    const escape = value => {
      const s = String(value === null || value === undefined ? '' : value)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }

    const lines = []
    for (const cls of config.classes) {
      const grid = grids[cls.id] || {}
      lines.push([`${config.schoolName || 'Timetable'}${config.branchName ? ' - ' + config.branchName : ''} - ${cls.name}`].map(escape).join(','))
      lines.push(['Day', ...periods.map(p => `${p.label} (${p.kind === 'break' ? 'break' : p.label})`)].map(escape).join(','))
      config.days.forEach((dayName, dayIndex) => {
        const row = [dayName]
        for (const period of periods) {
          if (period.kind !== 'teaching') { row.push('—'); continue }
          const cell = grid[cellKey(cls.id, dayIndex, period.index)]
          row.push(cell ? `${subjectName(cell.subjectId)}${cell.teacherId ? ' (' + teacherName(cell.teacherId) + ')' : ''}` : '')
        }
        lines.push(row.map(escape).join(','))
      })
      lines.push('')
    }

    const csv = lines.join('\r\n')
    const filename = `${(doc.name || 'timetable').replace(/[^\w\-]+/g, '_')}.csv`
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(csv)
  })

  return router
}

module.exports = { createTt2Router, READ_ROLES, WRITE_ROLES, pickTeacher, qualifiedTeachers }
