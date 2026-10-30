'use strict'

/**
 * Timetable API routes.
 *
 * This module exports a ROUTER FACTORY, not a server: the identical router runs
 * in the standalone dev server (timetable/dev-server.js) and inside The Eye
 * (mounted from serverg.js — see INTEGRATION.md). Authentication is INJECTED,
 * never duplicated:
 *
 *   app.use('/api/timetable', requireAuth(ROLES), createTimetableRouter({
 *     store: createPgStore(pool),
 *     featureEnabled: tenant => timetableFeatureEnabled(tenant)
 *   }))
 *
 * Conventions mirrored from serverg.js:
 *   - res.status(4xx).json({ error }) for failures, JSON for everything
 *   - req.user comes from authMiddleware.requireAuth; tenant scope is ALWAYS
 *     req.user.tenant_id from the JWT, never from the request body or query
 *   - write roles: super_admin, admin, coordinator (teachers read-only)
 *   - a feature gate that fails OPEN, exactly like isPortalEnabled()
 *
 * Validation policy (the validator returns missing lessons as a HARD
 * violation, which is right for publishing but wrong for an unfinished draft):
 *   - PUT /entries  blocks every hard violation EXCEPT H_MISSING_LESSON,
 *                   because a draft is allowed to be incomplete
 *   - POST /publish blocks ALL hard violations and requires 100% completeness
 */

const { generateTimetable } = require('./solver')
const { validateTimetable } = require('./validator')

const READ_ROLES = ['super_admin', 'admin', 'coordinator', 'teacher']
const WRITE_ROLES = ['super_admin', 'admin', 'coordinator']

const DEFAULT_GENERATE_OPTIONS = { nodeBudget: 300000, timeBudgetMs: 5000 }
const MAX_GENERATE_OPTIONS = { nodeBudget: 2000000, timeBudgetMs: 20000 }

function asArray(v) {
  return Array.isArray(v) ? (typeof v === 'function' ? [v] : v) : [v].filter(Boolean)
}

function isIdArray(value) {
  return Array.isArray(value) && value.every(x => x !== null && typeof x === 'object')
}

/**
 * Structural sanity of a config document before it ever reaches the solver.
 * Returns { error } or { config } with fields normalised.
 */
function normalizeConfig(body) {
  if (!body || typeof body !== 'object') return { error: 'Configuration object expected' }
  const days = body.days
  const periods = body.periods
  if (!Array.isArray(days) || days.length === 0 || !days.every(d => typeof d === 'string' && d.trim())) {
    return { error: 'days must be a non-empty array of day names' }
  }
  if (!Array.isArray(periods) || periods.length === 0) {
    return { error: 'periods must be a non-empty array' }
  }
  for (const p of periods) {
    if (!p || typeof p !== 'object' || typeof p.label !== 'string' || !p.label.trim()) {
      return { error: 'every period needs a label' }
    }
    if (!['teaching', 'break', 'lunch'].includes(p.kind)) {
      return { error: `period "${p.label}" must have kind teaching, break or lunch` }
    }
  }
  if (!isIdArray(body.classes) || !body.classes.length) return { error: 'classes must be a non-empty array' }
  if (!isIdArray(body.subjects) || !body.subjects.length) return { error: 'subjects must be a non-empty array' }
  if (!isIdArray(body.teachers)) return { error: 'teachers must be an array' }
  if (!isIdArray(body.requirements)) return { error: 'requirements must be an array' }

  for (const c of body.classes) {
    if (c.id === undefined || c.id === null || c.id === '') return { error: 'every class needs an id' }
  }
  for (const s of body.subjects) {
    if (s.id === undefined || s.id === null || s.id === '') return { error: 'every subject needs an id' }
  }
  for (const t of body.teachers) {
    if (t.id === undefined || t.id === null || t.id === '') return { error: 'every teacher needs an id' }
    if (t.subjectIds !== undefined && !Array.isArray(t.subjectIds)) return { error: `teacher ${t.id}: subjectIds must be an array` }
  }

  const daySet = new Set(days)
  const periodLabels = new Set(periods.map(p => p.label))
  for (const t of body.teachers) {
    for (const u of t.unavailableSlots || []) {
      if (!u || typeof u !== 'object') return { error: `teacher ${t.id}: unavailable slots must be {day, period}` }
      if (u.day !== undefined && !daySet.has(u.day)) {
        return { error: `teacher ${t.id}: unavailable slot on unknown day "${u.day}"` }
      }
      if (u.period !== undefined && !periodLabels.has(u.period)) {
        return { error: `teacher ${t.id}: unavailable slot on unknown period "${u.period}"` }
      }
    }
  }

  const classIds = new Set(body.classes.map(c => String(c.id)))
  const subjectIds = new Set(body.subjects.map(s => String(s.id)))
  for (const r of body.requirements) {
    if (!classIds.has(String(r.classId))) return { error: `requirement references unknown class "${r.classId}"` }
    if (!subjectIds.has(String(r.subjectId))) return { error: `requirement references unknown subject "${r.subjectId}"` }
    const n = Number(r.periodsPerWeek)
    if (!Number.isInteger(n) || n < 0) return { error: 'requirements need a whole-number periodsPerWeek' }
  }

  return {
    config: {
      days: days.slice(),
      periods: periods.map(p => ({ label: p.label, kind: p.kind, start: p.start, end: p.end })),
      classes: body.classes.map(c => ({ id: c.id, name: c.name || String(c.id), section: c.section || null })),
      subjects: body.subjects.map(s => ({ id: s.id, name: s.name || String(s.id), difficult: !!s.difficult })),
      teachers: body.teachers.map(t => ({
        id: t.id,
        name: t.name || String(t.id),
        subjectIds: Array.isArray(t.subjectIds) ? t.subjectIds : [],
        maxPerDay: t.maxPerDay === undefined ? null : t.maxPerDay,
        maxPerWeek: t.maxPerWeek === undefined ? null : t.maxPerWeek,
        unavailableSlots: Array.isArray(t.unavailableSlots) ? t.unavailableSlots : []
      })),
      rooms: Array.isArray(body.rooms) ? body.rooms.map(r => ({
        id: r.id, name: r.name || String(r.id),
        unavailableSlots: Array.isArray(r.unavailableSlots) ? r.unavailableSlots : []
      })) : [],
      requirements: body.requirements.map(r => {
        const out = { classId: r.classId, subjectId: r.subjectId, periodsPerWeek: Number(r.periodsPerWeek) }
        if (r.roomId !== undefined && r.roomId !== null && r.roomId !== '') out.roomId = r.roomId
        if (Array.isArray(r.teacherIds) && r.teacherIds.length) out.teacherIds = r.teacherIds
        return out
      }),
      preferences: {
        maxSameSubjectPerDay: num(body.preferences && body.preferences.maxSameSubjectPerDay, 1),
        avoidConsecutiveDifficult: body.preferences
          ? body.preferences.avoidConsecutiveDifficult !== false
          : true
      }
    }
  }
}

function num(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Validate a set of entries against a config.
 * @returns {{validation: object, blocking: object[], missingOnly: object[]}}
 */
function validateEntries(config, entries, { locks = null } = {}) {
  const input = { ...config }
  if (locks) input.locks = locks
  else input.locks = (Array.isArray(entries) ? entries : []).filter(e => e && e.locked)
  const validation = validateTimetable(input, Array.isArray(entries) ? entries : [])
  const blocking = validation.hard.filter(v => v.code !== 'H_MISSING_LESSON')
  const missingOnly = validation.hard.filter(v => v.code === 'H_MISSING_LESSON')
  return { validation, blocking, missingOnly }
}

/** 400 when an entry points at something that does not exist in this tenant's config. */
function findBrokenReference(config, entries) {
  const classIds = new Set(config.classes.map(c => String(c.id)))
  const subjectIds = new Set(config.subjects.map(s => String(s.id)))
  const teacherIds = new Set(config.teachers.map(t => String(t.id)))
  const roomIds = new Set(config.rooms.map(r => String(r.id)))
  for (const e of entries) {
    if (!classIds.has(String(e.classId))) return `unknown class "${e.classId}"`
    if (!subjectIds.has(String(e.subjectId))) return `unknown subject "${e.subjectId}"`
    if (!teacherIds.has(String(e.teacherId))) return `unknown teacher "${e.teacherId}"`
    if (e.roomId !== undefined && e.roomId !== null && e.roomId !== '' && !roomIds.has(String(e.roomId))) {
      return `unknown room "${e.roomId}"`
    }
    if (!Number.isInteger(e.day) || e.day < 0 || e.day >= config.days.length) {
      return `day ${e.day} is outside this school's week`
    }
    if (!Number.isInteger(e.period) || e.period < 0 || e.period >= config.periods.length) {
      return `period ${e.period} is outside this school's day`
    }
  }
  return null
}

function sanitizeEntries(raw) {
  if (!Array.isArray(raw)) return null
  const out = []
  for (const e of raw) {
    if (!e || typeof e !== 'object') return null
    if (e.classId === undefined || e.subjectId === undefined || e.teacherId === undefined) return null
    out.push({
      classId: e.classId,
      day: Number(e.day),
      period: Number(e.period),
      subjectId: e.subjectId,
      teacherId: e.teacherId,
      roomId: e.roomId === undefined || e.roomId === null || e.roomId === '' ? undefined : e.roomId,
      locked: e.locked === true
    })
  }
  return out
}

/**
 * @param {{ store: object,
 *           auth: Function|Function[],
 *           featureEnabled?: (tenantId: string) => (boolean|Promise<boolean>),
 *           guards?: Function[] }} options
 */
function createTimetableRouter(options = {}) {
  const express = require('express')
  const { store, auth } = options
  if (!store) throw new Error('createTimetableRouter requires a store')
  if (!auth) throw new Error('createTimetableRouter requires an auth middleware (never run unauthenticated)')

  const router = express.Router()
  const guards = asArray(options.guards || [])
  const featureEnabled = typeof options.featureEnabled === 'function' ? options.featureEnabled : null

  const authChain = asArray(auth)

  // Meta is intentionally unauthenticated: the UI needs to know whether to
  // redirect to The Eye's login or show the standalone identity picker. It
  // exposes no school data.
  router.get('/meta', (req, res) => {
    res.json({
      module: 'timetable',
      readRoles: READ_ROLES,
      writeRoles: WRITE_ROLES,
      // true when running under timetable/dev-server.js (standalone testing)
      devAuth: options.devAuth === true
    })
  })

  // Every other route: auth -> feature gate -> extra guards (e.g. The Eye's
  // requireWritableBranch for coordinators).
  router.use((req, res, next) => {
    if (req.path === '/meta') return next()

    // Run the injected auth middlewares in order. A middleware that answers
    // (401/403) never calls next, which is exactly how The Eye's requireAuth
    // short-circuits — nothing after it runs in that case.
    let idx = 0
    const runAuth = (err) => {
      if (err) return next(err)
      if (res.headersSent) return
      if (idx < authChain.length) {
        const current = authChain[idx++]
        return current(req, res, runAuth)
      }
      return runGate()
    }

    const runGate = async () => {
      try {
        if (!req.user || !req.user.tenant_id) {
          return res.status(403).json({ error: 'Your account is not linked to a school' })
        }
        if (featureEnabled) {
          const enabled = await featureEnabled(req.user.tenant_id)
          if (enabled === false) {
            return res.status(403).json({ error: 'The timetable feature is not enabled for your school' })
          }
        }
        for (const g of guards) {
          await g(req, res, (err) => { if (err) throw err })
          if (res.headersSent) return
        }
        next()
      } catch (err) {
        next(err)
      }
    }

    runAuth()
  })

  function requireWrite(req, res) {
    if (!WRITE_ROLES.includes(req.user.role)) {
      res.status(403).json({ error: 'Only a school admin or coordinator can change timetables' })
      return false
    }
    return true
  }

  function requireRead(req, res) {
    if (!READ_ROLES.includes(req.user.role)) {
      res.status(403).json({ error: 'Your role cannot view timetables' })
      return false
    }
    return true
  }

  // -------------------------------------------------------------------------
  // GET /bootstrap — everything the UI needs for one tenant, one call
  // -------------------------------------------------------------------------
  router.get('/bootstrap', async (req, res, next) => {
    try {
      if (!requireRead(req, res)) return
      const tenantId = req.user.tenant_id
      const [config, timetable, name] = await Promise.all([
        store.getConfig(tenantId),
        store.getTimetable(tenantId),
        Promise.resolve(store.schoolName ? store.schoolName(tenantId) : tenantId)
      ])
      let validation = null
      if (config && timetable.entries.length) {
        validation = validateEntries(config, timetable.entries).validation
      }
      res.json({
        tenant: { id: tenantId, name },
        user: { role: req.user.role, branch_id: req.user.branch_id ?? null },
        config,
        timetable,
        validation,
        readOnly: !WRITE_ROLES.includes(req.user.role)
      })
    } catch (err) { next(err) }
  })

  // -------------------------------------------------------------------------
  // PUT /config — replace the school's scheduling configuration
  // -------------------------------------------------------------------------
  router.put('/config', async (req, res, next) => {
    try {
      if (!requireWrite(req, res)) return
      const tenantId = req.user.tenant_id
      const normalized = normalizeConfig(req.body && req.body.config !== undefined ? req.body.config : req.body)
      if (normalized.error) return res.status(400).json({ error: normalized.error })

      const previous = await store.getTimetable(tenantId)
      const config = await store.saveConfig(tenantId, normalized.config)

      // Existing entries may no longer fit the new configuration. Never hide
      // that: return the new config together with what it now implies.
      let validation = null
      if (previous.entries.length) {
        validation = validateEntries(config, previous.entries).validation
      }
      res.json({ ok: true, config, timetable: previous, validation })
    } catch (err) { next(err) }
  })

  // -------------------------------------------------------------------------
  // POST /generate — run the solver and return a PREVIEW. Nothing is saved.
  // -------------------------------------------------------------------------
  router.post('/generate', async (req, res, next) => {
    try {
      if (!requireWrite(req, res)) return
      const tenantId = req.user.tenant_id
      const config = await store.getConfig(tenantId)
      if (!config) return res.status(400).json({ error: 'Configure the school schedule first' })

      const body = req.body || {}
      const current = await store.getTimetable(tenantId)

      // Locked lessons from the saved timetable are handed to the solver so a
      // regeneration keeps every approved cell exactly where it is.
      const locks = current.entries.filter(e => e.locked).map(e => ({
        classId: e.classId, day: e.day, period: e.period,
        subjectId: e.subjectId, teacherId: e.teacherId,
        ...(e.roomId !== undefined ? { roomId: e.roomId } : {})
      }))
      if (locks.length && body.keepLocked === false) {
        // Explicit opt-out: regenerate everything, ignoring locks.
        locks.length = 0
      }

      const opts = body.options || {}
      const options = {
        nodeBudget: Math.min(MAX_GENERATE_OPTIONS.nodeBudget, Math.max(1000, num(opts.nodeBudget, DEFAULT_GENERATE_OPTIONS.nodeBudget))),
        timeBudgetMs: Math.min(MAX_GENERATE_OPTIONS.timeBudgetMs, Math.max(250, num(opts.timeBudgetMs, DEFAULT_GENERATE_OPTIONS.timeBudgetMs)))
      }

      const input = { ...config, locks }
      const result = generateTimetable(input, options)
      const validation = validateEntries(config, result.entries).validation

      res.json({
        ok: result.ok,
        preview: true,
        entries: result.entries,
        stats: result.stats,
        diagnostics: result.diagnostics,
        violations: result.violations,
        validation,
        locksUsed: locks.length,
        saved: false
      })
    } catch (err) { next(err) }
  })

  // -------------------------------------------------------------------------
  // POST /validate — second opinion on a set of entries (manual edits, preview)
  // -------------------------------------------------------------------------
  router.post('/validate', async (req, res, next) => {
    try {
      if (!requireRead(req, res)) return
      const tenantId = req.user.tenant_id
      const config = await store.getConfig(tenantId)
      if (!config) return res.status(400).json({ error: 'Configure the school schedule first' })

      const entries = sanitizeEntries(req.body && req.body.entries)
      if (!entries) return res.status(400).json({ error: 'entries must be an array of timetable cells' })

      const broken = findBrokenReference(config, entries)
      if (broken) return res.status(400).json({ error: `Entry references ${broken}` })

      const { validation } = validateEntries(config, entries)
      res.json({ ok: validation.ok, validation })
    } catch (err) { next(err) }
  })

  // -------------------------------------------------------------------------
  // PUT /entries — save a draft. Blocked by hard violations, but an incomplete
  // timetable is fine: it is a draft by definition.
  // -------------------------------------------------------------------------
  router.put('/entries', async (req, res, next) => {
    try {
      if (!requireWrite(req, res)) return
      const tenantId = req.user.tenant_id
      const config = await store.getConfig(tenantId)
      if (!config) return res.status(400).json({ error: 'Configure the school schedule first' })

      const entries = sanitizeEntries(req.body && req.body.entries)
      if (!entries) return res.status(400).json({ error: 'entries must be an array of timetable cells' })

      const broken = findBrokenReference(config, entries)
      if (broken) return res.status(400).json({ error: `Entry references ${broken}` })

      const { validation, blocking } = validateEntries(config, entries)
      if (blocking.length) {
        return res.status(409).json({
          error: 'These edits would create conflicts, so nothing was saved.',
          violations: blocking,
          validation
        })
      }

      const saved = await store.saveEntries(tenantId, entries)
      res.json({ ok: true, timetable: saved, validation })
    } catch (err) { next(err) }
  })

  // -------------------------------------------------------------------------
  // POST /publish — only a complete, conflict-free timetable can be published
  // -------------------------------------------------------------------------
  router.post('/publish', async (req, res, next) => {
    try {
      if (!requireWrite(req, res)) return
      const tenantId = req.user.tenant_id
      const config = await store.getConfig(tenantId)
      if (!config) return res.status(400).json({ error: 'Configure the school schedule first' })

      const current = await store.getTimetable(tenantId)
      const { validation } = validateEntries(config, current.entries)

      if (!validation.ok || validation.totals.scheduled < validation.totals.required) {
        return res.status(409).json({
          error: 'The timetable is incomplete or has conflicts, so it was not published.',
          violations: validation.hard,
          validation
        })
      }

      const saved = await store.setStatus(tenantId, 'published')
      res.json({ ok: true, timetable: { ...current, ...saved }, validation })
    } catch (err) { next(err) }
  })

  // -------------------------------------------------------------------------
  // GET /view?by=class|teacher|room|school — read models for the views
  // -------------------------------------------------------------------------
  router.get('/view', async (req, res, next) => {
    try {
      if (!requireRead(req, res)) return
      const tenantId = req.user.tenant_id
      const config = await store.getConfig(tenantId)
      if (!config) return res.status(400).json({ error: 'Configure the school schedule first' })
      const { entries, status } = await store.getTimetable(tenantId)

      const by = String(req.query.by || 'class')
      const nameOf = (list, id) => {
        const found = list.find(x => String(x.id) === String(id))
        return found ? found.name : String(id)
      }

      if (by === 'class') {
        const rows = config.classes.map(c => {
          const mine = entries.filter(e => String(e.classId) === String(c.id))
          return {
            classId: c.id, name: c.name, section: c.section,
            lessons: mine.length,
            slots: mine
          }
        })
        return res.json({ by, status, rows })
      }

      if (by === 'teacher') {
        const rows = config.teachers.map(t => {
          const mine = entries.filter(e => String(e.teacherId) === String(t.id))
          const byDay = {}
          config.days.forEach((d, i) => { byDay[d] = mine.filter(e => e.day === i).length })
          return {
            teacherId: t.id, name: t.name,
            lessons: mine.length,
            maxPerDay: t.maxPerDay, maxPerWeek: t.maxPerWeek,
            overWeekLimit: t.maxPerWeek !== null && mine.length > t.maxPerWeek,
            byDay, slots: mine
          }
        })
        return res.json({ by, status, rows })
      }

      if (by === 'room') {
        const rows = config.rooms.map(r => {
          const mine = entries.filter(e => e.roomId !== undefined && String(e.roomId) === String(r.id))
          return { roomId: r.id, name: r.name, bookings: mine.length, slots: mine }
        })
        return res.json({ by, status, rows })
      }

      if (by === 'school') {
        const rows = config.classes.map(c => {
          const mine = entries.filter(e => String(e.classId) === String(c.id))
          const byDay = {}
          config.days.forEach((d, i) => { byDay[d] = mine.filter(e => e.day === i).length })
          return { classId: c.id, name: c.name, section: c.section, lessons: mine.length, byDay }
        })
        return res.json({ by, status, rows, days: config.days, periods: config.periods })
      }

      res.status(400).json({ error: 'by must be class, teacher, room or school' })
    } catch (err) { next(err) }
  })

  return router
}

module.exports = { createTimetableRouter, normalizeConfig, validateEntries, sanitizeEntries, READ_ROLES, WRITE_ROLES }
