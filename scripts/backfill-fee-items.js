'use strict'

/* ==========================================================================
   backfill-fee-items.js
   --------------------------------------------------------------------------
   One-time, idempotent import of the legacy `fee_structures` rates into the
   new `fee_items` configuration table so the Fee Configuration tab shows the
   fees schools already configured through the "Fee Rates" modal.

   Mapping (mirrors voucher-engine semantics):
     type 'class'    -> level 'class'    (class_id = target_id)
     type 'student'  -> level 'student'  (student_id = target_id)
     type 'school'/'default' -> level 'school'
     monthly_fee   > 0 -> "Tuition Fee",   category tuition,   monthly
     admission_fee > 0 -> "Admission Fee", category admission, one_time
     transport_fee > 0 -> "Transport Fee", category transport, monthly
     discount           -> discount_amount on the tuition item (flat amount)

   Safe to re-run: a fee item is only inserted when no item with the same
   tenant/level/target/name already exists. Never touches obligations,
   payments, vouchers or receipts.

   Usage:  node scripts/backfill-fee-items.js [--dry-run]
   ========================================================================== */

require('dotenv').config()
const { Pool } = require('pg')

const DRY_RUN = process.argv.includes('--dry-run')

const LEVEL_SQL = `
  SELECT fs.*,
         CASE fs.type WHEN 'class' THEN 'class' WHEN 'student' THEN 'student' ELSE 'school' END AS level
    FROM fee_structures fs`

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const client = await pool.connect()
  const report = { structures: 0, itemsCreated: 0, itemsSkipped: 0, targetsMissing: 0 }

  try {
    await client.query('BEGIN')

    const structures = (await client.query(LEVEL_SQL)).rows
    report.structures = structures.length

    const settings = await client.query('SELECT tenant_id, due_days FROM fee_settings')
    const dueDayByTenant = new Map(settings.rows.map(r => [r.tenant_id, Math.min(31, Math.max(1, parseInt(r.due_days, 10) || 10))]))

    for (const fs of structures) {
      const level = fs.level
      const classId = level === 'class' ? fs.target_id : null
      const studentId = level === 'student' ? fs.target_id : null

      // Skip structures whose target row no longer exists.
      if (classId != null) {
        const c = await client.query('SELECT 1 FROM classes WHERE id = $1 AND tenant_id = $2', [classId, fs.tenant_id])
        if (!c.rows.length) { report.targetsMissing++; continue }
      }
      if (studentId != null) {
        const s = await client.query('SELECT 1 FROM students WHERE id = $1 AND tenant_id = $2', [studentId, fs.tenant_id])
        if (!s.rows.length) { report.targetsMissing++; continue }
      }

      const effectiveFrom = fs.created_at instanceof Date
        ? fs.created_at.toISOString().slice(0, 10)
        : String(fs.created_at || '2025-01-01').slice(0, 10)
      const dueDay = dueDayByTenant.get(fs.tenant_id) || 10
      const discount = parseFloat(fs.discount) > 0 ? parseFloat(fs.discount).toFixed(2) : null

      const specs = []
      if (parseFloat(fs.monthly_fee) > 0) {
        specs.push({ name: 'Tuition Fee', category: 'tuition', amount: fs.monthly_fee, frequency: 'monthly', discount })
      }
      if (parseFloat(fs.admission_fee) > 0) {
        specs.push({ name: 'Admission Fee', category: 'admission', amount: fs.admission_fee, frequency: 'one_time', discount: null })
      }
      if (parseFloat(fs.transport_fee) > 0) {
        specs.push({ name: 'Transport Fee', category: 'transport', amount: fs.transport_fee, frequency: 'monthly', discount: null })
      }

      for (const spec of specs) {
        const exists = await client.query(
          `SELECT 1 FROM fee_items
            WHERE tenant_id = $1 AND level = $2
              AND class_id IS NOT DISTINCT FROM $3
              AND student_id IS NOT DISTINCT FROM $4
              AND lower(name) = lower($5)`,
          [fs.tenant_id, level, classId, studentId, spec.name]
        )
        if (exists.rows.length) { report.itemsSkipped++; continue }
        if (!DRY_RUN) {
          await client.query(
            `INSERT INTO fee_items (tenant_id, level, class_id, student_id, name, category, amount,
               frequency, billing_mode, effective_from, due_day, discount_amount, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'full',$9,$10,$11,$12)`,
            [fs.tenant_id, level, classId, studentId, spec.name, spec.category, spec.amount,
             spec.frequency, effectiveFrom, dueDay, spec.discount,
             `Imported from legacy fee_structures row #${fs.id}`]
          )
        }
        report.itemsCreated++
      }
    }

    if (DRY_RUN) await client.query('ROLLBACK')
    else await client.query('COMMIT')
  } catch (err) {
    try { await client.query('ROLLBACK') } catch (_) {}
    throw err
  } finally {
    client.release()
    await pool.end()
  }

  console.log(JSON.stringify({ dryRun: DRY_RUN, ...report }, null, 2))
}

main().catch(err => { console.error('backfill failed:', err.message); process.exit(1) })
