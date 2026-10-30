'use strict'

/**
 * tt2 — data access.
 *
 * A timetable document holds everything needed to render, edit and re-generate
 * one timetable:
 *
 *   {
 *     id, tenantId, name, createdAt, updatedAt, generatedAt,
 *     config: { ...the wizard answers... },
 *     grids:  { [classId]: { [cellKey]: cell } },
 *     report: { ok, stats, violations, softPenalties, diagnostics }
 *   }
 *
 * The driver is a JSON file so the standalone dev server survives a restart.
 * The interface is deliberately narrow so the routes never touch storage
 * details and a Postgres driver can be dropped in later without touching a
 * single route.
 *
 * TENANT FIRST — every method takes the tenant id first and can only ever see
 * that tenant's documents. Isolation is enforced by the store signature, not
 * by each caller remembering to add a WHERE clause.
 */

const fs = require('fs')
const path = require('path')

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

let counter = 0

function newId() {
  counter += 1
  return `tt_${Date.now().toString(36)}_${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/**
 * @param {{ persistPath?: string }} [opts] when set, documents survive restarts
 */
function createFileStore(opts = {}) {
  const persistPath = opts.persistPath || null
  /** @type {Map<string, any>} id -> document */
  const docs = new Map()

  if (persistPath && fs.existsSync(persistPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(persistPath, 'utf8'))
      for (const doc of raw.documents || []) {
        if (doc && doc.id) docs.set(doc.id, doc)
      }
    } catch (err) {
      console.warn(`[tt2 store] could not read ${persistPath}: ${err.message} — starting empty`)
    }
  }

  function persist() {
    if (!persistPath) return
    try {
      fs.mkdirSync(path.dirname(persistPath), { recursive: true })
      const payload = JSON.stringify({ documents: [...docs.values()] }, null, 2)
      const tmp = `${persistPath}.tmp`
      fs.writeFileSync(tmp, payload, 'utf8')
      fs.renameSync(tmp, persistPath)
    } catch (err) {
      // Never let a dev convenience break a request.
      console.warn(`[tt2 store] persist failed: ${err.message}`)
    }
  }

  function summarise(doc) {
    return {
      id: doc.id,
      name: doc.name,
      schoolName: doc.config ? doc.config.schoolName : '',
      branchName: doc.config ? doc.config.branchName : '',
      classCount: doc.config ? doc.config.classes.length : 0,
      teacherCount: doc.config ? doc.config.teachers.length : 0,
      subjectCount: doc.config ? doc.config.subjects.length : 0,
      generated: !!doc.generatedAt,
      generatedAt: doc.generatedAt || null,
      updatedAt: doc.updatedAt || null
    }
  }

  function owned(tenantId, id) {
    const doc = docs.get(String(id))
    if (!doc) return null
    if (String(doc.tenantId) !== String(tenantId)) return null
    return doc
  }

  return {
    driver: 'file',

    list(tenantId) {
      return [...docs.values()]
        .filter(doc => String(doc.tenantId) === String(tenantId))
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
        .map(summarise)
    },

    get(tenantId, id) {
      return clone(owned(tenantId, id))
    },

    exists(tenantId, id) {
      return !!owned(tenantId, id)
    },

    /**
     * @param {{tenantId: string, name?: string, config: object}} input
     */
    create(input) {
      const now = new Date().toISOString()
      const doc = {
        id: newId(),
        tenantId: String(input.tenantId),
        name: (input.name && String(input.name).trim()) ||
          (input.config && input.config.schoolName) || 'Untitled timetable',
        config: clone(input.config) || null,
        grids: clone(input.grids) || {},
        report: clone(input.report) || null,
        generatedAt: null,
        createdAt: now,
        updatedAt: now
      }
      docs.set(doc.id, doc)
      persist()
      return clone(doc)
    },

    /** Shallow merge: only the keys present in `patch` are replaced. */
    update(tenantId, id, patch) {
      const doc = owned(tenantId, id)
      if (!doc) return null
      if (patch.config !== undefined) doc.config = clone(patch.config)
      if (patch.grids !== undefined) doc.grids = clone(patch.grids)
      if (patch.report !== undefined) doc.report = clone(patch.report)
      if (patch.name !== undefined) doc.name = String(patch.name)
      if (patch.generatedAt !== undefined) doc.generatedAt = patch.generatedAt
      doc.updatedAt = new Date().toISOString()
      persist()
      return clone(doc)
    },

    remove(tenantId, id) {
      const doc = owned(tenantId, id)
      if (!doc) return false
      docs.delete(doc.id)
      persist()
      return true
    }
  }
}

module.exports = { createFileStore }
