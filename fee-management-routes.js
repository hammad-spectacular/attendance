'use strict'

/* ==========================================================================
   fee-management-routes.js
   --------------------------------------------------------------------------
   REST API for the configurable fee system (fee_items -> obligations ->
   payments). Mounted at /api/fee-management by serverg.js.

   Every query is tenant-scoped; coordinators are additionally limited to
   their own branch, matching the voucher router's rules.
   ========================================================================== */

const express = require('express')
const D = require('./finance-domain')
const FM = require('./fee-management')
const { isCoordinator } = require('./authMiddleware')

const PAY_METHODS = ['cash', 'bank_transfer', 'cheque', 'card', 'online', 'other']

function createFeeManagementRouter({ pool, requireAuth }) {
  const router = express.Router()
  const auth = requireAuth(['admin', 'super_admin', 'coordinator'])

  const num = (v) => Number(v) || 0
  const today = () => new Date().toISOString().slice(0, 10)

  function sendError(res, err) {
    if (err && err.code === 'OVERPAY') return res.status(400).json({ error: err.message, overpay: true })
    if (err && err.code === 'NO_ADVANCE') return res.status(400).json({ error: err.message })
    console.error('fee-management API error:', err.message)
    return res.status(500).json({ error: err.message || 'Something went wrong with the fee records.' })
  }

  async function withTransaction(handler) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const result = await handler(client)
      await client.query('COMMIT')
      return result
    } catch (err) {
      try { await client.query('ROLLBACK') } catch (ignored) { /* connection already broken */ }
      throw err
    } finally {
      client.release()
    }
  }

  function scopeOf(user) {
    return { tenantId: user.tenant_id, branchId: isCoordinator(user) ? user.branch_id : null }
  }

  async function loadStudents(client, tenantId, branchId) {
    const branchClause = branchId != null ? 'AND s.branch_id = $2' : ''
    const params = branchId != null ? [tenantId, branchId] : [tenantId]
    const res = await client.query(
      `SELECT s.id, s.name, s.roll_no, s.phone, s.class_id, s.login_id, s.branch_id, s.is_frozen,
              s.created_at::date AS admission_date,
              c.name AS class_name, c.section AS class_section,
              b.name AS branch_name
         FROM students s
         LEFT JOIN classes c ON c.id = s.class_id AND c.tenant_id = s.tenant_id
         LEFT JOIN branches b ON b.id = s.branch_id
        WHERE s.tenant_id = $1 ${branchClause}
        ORDER BY s.name, s.id`,
      params
    )
    return res.rows.map(r => ({
      ...r,
      className: [r.class_name, r.class_section].filter(Boolean).join(' ') || null,
    }))
  }

  async function loadClasses(client, tenantId, branchId) {
    const res = branchId != null
      ? await client.query('SELECT id, name, section, branch_id FROM classes WHERE tenant_id = $1 AND branch_id = $2 ORDER BY id', [tenantId, branchId])
      : await client.query('SELECT id, name, section, branch_id FROM classes WHERE tenant_id = $1 ORDER BY id', [tenantId])
    return res.rows
  }

  async function loadItems(client, tenantId) {
    const res = await client.query(
      `SELECT fi.*,
              c.name AS class_name, c.section AS class_section,
              s.name AS student_name, s.roll_no AS student_roll
         FROM fee_items fi
         LEFT JOIN classes c ON c.id = fi.class_id AND c.tenant_id = fi.tenant_id
         LEFT JOIN students s ON s.id = fi.student_id AND s.tenant_id = fi.tenant_id
        WHERE fi.tenant_id = $1
        ORDER BY fi.level, fi.category, fi.name, fi.id`,
      [tenantId]
    )
    return res.rows
  }

  function itemOut(r) {
    return {
      id: r.id,
      level: r.level,
      classId: r.class_id,
      studentId: r.student_id,
      className: [r.class_name, r.class_section].filter(Boolean).join(' ') || null,
      studentName: r.student_name || null,
      studentRoll: r.student_roll || null,
      name: r.name,
      category: r.category,
      amount: num(r.amount).toFixed(2),
      frequency: r.frequency,
      billingMode: r.billing_mode,
      effectiveFrom: r.effective_from ? String(r.effective_from).slice(0, 10) : null,
      effectiveTo: r.effective_to ? String(r.effective_to).slice(0, 10) : null,
      dueDay: r.due_day,
      discountPercent: r.discount_percent == null ? null : num(r.discount_percent),
      discountAmount: r.discount_amount == null ? null : num(r.discount_amount).toFixed(2),
      exempt: !!r.exempt,
      isActive: r.is_active,
      notes: r.notes || null,
      createdAt: r.created_at,
    }
  }

  function obligationOut(r) {
    const paid = num(r.paid_amount)
    const finalAmt = num(r.final_amount)
    const remaining = Math.max(0, finalAmt - paid)
    return {
      id: r.id,
      studentId: r.student_id,
      studentName: r.student_name,
      studentRoll: r.student_roll,
      admissionNumber: r.admission_number,
      classId: r.class_id,
      className: r.class_name,
      branchId: r.branch_id,
      branchName: r.branch_name,
      feeItemId: r.fee_item_id,
      feeName: r.fee_name,
      category: r.category,
      frequency: r.frequency,
      appliedLevel: r.applied_level,
      originalAmount: num(r.original_amount).toFixed(2),
      discountAmount: num(r.discount_amount).toFixed(2),
      finalAmount: finalAmt.toFixed(2),
      paidAmount: paid.toFixed(2),
      remaining: remaining.toFixed(2),
      billingPeriodStart: r.billing_period_start ? String(r.billing_period_start).slice(0, 10) : null,
      billingPeriodEnd: r.billing_period_end ? String(r.billing_period_end).slice(0, 10) : null,
      periodLabel: r.period_label,
      dueDate: r.due_date ? String(r.due_date).slice(0, 10) : null,
      status: r.status,
      payStatus: FM.effectiveStatus({ ...r, paid: paid.toFixed(2), remaining: remaining.toFixed(2) }, today()),
      source: r.source,
      createdAt: r.created_at,
    }
  }

  const OBLIGATION_SELECT = `
    SELECT o.*,
           s.name AS student_name, s.roll_no AS student_roll, s.login_id AS admission_number,
           c.name AS class_name, c.section AS class_section,
           b.name AS branch_name,
           COALESCE((
             SELECT SUM(p.amount) FROM student_fee_payments p
              WHERE p.obligation_id = o.id AND p.tenant_id = o.tenant_id
                AND p.status = 'completed'
           ), 0) AS paid_amount
      FROM student_fee_obligations o
      JOIN students s ON s.id = o.student_id AND s.tenant_id = o.tenant_id
      LEFT JOIN classes c ON c.id = o.class_id AND c.tenant_id = o.tenant_id
      LEFT JOIN branches b ON b.id = o.branch_id`;

  function obligationQuery(tenantId, branchId, filters = {}) {
    const where = ['o.tenant_id = $1']
    const params = [tenantId]
    const push = (v) => { params.push(v); return `$${params.length}` }
    if (branchId != null) where.push(`o.branch_id = ${push(branchId)}`)
    if (filters.studentId) where.push(`o.student_id = ${push(filters.studentId)}`)
    if (filters.classId && filters.classId !== 'all') where.push(`o.class_id = ${push(filters.classId)}`)
    if (filters.category && filters.category !== 'all') where.push(`o.category = ${push(filters.category)}`)
    if (filters.feeName) where.push(`o.fee_name ILIKE '%' || ${push(filters.feeName)} || '%'`)
    if (filters.from) where.push(`o.billing_period_start >= ${push(filters.from)}`)
    if (filters.to) where.push(`o.billing_period_start <= ${push(filters.to)}`)
    if (filters.search) {
      const q = push(`%${filters.search}%`)
      where.push(`(s.name ILIKE ${q} OR s.roll_no ILIKE ${q} OR s.login_id ILIKE ${q})`)
    }
    return { sql: `${OBLIGATION_SELECT} WHERE ${where.join(' AND ')} ORDER BY o.due_date NULLS LAST, o.billing_period_start, s.name`, params }
  }

  // -------------------------------------------------------------------------
  // Bootstrap
  // -------------------------------------------------------------------------

  router.get('/bootstrap', auth, async (req, res) => {
    try {
      const client = await pool.connect()
      try {
        const { tenantId, branchId } = scopeOf(req.user)
        const [students, classes, items] = await Promise.all([
          loadStudents(client, tenantId, branchId),
          loadClasses(client, tenantId, branchId),
          loadItems(client, tenantId),
        ])
        res.json({
          students: students.map(s => ({
            id: s.id, name: s.name, rollNo: s.roll_no, admissionNumber: s.login_id || s.roll_no,
            classId: s.class_id, className: s.className, branchId: s.branch_id,
            branchName: s.branch_name, admissionDate: s.admission_date,
            frozen: !!s.is_frozen,
          })),
          classes: classes.map(c => ({ id: c.id, name: c.name, section: c.section, label: [c.name, c.section].filter(Boolean).join(' ') })),
          items: items.map(itemOut),
          categories: FM.CATEGORIES,
          frequencies: FM.FREQUENCIES,
          counts: { students: students.length, classes: classes.length, items: items.length },
        })
      } finally { client.release() }
    } catch (err) { sendError(res, err) }
  })

  // -------------------------------------------------------------------------
  // Fee items (configuration)
  // -------------------------------------------------------------------------

  router.get('/items', auth, async (req, res) => {
    try {
      const client = await pool.connect()
      try {
        const { tenantId } = scopeOf(req.user)
        const { level, classId, studentId, active } = req.query
        let items = await loadItems(client, tenantId)
        if (level && level !== 'all') items = items.filter(i => i.level === level)
        if (classId && classId !== 'all') items = items.filter(i => String(i.class_id) === String(classId))
        if (studentId && studentId !== 'all') items = items.filter(i => String(i.student_id) === String(studentId))
        if (active === 'true') items = items.filter(i => i.is_active)
        if (active === 'false') items = items.filter(i => !i.is_active)
        res.json(items.map(itemOut))
      } finally { client.release() }
    } catch (err) { sendError(res, err) }
  })

  function validateItem(body) {
    const name = String(body.name || '').trim()
    if (!name) return 'Fee name is required.'
    if (name.length > 150) return 'Fee name must be 150 characters or fewer.'
    const level = String(body.level || 'school')
    if (!['school', 'class', 'student'].includes(level)) return 'Level must be school, class or student.'
    const frequency = String(body.frequency || 'monthly')
    if (!FM.FREQUENCIES.includes(frequency)) return 'Frequency must be one of: ' + FM.FREQUENCIES.join(', ') + '.'
    const category = String(body.category || 'other').trim().toLowerCase()
    const amount = D.normalizeAmount(body.amount, { allowZero: true })
    if (amount === null) return 'Amount must be a valid number.'
    const effectiveFrom = FM.parseDate(body.effectiveFrom || body.effective_from)
    if (!effectiveFrom) return 'A valid effective date is required.'
    const effectiveTo = FM.parseDate(body.effectiveTo || body.effective_to)
    if ((body.effectiveTo || body.effective_to) && !effectiveTo) return 'Effective-to date is invalid.'
    if (effectiveTo && effectiveTo < effectiveFrom) return 'Effective-to cannot be before effective-from.'
    const dueDay = Math.min(31, Math.max(1, parseInt(body.dueDay ?? body.due_day, 10) || 10))
    const billingMode = body.billingMode === 'prorated' || body.billing_mode === 'prorated' ? 'prorated' : 'full'
    let discountPercent = null
    if (body.discountPercent != null && body.discountPercent !== '') {
      discountPercent = Number(body.discountPercent)
      if (!(discountPercent >= 0 && discountPercent <= 100)) return 'Discount percent must be between 0 and 100.'
    }
    let discountAmount = null
    if (body.discountAmount != null && body.discountAmount !== '') {
      discountAmount = D.normalizeAmount(body.discountAmount, { allowZero: true })
      if (discountAmount === null) return 'Discount amount is invalid.'
    }
    const classId = body.classId ?? body.class_id ?? null
    const studentId = body.studentId ?? body.student_id ?? null
    if (level === 'class' && classId == null) return 'Pick a class for a class-wise fee.'
    if (level === 'student' && studentId == null) return 'Pick a student for a student-wise fee.'
    if (level === 'school' && (classId != null || studentId != null)) return 'School-wise fees cannot target a class or student.'
    return {
      name, level, category, amount, frequency, effectiveFrom, effectiveTo,
      dueDay, billingMode, discountPercent, discountAmount,
      exempt: !!body.exempt, classId: level === 'class' ? classId : null,
      studentId: level === 'student' ? studentId : null,
      notes: String(body.notes || '').slice(0, 500) || null,
      isActive: body.isActive !== undefined ? !!body.isActive : body.is_active !== undefined ? !!body.is_active : true,
    }
  }

  router.post('/items', auth, async (req, res) => {
    try {
      const v = validateItem(req.body || {})
      if (typeof v === 'string') return res.status(400).json({ error: v })
      const { tenantId } = scopeOf(req.user)
      const row = await withTransaction(async (client) => {
        const r = await client.query(
          `INSERT INTO fee_items (tenant_id, level, class_id, student_id, name, category, amount,
             frequency, billing_mode, effective_from, effective_to, due_day,
             discount_percent, discount_amount, exempt, is_active, notes, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
           RETURNING *`,
          [tenantId, v.level, v.classId, v.studentId, v.name, v.category, v.amount,
           v.frequency, v.billingMode, v.effectiveFrom, v.effectiveTo, v.dueDay,
           v.discountPercent, v.discountAmount, v.exempt, v.isActive, v.notes,
           req.user.user_id ?? req.user.id ?? null]
        )
        return r.rows[0]
      })
      // New/changed config applies to future periods only; generate any
      // obligations that are already due for affected students.
      try {
        const client = await pool.connect()
        try {
          const students = await loadStudents(client, tenantId, scopeOf(req.user).branchId)
          const items = await loadItems(client, tenantId)
          const targets = v.level === 'student' ? students.filter(s => String(s.id) === String(v.studentId))
            : v.level === 'class' ? students.filter(s => String(s.class_id) === String(v.classId))
            : students
          await withTransaction(async (tx) => {
            for (const s of targets) {
              await FM.generateForStudent(tx, tenantId, s, items, { source: 'manual', monthsAhead: 12 })
            }
          })
        } finally { client.release() }
      } catch (genErr) {
        console.error('post-item generation failed (non-fatal):', genErr.message)
      }
      res.status(201).json(itemOut(row))
    } catch (err) { sendError(res, err) }
  })

  router.put('/items/:id', auth, async (req, res) => {
    try {
      const { tenantId } = scopeOf(req.user)
      const id = parseInt(req.params.id, 10)
      if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid fee id.' })
      const existing = await pool.query('SELECT * FROM fee_items WHERE id = $1 AND tenant_id = $2', [id, tenantId])
      if (!existing.rows.length) return res.status(404).json({ error: 'Fee not found.' })
      const v = validateItem({ ...itemOut(existing.rows[0]), ...req.body })
      if (typeof v === 'string') return res.status(400).json({ error: v })
      const row = await withTransaction(async (client) => {
        // Future unpaid obligations of this item pick up the new rate; paid
        // and historical rows are never rewritten.
        await client.query(
          `UPDATE student_fee_obligations o
              SET original_amount = $3,
                  discount_amount = CASE
                    WHEN $6 THEN o.original_amount
                    WHEN $7 IS NOT NULL THEN LEAST($3::numeric, $7::numeric)
                    WHEN $8 IS NOT NULL THEN ROUND($3::numeric * $8::numeric / 100, 2)
                    ELSE 0 END,
                  final_amount = GREATEST(0, $3::numeric - CASE
                    WHEN $6 THEN $3::numeric
                    WHEN $7 IS NOT NULL THEN LEAST($3::numeric, $7::numeric)
                    WHEN $8 IS NOT NULL THEN ROUND($3::numeric * $8::numeric / 100, 2)
                    ELSE 0 END),
                  status = CASE WHEN $6 OR ($3::numeric - CASE
                    WHEN $7 IS NOT NULL THEN LEAST($3::numeric, $7::numeric)
                    WHEN $8 IS NOT NULL THEN ROUND($3::numeric * $8::numeric / 100, 2)
                    ELSE 0 END) <= 0 THEN 'exempt' ELSE o.status END,
                  updated_at = NOW()
            WHERE o.tenant_id = $1 AND o.fee_item_id = $2
              AND o.status IN ('unpaid', 'overdue')
              AND o.billing_period_start >= CURRENT_DATE`,
          [tenantId, id, v.amount, v.exempt ? 1 : 0, null,
           v.exempt, v.discountAmount, v.discountPercent]
        )
        const r = await client.query(
          `UPDATE fee_items SET level=$2, class_id=$3, student_id=$4, name=$5, category=$6,
             amount=$7, frequency=$8, billing_mode=$9, effective_from=$10, effective_to=$11,
             due_day=$12, discount_percent=$13, discount_amount=$14, exempt=$15, is_active=$16,
             notes=$17, updated_at=NOW()
           WHERE id=$1 AND tenant_id=$18 RETURNING *`,
          [id, v.level, v.classId, v.studentId, v.name, v.category, v.amount,
           v.frequency, v.billingMode, v.effectiveFrom, v.effectiveTo, v.dueDay,
           v.discountPercent, v.discountAmount, v.exempt, v.isActive, v.notes, tenantId]
        )
        return r.rows[0]
      })
      if (!row) return res.status(404).json({ error: 'Fee not found.' })
      res.json(itemOut(row))
    } catch (err) { sendError(res, err) }
  })

  router.delete('/items/:id', auth, async (req, res) => {
    try {
      const { tenantId } = scopeOf(req.user)
      const id = parseInt(req.params.id, 10)
      if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid fee id.' })
      const result = await withTransaction(async (client) => {
        const upd = await client.query(
          'UPDATE fee_items SET is_active = false, updated_at = NOW() WHERE id = $1 AND tenant_id = $2 RETURNING id',
          [id, tenantId]
        )
        if (!upd.rows.length) return null
        // Deactivating stops future billing; unpaid future obligations of this
        // item are cancelled so they stop appearing as pending.
        await client.query(
          `UPDATE student_fee_obligations SET status = 'cancelled', updated_at = NOW()
            WHERE tenant_id = $1 AND fee_item_id = $2 AND status IN ('unpaid','overdue')
              AND billing_period_start >= CURRENT_DATE`,
          [tenantId, id]
        )
        return upd.rows[0]
      })
      if (!result) return res.status(404).json({ error: 'Fee not found.' })
      res.json({ deactivated: true })
    } catch (err) { sendError(res, err) }
  })

  // -------------------------------------------------------------------------
  // Obligation generation & reconciliation
  // -------------------------------------------------------------------------

  async function runGeneration(client, req, body = {}) {
    const { tenantId, branchId } = scopeOf(req.user)
    const [students, items] = await Promise.all([
      loadStudents(client, tenantId, branchId),
      loadItems(client, tenantId),
    ])
    return FM.generateForStudents(client, tenantId, students, items, {
      studentIds: body.studentIds,
      classId: body.classId,
      branchId,
      from: body.from,
      monthsAhead: body.monthsAhead,
      source: body.source || 'reconciliation',
      createdBy: req.user.user_id ?? req.user.id ?? null,
    })
  }

  router.post('/obligations/generate', auth, async (req, res) => {
    try {
      const body = req.body || {}
      const result = await withTransaction((client) => runGeneration(client, req, { ...body, source: 'manual' }))
      res.json(result)
    } catch (err) { sendError(res, err) }
  })

  router.post('/obligations/reconcile', auth, async (req, res) => {
    try {
      const body = req.body || {}
      const result = await withTransaction((client) => runGeneration(client, req, { ...body, source: 'reconciliation' }))
      res.json({ reconciled: true, ...result })
    } catch (err) { sendError(res, err) }
  })

  // -------------------------------------------------------------------------
  // Obligations (pending / balances)
  // -------------------------------------------------------------------------

  router.get('/obligations', auth, async (req, res) => {
    try {
      const { tenantId, branchId } = scopeOf(req.user)
      const client = await pool.connect()
      try {
        const { sql, params } = obligationQuery(tenantId, branchId, req.query)
        const res2 = await client.query(sql, params)
        let rows = res2.rows.map(obligationOut)
        const statusFilter = req.query.status
        if (statusFilter && statusFilter !== 'all') {
          rows = rows.filter(r => r.payStatus === statusFilter || r.status === statusFilter)
        }
        res.json(rows)
      } finally { client.release() }
    } catch (err) { sendError(res, err) }
  })

  router.get('/summary', auth, async (req, res) => {
    try {
      const { tenantId, branchId } = scopeOf(req.user)
      const client = await pool.connect()
      try {
        const { sql, params } = obligationQuery(tenantId, branchId, req.query)
        const res2 = await client.query(sql, params)
        const rows = res2.rows.map(obligationOut).filter(r => !['cancelled', 'waived'].includes(r.status))
        const sum = (f) => rows.reduce((a, r) => a + num(r[f]), 0)
        const byCategory = {}
        const byClass = {}
        const byStudent = {}
        for (const r of rows) {
          const rem = num(r.remaining)
          byCategory[r.category] = (byCategory[r.category] || 0) + rem
          const cls = r.className || 'Unassigned'
          byClass[cls] = (byClass[cls] || 0) + rem
          const st = `${r.studentName} (${r.studentRoll || r.admissionNumber || r.studentId})`
          byStudent[st] = (byStudent[st] || 0) + rem
        }
        res.json({
          assigned: sum('finalAmount').toFixed(2),
          collected: sum('paidAmount').toFixed(2),
          outstanding: sum('remaining').toFixed(2),
          overdue: rows.filter(r => r.payStatus === 'overdue').reduce((a, r) => a + num(r.remaining), 0).toFixed(2),
          obligations: rows.length,
          studentsWithDues: new Set(rows.filter(r => num(r.remaining) > 0).map(r => r.studentId)).size,
          byCategory, byClass, byStudent,
        })
      } finally { client.release() }
    } catch (err) { sendError(res, err) }
  })

  // -------------------------------------------------------------------------
  // Payments
  // -------------------------------------------------------------------------

  function paymentFields(body) {
    const method = PAY_METHODS.includes(body.paymentMethod) ? body.paymentMethod : 'cash'
    const date = FM.parseDate(body.paymentDate) || today()
    return { method, date }
  }

  /**
   * Records one student's payment. `amount` is split across that student's
   * open obligations oldest-due-first unless explicit `allocations`
   * [{obligationId, amount}] are supplied. One receipt_no per call.
   */
  async function recordStudentPayment(client, tenantId, req, studentId, body) {
    const amountCents = D.amountToCents(D.normalizeAmount(body.amount, { allowZero: true }))
    if (amountCents == null || amountCents <= 0n) {
      const err = new Error('Amount must be above zero.'); err.code = 'BAD_AMOUNT'; throw err
    }
    const { method, date } = paymentFields(body)
    const receivedBy = req.user.user_id ?? req.user.id ?? null
    const receivedByName = req.user.login_id || req.user.name || req.user.email || null

    const openRes = await client.query(
      `SELECT o.*,
              COALESCE((SELECT SUM(p.amount) FROM student_fee_payments p
                         WHERE p.obligation_id = o.id AND p.tenant_id = o.tenant_id
                           AND p.status = 'completed'), 0) AS paid
         FROM student_fee_obligations o
        WHERE o.tenant_id = $1 AND o.student_id = $2
          AND o.status NOT IN ('cancelled', 'waived', 'exempt')
        FOR UPDATE OF o`,
      [tenantId, studentId]
    )
    const obligations = openRes.rows.map(r => ({
      ...r,
      remaining: D.centsToAmount(D.amountToCents(D.normalizeAmount(r.final_amount, { allowZero: true })) - D.amountToCents(D.normalizeAmount(r.paid, { allowZero: true }))),
    }))

    let allocations
    if (Array.isArray(body.allocations) && body.allocations.length) {
      const wanted = new Map(body.allocations.map(a => [String(a.obligationId), D.amountToCents(D.normalizeAmount(a.amount, { allowZero: true }))]))
      const totalWanted = [...wanted.values()].reduce((a, b) => a + (b || 0n), 0n)
      if (totalWanted !== amountCents) {
        const err = new Error('Allocation amounts must add up to the payment amount.'); err.code = 'BAD_AMOUNT'; throw err
      }
      allocations = []
      for (const [oid, cents] of wanted) {
        const ob = obligations.find(o => String(o.id) === oid)
        if (!ob) { const e = new Error('One of the selected fees no longer exists.'); e.code = 'BAD_OBLIGATION'; throw e }
        const remainingC = D.amountToCents(D.normalizeAmount(ob.remaining, { allowZero: true }))
        if (cents == null || cents <= 0n || cents > remainingC) {
          const e = new Error('An allocation exceeds the remaining balance of that fee.'); e.code = 'OVERPAY'; throw e
        }
        allocations.push({ obligation: ob, amountCents: cents })
      }
    } else {
      allocations = FM.allocate(amountCents, obligations)
    }

    // Insert payment rows first (receipt number derives from the first id),
    // then refresh each obligation's stored status.
    const paymentIds = []
    for (const alloc of allocations) {
      const ins = await client.query(
        `INSERT INTO student_fee_payments (
           tenant_id, receipt_no, batch_id, student_id, obligation_id, amount,
           payment_date, payment_method, received_by, received_by_name, notes,
           idempotency_key)
         VALUES ($1,'',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id`,
        [tenantId, 'pending', studentId, alloc.obligation.id,
         D.centsToAmount(alloc.amountCents), date, method, receivedBy, receivedByName,
         String(body.notes || '').slice(0, 300) || null,
         `pay:${tenantId}:${studentId}:${date}:${method}:${alloc.obligation.id}:${D.centsToAmount(alloc.amountCents)}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`]
      )
      paymentIds.push(ins.rows[0].id)
    }
    const receiptNo = `RCP-${tenantId}-${String(paymentIds[0]).padStart(5, '0')}`
    const batchId = `B-${paymentIds[0]}`
    await client.query(
      `UPDATE student_fee_payments SET receipt_no = $1, batch_id = $2
        WHERE tenant_id = $3 AND id = ANY($4::bigint[])`,
      [receiptNo, batchId, tenantId, paymentIds]
    )

    const todayStr = today()
    for (const alloc of allocations) {
      const ob = alloc.obligation
      const finalC = D.amountToCents(D.normalizeAmount(ob.final_amount, { allowZero: true }))
      const paidC = D.amountToCents(D.normalizeAmount(ob.paid, { allowZero: true })) + alloc.amountCents
      const newStatus = FM.statusAfterPayment(paidC, finalC, ob.due_date, todayStr)
      await client.query(
        `UPDATE student_fee_obligations SET status = $3, updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2`,
        [ob.id, tenantId, newStatus]
      )
    }

    return { receiptNo, batchId, paymentIds, allocations: allocations.map(a => ({ obligationId: a.obligation.id, feeName: a.obligation.fee_name, amount: D.centsToAmount(a.amountCents) })) }
  }

  router.post('/payments', auth, async (req, res) => {
    try {
      const body = req.body || {}
      const studentId = parseInt(body.studentId ?? body.student_id, 10)
      if (Number.isNaN(studentId)) return res.status(400).json({ error: 'studentId is required.' })
      const { tenantId } = scopeOf(req.user)
      const result = await withTransaction((client) => recordStudentPayment(client, tenantId, req, studentId, body))
      res.json(result)
    } catch (err) {
      if (err.code === 'BAD_AMOUNT') return res.status(400).json({ error: err.message })
      if (err.code === 'BAD_OBLIGATION') return res.status(404).json({ error: err.message })
      sendError(res, err)
    }
  })

  router.post('/payments/bulk', auth, async (req, res) => {
    try {
      const body = req.body || {}
      const items = Array.isArray(body.items) ? body.items : []
      if (!items.length) return res.status(400).json({ error: 'No payments to record.' })
      if (items.length > 200) return res.status(400).json({ error: 'Too many payments in one go (max 200).' })
      const { tenantId } = scopeOf(req.user)

      const outcome = await withTransaction(async (client) => {
        const results = []
        for (const item of items) {
          const studentId = parseInt(item && item.studentId, 10)
          try {
            const r = await recordStudentPayment(client, tenantId, req, studentId, { ...item, paymentMethod: body.paymentMethod || item.paymentMethod, paymentDate: body.paymentDate || item.paymentDate })
            results.push({ studentId, ok: true, ...r })
          } catch (err) {
            results.push({ studentId, ok: false, error: err.message || 'Payment refused.' })
          }
        }
        return { results, accepted: results.filter(r => r.ok).length }
      })
      res.json(outcome)
    } catch (err) { sendError(res, err) }
  })

  router.get('/payments', auth, async (req, res) => {
    try {
      const { tenantId, branchId } = scopeOf(req.user)
      const client = await pool.connect()
      try {
        const where = ['p.tenant_id = $1']
        const params = [tenantId]
        const push = (v) => { params.push(v); return `$${params.length}` }
        if (branchId != null) where.push(`o.branch_id = ${push(branchId)}`)
        if (req.query.studentId) where.push(`p.student_id = ${push(req.query.studentId)}`)
        if (req.query.receiptNo) where.push(`p.receipt_no = ${push(req.query.receiptNo)}`)
        if (req.query.status === 'reversed') where.push(`p.status = 'reversed'`)
        else if (req.query.status === 'completed') where.push(`p.status = 'completed'`)
        const res2 = await client.query(
          `SELECT p.*, s.name AS student_name, s.roll_no AS student_roll, s.login_id AS admission_number,
                  c.name AS class_name, c.section AS class_section,
                  o.fee_name, o.category, o.period_label, o.billing_period_start, o.billing_period_end
             FROM student_fee_payments p
             JOIN student_fee_obligations o ON o.id = p.obligation_id AND o.tenant_id = p.tenant_id
             JOIN students s ON s.id = p.student_id AND s.tenant_id = p.tenant_id
             LEFT JOIN classes c ON c.id = o.class_id AND c.tenant_id = o.tenant_id
            WHERE ${where.join(' AND ')}
            ORDER BY p.payment_date DESC, p.receipt_no DESC, p.id DESC`,
          params
        )
        // Group allocation rows into receipts for the history view, while
        // keeping every allocation visible.
        const receipts = new Map()
        for (const r of res2.rows) {
          const key = r.receipt_no
          if (!receipts.has(key)) {
            receipts.set(key, {
              receiptNo: r.receipt_no, batchId: r.batch_id, studentId: r.student_id,
              studentName: r.student_name, studentRoll: r.student_roll,
              admissionNumber: r.admission_number,
              className: [r.class_name, r.class_section].filter(Boolean).join(' ') || null,
              amount: 0, paymentDate: r.payment_date ? String(r.payment_date).slice(0, 10) : null,
              paymentMethod: r.payment_method, receivedBy: r.received_by_name || r.received_by_name,
              receivedByName: r.received_by_name, status: r.status,
              reversedAt: r.reversed_at, reversedBy: r.reversed_by,
              createdAt: r.created_at, allocations: [], paymentIds: [],
            })
          }
          const rec = receipts.get(key)
          rec.amount += num(r.amount)
          rec.allocations.push({
            obligationId: r.obligation_id, feeName: r.fee_name, category: r.category,
            periodLabel: r.period_label, billingPeriodStart: r.billing_period_start ? String(r.billing_period_start).slice(0, 10) : null,
            amount: num(r.amount).toFixed(2), paymentId: r.id,
          })
          rec.paymentIds.push(r.id)
          if (r.status === 'reversed' && rec.status !== 'reversed') {
            rec.status = 'reversed'; rec.reversedAt = r.reversed_at; rec.reversedBy = r.reversed_by
          }
        }
        res.json([...receipts.values()].map(r => ({ ...r, amount: r.amount.toFixed(2) })))
      } finally { client.release() }
    } catch (err) { sendError(res, err) }
  })

  /** Controlled correction: reverses every allocation of one receipt. */
  router.post('/payments/:id/reverse', auth, async (req, res) => {
    try {
      const { tenantId } = scopeOf(req.user)
      const id = parseInt(req.params.id, 10)
      if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid payment id.' })
      const result = await withTransaction(async (client) => {
        const found = await client.query(
          'SELECT receipt_no, student_id FROM student_fee_payments WHERE id = $1 AND tenant_id = $2',
          [id, tenantId]
        )
        if (!found.rows.length) return null
        const { receipt_no, student_id } = found.rows[0]
        const reversed = await client.query(
          `UPDATE student_fee_payments
              SET status = 'reversed', reversed_at = NOW(), reversed_by = $4
            WHERE tenant_id = $1 AND receipt_no = $2 AND student_id = $3 AND status = 'completed'
            RETURNING id, obligation_id, amount`,
          [tenantId, receipt_no, student_id, req.user.login_id || String(req.user.user_id || '')]
        )
        // Recompute each touched obligation's status and stored status field.
        const touched = new Map()
        for (const p of reversed.rows) {
          if (!touched.has(String(p.obligation_id))) touched.set(String(p.obligation_id), p.obligation_id)
        }
        const todayStr = today()
        for (const obId of touched.values()) {
          const agg = await client.query(
            `SELECT o.final_amount, o.due_date,
                    COALESCE((SELECT SUM(p.amount) FROM student_fee_payments p
                               WHERE p.obligation_id = o.id AND p.tenant_id = o.tenant_id
                                 AND p.status = 'completed'), 0) AS paid
               FROM student_fee_obligations o WHERE o.id = $1 AND o.tenant_id = $2`,
            [obId, tenantId]
          )
          const row = agg.rows[0]
          if (!row) continue
          const paidC = D.amountToCents(D.normalizeAmount(row.paid, { allowZero: true })) || 0n
          const finalC = D.amountToCents(D.normalizeAmount(row.final_amount, { allowZero: true })) || 0n
          await client.query(
            'UPDATE student_fee_obligations SET status = $3, updated_at = NOW() WHERE id = $1 AND tenant_id = $2',
            [obId, tenantId, FM.statusAfterPayment(paidC, finalC, row.due_date, todayStr)]
          )
        }
        return { receiptNo: receipt_no, reversed: reversed.rows.length }
      })
      if (!result) return res.status(404).json({ error: 'Payment not found.' })
      res.json(result)
    } catch (err) { sendError(res, err) }
  })

  // -------------------------------------------------------------------------
  // Per-student fee view
  // -------------------------------------------------------------------------

  router.get('/students/:id', auth, async (req, res) => {
    try {
      const { tenantId, branchId } = scopeOf(req.user)
      const id = parseInt(req.params.id, 10)
      if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid student id.' })
      const client = await pool.connect()
      try {
        const sRes = await client.query(
          `SELECT s.id, s.name, s.roll_no, s.login_id, s.class_id, s.branch_id, s.is_frozen,
                  s.created_at::date AS admission_date,
                  c.name AS class_name, c.section AS class_section, b.name AS branch_name
             FROM students s
             LEFT JOIN classes c ON c.id = s.class_id AND c.tenant_id = s.tenant_id
             LEFT JOIN branches b ON b.id = s.branch_id
            WHERE s.id = $1 AND s.tenant_id = $2`,
          [id, tenantId]
        )
        if (!sRes.rows.length) return res.status(404).json({ error: 'Student not found.' })
        const student = sRes.rows[0]
        if (branchId != null && student.branch_id != null && String(student.branch_id) !== String(branchId)) {
          return res.status(404).json({ error: 'Student not found.' })
        }
        const { sql, params } = obligationQuery(tenantId, branchId, { studentId: id })
        const obs = (await client.query(sql, params)).rows.map(obligationOut)
        const pays = await client.query(
          `SELECT p.*, o.fee_name, o.period_label
             FROM student_fee_payments p
             JOIN student_fee_obligations o ON o.id = p.obligation_id AND o.tenant_id = p.tenant_id
            WHERE p.tenant_id = $1 AND p.student_id = $2
            ORDER BY p.payment_date DESC, p.id DESC`,
          [tenantId, id]
        )
        res.json({
          student: {
            id: student.id, name: student.name, rollNo: student.roll_no,
            admissionNumber: student.login_id || student.roll_no,
            classId: student.class_id,
            className: [student.class_name, student.class_section].filter(Boolean).join(' ') || null,
            branchName: student.branch_name, admissionDate: student.admission_date,
            frozen: !!student.is_frozen,
          },
          obligations: obs,
          payments: pays.rows.map(p => ({
            id: p.id, receiptNo: p.receipt_no, obligationId: p.obligation_id,
            feeName: p.fee_name, periodLabel: p.period_label, amount: num(p.amount).toFixed(2),
            paymentDate: p.payment_date ? String(p.payment_date).slice(0, 10) : null,
            paymentMethod: p.payment_method, receivedByName: p.received_by_name,
            status: p.status, reversedAt: p.reversed_at, createdAt: p.created_at,
          })),
        })
      } finally { client.release() }
    } catch (err) { sendError(res, err) }
  })

  return router
}

module.exports = { createFeeManagementRouter }
