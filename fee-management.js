'use strict'

/* ==========================================================================
   fee-management.js
   --------------------------------------------------------------------------
   Domain logic for the configurable student fee system:

     fee_items (school / class / student level)
        -> student_fee_obligations (one row per fee per billing period)
        -> student_fee_payments   (allocations against obligations)

   The module is deliberately free of Express concerns: every function takes a
   pg client/pool and plain objects, so the same code runs inside registration,
   reconciliation, class changes and the REST routes. Money maths reuses
   finance-domain.js so amounts can never drift into floats.
   ========================================================================== */

const D = require('./finance-domain')

const FREQUENCIES = ['one_time', 'monthly', 'quarterly', 'annually', 'per_term']
const FREQ_MONTH_STEP = { monthly: 1, quarterly: 3, annually: 12, per_term: 4 }
const STATUSES = ['unpaid', 'partially_paid', 'paid', 'overdue', 'exempt', 'waived', 'cancelled']
const CATEGORIES = ['tuition', 'admission', 'transport', 'exam', 'activity', 'hostel', 'fine', 'other']

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function normName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function parseDate(value) {
  if (value == null || value === '') return null
  if (value instanceof Date) return isNaN(value) ? null : value.toISOString().slice(0, 10)
  const s = String(value).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function addMonths(dateStr, months) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1 + months, 1))
  const lastDay = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate()
  dt.setUTCDate(Math.min(d, lastDay))
  return dt.toISOString().slice(0, 10)
}

function monthStart(dateStr) {
  return dateStr.slice(0, 7) + '-01'
}

function daysInMonth(dateStr) {
  const [y, m] = dateStr.slice(0, 7).split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

function periodLabel(frequency, periodStart) {
  const [y, m] = periodStart.slice(0, 7).split('-').map(Number)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  if (frequency === 'monthly') return `${months[m - 1]} ${y}`
  if (frequency === 'quarterly') return `Q${Math.floor((m - 1) / 3) + 1} ${y}`
  if (frequency === 'annually') return `${y}`
  if (frequency === 'per_term') return `Term ${Math.floor((m - 1) / 4) + 1} ${y}`
  return 'One-time'
}

/** Due date inside the period's first month, clamped to month length. */
function dueDateFor(periodStart, dueDay) {
  const [y, m] = periodStart.slice(0, 7).split('-').map(Number)
  const dim = daysInMonth(periodStart)
  const day = Math.min(Math.max(1, Number(dueDay) || 10), dim)
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Fee resolution: student > class > school, matched by normalised fee name.
// A student-level row for a name that no school/class row defines is an
// independent additional charge — it can never replace tuition.
// ---------------------------------------------------------------------------

function resolveStudentFees(items, student) {
  const byName = new Map()
  const extras = []
  for (const item of items) {
    if (!item.is_active) continue
    const key = normName(item.name)
    if (!key) continue
    const lvl = item.level
    if (lvl === 'school') {
      if (!byName.has(key)) byName.set(key, { school: item })
      else byName.get(key).school = item
    } else if (lvl === 'class') {
      if (String(item.class_id) !== String(student.class_id)) continue
      if (!byName.has(key)) byName.set(key, { klass: item })
      else byName.get(key).klass = item
    } else if (lvl === 'student') {
      if (String(item.student_id) !== String(student.id)) continue
      const slot = byName.get(key) || {}
      slot.student = item
      byName.set(key, slot)
    }
  }

  const resolved = []
  for (const [key, slot] of byName) {
    const winner = slot.student || slot.klass || slot.school
    if (!winner) continue
    // A student-level row that only exists to discount must still carry an
    // amount; we treat its amount as the rate and its discount fields as the
    // adjustment. If the student row omits amount intent we keep winner.amount.
    resolved.push({ key, winner, level: winner.level })
  }
  return resolved
}

function discountFor(item, originalCents) {
  // Returns discount in cents. Explicit amount wins over percent.
  if (item.discount_amount != null) {
    const c = D.amountToCents(D.normalizeAmount(item.discount_amount, { allowZero: true }))
    if (c != null) return c > originalCents ? originalCents : c
  }
  if (item.discount_percent != null) {
    const pct = Number(item.discount_percent)
    if (pct > 0) return (originalCents * BigInt(Math.round(pct * 100))) / 10000n
  }
  return 0n
}

// ---------------------------------------------------------------------------
// Billing periods
// ---------------------------------------------------------------------------

function* periodStarts(item, anchorDate, horizonDate) {
  if (item.frequency === 'one_time') {
    yield anchorDate
    return
  }
  const step = FREQ_MONTH_STEP[item.frequency] || 1
  // Anchor recurring periods to the month of effective_from so quarterly /
  // annual cycles stay aligned to the fee's own calendar.
  let cursor = monthStart(item.effective_from < anchorDate ? item.effective_from : anchorDate)
  // If the anchor month is earlier than effective_from's month we still start
  // at effective month; periods before anchor are simply not yielded.
  cursor = monthStart(item.effective_from > anchorDate ? item.effective_from : anchorDate)
  while (cursor <= horizonDate) {
    yield cursor
    cursor = monthStart(addMonths(cursor, step))
  }
}

function periodEndFor(periodStart, frequency) {
  if (frequency === 'one_time') return periodStart
  const step = FREQ_MONTH_STEP[frequency] || 1
  const next = addMonths(periodStart, step)
  // Last day of the month before the next period starts.
  const [y, m] = next.slice(0, 7).split('-').map(Number)
  const last = new Date(Date.UTC(y, m - 1, 0))
  const py = last.getUTCFullYear()
  const pm = last.getUTCMonth() + 1
  return `${py}-${String(pm).padStart(2, '0')}-${String(last.getUTCDate()).padStart(2, '0')}`
}

/** Prorated amount for a mid-period admission, in cents. */
function proratedCents(fullCents, anchorDate, periodStart, periodEnd) {
  if (anchorDate <= periodStart) return fullCents
  if (anchorDate > periodEnd) return 0n
  const dim = daysInMonth(periodStart)
  const startDay = Number(periodStart.slice(8, 10))
  const admitDay = Number(anchorDate.slice(8, 10))
  const remaining = dim - admitDay + 1
  if (remaining >= dim) return fullCents
  // round half up, exact integer math (dim can be odd)
  return (fullCents * BigInt(remaining) * 2n + BigInt(dim)) / (BigInt(dim) * 2n)
}

// ---------------------------------------------------------------------------
// Obligation generation
// ---------------------------------------------------------------------------

function idempotencyKey(studentId, itemId, periodStart) {
  return `${studentId}:${itemId || 'x'}:${periodStart}`
}

/**
 * Generates obligations for one student inside an existing transaction.
 * options: { from, monthsAhead, source, createdBy }
 * Returns { created, skipped }.
 */
async function generateForStudent(client, tenantId, student, items, options = {}) {
  const today = todayIso()
  const admission = parseDate(student.admission_date || student.created_at) || today
  const from = parseDate(options.from) || admission
  const horizon = addMonths(today, Number(options.monthsAhead) || 12)
  const source = options.source || 'manual'
  const createdBy = options.createdBy ?? null

  let created = 0
  let skipped = 0
  const feeItems = resolveStudentFees(items, student)

  for (const { winner, level } of feeItems) {
    if (!winner.is_active) continue
    // Class-dependent charges wait until a class is assigned.
    if (level === 'class' && student.class_id == null) continue

    const effFrom = parseDate(winner.effective_from) || today
    const effTo = parseDate(winner.effective_to)
    if (effTo && effTo < from) continue

    const fullCents = D.amountToCents(D.normalizeAmount(winner.amount, { allowZero: true }))
    if (fullCents == null) continue

    const itemAnchor = effFrom > from ? effFrom : from
    for (const periodStart of periodStarts(winner, itemAnchor, horizon)) {
      if (effTo && periodStart > effTo) break
      const periodEnd = periodEndFor(periodStart, winner.frequency)
      if (periodEnd < from) continue

      // First-period proration for mid-month admissions on recurring fees.
      let amountCents = fullCents
      if (winner.frequency !== 'one_time' && winner.billing_mode === 'prorated') {
        amountCents = proratedCents(fullCents, admission > itemAnchor ? admission : itemAnchor, periodStart, periodEnd)
      }
      if (winner.frequency === 'one_time') {
        // One-time fees bill once, on the later of effective date / admission.
        if (periodStart !== itemAnchor) continue
      }

      let original = amountCents
      let discount = winner.exempt ? original : discountFor(winner, original)
      if (winner.exempt) discount = original
      let finalC = original - discount
      if (finalC < 0n) finalC = 0n

      const status = winner.exempt || finalC === 0n ? 'exempt' : 'unpaid'
      const res = await client.query(
        `INSERT INTO student_fee_obligations (
           tenant_id, student_id, class_id, branch_id, fee_item_id, fee_name, category,
           frequency, applied_level, original_amount, discount_amount, final_amount,
           billing_period_start, billing_period_end, period_label, due_date, status,
           source, idempotency_key, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
         RETURNING id`,
        [
          tenantId, student.id, student.class_id ?? null, student.branch_id ?? null,
          winner.id, winner.name, winner.category || 'other', winner.frequency, level,
          D.centsToAmount(original), D.centsToAmount(discount), D.centsToAmount(finalC),
          periodStart, periodEnd, periodLabel(winner.frequency, periodStart),
          dueDateFor(periodStart, winner.due_day), status, source,
          idempotencyKey(student.id, winner.id, periodStart), createdBy,
        ]
      )
      if (res.rows.length) created++
      else skipped++
    }
  }
  return { created, skipped }
}

/**
 * Generates obligations for a set of students. options may carry
 * studentIds / classId / all flags plus generation options.
 */
async function generateForStudents(client, tenantId, students, items, options = {}) {
  const isCoordinatorScoped = options.branchId != null
  let targets = students.filter(s => !s.is_frozen && s.status !== 'withdrawn' && s.status !== 'left')
  if (isCoordinatorScoped) targets = targets.filter(s => s.branch_id == null || String(s.branch_id) === String(options.branchId))
  if (Array.isArray(options.studentIds) && options.studentIds.length) {
    const wanted = new Set(options.studentIds.map(String))
    targets = targets.filter(s => wanted.has(String(s.id)))
  } else if (options.classId && options.classId !== 'all') {
    targets = targets.filter(s => String(s.class_id) === String(options.classId))
  }

  let created = 0
  let skipped = 0
  const perStudent = []
  for (const student of targets) {
    const outcome = await generateForStudent(client, tenantId, student, items, {
      ...options,
      source: options.source || 'reconciliation',
    })
    created += outcome.created
    skipped += outcome.skipped
    if (outcome.created) perStudent.push({ studentId: student.id, created: outcome.created })
  }
  return { created, skipped, students: perStudent.length, perStudent }
}

/**
 * A class change cancels unpaid class-level obligations starting on/after the
 * change date, then regenerates so future periods bill at the new rates.
 * Paid, partially paid and historical rows are never touched.
 */
async function handleClassChange(client, tenantId, student, items, options = {}) {
  const today = todayIso()
  const cancelled = await client.query(
    `UPDATE student_fee_obligations
        SET status = 'cancelled', updated_at = NOW()
      WHERE tenant_id = $1 AND student_id = $2 AND applied_level = 'class'
        AND status IN ('unpaid', 'overdue')
        AND billing_period_start >= $3
      RETURNING id`,
    [tenantId, student.id, today]
  )
  const generated = await generateForStudent(client, tenantId, student, items, {
    ...options,
    source: 'class_change',
  })
  return { cancelled: cancelled.rows.length, ...generated }
}

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

/** Effective display status from stored status + paid/remaining + due date. */
function effectiveStatus(row, today = todayIso()) {
  if (['exempt', 'waived', 'cancelled', 'paid'].includes(row.status)) return row.status
  const remaining = D.amountToCents(D.normalizeAmount(row.remaining, { allowZero: true }))
  if (remaining == null) return row.status
  if (remaining === 0n) return 'paid'
  const paidC = D.amountToCents(D.normalizeAmount(row.paid, { allowZero: true })) || 0n
  if (paidC > 0n && row.due_date && String(row.due_date).slice(0, 10) < today) return 'overdue'
  if (paidC > 0n) return 'partially_paid'
  if (row.due_date && String(row.due_date).slice(0, 10) < today) return 'overdue'
  return 'unpaid'
}

/**
 * Allocates `amount` (cents) across open obligations, oldest due first.
 * obligations: rows with remaining > 0 already sorted by caller or sorted here.
 * Returns [{obligation, amountCents}] or throws {code:'OVERPAY'} when the
 * amount exceeds what is owed.
 */
function allocate(amountCents, obligations, { allowAdvance = false } = {}) {
  const open = obligations
    .map(o => ({ ...o, remainingC: D.amountToCents(D.normalizeAmount(o.remaining, { allowZero: true })) }))
    .filter(o => o.remainingC != null && o.remainingC > 0n)
    .sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999'))
      || String(a.billing_period_start || '').localeCompare(String(b.billing_period_start || '')))
  const totalOpen = open.reduce((s, o) => s + o.remainingC, 0n)
  if (amountCents > totalOpen && !allowAdvance) {
    const err = new Error(`Amount exceeds the outstanding balance by ${D.centsToAmount(amountCents - totalOpen)}.`)
    err.code = 'OVERPAY'
    err.excess = D.centsToAmount(amountCents - totalOpen)
    throw err
  }
  const out = []
  let left = amountCents
  for (const o of open) {
    if (left <= 0n) break
    const take = left < o.remainingC ? left : o.remainingC
    out.push({ obligation: o, amountCents: take })
    left -= take
  }
  // Advance remainder (only when explicitly allowed) attaches to the newest
  // open obligation as an over-payment credit is not modelled; refuse instead.
  if (left > 0n) {
    const err = new Error('Advance payments are not supported yet.')
    err.code = 'NO_ADVANCE'
    throw err
  }
  return out
}

/** Marks obligation.status from paid/remaining after payments change. */
function statusAfterPayment(paidCents, finalCents, dueDate, today = todayIso()) {
  if (finalCents === 0n) return 'exempt'
  if (paidCents >= finalCents) return 'paid'
  if (dueDate && String(dueDate).slice(0, 10) < today) return 'overdue'
  return paidCents > 0n ? 'partially_paid' : 'unpaid'
}

module.exports = {
  FREQUENCIES,
  CATEGORIES,
  STATUSES,
  normName,
  parseDate,
  todayIso,
  addMonths,
  monthStart,
  daysInMonth,
  resolveStudentFees,
  generateForStudent,
  generateForStudents,
  handleClassChange,
  effectiveStatus,
  allocate,
  statusAfterPayment,
  idempotencyKey,
  discountFor,
  proratedCents,
  periodLabel,
  dueDateFor,
}
