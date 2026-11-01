'use strict'
/**
 * Standalone verification for the "school ends at 2:00 PM … require until
 * 7:20 PM" bug. Reproduces the exact reported screen values and proves the
 * derived end time + validation now agree, including for legacy saved configs
 * that still carry the old hardcoded endTime '14:00'.
 *
 *   node timetable/tt2/test/verify-timing-fix.js
 */
const { normaliseConfig, validateConfig, calculateEndTime, formatClock, defaultConfig } = require('../wizard')

function scenario(label, cfg) {
  const norm = normaliseConfig(cfg)
  const derived = calculateEndTime(norm)
  const res = validateConfig(cfg)
  const contradiction = res.errors.filter(e => /School ends at .* but .* require until/i.test(e))
  console.log(`\n=== ${label} ===`)
  console.log(`  startTime         : ${norm.startTime}`)
  console.log(`  stored endTime    : ${norm.endTime === null ? 'null (no limit)' : norm.endTime}`)
  console.log(`  derived end       : ${formatClock(derived)}`)
  console.log(`  validation errors : ${res.errors.length ? res.errors.join(' | ') : '(none)'}`)
  console.log(`  canGenerate       : ${res.canGenerate}`)
  console.log(`  2:00 PM contradiction present? ${contradiction.length > 0 ? 'YES  <-- BUG' : 'no'}`)
  return { res, contradiction, derived }
}

let failures = 0
function expect(cond, msg) {
  if (!cond) { failures++; console.log(`  ASSERT FAIL: ${msg}`) }
}

// 1) THE REPORTED SCREEN: start 4:00 PM, 5 periods x 40 min, 2 breaks.
//    Derived end = 16:00 + 5*40 + 15 + 30 = 19:25 (7:25 PM).
const reported = scenario('Reported screen (start 4:00 PM, 5 x 40min, 2 breaks)', {
  ...defaultConfig(),
  schoolName: 'Test School',
  startTime: '16:00',
  periodCount: 5,
  periodDuration: 40,
  breaks: [
    { afterPeriod: 2, label: 'Short Break', duration: 15 },
    { afterPeriod: 4, label: 'Lunch', duration: 30 }
  ],
  classes: [{ id: 'c1', name: 'G9', studentCount: 1 }],
  subjects: [{ id: 's1', name: 'Math', difficult: 'medium' }],
  teachers: [{ id: 't1', name: 'T', subjectIds: ['s1'] }],
  curriculum: [{ classId: 'c1', subjectId: 's1', periodsPerWeek: 5, teacherIds: ['t1'] }]
})
expect(reported.contradiction.length === 0, 'reported scenario must not show the 2:00 PM contradiction')
expect(reported.res.canGenerate === true, 'reported scenario should be generatable')

// 2) Legacy saved config: still carries the OLD hardcoded endTime '14:00'.
const legacy = scenario('Legacy saved config with endTime: "14:00" + 4 PM start', {
  ...defaultConfig(),
  schoolName: 'Legacy School',
  startTime: '16:00',
  endTime: '14:00', // the stale hardcoded value from the old default
  periodCount: 5,
  periodDuration: 40,
  breaks: [],
  classes: [{ id: 'c1', name: 'G9', studentCount: 1 }],
  subjects: [{ id: 's1', name: 'Math', difficult: 'medium' }],
  teachers: [{ id: 't1', name: 'T', subjectIds: ['s1'] }],
  curriculum: [{ classId: 'c1', subjectId: 's1', periodsPerWeek: 5, teacherIds: ['t1'] }]
})
expect(normaliseConfig({ endTime: '14:00' }).endTime === null, "legacy '14:00' must migrate to null (no limit)")
expect(legacy.contradiction.length === 0, 'legacy 14:00 must not override the 4 PM start')

// 3) Different start times all validate cleanly with no limit.
for (const start of ['08:00', '10:00', '16:00']) {
  const r = scenario(`Start ${start}, 6 x 40min, no limit`, {
    ...defaultConfig(),
    schoolName: 'S', startTime: start, periodCount: 6, periodDuration: 40, breaks: [],
    classes: [{ id: 'c1', name: 'G', studentCount: 1 }],
    subjects: [{ id: 's1', name: 'M', difficult: 'medium' }],
    teachers: [{ id: 't1', name: 'T', subjectIds: ['s1'] }],
    curriculum: [{ classId: 'c1', subjectId: 's1', periodsPerWeek: 6, teacherIds: ['t1'] }]
  })
  expect(r.res.canGenerate === true, `start ${start} should validate cleanly`)
}

// 4) A GENUINE explicit limit is still enforced (feature preserved).
const capped = scenario('Explicit limit 10:00 with a day needing 12:45', {
  ...defaultConfig(),
  schoolName: 'Capped', startTime: '08:00', endTime: '10:00',
  periodCount: 6, periodDuration: 40,
  breaks: [{ afterPeriod: 2, label: 'B', duration: 15 }, { afterPeriod: 4, label: 'L', duration: 30 }],
  classes: [{ id: 'c1', name: 'G', studentCount: 1 }],
  subjects: [{ id: 's1', name: 'M', difficult: 'medium' }],
  teachers: [{ id: 't1', name: 'T', subjectIds: ['s1'] }],
  curriculum: [{ classId: 'c1', subjectId: 's1', periodsPerWeek: 6, teacherIds: ['t1'] }]
})
expect(capped.res.canGenerate === false, 'an explicit limit that is exceeded must still block')
expect(capped.res.errors.some(e => /dismissal time/i.test(e)), 'explicit-limit error should mention dismissal time')

console.log(failures === 0
  ? '\nALL CHECKS PASSED — no hardcoded/stale 2:00 PM can override admin timing.'
  : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
