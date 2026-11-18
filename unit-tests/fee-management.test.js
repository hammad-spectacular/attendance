'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  normName,
  resolveStudentFees,
  discountFor,
  proratedCents,
  allocate,
  effectiveStatus,
  generateForStudent,
  idempotencyKey,
  periodLabel,
  dueDateFor,
} = require('../fee-management')

const student = { id: 7, class_id: 3, branch_id: 1, admission_date: '2025-01-10' }

function item(over = {}) {
  return {
    id: 100, name: 'Tuition Fee', category: 'tuition', amount: '1000.00',
    frequency: 'monthly', level: 'school', class_id: null, student_id: null,
    is_active: true, effective_from: '2025-01-01', effective_to: null,
    due_day: 10, billing_mode: 'full', exempt: false,
    discount_percent: null, discount_amount: null, ...over,
  }
}

test('normName normalizes case and whitespace', () => {
  assert.equal(normName('  Tuition   Fee '), 'tuition fee')
  assert.equal(normName('ADMISSION FEE'), 'admission fee')
  assert.equal(normName(null), '')
})

test('resolveStudentFees: student > class > school precedence per fee name', () => {
  const school = item({ id: 1, level: 'school', amount: '1000.00' })
  const klass = item({ id: 2, level: 'class', class_id: 3, amount: '1200.00' })
  const otherClass = item({ id: 3, level: 'class', class_id: 9, amount: '9999.00' })
  const stud = item({ id: 4, level: 'student', student_id: 7, amount: '800.00' })
  const resolved = resolveStudentFees([school, klass, otherClass, stud], student)
  assert.equal(resolved.length, 1)
  assert.equal(resolved[0].winner.id, 4)
  assert.equal(resolved[0].winner.amount, '800.00')

  // Without the student row, the class row wins for this student.
  const noStudent = resolveStudentFees([school, klass, otherClass], student)
  assert.equal(noStudent[0].winner.id, 2)
  // A student in another class falls back to school.
  const other = resolveStudentFees([school, klass, otherClass], { ...student, class_id: 9 })
  assert.equal(other[0].winner.id, 3)
})

test('resolveStudentFees ignores inactive items', () => {
  const resolved = resolveStudentFees([item({ is_active: false })], student)
  assert.equal(resolved.length, 0)
})

test('discountFor: explicit amount beats percent and is capped at original', () => {
  assert.equal(discountFor(item({ discount_amount: '200.00', discount_percent: 50 }), 100000n), 20000n)
  assert.equal(discountFor(item({ discount_percent: 25 }), 100000n), 25000n)
  assert.equal(discountFor(item({ discount_amount: '9999.00' }), 100000n), 100000n)
  assert.equal(discountFor(item(), 100000n), 0n)
})

test('proratedCents prorates mid-month admissions by remaining days', () => {
  // January has 31 days; admitted on the 16th -> 16 days remaining (16..31).
  const full = 31000n
  const got = proratedCents(full, '2025-01-16', '2025-01-01', '2025-01-31')
  assert.equal(got, (full * 16n * 2n + 31n) / 62n)
  // Admission on/before period start -> full amount.
  assert.equal(proratedCents(full, '2025-01-01', '2025-01-01', '2025-01-31'), full)
})

test('allocate pays oldest-due first and refuses overpayment', () => {
  const obs = [
    { id: 'b', remaining: '300.00', due_date: '2025-02-10', billing_period_start: '2025-02-01' },
    { id: 'a', remaining: '500.00', due_date: '2025-01-10', billing_period_start: '2025-01-01' },
  ]
  const parts = allocate(40000n, obs)
  assert.deepEqual(parts.map(p => [p.obligation.id, p.amountCents]), [['a', 40000n]])
  const parts2 = allocate(60000n, obs)
  assert.deepEqual(parts2.map(p => [p.obligation.id, p.amountCents]), [['a', 50000n], ['b', 10000n]])
  assert.throws(() => allocate(90000n, obs), /exceeds the outstanding balance/)
  assert.throws(() => allocate(90000n, obs, { allowAdvance: true }), /Advance payments/)
})

test('effectiveStatus distinguishes unpaid/partial/paid/overdue', () => {
  const today = '2025-06-15'
  assert.equal(effectiveStatus({ status: 'unpaid', remaining: '100.00', paid: '0.00', due_date: '2025-07-01' }, today), 'unpaid')
  assert.equal(effectiveStatus({ status: 'unpaid', remaining: '50.00', paid: '50.00', due_date: '2025-07-01' }, today), 'partially_paid')
  assert.equal(effectiveStatus({ status: 'unpaid', remaining: '0.00', paid: '100.00', due_date: '2025-07-01' }, today), 'paid')
  assert.equal(effectiveStatus({ status: 'unpaid', remaining: '100.00', paid: '0.00', due_date: '2025-06-01' }, today), 'overdue')
  assert.equal(effectiveStatus({ status: 'unpaid', remaining: '50.00', paid: '50.00', due_date: '2025-06-01' }, today), 'overdue')
  assert.equal(effectiveStatus({ status: 'exempt', remaining: '0.00', paid: '0.00' }, today), 'exempt')
})

test('generateForStudent writes idempotent obligation rows', async () => {
  const calls = []
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [{ id: calls.length }] } } }
  const items = [
    item({ id: 10, name: 'Admission Fee', category: 'admission', frequency: 'one_time', amount: '5000.00', effective_from: '2025-01-10' }),
    item({ id: 11, name: 'Tuition Fee', category: 'tuition', frequency: 'monthly', amount: '1000.00', due_day: 5 }),
  ]
  const out = await generateForStudent(client, 'school1', student, items, { monthsAhead: 2, source: 'test' })
  assert.ok(out.created >= 2)
  const inserts = calls.filter(c => /INSERT INTO student_fee_obligations/.test(c.sql))
  // 1 one-time + monthly periods from anchor through horizon.
  assert.ok(inserts.length >= 3)
  const keys = inserts.map(c => c.params[18])
  assert.equal(new Set(keys).size, keys.length, 'idempotency keys unique per period')
  assert.ok(keys.every(k => k.startsWith('7:')))
  // Every insert is conflict-safe.
  assert.ok(inserts.every(c => /ON CONFLICT \(tenant_id, idempotency_key\) DO NOTHING/.test(c.sql)))
})

test('generateForStudent treats conflict-skip as skipped, not created', async () => {
  const client = { query: async () => ({ rows: [] }) } // ON CONFLICT DO NOTHING -> no rows
  const out = await generateForStudent(client, 't', student, [item({ frequency: 'one_time', effective_from: '2025-01-10' })], { monthsAhead: 0 })
  assert.equal(out.created, 0)
  assert.ok(out.skipped >= 1)
})

test('student-level exempt produces exempt status with zero final', async () => {
  const calls = []
  const client = { query: async (sql, params) => { calls.push(params); return { rows: [{ id: 1 }] } } }
  const stud = item({ id: 20, level: 'student', student_id: 7, name: 'Tuition Fee', exempt: true, frequency: 'one_time', effective_from: '2025-01-10' })
  await generateForStudent(client, 't', student, [stud], { monthsAhead: 0 })
  const p = calls[0]
  // params: tenant,student,class,branch,item,name,category,frequency,level,orig,disc,final,...
  assert.equal(p[16], 'exempt')
  assert.equal(p[11], '0.00') // final_amount
})

test('idempotencyKey and periodLabel formats', () => {
  assert.equal(idempotencyKey(7, 10, '2025-01-01'), '7:10:2025-01-01')
  assert.equal(periodLabel('monthly', '2025-01-01'), 'Jan 2025')
  assert.equal(dueDateFor('2025-01-01', 10), '2025-01-10')
  assert.equal(dueDateFor('2025-01-01', 31), '2025-01-31')
  assert.equal(dueDateFor('2025-02-01', 31), '2025-02-28')
})
