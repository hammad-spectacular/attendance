'use strict'

/**
 * PostgreSQL driver for the timetable store — integration only.
 *
 * STATUS: NOT EXECUTED AND NOT TESTED. There is no reachable development
 * database in this workspace (only the production .env, which must not be used
 * for testing), so this driver is review-only until the migration in
 * PROPOSED_SCHEMA.sql has been applied to a development database. See
 * INTEGRATION.md for the steps to verify it before use.
 *
 * It assembles exactly the solver/validator config document from the
 * NORMALISED schema in PROPOSED_SCHEMA.sql:
 *
 *   timetable_configs + classes + subjects + teachers + teacher_subjects
 *   + timetable_teacher_availability + timetable_teacher_limits
 *   + timetable_rooms + timetable_class_subjects + timetable_teacher_assignments
 *
 * Conventions followed from serverg.js:
 *   - parameterised queries only ($1, $2, ...), never string interpolation
 *   - EVERY query filters `tenant_id = $1` first; tenant_id comes from the JWT
 *     (req.user.tenant_id), never from a client-supplied body
 *   - JSON.stringify before passing JS arrays/objects to jsonb columns:
 *     node-postgres turns raw JS arrays into Postgres ARRAY literals, which
 *     would silently corrupt a jsonb column
 */

function createPgStore(pool) {
  if (!pool) throw new Error('createPgStore requires a pg Pool')

  async function getConfig(tenantId) {
    const cfg = await pool.query(
      `SELECT id, days, periods, preferences FROM timetable_configs
       WHERE tenant_id = $1 AND is_default = true ORDER BY id LIMIT 1`,
      [tenantId]
    )
    if (!cfg.rows.length) return null
    const configId = cfg.rows[0].id
    const days = cfg.rows[0].days || []
    const periods = cfg.rows[0].periods || []

    const [classes, subjects, teachers, quals, availability, limits, rooms, reqs] =
      await Promise.all([
        pool.query('SELECT id, name, section FROM classes WHERE tenant_id = $1 ORDER BY id', [tenantId]),
        pool.query('SELECT id, code, name, difficult FROM subjects WHERE tenant_id = $1 ORDER BY id', [tenantId]),
        pool.query('SELECT id, name FROM teachers WHERE tenant_id = $1 ORDER BY id', [tenantId]),
        pool.query('SELECT teacher_id, subject_id FROM teacher_subjects WHERE tenant_id = $1', [tenantId]),
        pool.query(
          'SELECT teacher_id, day_index, period_index FROM timetable_teacher_availability WHERE tenant_id = $1',
          [tenantId]
        ),
        pool.query('SELECT teacher_id, max_per_day, max_per_week FROM timetable_teacher_limits WHERE tenant_id = $1', [tenantId]),
        pool.query('SELECT id, name, unavailable FROM timetable_rooms WHERE tenant_id = $1 ORDER BY id', [tenantId]),
        pool.query(
          `SELECT cs.id, cs.class_id, cs.subject_id, cs.periods_per_week, cs.room_id, ta.teacher_id
             FROM timetable_class_subjects cs
             LEFT JOIN timetable_teacher_assignments ta
               ON ta.class_subject_id = cs.id AND ta.tenant_id = cs.tenant_id
            WHERE cs.tenant_id = $1 AND cs.config_id = $2
            ORDER BY cs.id`,
          [tenantId, configId]
        )
      ])

    const subjectIdsByTeacher = new Map()
    for (const q of quals.rows) {
      if (!subjectIdsByTeacher.has(q.teacher_id)) subjectIdsByTeacher.set(q.teacher_id, [])
      subjectIdsByTeacher.get(q.teacher_id).push(q.subject_id)
    }

    const limitsByTeacher = new Map(limits.rows.map(l => [l.teacher_id, l]))

    // Availability is stored as indices; the solver/validator accept names too,
    // and names survive a column being reordered later, so map to labels.
    const unavailableByTeacher = new Map()
    for (const a of availability.rows) {
      if (a.available !== false) continue
      const day = days[a.day_index]
      const period = periods[a.period_index] ? periods[a.period_index].label : null
      if (day === undefined || period === null) continue
      if (!unavailableByTeacher.has(a.teacher_id)) unavailableByTeacher.set(a.teacher_id, [])
      unavailableByTeacher.get(a.teacher_id).push({ day, period })
    }

    const requirements = []
    const reqByRow = new Map()
    for (const r of reqs.rows) {
      if (!reqByRow.has(r.id)) {
        const req = {
          classId: r.class_id,
          subjectId: r.subject_id,
          periodsPerWeek: r.periods_per_week
        }
        if (r.room_id) req.roomId = r.room_id
        if (r.teacher_id) req.teacherIds = []
        reqByRow.set(r.id, req)
        requirements.push(req)
      }
      if (r.teacher_id) reqByRow.get(r.id).teacherIds.push(r.teacher_id)
    }

    return {
      days,
      periods,
      classes: classes.rows.map(c => ({ id: c.id, name: c.section ? `${c.name} (${c.section})` : c.name })),
      subjects: subjects.rows.map(s => ({ id: s.id, name: s.name, difficult: !!s.difficult })),
      teachers: teachers.rows.map(t => {
        const lim = limitsByTeacher.get(t.id) || {}
        return {
          id: t.id,
          name: t.name,
          subjectIds: subjectIdsByTeacher.get(t.id) || [],
          maxPerDay: lim.max_per_day ?? null,
          maxPerWeek: lim.max_per_week ?? null,
          unavailableSlots: unavailableByTeacher.get(t.id) || []
        }
      }),
      rooms: rooms.rows.map(r => ({ id: r.id, name: r.name, unavailableSlots: r.unavailable || [] })),
      requirements,
      preferences: cfg.rows[0].preferences || {}
    }
  }

  async function saveConfig(tenantId, config) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const cfgRow = await client.query(
        `INSERT INTO timetable_configs (tenant_id, name, days, periods, preferences)
         VALUES ($1, 'Default schedule', $2, $3, $4)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [tenantId, JSON.stringify(config.days), JSON.stringify(config.periods), JSON.stringify(config.preferences || {})]
      )
      let configId = cfgRow.rows[0] && cfgRow.rows[0].id
      if (!configId) {
        const existing = await client.query(
          'SELECT id FROM timetable_configs WHERE tenant_id = $1 AND is_default = true ORDER BY id LIMIT 1',
          [tenantId]
        )
        configId = existing.rows[0].id
        await client.query(
          'UPDATE timetable_configs SET days = $2, periods = $3, preferences = $4, updated_at = NOW() WHERE id = $1',
          [configId, JSON.stringify(config.days), JSON.stringify(config.periods), JSON.stringify(config.preferences || {})]
        )
      }

      // Subjects upsert by (tenant, code) — ids must stay stable because
      // teacher_subjects and timetable entries reference them.
      const subjectIdByCode = new Map()
      for (const s of config.subjects || []) {
        const code = String(s.id)
        const r = await client.query(
          `INSERT INTO subjects (tenant_id, code, name, difficult)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (tenant_id, code)
           DO UPDATE SET name = $3, difficult = $4
           RETURNING id`,
          [tenantId, code, s.name, !!s.difficult]
        )
        subjectIdByCode.set(code, r.rows[0].id)
      }

      // Rooms upsert by (tenant, name).
      const roomIdByName = new Map()
      for (const r0 of config.rooms || []) {
        const r = await client.query(
          `INSERT INTO timetable_rooms (tenant_id, name, unavailable)
           VALUES ($1, $2, $3)
           ON CONFLICT (tenant_id, name)
           DO UPDATE SET unavailable = $3
           RETURNING id`,
          [tenantId, r0.name, JSON.stringify(r0.unavailableSlots || [])]
        )
        roomIdByName.set(r0.name, r.rows[0].id)
        if (r0.id !== undefined) roomIdByName.set(String(r0.id), r.rows[0].id)
      }

      // Availability + limits replace per tenant (derived entirely from config).
      await client.query('DELETE FROM timetable_teacher_availability WHERE tenant_id = $1', [tenantId])
      await client.query('DELETE FROM timetable_teacher_limits WHERE tenant_id = $1', [tenantId])
      const dayIndex = new Map((config.days || []).map((d, i) => [d, i]))
      const periodIndex = new Map((config.periods || []).map((p, i) => [p.label, i]))
      for (const t of config.teachers || []) {
        if (t.maxPerDay !== null && t.maxPerDay !== undefined) {
          await client.query(
            'INSERT INTO timetable_teacher_limits (tenant_id, teacher_id, max_per_day, max_per_week) VALUES ($1, $2, $3, $4)',
            [tenantId, t.id, t.maxPerDay, t.maxPerWeek ?? null]
          )
        }
        for (const u of t.unavailableSlots || []) {
          const di = dayIndex.has(u.day) ? dayIndex.get(u.day) : Number(u.day)
          const pi = periodIndex.has(u.period) ? periodIndex.get(u.period) : Number(u.period)
          if (!Number.isInteger(di) || !Number.isInteger(pi)) continue
          await client.query(
            `INSERT INTO timetable_teacher_availability (tenant_id, teacher_id, day_index, period_index, available)
             VALUES ($1, $2, $3, $4, false) ON CONFLICT DO NOTHING`,
            [tenantId, t.id, di, pi]
          )
        }
      }

      // Weekly requirements + teacher assignments replace per config.
      await client.query(
        'DELETE FROM timetable_class_subjects WHERE tenant_id = $1 AND config_id = $2',
        [tenantId, configId]
      )
      for (const req of config.requirements || []) {
        const subjectId = subjectIdByCode.get(String(req.subjectId))
        const roomId = req.roomId ? (roomIdByName.get(String(req.roomId)) || null) : null
        if (!subjectId) continue
        const cs = await client.query(
          `INSERT INTO timetable_class_subjects
             (tenant_id, config_id, class_id, subject_id, periods_per_week, room_id)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [tenantId, configId, req.classId, subjectId, req.periodsPerWeek, roomId]
        )
        const csId = cs.rows[0].id
        for (const teacherId of req.teacherIds || []) {
          await client.query(
            `INSERT INTO timetable_teacher_assignments (tenant_id, class_subject_id, teacher_id)
             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
            [tenantId, csId, teacherId]
          )
        }
      }

      await client.query('COMMIT')
      return getConfig(tenantId)
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  async function timetableRow(tenantId) {
    const r = await pool.query(
      'SELECT id, status, updated_at FROM timetables WHERE tenant_id = $1 ORDER BY id LIMIT 1',
      [tenantId]
    )
    return r.rows.length ? r.rows[0] : null
  }

  async function getTimetable(tenantId) {
    const row = await timetableRow(tenantId)
    if (!row) return { entries: [], status: 'draft', updatedAt: null }
    const entries = await pool.query(
      `SELECT class_id AS "classId", day_index AS day, period_index AS period,
              subject_id AS "subjectId", teacher_id AS "teacherId",
              room_id AS "roomId", locked
         FROM timetable_entries WHERE tenant_id = $1 AND timetable_id = $2
        ORDER BY class_id, day_index, period_index`,
      [tenantId, row.id]
    )
    return {
      entries: entries.rows.map(e => ({ ...e, roomId: e.roomId || undefined })),
      status: row.status,
      updatedAt: row.updated_at
    }
  }

  async function saveEntries(tenantId, entries) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      let row = await timetableRow(tenantId)
      if (!row) {
        const created = await client.query(
          `INSERT INTO timetables (tenant_id, name, status) VALUES ($1, 'Weekly timetable', 'draft')
           RETURNING id, status, updated_at`,
          [tenantId]
        )
        row = created.rows[0]
      }
      await client.query('DELETE FROM timetable_entries WHERE tenant_id = $1 AND timetable_id = $2', [tenantId, row.id])
      for (const e of entries) {
        await client.query(
          `INSERT INTO timetable_entries
             (tenant_id, timetable_id, class_id, subject_id, teacher_id, room_id,
              day_index, period_index, locked)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [tenantId, row.id, e.classId, e.subjectId, e.teacherId, e.roomId ?? null,
            e.day, e.period, !!e.locked]
        )
      }
      // Saving demotes to draft: a published timetable must be re-approved.
      const upd = await client.query(
        `UPDATE timetables SET status = 'draft', updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2 RETURNING status, updated_at`,
        [row.id, tenantId]
      )
      await client.query('COMMIT')
      return { entries, status: upd.rows[0].status, updatedAt: upd.rows[0].updated_at }
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  async function setStatus(tenantId, status) {
    const r = await pool.query(
      `UPDATE timetables SET status = $2, updated_at = NOW(),
              published_at = CASE WHEN $2 = 'published' THEN NOW() ELSE published_at END
        WHERE tenant_id = $1
        RETURNING status, updated_at`,
      [tenantId, status]
    )
    if (!r.rows.length) throw new Error('no timetable to update for this school')
    return { status: r.rows[0].status, updatedAt: r.rows[0].updated_at }
  }

  async function schoolName(tenantId) {
    const r = await pool.query(
      'SELECT name FROM schools WHERE school_code = $1 LIMIT 1',
      [tenantId]
    )
    return r.rows.length ? r.rows[0].name : tenantId
  }

  async function listTenants() {
    const r = await pool.query('SELECT school_code AS id, name FROM schools ORDER BY school_code')
    return r.rows
  }

  return { driver: 'pg', listTenants, getConfig, saveConfig, getTimetable, saveEntries, setStatus, schoolName }
}

module.exports = { createPgStore }
