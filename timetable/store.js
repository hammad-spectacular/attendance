'use strict'

/**
 * Timetable data access.
 *
 * The store is a narrow, tenant-first interface so the routes never touch
 * storage details and the SAME routes run against either driver:
 *
 *   createMemoryStore(seed, opts)   in-memory (+ optional JSON file) for the
 *                                   standalone dev server and the route tests
 *   createPgStore(pool)             PostgreSQL driver for The Eye (store.pg.js),
 *                                   written against PROPOSED_SCHEMA.sql
 *
 * Every method takes tenantId first and can only ever see that tenant's data —
 * isolation is enforced by the store signature, not by each caller remembering
 * to add a WHERE clause.
 *
 * State shape per tenant (also the row shape in the migration):
 *   {
 *     config:   { days, periods, classes, subjects, teachers, rooms,
 *                 requirements, preferences },
 *     entries:  [ { classId, day, period, subjectId, teacherId, roomId?, locked } ],
 *     status:   'draft' | 'published',
 *     updatedAt: ISO string
 *   }
 */

const fs = require('fs')
const path = require('path')

const VALID_STATUS = new Set(['draft', 'published'])

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function defaultState() {
  return { config: null, entries: [], status: 'draft', updatedAt: null }
}

/**
 * @param {Object<string, {name: string, config: object}>} seed sampleSchools()
 * @param {{ persistPath?: string }} [opts] when set, state survives restarts
 */
function createMemoryStore(seed = {}, opts = {}) {
  /** @type {Map<string, any>} tenant_id -> state */
  const states = new Map()
  const names = new Map()
  const persistPath = opts.persistPath || null

  // Load previously saved dev state first, then make sure every seed tenant
  // exists (seed data never overwrites state the tester already saved).
  if (persistPath && fs.existsSync(persistPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(persistPath, 'utf8'))
      for (const [tenantId, state] of Object.entries(raw.states || {})) {
        states.set(tenantId, state)
      }
      for (const [tenantId, name] of Object.entries(raw.names || {})) {
        names.set(tenantId, name)
      }
    } catch (err) {
      console.warn(`[timetable store] could not read ${persistPath}: ${err.message} — starting empty`)
    }
  }

  for (const [tenantId, school] of Object.entries(seed)) {
    names.set(tenantId, school.name || tenantId)
    if (!states.has(tenantId)) {
      states.set(tenantId, { config: clone(school.config), entries: [], status: 'draft', updatedAt: null })
    }
  }

  function persist() {
    if (!persistPath) return
    try {
      const payload = JSON.stringify({
        names: Object.fromEntries(names),
        states: Object.fromEntries(states)
      }, null, 2)
      const tmp = `${persistPath}.tmp`
      fs.writeFileSync(tmp, payload, 'utf8')
      fs.renameSync(tmp, persistPath)
    } catch (err) {
      // Never let a dev convenience break a request.
      console.warn(`[timetable store] persist failed: ${err.message}`)
    }
  }

  function stateOf(tenantId) {
    const id = String(tenantId || '')
    if (!states.has(id)) {
      // Unknown tenant gets an empty shell so a new school can be configured
      // without a migration; it never inherits another tenant's data.
      states.set(id, defaultState())
    }
    return states.get(id)
  }

  return {
    driver: 'memory',

    listTenants() {
      return [...states.keys()].map(id => ({ id, name: names.get(id) || id }))
    },

    schoolName(tenantId) {
      return names.get(String(tenantId)) || String(tenantId)
    },

    getConfig(tenantId) {
      return clone(stateOf(tenantId).config)
    },

    /** Full replace of the configuration (routes validate before calling). */
    saveConfig(tenantId, config) {
      const st = stateOf(tenantId)
      st.config = clone(config)
      st.updatedAt = new Date().toISOString()
      persist()
      return clone(st.config)
    },

    getTimetable(tenantId) {
      const st = stateOf(tenantId)
      return {
        entries: clone(st.entries),
        status: st.status,
        updatedAt: st.updatedAt
      }
    },

    /** Saving always demotes to draft: a published timetable must be re-approved. */
    saveEntries(tenantId, entries) {
      const st = stateOf(tenantId)
      st.entries = clone(entries)
      st.status = 'draft'
      st.updatedAt = new Date().toISOString()
      persist()
      return { entries: clone(st.entries), status: st.status, updatedAt: st.updatedAt }
    },

    setStatus(tenantId, status) {
      if (!VALID_STATUS.has(status)) throw new Error(`invalid status: ${status}`)
      const st = stateOf(tenantId)
      st.status = status
      st.updatedAt = new Date().toISOString()
      persist()
      return { status: st.status, updatedAt: st.updatedAt }
    },

    resetTenant(tenantId, school) {
      const id = String(tenantId)
      states.set(id, { config: clone(school.config), entries: [], status: 'draft', updatedAt: null })
      names.set(id, school.name || id)
      persist()
    }
  }
}

module.exports = { createMemoryStore }
