/* ==========================================================================
   fee-routes.js
   --------------------------------------------------------------------------
   The server side of the fee voucher generator: the real students, classes and
   fee rules of a school, plus the vouchers and receipts made from them.

   The money maths is not repeated here. Every calculation comes from
   voucher-engine.js (the same file the browser loads), so the printed challan,
   the collection screen and the stored records can never disagree about what
   is owed. This module only reads and writes rows, and hands the engine the
   same shape of data it already understands.

   Everything is scoped by tenant: a request only ever sees the academy it
   belongs to, and a coordinator only ever sees their own branch.

   Mounted at /api/fees by serverg.js.
   ========================================================================== */

const express = require('express')
const jwt = require('jsonwebtoken')
const E = require('./voucher-engine')
const { isCoordinator } = require('./authMiddleware')

const num = E.num
const DAY_MS = 24 * 60 * 60 * 1000

function createFeeRouter({ pool, requireAuth }) {
  const router = express.Router()
  const auth = requireAuth(['admin', 'super_admin', 'coordinator'])

  // --------------------------------------------------------------------------
  // Reading a school out of the database
  // --------------------------------------------------------------------------

  /** A voucher row becomes the object the fee engine works with. */
  function rowToVoucher(r) {
    return {
      id: r.ref_id,
      studentId: r.student_id,
      studentName: r.student_name || '',
      fatherName: r.father_name || '',
      admissionNumber: r.admission_number || '',
      className: r.class_name || '',
      classId: r.class_id,
      month: r.month,
      year: String(r.year),
      amount: num(r.amount),
      baseAmount: num(r.base_amount),
      discount: num(r.discount),
      charges: Array.isArray(r.charges) ? r.charges : [],
      status: r.status || 'Unpaid',
      issueDate: r.issue_date ? new Date(r.issue_date).toISOString() : null,
      dueDate: r.due_date ? new Date(r.due_date).toISOString() : null,
      paymentDate: r.payment_date ? new Date(r.payment_date).toISOString() : null,
      totalReceived: num(r.total_received),
      paidTuition: num(r.paid_tuition),
      paidAC: num(r.paid_ac),
      ...(r.fine_charged != null && { fineCharged: num(r.fine_charged) }),
      fineWaived: !!r.fine_waived,
      remainingAnnualCharges: num(r.remaining_annual_charges),
    }
  }

  /** A receipt row becomes the object the fee engine works with. */
  function rowToReceipt(r) {
    return {
      id: r.ref_id,
      receiptNo: r.receipt_no,
      voucherId: r.voucher_id,
      studentId: r.student_id,
      studentName: r.student_name || '',
      className: r.class_name || '',
      month: r.month || '',
      year: String(r.year || ''),
      paidTuition: num(r.paid_tuition),
      paidAC: num(r.paid_ac),
      amount: num(r.amount),
      receivedAt: new Date(r.received_at).toISOString(),
      receivedBy: r.received_by || '',
      receivedByName: r.received_by_name || '',
      paymentMethod: r.payment_method || '',
      paymentDate: r.payment_date ? (() => {
        const d = new Date(r.payment_date)
        const pad = (n) => String(n).padStart(2, '0')
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      })() : '',
      allocations: Array.isArray(r.allocations) ? r.allocations : [],
      reversedAt: r.reversed_at ? new Date(r.reversed_at).toISOString() : null,
      reversedBy: r.reversed_by || null,
    }
  }

  const FEE_EPOCH = '2000-01-01'

  /** 'YYYY-MM-DD' for a DATE column value or Date, in server-local time. */
  function isoDay(value) {
    if (value == null) return ''
    if (value instanceof Date) {
      const p = (n) => String(n).padStart(2, '0')
      return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`
    }
    return String(value).slice(0, 10)
  }

  /** The fee rule in force on `asOf`: newest non-voided version effective by then. */
  function pickFeeVersion(rows, asOf) {
    const day = asOf instanceof Date ? isoDay(asOf) : String(asOf ?? '').slice(0, 10)
    let best = null
    for (const row of rows ?? []) {
      if (row.voided) continue
      const eff = row.effective_from ? isoDay(row.effective_from) : FEE_EPOCH
      if (eff > day) continue
      const bestEff = best?.effective_from ? isoDay(best.effective_from) : FEE_EPOCH
      if (!best || eff > bestEff || (eff === bestEff && num(row.id) > num(best.id))) best = row
    }
    return best
  }

  /** The fee rules of one student: their own row wins over the class row, then the school default. */
  function feeFor(feeVersions, student, asOf) {
    const pick = (key) => pickFeeVersion(feeVersions.get(key), asOf)
    const row = pick(`student:${student.id}`)
      || (student.class_id != null ? pick(`class:${student.class_id}`) : null)
      || pick('school:0')
    return {
      monthlyFee: num(row?.monthly_fee),
      discount: num(row?.discount),
      admissionFee: num(row?.admission_fee),
      transportFee: num(row?.transport_fee),
    }
  }

  /**
   * Loads the whole school into the shape the fee engine expects:
   * settings, classes, students, vouchers and receipts.
   */
  async function loadDb(client, tenantId, user, asOf = new Date()) {
    const branchId = isCoordinator(user) ? user.branch_id : null

    const classQuery = branchId
      ? client.query('SELECT id, name, section FROM classes WHERE tenant_id = $1 AND branch_id = $2 ORDER BY id', [tenantId, branchId])
      : client.query('SELECT id, name, section FROM classes WHERE tenant_id = $1 ORDER BY id', [tenantId])
    const studentQuery = branchId
      ? client.query('SELECT id, name, roll_no, phone, class_id, login_id FROM students WHERE tenant_id = $1 AND branch_id = $2 ORDER BY name, id', [tenantId, branchId])
      : client.query('SELECT id, name, roll_no, phone, class_id, login_id FROM students WHERE tenant_id = $1 ORDER BY name, id', [tenantId])

    const [classesRes, studentsRes, feesRes, settingsRes, voucherRes, receiptRes] = await Promise.all([
      classQuery,
      studentQuery,
      client.query('SELECT id, type, target_id, monthly_fee, admission_fee, transport_fee, discount, effective_from, voided FROM fee_structures WHERE tenant_id = $1 ORDER BY effective_from, id', [tenantId]),
      client.query('SELECT due_days, late_fine, branding FROM fee_settings WHERE tenant_id = $1', [tenantId]),
      client.query('SELECT * FROM fee_vouchers WHERE tenant_id = $1 ORDER BY year, month, id', [tenantId]),
      client.query('SELECT * FROM fee_receipts WHERE tenant_id = $1 ORDER BY id', [tenantId]),
    ])

    // Every fee-structure version, grouped by scope; pickFeeVersion resolves
    // which one was in force on `asOf` (a billing month start, or today).
    const feeVersions = new Map()
    for (const row of feesRes.rows) {
      const key = `${row.type}:${row.target_id}`
      if (!feeVersions.has(key)) feeVersions.set(key, [])
      feeVersions.get(key).push(row)
    }

    // Annual charges already paid come from the receipts that are not reversed.
    const paidAnnual = new Map()
    for (const row of receiptRes.rows) {
      if (row.reversed_at) continue
      paidAnnual.set(row.student_id, num(paidAnnual.get(row.student_id)) + num(row.paid_ac))
    }

    const classes = classesRes.rows.map((c) => {
      const rule = pickFeeVersion(feeVersions.get(`class:${c.id}`), asOf)
      return {
        id: c.id,
        name: c.name,
        section: c.section || '',
        monthlyFee: num(rule?.monthly_fee),
        annualCharges: num(rule?.admission_fee),
      }
    })

    const students = studentsRes.rows.map((s) => {
      const fee = feeFor(feeVersions, s, asOf)
      return {
        id: s.id,
        name: s.name,
        fatherName: '',
        admissionNumber: s.roll_no || s.login_id || `ST-${s.id}`,
        classId: s.class_id,
        monthlyFee: fee.monthlyFee,
        discount: fee.discount,
        annualCharges: fee.admissionFee,
        paidAnnualCharges: num(paidAnnual.get(s.id)),
        monthlyCharges: fee.transportFee > 0 ? [{ label: 'Transport Fee', amount: fee.transportFee }] : [],
        parentPhone: s.phone || '',
        status: 'Active',
      }
    })

    const settingsRow = settingsRes.rows[0]
    const settings = {
      dueDays: settingsRow ? num(settingsRow.due_days) : E.DEFAULT_DUE_DAYS,
      lateFine: settingsRow ? num(settingsRow.late_fine) : 0,
    }

    const branding = (settingsRow && settingsRow.branding) || {}

    const fees = voucherRes.rows.map(rowToVoucher)
    const payments = receiptRes.rows.map(rowToReceipt)

    const counters = {
      voucher: fees.reduce((max, v) => Math.max(max, num(v.id)), 0),
      payment: payments.reduce((max, p) => Math.max(max, num(p.id)), 0),
    }

    return { settings, classes, students, fees, payments, counters, branding }
  }

  /** Vouchers with arrears, late fines and balances worked out fresh. */
  function decorate(db, vouchers) {
    const students = new Map(db.students.map((s) => [String(s.id), s]))
    return E.withBalances(vouchers, db.fees, students, db.settings)
  }

  const round2 = (v) => Math.round(v * 100) / 100

  /** Tidied saved-charge presets: name, positive amount, optional class scope. */
  function normalizePresets(list) {
    return (Array.isArray(list) ? list : [])
      .map((p, i) => ({
        id: p?.id || `p${i}`,
        label: String(p?.label ?? '').trim(),
        amount: round2(num(p?.amount)),
        classId: p?.classId == null ? '' : String(p.classId),
      }))
      .filter((p) => p.label && p.amount > 0)
  }

  /**
   * The preset list in force for a billing month. Versions live in
   * branding.chargePresetVersions as {effectiveFrom:'YYYY-MM', presets}.
   * Falls back to the legacy flat chargePresets for schools saved before
   * versioning existed.
   */
  function presetsForPeriod(branding, periodStart) {
    const versions = Array.isArray(branding?.chargePresetVersions) ? branding.chargePresetVersions : []
    const monthStr = `${periodStart.getFullYear()}-${String(periodStart.getMonth() + 1).padStart(2, '0')}`
    let best = null
    for (const v of versions) {
      const eff = String(v?.effectiveFrom || '')
      if (eff && eff <= monthStr && (!best || eff > best.eff)) best = { eff, presets: v.presets }
    }
    return normalizePresets(best ? best.presets : branding?.chargePresets)
  }

  /**
   * The saved challan charges that apply to this student: every school-wide
   * preset plus the ones scoped to the student's class. A preset whose name
   * is already a monthly charge (the transport fee, say) is not repeated.
   */
  function presetChargesFor(db, student, presets) {
    const taken = new Set((student.monthlyCharges ?? []).map((c) => String(c.label).toLowerCase()))
    const out = []
    for (const p of presets ?? []) {
      const label = String(p?.label ?? '').trim()
      const amount = num(p?.amount)
      if (!label || !(amount > 0) || taken.has(label.toLowerCase())) continue
      const scope = p?.classId == null ? '' : String(p.classId)
      if (scope !== '' && scope !== String(student.classId)) continue
      taken.add(label.toLowerCase())
      out.push({ label, amount })
    }
    return out
  }

  /** What one student's voucher for a period should bill, from effective config. */
  function voucherSpecFor(db, student, periodPresets) {
    const extra = presetChargesFor(db, student, periodPresets)
    const s = extra.length
      ? { ...student, monthlyCharges: [...(student.monthlyCharges ?? []), ...extra] }
      : student
    const baseAmount = num(s.monthlyFee)
    const discount = num(s.discount)
    const charges = E.cleanCharges(s.monthlyCharges)
    const amount = Math.max(0, baseAmount - discount) + charges.reduce((a, c) => a + num(c.amount), 0)
    return { baseAmount, discount, charges, amount }
  }

  function periodStartFor(month, year) {
    const monthIdx = E.MONTHS.indexOf(month)
    return new Date(Number(year), monthIdx < 0 ? 0 : monthIdx, 1)
  }

  /**
   * Works out what re-pricing one billing period would do WITHOUT writing:
   * create vouchers for students who have none, update amounts on vouchers
   * that are not fully paid, and leave Paid vouchers untouched.
   */
  function planPeriodReprice(db, month, year) {
    const periodStart = periodStartFor(month, year)
    const periodPresets = presetsForPeriod(db.branding, periodStart)
    const plan = { create: [], update: [], preserved: 0 }
    for (const student of db.students.filter((s) => !E.isLeft(s))) {
      const spec = voucherSpecFor(db, student, periodPresets)
      const existing = db.fees.find((v) =>
        String(v.studentId) === String(student.id) && v.month === month && String(v.year) === String(year))
      if (!existing) plan.create.push({ student, spec })
      else if (E.voucherStatus(existing) === 'Paid') plan.preserved++
      else plan.update.push({ voucher: existing, student, spec })
    }
    return plan
  }

  /**
   * Applies a reprice plan: new vouchers are created exactly like Generate,
   * open vouchers get new amounts while every paid rupee stays recorded,
   * and fully paid vouchers are never touched.
   */
  async function applyPeriodReprice(client, tenantId, db, plan, month, year) {
    const issued = new Date()
    const dueDate = new Date(issued.getTime() + db.settings.dueDays * DAY_MS)
    const classes = new Map(db.classes.map((c) => [String(c.id), c]))
    let created = 0
    let updated = 0
    for (const { student, spec } of plan.create) {
      const voucher = E.newVoucher(
        { ...student, monthlyCharges: spec.charges },
        E.classLabel(classes.get(String(student.classId)), student.classId),
        month, year, issued, dueDate
      )
      if (E.insertIfNew(db, voucher)) created++
    }
    for (const { voucher, student, spec } of plan.update) {
      voucher.amount = spec.amount
      voucher.baseAmount = spec.baseAmount
      voucher.discount = spec.discount
      voucher.charges = spec.charges
      voucher.remainingAnnualCharges = Math.max(0, num(student.annualCharges) - num(student.paidAnnualCharges))
      voucher.status = E.voucherStatus(voucher)
      updated++
    }
    await persist(client, tenantId, db)
    return { created, updated, preserved: plan.preserved }
  }

  // --------------------------------------------------------------------------
  // Writing back
  // --------------------------------------------------------------------------

  async function persist(client, tenantId, db) {
    for (const v of db.fees) {
      await client.query(
        `INSERT INTO fee_vouchers (
           tenant_id, ref_id, student_id, class_id, student_name, father_name, admission_number,
           class_name, month, year, amount, base_amount, discount, charges, status, issue_date,
           due_date, payment_date, total_received, paid_tuition, paid_ac, fine_charged,
           fine_waived, remaining_annual_charges, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24, NOW())
         ON CONFLICT (tenant_id, ref_id) DO UPDATE SET
           amount = EXCLUDED.amount, base_amount = EXCLUDED.base_amount, discount = EXCLUDED.discount,
           charges = EXCLUDED.charges, status = EXCLUDED.status, due_date = EXCLUDED.due_date,
           payment_date = EXCLUDED.payment_date, total_received = EXCLUDED.total_received,
           paid_tuition = EXCLUDED.paid_tuition, paid_ac = EXCLUDED.paid_ac,
           fine_charged = EXCLUDED.fine_charged, fine_waived = EXCLUDED.fine_waived,
           remaining_annual_charges = EXCLUDED.remaining_annual_charges, updated_at = NOW()`,
        [
          tenantId, num(v.id), v.studentId ?? null, v.classId ?? null, v.studentName || null,
          v.fatherName || null, v.admissionNumber || null, v.className || null, v.month, String(v.year),
          num(v.amount), num(v.baseAmount), num(v.discount), JSON.stringify(v.charges ?? []),
          v.status || 'Unpaid', v.issueDate || null, v.dueDate || null, v.paymentDate || null,
          num(v.totalReceived), num(v.paidTuition), num(v.paidAC),
          v.fineCharged == null ? null : num(v.fineCharged), !!v.fineWaived,
          num(v.remainingAnnualCharges),
        ]
      )
    }

    // A voucher that was reversed is gone from the list, so take it out of the database too.
    const refs = db.fees.map((v) => num(v.id))
    await client.query('DELETE FROM fee_vouchers WHERE tenant_id = $1 AND NOT (ref_id = ANY($2::int[]))', [tenantId, refs])

    for (const p of db.payments) {
      await client.query(
        `INSERT INTO fee_receipts (
           tenant_id, ref_id, receipt_no, voucher_id, student_id, student_name, class_name, month, year,
           paid_tuition, paid_ac, amount, allocations, received_at, received_by, received_by_name,
           payment_method, payment_date, reversed_at, reversed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18,$19,$20)
         ON CONFLICT (tenant_id, ref_id) DO UPDATE SET
           paid_tuition = EXCLUDED.paid_tuition, paid_ac = EXCLUDED.paid_ac, amount = EXCLUDED.amount,
           allocations = EXCLUDED.allocations, payment_method = EXCLUDED.payment_method,
           payment_date = EXCLUDED.payment_date,
           reversed_at = EXCLUDED.reversed_at, reversed_by = EXCLUDED.reversed_by`,
        [
          tenantId, num(p.id), p.receiptNo || `RCP-${num(p.id)}`, p.voucherId ?? null, p.studentId ?? null,
          p.studentName || null, p.className || null, p.month || null, p.year ? String(p.year) : null,
          num(p.paidTuition), num(p.paidAC), num(p.amount), JSON.stringify(p.allocations ?? []),
          p.receivedAt || new Date().toISOString(), p.receivedBy || null, p.receivedByName || null,
          p.paymentMethod || null, p.paymentDate || null,
          p.reversedAt || null, p.reversedBy || null,
        ]
      )
    }
  }

  /** Keeps the older Fees tab in step with what the voucher module records. */
  async function syncLegacyPayments(client, tenantId, db, receipt) {
    const lines = receipt?.allocations?.length
      ? receipt.allocations
      : [{ voucherId: receipt?.voucherId, amount: receipt?.paidTuition }]

    for (const line of lines) {
      const voucher = db.fees.find((v) => String(v.id) === String(line.voucherId))
      if (!voucher || voucher.studentId == null) continue
      const monthIndex = E.MONTHS.indexOf(String(voucher.month))
      const month = monthIndex >= 0 ? `${voucher.year}-${String(monthIndex + 1).padStart(2, '0')}` : `${voucher.year}-01`
      const paid = num(voucher.paidTuition) + num(voucher.paidAC)
      const status = num(voucher.paidTuition) >= num(voucher.amount) ? 'paid' : paid > 0 ? 'partial' : 'unpaid'
      await client.query(
        `INSERT INTO fee_payments (student_id, month, amount_due, amount_paid, status, tenant_id, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6, NOW())
         ON CONFLICT (student_id, month, tenant_id) DO UPDATE SET
           amount_due = EXCLUDED.amount_due, amount_paid = EXCLUDED.amount_paid,
           status = EXCLUDED.status, updated_at = NOW()`,
        [voucher.studentId, month, num(voucher.amount), paid, status, tenantId]
      )
    }
  }

  async function ensureSettings(client, tenantId) {
    await client.query(
      `INSERT INTO fee_settings (tenant_id, due_days, late_fine, branding)
       VALUES ($1, $2, $3, '{}'::jsonb) ON CONFLICT (tenant_id) DO NOTHING`,
      [tenantId, E.DEFAULT_DUE_DAYS, 0]
    )
    const res = await client.query('SELECT due_days, late_fine, branding FROM fee_settings WHERE tenant_id = $1', [tenantId])
    return res.rows[0] || { due_days: E.DEFAULT_DUE_DAYS, late_fine: 0, branding: {} }
  }

  /** Runs a write inside a transaction, so a refused change leaves nothing behind. */
  async function withTransaction(handler) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const result = await handler(client)
      await client.query('COMMIT')
      return result
    } catch (err) {
      try { await client.query('ROLLBACK') } catch (ignored) { /* the connection is already broken */ }
      throw err
    } finally {
      client.release()
    }
  }

  /** The message the fee engine refuses with, as a clean HTTP answer. */
  function sendError(res, err) {
    if (err instanceof E.Refused) return res.status(400).json({ error: err.message, refused: true })
    console.error('fee API error:', err.message)
    return res.status(500).json({ error: err.message || 'Something went wrong with the fee records.' })
  }

  // --------------------------------------------------------------------------
  // Routes
  // --------------------------------------------------------------------------

  /**
   * Is the fee service there, and is this browser signed in?
   *
   * The page asks this before anything else. It always answers with a 200, so
   * a browser that is not signed in gets a plain answer instead of an error
   * in the console, and knows to show the demo data instead.
   */
  router.get('/status', async (req, res) => {
    let signedIn = false;
    try {
      const header = req.headers['authorization'];
      const token = header && header.startsWith('Bearer ')
        ? header.slice(7)
        : req.cookies?.auth_token;
      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'theEye_Secret_2024_xK9mP2qR7vN');
        signedIn = !!decoded.tenant_id;
      }
    } catch (err) {
      signedIn = false;
    }
    res.json({ service: 'fees', signedIn });
  })

  /** Everything the page needs to start: the school's classes, students and rules. */
  router.get('/bootstrap', auth, async (req, res) => {
    try {
      const client = await pool.connect()
      try {
        const db = await loadDb(client, req.user.tenant_id, req.user)
        res.json({
          classes: db.classes,
          students: db.students,
          settings: db.settings,
          branding: db.branding,
          counts: {
            classes: db.classes.length,
            students: db.students.length,
            vouchers: db.fees.length,
          },
        })
      } finally {
        client.release()
      }
    } catch (err) {
      sendError(res, err)
    }
  })

  /** The vouchers of a billing cycle, with arrears and balances worked out. */
  router.get('/vouchers', auth, async (req, res) => {
    try {
      const client = await pool.connect()
      try {
        const db = await loadDb(client, req.user.tenant_id, req.user)
        let fees = db.fees

        const { month, year, classId, status, search } = req.query
        if (month && month !== 'all') fees = fees.filter((f) => f.month === month)
        if (year && year !== 'all') fees = fees.filter((f) => String(f.year) === String(year))
        if (classId && classId !== 'all') fees = fees.filter((f) => String(f.classId) === String(classId))
        if (status && status !== 'all') fees = fees.filter((f) => f.status === status)
        if (search) {
          const q = String(search).toLowerCase()
          fees = fees.filter((f) => [f.studentName, f.fatherName, f.admissionNumber, f.className]
            .some((v) => String(v ?? '').toLowerCase().includes(q)))
        }

        res.json(decorate(db, fees))
      } finally {
        client.release()
      }
    } catch (err) {
      sendError(res, err)
    }
  })

  /** Generates the vouchers of one month for a class, or for the whole school. */
  router.post('/vouchers/generate', auth, async (req, res) => {
    try {
      const body = req.body || {}
      const tenantId = req.user.tenant_id
      const month = body.month || E.MONTHS[new Date().getMonth()]
      const year = String(body.year || new Date().getFullYear())

      const count = await withTransaction(async (client) => {
        // Fees and presets resolve as they were in force for THIS billing
        // month, so a config saved for next month cannot leak backwards.
        const monthIdx = E.MONTHS.indexOf(month)
        const periodStart = new Date(Number(year), monthIdx < 0 ? new Date().getMonth() : monthIdx, 1)
        const db = await loadDb(client, tenantId, req.user, periodStart)
        const periodPresets = presetsForPeriod(db.branding, periodStart)
        const alreadyBilled = new Set(
          db.fees.filter((f) => f.month === month && String(f.year) === year).map((f) => String(f.studentId))
        )

        let targets = db.students.filter((s) => !E.isLeft(s))
        if (Array.isArray(body.studentIds) && body.studentIds.length) {
          targets = targets.filter((s) => body.studentIds.some((id) => String(id) === String(s.id)))
        } else if (body.classId && body.classId !== 'all') {
          targets = targets.filter((s) => String(s.classId) === String(body.classId))
        }

        const issued = new Date()
        const dueDate = new Date(issued.getTime() + db.settings.dueDays * DAY_MS)
        const classes = new Map(db.classes.map((c) => [String(c.id), c]))

        let made = 0
        for (const student of targets) {
          if (alreadyBilled.has(String(student.id))) continue
          const extra = presetChargesFor(db, student, periodPresets)
          const voucher = E.newVoucher(
            extra.length ? { ...student, monthlyCharges: [...(student.monthlyCharges ?? []), ...extra] } : student,
            E.classLabel(classes.get(String(student.classId)), student.classId),
            month,
            year,
            issued,
            dueDate
          )
          if (E.insertIfNew(db, voucher)) made++
        }

        await persist(client, tenantId, db)
        return made
      })

      res.json({ count, month, year })
    } catch (err) {
      sendError(res, err)
    }
  })

  // --------------------------------------------------------------------------
  // Fee configuration: versioned structures + scheduled presets
  // --------------------------------------------------------------------------

  const configAuth = requireAuth(['admin', 'super_admin'])

  /** Everything the Fee Configuration tab needs: rules in force, targets, presets. */
  router.get('/config', configAuth, async (req, res) => {
    try {
      const client = await pool.connect()
      try {
        const tenantId = req.user.tenant_id
        const today = new Date()
        const [classesRes, studentsRes, structRes, settingsRes] = await Promise.all([
          client.query('SELECT id, name, section FROM classes WHERE tenant_id = $1 ORDER BY id', [tenantId]),
          client.query('SELECT id, name, roll_no, class_id, login_id FROM students WHERE tenant_id = $1 ORDER BY name, id', [tenantId]),
          client.query('SELECT * FROM fee_structures WHERE tenant_id = $1 ORDER BY effective_from, id', [tenantId]),
          client.query('SELECT branding FROM fee_settings WHERE tenant_id = $1', [tenantId]),
        ])
        const classLabelOf = (id) => {
          const c = classesRes.rows.find((x) => String(x.id) === String(id))
          return c ? `${c.name}${c.section ? ' - ' + c.section : ''}` : null
        }
        const byKey = new Map()
        for (const r of structRes.rows) {
          const key = `${r.type}:${r.target_id}`
          if (!byKey.has(key)) byKey.set(key, [])
          byKey.get(key).push(r)
        }
        const structures = []
        for (const rows of byKey.values()) {
          const cur = pickFeeVersion(rows, today)
          if (cur) structures.push(cur)
        }
        const branding = settingsRes.rows[0]?.branding || {}
        res.json({
          classes: classesRes.rows.map((c) => ({ id: c.id, label: `${c.name}${c.section ? ' - ' + c.section : ''}` })),
          students: studentsRes.rows.map((s) => ({
            id: s.id, name: s.name, rollNo: s.roll_no || s.login_id || '',
            classId: s.class_id, className: classLabelOf(s.class_id),
          })),
          structures: structures.map((r) => ({
            id: r.id, type: r.type, target_id: r.target_id,
            effective_from: isoDay(r.effective_from),
            monthly_fee: num(r.monthly_fee), admission_fee: num(r.admission_fee),
            transport_fee: num(r.transport_fee), discount: num(r.discount),
          })),
          presets: presetsForPeriod(branding, today),
          presetVersions: Array.isArray(branding.chargePresetVersions) ? branding.chargePresetVersions : [],
        })
      } finally {
        client.release()
      }
    } catch (err) {
      sendError(res, err)
    }
  })

  /** Dry run: how many vouchers a reprice of a billing month would touch. */
  router.post('/config/preview', configAuth, async (req, res) => {
    try {
      const { month, year } = req.body || {}
      if (!E.MONTHS.includes(month) || !/^\d{4}$/.test(String(year))) {
        return res.status(400).json({ error: 'Pick a valid month and year.' })
      }
      const client = await pool.connect()
      try {
        const db = await loadDb(client, req.user.tenant_id, req.user, periodStartFor(month, String(year)))
        const plan = planPeriodReprice(db, month, String(year))
        res.json({
          month, year: String(year),
          students: db.students.filter((s) => !E.isLeft(s)).length,
          create: plan.create.length,
          update: plan.update.length,
          preserved: plan.preserved,
          affected: plan.create.length + plan.update.length,
        })
      } finally {
        client.release()
      }
    } catch (err) {
      sendError(res, err)
    }
  })

  /**
   * Saves the fee configuration as new effective-dated versions — old rows are
   * never rewritten, so history stays auditable — and optionally re-prices the
   * effective month's vouchers (unpaid/partial only; paid vouchers untouched).
   */
  router.post('/config/save', configAuth, async (req, res) => {
    try {
      const body = req.body || {}
      const eff = String(body.effectiveFrom || '')
      const effMatch = /^(\d{4})-(\d{2})$/.exec(eff)
      if (!effMatch) return res.status(400).json({ error: 'effectiveFrom must be YYYY-MM.' })
      const effMonthStr = eff
      const effDate = new Date(Number(effMatch[1]), Number(effMatch[2]) - 1, 1)
      const effIso = isoDay(effDate)

      const structures = Array.isArray(body.structures) ? body.structures : []
      const cleanStructures = []
      for (const s of structures) {
        const type = String(s?.type || '')
        if (!['school', 'class', 'student'].includes(type)) {
          return res.status(400).json({ error: `Unknown fee scope "${type}".` })
        }
        const target = type === 'school' ? 0 : parseInt(s?.target_id, 10)
        if (type !== 'school' && !Number.isFinite(target)) {
          return res.status(400).json({ error: 'Every class/student fee needs a target.' })
        }
        const amounts = {}
        for (const f of ['monthly_fee', 'admission_fee', 'transport_fee', 'discount']) {
          const v = Number(s?.[f])
          if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: `${f} must be a non-negative number.` })
          amounts[f] = v
        }
        cleanStructures.push({ type, target, voided: s?.voided === true, ...amounts })
      }
      const presets = normalizePresets(body.presets)
      const applyMonth = /^\d{4}-\d{2}$/.test(String(body.applyMonth || '')) ? String(body.applyMonth) : null

      const tenantId = req.user.tenant_id
      const result = await withTransaction(async (client) => {
        const existing = await client.query(
          'SELECT * FROM fee_structures WHERE tenant_id = $1 ORDER BY effective_from, id', [tenantId])
        let structuresSaved = 0
        for (const s of cleanStructures) {
          const key = `${s.type}:${s.target}`
          const rows = existing.rows.filter((r) => `${r.type}:${r.target_id}` === key)
          const dup = rows.some((r) =>
            isoDay(r.effective_from) === effIso && !!r.voided === s.voided &&
            num(r.monthly_fee) === s.monthly_fee && num(r.admission_fee) === s.admission_fee &&
            num(r.transport_fee) === s.transport_fee && num(r.discount) === s.discount)
          if (dup) continue
          await client.query(
            `INSERT INTO fee_structures (type, target_id, monthly_fee, admission_fee, transport_fee, discount, tenant_id, effective_from, voided, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())`,
            [s.type, s.target, s.monthly_fee, s.admission_fee, s.transport_fee, s.discount, tenantId, effIso, s.voided])
          structuresSaved++
        }

        // Presets: replace the version for this effective month, keep the rest.
        const settingsRes = await client.query('SELECT branding FROM fee_settings WHERE tenant_id = $1', [tenantId])
        const branding = (settingsRes.rows[0] && settingsRes.rows[0].branding) || {}
        const versions = (Array.isArray(branding.chargePresetVersions) ? branding.chargePresetVersions : [])
          .filter((v) => String(v?.effectiveFrom || '') !== effMonthStr)
        versions.push({ effectiveFrom: effMonthStr, presets })
        versions.sort((a, b) => String(a.effectiveFrom).localeCompare(String(b.effectiveFrom)))
        branding.chargePresetVersions = versions
        branding.chargePresets = presetsForPeriod(branding, new Date())
        await client.query(
          `INSERT INTO fee_settings (tenant_id, due_days, late_fine, branding, updated_at)
           VALUES ($1, 10, 0, $2::jsonb, NOW())
           ON CONFLICT (tenant_id) DO UPDATE SET branding = $2::jsonb, updated_at = NOW()`,
          [tenantId, JSON.stringify(branding)])

        let applied = null
        if (applyMonth) {
          const [ay, am] = applyMonth.split('-').map(Number)
          const applyMonthName = E.MONTHS[am - 1]
          const db = await loadDb(client, tenantId, req.user, new Date(ay, am - 1, 1))
          const plan = planPeriodReprice(db, applyMonthName, String(ay))
          applied = await applyPeriodReprice(client, tenantId, db, plan, applyMonthName, String(ay))
        }
        return { structuresSaved, presetsSaved: effMonthStr, applied }
      })

      res.json(result)
    } catch (err) {
      sendError(res, err)
    }
  })

  /** Replaces the charges on one voucher. */
  router.put('/vouchers/:id/charges', auth, async (req, res) => {
    try {
      const parsed = E.parseCharges((req.body || {}).charges)
      if (typeof parsed === 'string') return res.status(400).json({ error: parsed })

      const tenantId = req.user.tenant_id
      const voucher = await withTransaction(async (client) => {
        const db = await loadDb(client, tenantId, req.user)
        const result = E.setVoucherCharges(db, req.params.id, parsed)
        if (!result) return null
        await persist(client, tenantId, db)
        return result.voucher
      })

      if (!voucher) return res.status(404).json({ error: 'That voucher no longer exists.' })
      res.json({ voucher })
    } catch (err) {
      sendError(res, err)
    }
  })

  /** Adds one charge to many vouchers at once (an exam fee for a whole class, say). */
  router.post('/vouchers/charges', auth, async (req, res) => {
    try {
      const body = req.body || {}
      const parsed = E.parseCharges([body.charge])
      if (typeof parsed === 'string') return res.status(400).json({ error: parsed })

      const tenantId = req.user.tenant_id
      const result = await withTransaction(async (client) => {
        const db = await loadDb(client, tenantId, req.user)
        const outcome = E.addChargeToVouchers(db, body.voucherIds || [], parsed[0])
        await persist(client, tenantId, db)
        return outcome
      })

      res.json({ added: result.added.length, skipped: result.skipped })
    } catch (err) {
      sendError(res, err)
    }
  })

  /** Deletes a voucher and takes back every receipt that touched it. */
  router.delete('/vouchers/:id', auth, async (req, res) => {
    try {
      const tenantId = req.user.tenant_id
      const result = await withTransaction(async (client) => {
        const db = await loadDb(client, tenantId, req.user)
        const outcome = E.reverseVoucher(db, req.params.id)
        if (!outcome) return null
        await persist(client, tenantId, db)
        return outcome
      })

      if (!result) return res.status(404).json({ error: 'That voucher no longer exists.' })
      res.json({ takenBack: result.takenBack, receipts: result.receipts })
    } catch (err) {
      sendError(res, err)
    }
  })

  /** The payment method and date a receipt records, cleaned for storage. */
  function receiptPaymentFields(body) {
    const method = String((body || {}).paymentMethod || 'cash').trim().slice(0, 40) || 'cash'
    const rawDate = String((body || {}).paymentDate || '').trim()
    const paymentDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : new Date().toISOString().slice(0, 10)
    return { paymentMethod: method, paymentDate }
  }

  /** Takes a payment and issues the receipt for it. */
  router.post('/receipts', auth, async (req, res) => {
    try {
      const body = req.body || {}
      const tenantId = req.user.tenant_id
      const session = {
        username: req.user.login_id || String(req.user.user_id),
        displayName: req.user.login_id || String(req.user.user_id),
      }
      const fields = receiptPaymentFields(body)

      const result = await withTransaction(async (client) => {
        const db = await loadDb(client, tenantId, req.user)
        const outcome = E.receivePayment(db, body.voucherId, {
          paidTuition: E.num(body.paidTuition),
          paidAC: E.num(body.paidAC),
          waiveFine: !!body.waiveFine,
          advance: !!body.advance,
          monthlyCharges: body.monthlyCharges !== false,
        }, session)
        if (!outcome) return null
        outcome.receipt.receiptNo = `RCP-${tenantId}-${String(outcome.receipt.id).padStart(5, '0')}`
        outcome.receipt.paymentMethod = fields.paymentMethod
        outcome.receipt.paymentDate = fields.paymentDate
        await persist(client, tenantId, db)
        await syncLegacyPayments(client, tenantId, db, outcome.receipt)
        return outcome
      })

      if (!result) return res.status(404).json({ error: 'That voucher no longer exists.' })
      res.json({ receipt: result.receipt, voucher: result.voucher })
    } catch (err) {
      sendError(res, err)
    }
  })

  /**
   * Bulk collection: one payment per student, each with its own receipt.
   * Every item names the voucher the payment is anchored on (the student's
   * oldest open voucher); the engine spreads the money across that student's
   * unpaid months by itself. One bad item does not stop the others.
   */
  router.post('/receipts/bulk', auth, async (req, res) => {
    try {
      const body = req.body || {}
      const items = Array.isArray(body.items) ? body.items : []
      if (!items.length) return res.status(400).json({ error: 'No payments to record.' })
      if (items.length > 200) return res.status(400).json({ error: 'Too many payments in one go (max 200).' })

      const tenantId = req.user.tenant_id
      const session = {
        username: req.user.login_id || String(req.user.user_id),
        displayName: req.user.login_id || String(req.user.user_id),
      }
      const fields = receiptPaymentFields(body)

      const outcome = await withTransaction(async (client) => {
        const db = await loadDb(client, tenantId, req.user)
        const results = []
        for (const item of items) {
          const paidTuition = E.num(item && item.paidTuition)
          const paidAC = E.num(item && item.paidAC)
          if (!(paidTuition > 0) && !(paidAC > 0)) {
            results.push({ voucherId: item && item.voucherId, ok: false, error: 'Amount must be above zero.' })
            continue
          }
          try {
            const receipt = E.receivePayment(db, item && item.voucherId, {
              paidTuition,
              paidAC,
              waiveFine: !!(item && item.waiveFine),
              advance: !!(item && item.advance),
              monthlyCharges: !item || item.monthlyCharges !== false,
            }, session)
            if (!receipt) {
              results.push({ voucherId: item && item.voucherId, ok: false, error: 'That voucher no longer exists.' })
              continue
            }
            receipt.receipt.receiptNo = `RCP-${tenantId}-${String(receipt.receipt.id).padStart(5, '0')}`
            receipt.receipt.paymentMethod = fields.paymentMethod
            receipt.receipt.paymentDate = fields.paymentDate
            results.push({ voucherId: item.voucherId, ok: true, receipt: receipt.receipt, voucher: receipt.voucher })
          } catch (err) {
            results.push({ voucherId: item && item.voucherId, ok: false, error: err.message || 'Payment refused.' })
          }
        }
        const accepted = results.filter((r) => r.ok)
        if (accepted.length) {
          await persist(client, tenantId, db)
          for (const r of accepted) await syncLegacyPayments(client, tenantId, db, r.receipt)
        }
        return { results, accepted: accepted.length }
      })

      res.json(outcome)
    } catch (err) {
      sendError(res, err)
    }
  })

  /** Undoes a receipt: the money comes off the vouchers it reached. */
  router.post('/receipts/:id/reverse', auth, async (req, res) => {
    try {
      const tenantId = req.user.tenant_id
      const receipt = await withTransaction(async (client) => {
        const db = await loadDb(client, tenantId, req.user)
        const outcome = E.reverseReceipt(db, req.params.id)
        if (!outcome) return null
        await persist(client, tenantId, db)
        return outcome
      })

      if (!receipt) return res.status(404).json({ error: 'That receipt was already reversed.' })
      res.json({ receipt })
    } catch (err) {
      sendError(res, err)
    }
  })

  /** The receipts of a school, newest first. */
  router.get('/receipts', auth, async (req, res) => {
    try {
      const client = await pool.connect()
      try {
        const db = await loadDb(client, req.user.tenant_id, req.user)
        let receipts = db.payments
        if (req.query.studentId) {
          receipts = receipts.filter((p) => String(p.studentId) === String(req.query.studentId))
        }
        res.json([...receipts].sort((a, b) => num(b.id) - num(a.id)))
      } finally {
        client.release()
      }
    } catch (err) {
      sendError(res, err)
    }
  })

  /** The fee rules of the school: how many days a bill is good for, and the late fine. */
  router.get('/settings', auth, async (req, res) => {
    try {
      const client = await pool.connect()
      try {
        const db = await loadDb(client, req.user.tenant_id, req.user)
        res.json({ ...db.settings, branding: db.branding })
      } finally {
        client.release()
      }
    } catch (err) {
      sendError(res, err)
    }
  })

  router.put('/settings', auth, async (req, res) => {
    try {
      const body = req.body || {}
      const tenantId = req.user.tenant_id
      await withTransaction(async (client) => {
        await ensureSettings(client, tenantId)
        await client.query(
          `UPDATE fee_settings SET due_days = $2, late_fine = $3, updated_at = NOW() WHERE tenant_id = $1`,
          [tenantId, Math.max(0, Math.round(num(body.dueDays)) || 0), Math.max(0, E.roundRupees(num(body.lateFine)))]
        )
      })
      const client = await pool.connect()
      try {
        const db = await loadDb(client, tenantId, req.user)
        res.json({ ...db.settings, branding: db.branding })
      } finally {
        client.release()
      }
    } catch (err) {
      sendError(res, err)
    }
  })

  /** The school logo, bank details and saved charges used on the printed challan. */
  router.put('/branding', auth, async (req, res) => {
    try {
      const tenantId = req.user.tenant_id
      const branding = (req.body && req.body.branding) || {}
      await withTransaction(async (client) => {
        await ensureSettings(client, tenantId)
        await client.query(
          'UPDATE fee_settings SET branding = $2::jsonb, updated_at = NOW() WHERE tenant_id = $1',
          [tenantId, JSON.stringify(branding)]
        )
      })
      res.json({ branding })
    } catch (err) {
      sendError(res, err)
    }
  })

  return router
}

module.exports = { createFeeRouter }
