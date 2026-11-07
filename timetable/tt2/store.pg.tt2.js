'use strict'

/**
 * PostgreSQL driver for tt2 — compatible with the file store interface.
 *
 * This adapter maps the file store methods (list, get, create, update, remove)
 * to PostgreSQL tables, keeping the tt2 routes unchanged.
 */

function createPgTt2Store(pool) {
  if (!pool) throw new Error('createPgTt2Store requires a pg Pool')

  async function summarise(doc) {
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

  return {
    driver: 'pg',

    async list(tenantId) {
      const result = await pool.query(
        `SELECT id, name, config, grids, report, generated_at, created_at, updated_at
         FROM tt2_timetables
         WHERE tenant_id = $1
         ORDER BY updated_at DESC`,
        [tenantId]
      )
      return result.rows.map(row => ({
        id: row.id,
        name: row.name,
        schoolName: row.config ? row.config.schoolName : '',
        branchName: row.config ? row.config.branchName : '',
        classCount: row.config ? row.config.classes.length : 0,
        teacherCount: row.config ? row.config.teachers.length : 0,
        subjectCount: row.config ? row.config.subjects.length : 0,
        generated: !!row.generated_at,
        generatedAt: row.generated_at,
        updatedAt: row.updated_at
      }))
    },

    async get(tenantId, id) {
      const result = await pool.query(
        `SELECT id, tenant_id, name, config, grids, report, generated_at, created_at, updated_at
         FROM tt2_timetables
         WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId]
      )
      if (result.rows.length === 0) return null
      const row = result.rows[0]
      return {
        id: row.id,
        tenantId: row.tenant_id,
        name: row.name,
        config: row.config,
        grids: row.grids,
        report: row.report,
        generatedAt: row.generated_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    },

    async exists(tenantId, id) {
      const result = await pool.query(
        `SELECT 1 FROM tt2_timetables WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId]
      )
      return result.rows.length > 0
    },

    async create(input) {
      const now = new Date().toISOString()
      const result = await pool.query(
        `INSERT INTO tt2_timetables (tenant_id, name, config, grids, report, generated_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, tenant_id, name, config, grids, report, generated_at, created_at, updated_at`,
        [
          String(input.tenantId),
          (input.name && String(input.name).trim()) || (input.config && input.config.schoolName) || 'Untitled timetable',
          input.config || null,
          input.grids || {},
          input.report || null,
          null,
          now,
          now
        ]
      )
      const row = result.rows[0]
      return {
        id: row.id,
        tenantId: row.tenant_id,
        name: row.name,
        config: row.config,
        grids: row.grids,
        report: row.report,
        generatedAt: row.generated_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    },

    async update(tenantId, id, patch) {
      const updates = []
      const values = []
      let paramIndex = 1

      if (patch.config !== undefined) {
        updates.push(`config = $${paramIndex}`)
        values.push(patch.config)
        paramIndex++
      }
      if (patch.grids !== undefined) {
        updates.push(`grids = $${paramIndex}`)
        values.push(patch.grids)
        paramIndex++
      }
      if (patch.report !== undefined) {
        updates.push(`report = $${paramIndex}`)
        values.push(patch.report)
        paramIndex++
      }
      if (patch.name !== undefined) {
        updates.push(`name = $${paramIndex}`)
        values.push(patch.name)
        paramIndex++
      }
      if (patch.generatedAt !== undefined) {
        updates.push(`generated_at = $${paramIndex}`)
        values.push(patch.generatedAt)
        paramIndex++
      }

      updates.push(`updated_at = $${paramIndex}`)
      values.push(new Date().toISOString())
      paramIndex++

      values.push(id)
      values.push(tenantId)

      const result = await pool.query(
        `UPDATE tt2_timetables SET ${updates.join(', ')} WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1}
         RETURNING id, tenant_id, name, config, grids, report, generated_at, created_at, updated_at`,
        values
      )

      if (result.rows.length === 0) return null
      const row = result.rows[0]
      return {
        id: row.id,
        tenantId: row.tenant_id,
        name: row.name,
        config: row.config,
        grids: row.grids,
        report: row.report,
        generatedAt: row.generated_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    },

    async remove(tenantId, id) {
      const result = await pool.query(
        `DELETE FROM tt2_timetables WHERE id = $1 AND tenant_id = $2 RETURNING id`,
        [id, tenantId]
      )
      return result.rows.length > 0
    }
  }
}

module.exports = { createPgTt2Store }
