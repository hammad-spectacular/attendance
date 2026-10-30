'use strict'

/**
 * Generation benchmark: measures wall-clock time, completeness and search size
 * on realistic multi-class school timetables.
 *
 * Run with:  node unit-tests/benchmark.js
 */

const { generateTimetable } = require('../timetable/solver')
const { validateTimetable } = require('../timetable/validator')
const { realisticSchool, scaledSchool } = require('./fixtures')

function run(label, input, expectedTotal, repeats = 3) {
  const times = []
  let last = null
  for (let i = 0; i < repeats; i++) {
    const t0 = process.hrtime.bigint()
    last = generateTimetable(input)
    times.push(Number(process.hrtime.bigint() - t0) / 1e6)
  }
  const vStart = process.hrtime.bigint()
  const report = validateTimetable(input, last.entries)
  const validateMs = Number(process.hrtime.bigint() - vStart) / 1e6

  times.sort((a, b) => a - b)
  console.log(`\n${label}`)
  console.log(`  classes: ${input.classes.length}  teachers: ${input.teachers.length}  requirements: ${input.requirements.length}`)
  console.log(`  lessons required/scheduled: ${last.stats.scheduledLessons}/${last.stats.requiredLessons} (${last.stats.completenessPct}%)`)
  console.log(`  ok: ${last.ok}   hard violations: ${last.violations.length}   soft penalties: ${last.softPenalties.length}`)
  console.log(`  generation: min ${times[0].toFixed(1)} ms, median ${times[Math.floor(times.length / 2)].toFixed(1)} ms, max ${times[times.length - 1].toFixed(1)} ms`)
  console.log(`  search nodes: ${last.stats.nodeCount}   independent validation: ${validateMs.toFixed(1)} ms (ok=${report.ok})`)
  if (!last.ok) console.log(`  diagnostics: ${JSON.stringify(last.diagnostics.map(d => d.code))}`)
  return last.ok && last.stats.completenessPct === 100 && report.ok
}

let allOk = true

allOk = run('Realistic school — 8 classes', realisticSchool().input, realisticSchool().expectedTotal, 5) && allOk
allOk = run('Medium school — 12 classes', scaledSchool(12).input, scaledSchool(12).expectedTotal, 3) && allOk
allOk = run('Large school — 20 classes', scaledSchool(20).input, scaledSchool(20).expectedTotal, 3) && allOk
allOk = run('Very large school — 40 classes', scaledSchool(40).input, scaledSchool(40).expectedTotal, 3) && allOk

console.log(`\nAll benchmark scenarios produced a complete, validated timetable: ${allOk}`)
process.exit(allOk ? 0 : 1)
