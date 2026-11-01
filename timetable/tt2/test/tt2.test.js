'use strict'

/**
 * tt2 — tests.
 *
 *   node --test timetable/tt2/test/
 *
 * Covers the three things that can silently break tt2:
 *   1. the wizard rules — what is allowed and what blocks generation
 *   2. the model mapping — wizard answers -> solver input -> grid, including
 *      the period-index arithmetic that breaks easily when breaks exist
 *   3. the API — generate, place a lesson by hand, clear it, export
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const path = require('path')

const { defaultConfig, normaliseConfig, validateConfig, STEPS, ALL_DAYS } = require('../wizard')
const { createFileStore } = require('../store')
const {
  buildPeriods,
  buildDayPeriods,
  buildTimeLabels,
  buildSolverInput,
  buildGrids,
  gridToEntries,
  collectLocks,
  formatClock,
  resolveTiming,
  buildPeriodsForDate,
  validateLockedCells,
  isDayOverrideActive
} = require('../model')
const { validateTimetable } = require('../../validator')
const { createTt2Router } = require('../routes')

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A small but realistic school: 2 classes, 6 subjects, 3 teachers. */
function sampleConfig(overrides = {}) {
  const config = {
    ...defaultConfig(),
    schoolName: 'Greenwood Academy',
    days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    startTime: '08:00',
    periodCount: 6,
    periodDuration: 40,
    breaks: [
      { id: 'b1', afterPeriod: 2, label: 'Short Break', duration: 15 },
      { id: 'b2', afterPeriod: 4, label: 'Lunch', duration: 30 }
    ],
    classes: [
      { id: 'c1', name: 'Grade 9A', studentCount: 28 },
      { id: 'c2', name: 'Grade 9B', studentCount: 30 }
    ],
    subjects: [
      { id: 's_math', name: 'Mathematics', difficult: 'medium', roomId: null },
      { id: 's_phys', name: 'Physics', difficult: 'difficult', roomId: null },
      { id: 's_eng', name: 'English', difficult: 'easy', roomId: null },
      { id: 's_hist', name: 'History', difficult: 'medium', roomId: null },
      { id: 's_bio', name: 'Biology', difficult: 'difficult', roomId: null },
      { id: 's_art', name: 'Art', difficult: 'easy', roomId: null }
    ],
    teachers: [
      { id: 't_a', name: 'Ayesha Khan', subjectIds: ['s_math', 's_phys'], maxPerDay: 5, maxPerWeek: 14, unavailableSlots: [] },
      { id: 't_b', name: 'Bilal Ahmed', subjectIds: ['s_eng', 's_hist'], maxPerDay: 5, maxPerWeek: 14, unavailableSlots: [] },
      { id: 't_c', name: 'Sana Malik', subjectIds: ['s_bio', 's_art'], maxPerDay: 5, maxPerWeek: 10, unavailableSlots: [] }
    ],
    curriculum: [
      { id: 'r1', classId: 'c1', subjectId: 's_math', periodsPerWeek: 3, teacherIds: [] },
      { id: 'r2', classId: 'c1', subjectId: 's_phys', periodsPerWeek: 3, teacherIds: [] },
      { id: 'r3', classId: 'c1', subjectId: 's_eng', periodsPerWeek: 3, teacherIds: [] },
      { id: 'r4', classId: 'c1', subjectId: 's_hist', periodsPerWeek: 3, teacherIds: [] },
      { id: 'r5', classId: 'c1', subjectId: 's_bio', periodsPerWeek: 2, teacherIds: [] },
      { id: 'r6', classId: 'c1', subjectId: 's_art', periodsPerWeek: 2, teacherIds: [] },
      { id: 'r7', classId: 'c2', subjectId: 's_math', periodsPerWeek: 3, teacherIds: [] },
      { id: 'r8', classId: 'c2', subjectId: 's_phys', periodsPerWeek: 3, teacherIds: [] },
      { id: 'r9', classId: 'c2', subjectId: 's_eng', periodsPerWeek: 3, teacherIds: [] },
      { id: 'r10', classId: 'c2', subjectId: 's_hist', periodsPerWeek: 3, teacherIds: [] },
      { id: 'r11', classId: 'c2', subjectId: 's_bio', periodsPerWeek: 2, teacherIds: [] },
      { id: 'r12', classId: 'c2', subjectId: 's_art', periodsPerWeek: 2, teacherIds: [] }
    ]
  }
  return { ...config, ...overrides }
}

// ---------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------

test('wizard: every step is described', () => {
  assert.ok(STEPS.length >= 9)
  for (const step of STEPS) {
    assert.ok(step.id && step.title && step.blurb, `step ${step.id} is incomplete`)
    assert.ok(Array.isArray(step.fields) && step.fields.length, `step ${step.id} lists no questions`)
  }
})

test('wizard: a complete configuration passes validation', () => {
  const result = validateConfig(sampleConfig())
  assert.deepEqual(result.errors, [])
  assert.equal(result.canGenerate, true)
})

test('wizard: a teacher may teach three subjects without complaint', () => {
  const config = sampleConfig()
  config.teachers[0].subjectIds = ['s_math', 's_phys', 's_hist']
  config.teachers[1].subjectIds = ['s_eng']
  config.teachers[2].subjectIds = ['s_bio', 's_art']
  // t_a now carries three subjects across both classes: 18 periods a week.
  config.teachers[0].maxPerWeek = 20
  config.teachers[0].maxPerDay = 6
  const result = validateConfig(config)
  assert.equal(result.canGenerate, true)
  assert.equal(result.errors.length, 0)
})

test('wizard: a teacher with no subject is an error', () => {
  const config = sampleConfig()
  config.teachers[0].subjectIds = []
  const result = validateConfig(config)
  assert.equal(result.canGenerate, false)
  assert.ok(result.errors.some(e => /Ayesha Khan.*no subject/i.test(e)))
})

test('wizard: a subject with no teacher is an error', () => {
  const config = sampleConfig()
  config.teachers = config.teachers.filter(t => t.id !== 't_c')
  const result = validateConfig(config)
  assert.equal(result.canGenerate, false)
  assert.ok(result.errors.some(e => /Biology.*no teacher/i.test(e)))
})

test('wizard: a teacher cannot be pinned to a subject they do not teach', () => {
  const config = sampleConfig()
  config.curriculum[0].teacherIds = ['t_c']
  const result = validateConfig(config)
  assert.equal(result.canGenerate, false)
  assert.ok(result.errors.some(e => /not qualified/i.test(e)))
})

test('wizard: over-subscribing a class is an error', () => {
  const config = sampleConfig()
  config.curriculum[0].periodsPerWeek = 40
  const result = validateConfig(config)
  assert.equal(result.canGenerate, false)
  assert.ok(result.errors.some(e => /only 30 teaching slots/i.test(e)))
})

test('wizard: exceeding a teacher weekly cap is an error', () => {
  const config = sampleConfig()
  config.teachers[0].maxPerWeek = 4
  const result = validateConfig(config)
  assert.equal(result.canGenerate, false)
  assert.ok(result.errors.some(e => /capped at 4/i.test(e)))
})

test('wizard: a break beyond the last period is an error', () => {
  const config = sampleConfig()
  config.breaks.push({ id: 'b3', afterPeriod: 9, label: 'Snack', duration: 15 })
  const result = validateConfig(config)
  assert.equal(result.canGenerate, false)
  assert.ok(result.errors.some(e => /only 6 periods/i.test(e)))
})

test('wizard: an unused subject is a warning, not an error', () => {
  const config = sampleConfig()
  config.subjects.push({ id: 's_geo', name: 'Geography', difficult: 'medium', roomId: null })
  config.teachers[0].subjectIds.push('s_geo')
  const result = validateConfig(config)
  assert.equal(result.canGenerate, true)
  assert.ok(result.warnings.some(w => /Geography.*not taught/i.test(w)))
})

test('wizard: normaliseConfig drops junk and fills defaults', () => {
  const config = normaliseConfig({ schoolName: '  Rose School  ', days: ['Monday', 'Nonsense'], classes: 'not-an-array' })
  assert.equal(config.schoolName, 'Rose School')
  assert.deepEqual(config.days, ['Monday'])
  assert.deepEqual(config.classes, [])
  assert.equal(config.periodCount, defaultConfig().periodCount)
})

test('wizard: endTime must be after startTime', () => {
  const config = sampleConfig({ startTime: '14:00', endTime: '08:00' })
  const result = validateConfig(config)
  assert.equal(result.canGenerate, false)
  assert.ok(result.errors.some(e => /end time must be after the start time/i.test(e)))
})

test('wizard: endTime must be in HH:MM format', () => {
  const config = normaliseConfig(sampleConfig({ endTime: 'invalid' }))
  // Invalid endTime should be normalised to default
  assert.equal(config.endTime, defaultConfig().endTime)
})

test('wizard: periods must fit within start-end window', () => {
  const config = sampleConfig({ startTime: '08:00', endTime: '10:00', periodCount: 6, periodDuration: 40 })
  const result = validateConfig(config)
  assert.equal(result.canGenerate, false)
  assert.ok(result.errors.some(e => /require until/i.test(e)))
})

test('wizard: calculateEndTime helper works correctly', () => {
  const { calculateEndTime } = require('../wizard')
  const config = sampleConfig({ startTime: '08:00', periodCount: 3, periodDuration: 40, breaks: [] })
  const endMinutes = calculateEndTime(config)
  assert.equal(endMinutes, 10 * 60) // 10:00 AM = 600 minutes
})

test('wizard: date override with valid date and timing', () => {
  const config = sampleConfig({
    dateOverrides: {
      '2026-11-06': { periodDuration: 30, startTime: '09:00', breakDuration: 10 }
    }
  })
  const result = validateConfig(config)
  assert.equal(result.canGenerate, true)
  assert.equal(result.errors.length, 0)
})

test('wizard: date override with invalid date format', () => {
  const config = normaliseConfig(sampleConfig({
    dateOverrides: {
      'invalid-date': { periodDuration: 30, startTime: '09:00', breakDuration: 10 }
    }
  }))
  // Invalid date should be filtered out during normalisation
  assert.deepEqual(config.dateOverrides, {})
})

test('wizard: date override for non-school day is an error', () => {
  const config = sampleConfig({
    days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    dateOverrides: {
      '2026-11-07': { periodDuration: 30, startTime: '09:00', breakDuration: 10 } // Saturday
    }
  })
  const result = validateConfig(config)
  assert.equal(result.canGenerate, false)
  assert.ok(result.errors.some(e => /not a configured school day/i.test(e)))
})

test('wizard: date override with invalid timing (exceeds end time)', () => {
  const config = sampleConfig({
    endTime: '10:00',
    dateOverrides: {
      '2026-11-16': { periodDuration: 40, startTime: '08:00', breakDuration: 10 }
    }
  })
  const result = validateConfig(config)
  assert.equal(result.canGenerate, false)
  assert.ok(result.errors.some(e => /past the school end time/i.test(e)))
})

test('wizard: date overrides are separate from recurring dayOverrides', () => {
  const config = normaliseConfig(sampleConfig({
    dayOverrides: {
      'Friday': { periodDuration: 30, startTime: '08:00', breakDuration: 15 }
    },
    dateOverrides: {
      '2026-11-06': { periodDuration: 25, startTime: '09:00', breakDuration: 10 }
    }
  }))
  // Both should coexist independently
  assert.ok(config.dayOverrides['Friday'])
  assert.ok(config.dateOverrides['2026-11-06'])
  assert.equal(config.dayOverrides['Friday'].periodDuration, 30)
  assert.equal(config.dateOverrides['2026-11-06'].periodDuration, 25)
})

test('wizard: date override normalises timing values', () => {
  const config = normaliseConfig(sampleConfig({
    dateOverrides: {
      '2026-11-16': { periodDuration: 200, startTime: 'invalid', breakDuration: 150 }
    }
  }))
  // Should normalise to valid ranges
  assert.equal(config.dateOverrides['2026-11-16'].periodDuration, 180) // max
  assert.equal(config.dateOverrides['2026-11-16'].startTime, '08:00') // default
  assert.equal(config.dateOverrides['2026-11-16'].breakDuration, 120) // max
})

test('wizard: date override with backward compatibility (missing field)', () => {
  const config = normaliseConfig(sampleConfig({
    // No dateOverrides field - should default to empty object
  }))
  assert.deepEqual(config.dateOverrides, {})
})

// ---------------------------------------------------------------------------
// Phase 1: Date-aware period logic tests
// ---------------------------------------------------------------------------

test('model: resolveTiming uses date override (highest priority)', () => {
  const config = sampleConfig({
    periodDuration: 40,
    startTime: '08:00',
    dayTimingMode: 'custom',
    dayOverrides: {
      'Monday': { periodDuration: 30, startTime: '09:00', breakDuration: 10 }
    },
    dateOverrides: {
      '2026-11-02': { periodDuration: 25, startTime: '10:00', breakDuration: 5 }
    }
  })
  const result = resolveTiming(config, '2026-11-02') // Monday
  assert.equal(result.source, 'date')
  assert.equal(result.timing.periodDuration, 25)
  assert.equal(result.timing.startTime, '10:00')
})

test('model: resolveTiming uses recurring override when no date override', () => {
  const config = sampleConfig({
    days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    periodDuration: 40,
    startTime: '08:00',
    dayTimingMode: 'custom',
    dayOverrides: {
      'Friday': { periodDuration: 30, startTime: '09:00', breakDuration: 10 }
    }
  })
  const result = resolveTiming(config, '2026-11-06') // Friday
  assert.equal(result.source, 'recurring')
  assert.equal(result.timing.periodDuration, 30)
  assert.equal(result.timing.startTime, '09:00')
})

test('model: resolveTiming uses default when no overrides exist', () => {
  const config = sampleConfig({
    periodDuration: 40,
    startTime: '08:00'
  })
  const result = resolveTiming(config, '2026-11-02')
  assert.equal(result.source, 'default')
  assert.equal(result.timing.periodDuration, 40)
  assert.equal(result.timing.startTime, '08:00')
})

test('model: buildPeriodsForDate with date override', () => {
  const config = sampleConfig({
    periodDuration: 40,
    startTime: '08:00',
    dateOverrides: {
      '2026-11-02': { periodDuration: 30, startTime: '09:00', breakDuration: 10 }
    }
  })
  const result = buildPeriodsForDate(config, '2026-11-02')
  assert.equal(result.source, 'date')
  assert.equal(result.periods[0].duration, 30)
  assert.equal(result.periods[0].text, '9:00 AM – 9:30 AM')
  assert.equal(result.startTime, '9:00 AM')
})

test('model: buildPeriodsForDate with recurring override', () => {
  const config = sampleConfig({
    days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    periodDuration: 40,
    startTime: '08:00',
    dayTimingMode: 'custom',
    dayOverrides: {
      'Friday': { periodDuration: 35, startTime: '08:30', breakDuration: 15 }
    }
  })
  const result = buildPeriodsForDate(config, '2026-11-06') // Friday
  assert.equal(result.source, 'recurring')
  assert.equal(result.periods[0].duration, 35)
  assert.equal(result.periods[0].text, '8:30 AM – 9:05 AM')
})

test('model: buildPeriodsForDate with default timing', () => {
  const config = sampleConfig({
    periodDuration: 40,
    startTime: '08:00'
  })
  const result = buildPeriodsForDate(config, '2026-11-02')
  assert.equal(result.source, 'default')
  assert.equal(result.periods[0].duration, 40)
  assert.equal(result.periods[0].text, '8:00 AM – 8:40 AM')
})

test('model: date override does not modify recurring settings', () => {
  const config = sampleConfig({
    days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    dayTimingMode: 'custom',
    dayOverrides: {
      'Friday': { periodDuration: 30, startTime: '09:00', breakDuration: 10 }
    },
    dateOverrides: {
      '2026-11-06': { periodDuration: 25, startTime: '10:00', breakDuration: 5 }
    }
  })
  
  // Date override takes priority for the specific date
  const dateResult = buildPeriodsForDate(config, '2026-11-06') // Friday
  assert.equal(dateResult.source, 'date')
  assert.equal(dateResult.periods[0].duration, 25)
  
  // Recurring settings remain unchanged for other dates
  const recurringResult = buildPeriodsForDate(config, '2026-11-13') // Another Friday
  assert.equal(recurringResult.source, 'recurring')
  assert.equal(recurringResult.periods[0].duration, 30)
})

test('model: backward compatibility - date with no overrides', () => {
  const config = sampleConfig({
    periodDuration: 40,
    startTime: '08:00'
  })
  const result = buildPeriodsForDate(config, '2026-11-02')
  assert.equal(result.source, 'default')
  assert.equal(result.periods.length, 8) // 6 teaching + 2 breaks
  assert.equal(result.teachingIndex['1'], 0)
})

test('model: period labels match resolved schedule', () => {
  const config = sampleConfig({
    periodDuration: 40,
    startTime: '08:00',
    dateOverrides: {
      '2026-11-02': { periodDuration: 30, startTime: '09:00', breakDuration: 15 }
    }
  })
  const result = buildPeriodsForDate(config, '2026-11-02')
  
  // First period: 9:00 AM - 9:30 AM (30 min)
  assert.equal(result.periods[0].text, '9:00 AM – 9:30 AM')
  assert.equal(result.periods[0].duration, 30)
  
  // Break after P2: 10:00 AM - 10:15 AM (15 min break)
  assert.equal(result.periods[2].kind, 'break')
  assert.equal(result.periods[2].duration, 15)
  
  // P3 starts after break: 10:15 AM
  assert.equal(result.periods[3].text, '10:15 AM – 10:45 AM')
})

// ---------------------------------------------------------------------------
// Phase 1: Locked lesson validation tests
// ---------------------------------------------------------------------------

test('model: validateLockedCells with valid locked lessons', () => {
  const config = sampleConfig({ periodCount: 6, periodDuration: 40 })
  const oldPeriods = buildPeriods(config).periods
  
  // Change period duration by 5 minutes (within 10 min threshold)
  const newConfig = sampleConfig({ periodCount: 6, periodDuration: 35 })
  const newPeriods = buildPeriods(newConfig).periods
  
  const grids = {
    'c1': {
      'c1|0|0': { classId: 'c1', day: 0, period: 0, teachingNumber: 1, subjectId: 's_math', teacherId: 't_a', locked: true, manual: true }
    }
  }
  
  const result = validateLockedCells(config, grids, oldPeriods, newPeriods)
  assert.equal(result.valid, true)
  assert.equal(result.invalidCells.length, 0)
  assert.equal(result.warnings.length, 0) // Only 5 min change, no warning
})

test('model: validateLockedCells with invalid period reference', () => {
  const config = sampleConfig({ periodCount: 6, periodDuration: 40 })
  const oldPeriods = buildPeriods(config).periods
  
  // Reduce period count - period 6 (teachingNumber) no longer exists
  const newConfig = sampleConfig({ periodCount: 5, periodDuration: 40 })
  const newPeriods = buildPeriods(newConfig).periods
  
  // Lock a cell at column index 7 (which was P6 with periodCount: 6)
  // With periodCount: 6 and a break after P2: columns are [P1, P2, break, P3, P4, P5, P6]
  // With periodCount: 5 and a break after P2: columns are [P1, P2, break, P3, P4, P5]
  // Column 7 no longer exists in new config
  const grids = {
    'c1': {
      'c1|0|7': { classId: 'c1', day: 0, period: 7, teachingNumber: 6, subjectId: 's_math', teacherId: 't_a', locked: true, manual: true }
    }
  }
  
  const result = validateLockedCells(config, grids, oldPeriods, newPeriods)
  assert.equal(result.valid, false)
  assert.equal(result.invalidCells.length, 1)
  assert.ok(result.invalidCells[0].reason.includes('no longer exists'))
})

test('model: validateLockedCells with break conflict', () => {
  const config = sampleConfig({
    periodCount: 6,
    periodDuration: 40,
    breaks: [{ afterPeriod: 2, label: 'Lunch', duration: 30 }]
  })
  const oldPeriods = buildPeriods(config).periods
  
  // Old columns: P1, P2, break, P3, P4, P5, P6
  // Column 3 is P3 (teaching)
  
  // New config: turn column 3 into a break
  const newConfig = sampleConfig({
    periodCount: 2,
    periodDuration: 40,
    breaks: [
      { afterPeriod: 1, label: 'Break', duration: 10 },
      { afterPeriod: 2, label: 'Lunch', duration: 30 }
    ]
  })
  const newPeriods = buildPeriods(newConfig).periods
  // New columns: P1, break, P2, break
  // Column 3 is now a break
  
  const grids = {
    'c1': {
      'c1|0|3': { classId: 'c1', day: 0, period: 3, teachingNumber: 3, subjectId: 's_math', teacherId: 't_a', locked: true, manual: true }
    }
  }
  
  const result = validateLockedCells(config, grids, oldPeriods, newPeriods)
  assert.equal(result.valid, false)
  assert.equal(result.invalidCells.length, 1)
  assert.ok(result.invalidCells[0].reason.includes('now a break'))
})

test('model: validateLockedCells with timing change warning', () => {
  const config = sampleConfig({ periodCount: 6, periodDuration: 40 })
  const oldPeriods = buildPeriods(config).periods
  
  // Change duration by 20 minutes (> 10 min threshold)
  const newConfig = sampleConfig({ periodCount: 6, periodDuration: 60 })
  const newPeriods = buildPeriods(newConfig).periods
  
  const grids = {
    'c1': {
      'c1|0|0': { classId: 'c1', day: 0, period: 0, teachingNumber: 1, subjectId: 's_math', teacherId: 't_a', locked: true, manual: true }
    }
  }
  
  const result = validateLockedCells(config, grids, oldPeriods, newPeriods)
  assert.equal(result.valid, true)
  assert.equal(result.invalidCells.length, 0)
  assert.equal(result.warnings.length, 1)
  assert.ok(result.warnings[0].reason.includes('changed from 40 to 60'))
})

test('model: validateLockedCells with no locked cells', () => {
  const config = sampleConfig({ periodCount: 6, periodDuration: 40 })
  const oldPeriods = buildPeriods(config).periods
  const newPeriods = buildPeriods(config).periods
  
  const grids = {
    'c1': {
      'c1|0|0': { classId: 'c1', day: 0, period: 0, teachingNumber: 1, subjectId: 's_math', teacherId: 't_a', locked: false, manual: false }
    }
  }
  
  const result = validateLockedCells(config, grids, oldPeriods, newPeriods)
  assert.equal(result.valid, true)
  assert.equal(result.invalidCells.length, 0)
  assert.equal(result.warnings.length, 0)
})

test('model: validateLockedCells preserves teacher and subject assignments', () => {
  const config = sampleConfig({ periodCount: 6, periodDuration: 40 })
  const oldPeriods = buildPeriods(config).periods
  const newPeriods = buildPeriods(config).periods
  
  const grids = {
    'c1': {
      'c1|0|0': { 
        classId: 'c1', 
        day: 0, 
        period: 0, 
        teachingNumber: 1, 
        subjectId: 's_math', 
        teacherId: 't_a', 
        locked: true, 
        manual: true 
      }
    }
  }
  
  const result = validateLockedCells(config, grids, oldPeriods, newPeriods)
  assert.equal(result.valid, true)
  // The validation does not modify the grids
  assert.equal(grids.c1['c1|0|0'].subjectId, 's_math')
  assert.equal(grids.c1['c1|0|0'].teacherId, 't_a')
  assert.equal(grids.c1['c1|0|0'].locked, true)
})

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

test('model: breaks get their own column but do not count as periods', () => {
  const { periods, teachingIndex } = buildPeriods(sampleConfig())
  assert.equal(periods.filter(p => p.kind === 'teaching').length, 6)
  assert.equal(periods.filter(p => p.kind === 'break').length, 2)
  assert.equal(periods.length, 8)
  // P3 sits at column 3 because one break precedes it
  assert.equal(teachingIndex['1'], 0)
  assert.equal(teachingIndex['3'], 3)
  assert.equal(teachingIndex['6'], 7)
})

test('model: time labels run from the start time and honour durations', () => {
  const labels = buildTimeLabels(sampleConfig())
  assert.equal(labels[0].text, '8:00 AM – 8:40 AM')
  assert.equal(labels[1].text, '8:40 AM – 9:20 AM')
  // the 15-minute break sits between P2 and P3
  assert.equal(labels[2].kind, 'break')
  assert.equal(labels[2].text, '9:20 AM – 9:35 AM')
  // so P3 starts at 9:35
  assert.equal(labels[3].text, '9:35 AM – 10:15 AM')
  assert.equal(labels[3].kind, 'teaching')
})

test('model: formatClock renders 12-hour times', () => {
  assert.equal(formatClock(0), '12:00 AM')
  assert.equal(formatClock(12 * 60), '12:00 PM')
  assert.equal(formatClock(13 * 60 + 5), '1:05 PM')
})

test('model: a per-period duration override is applied', () => {
  const config = sampleConfig({ periodOverrides: { '1': 90 } })
  const labels = buildTimeLabels(config)
  assert.equal(labels[0].text, '8:00 AM – 9:30 AM')
})

test('model: custom day timings (e.g. Pakistan Friday shorter schedule)', () => {
  const config = sampleConfig({
    dayTimingMode: 'custom',
    periodDuration: 40,
    startTime: '08:00',
    dayOverrides: {
      Friday: {
        periodDuration: 30,
        startTime: '08:00',
        breakDuration: 15
      }
    }
  })
  // Standard day (e.g. Monday)
  const mondayLabels = buildTimeLabels(config, 'Monday')
  assert.equal(mondayLabels[0].text, '8:00 AM – 8:40 AM')

  // Friday custom shorter periods (30 min)
  const fridayLabels = buildTimeLabels(config, 'Friday')
  assert.equal(fridayLabels[0].text, '8:00 AM – 8:30 AM')
  assert.equal(fridayLabels[1].text, '8:30 AM – 9:00 AM')

  const dayPeriods = buildDayPeriods(config, 'Friday')
  assert.equal(dayPeriods.periods[0].duration, 30)
  assert.equal(dayPeriods.isCustom, true)
})

test('model: solver input carries days, periods and requirements', () => {
  const input = buildSolverInput(sampleConfig())
  assert.equal(input.days.length, 5)
  assert.equal(input.periods.length, 8)
  assert.equal(input.classes.length, 2)
  assert.equal(input.subjects.length, 6)
  assert.equal(input.teachers.length, 3)
  assert.equal(input.requirements.length, 12)
  assert.equal(input.requirements[0].periodsPerWeek, 3)
  assert.equal(input.teachers[0].subjectIds.length, 2)
  // difficult is a boolean flag for the solver
  const physics = input.subjects.find(s => s.id === 's_phys')
  assert.equal(physics.difficult, true)
})

test('model: unavailable slots are translated to column indices', () => {
  const config = sampleConfig()
  config.teachers[0].unavailableSlots = [{ day: 0, period: 3 }]
  const input = buildSolverInput(config)
  assert.equal(input.teachers[0].unavailableSlots[0].day, 'Monday')
  // teaching period 3 is column 3 in this layout
  assert.equal(input.teachers[0].unavailableSlots[0].period, 3)
})

test('model: manual pins become solver locks', () => {
  const config = sampleConfig()
  const locks = [{ classId: 'c1', day: 0, teachingNumber: 2, subjectId: 's_math', teacherId: 't_a' }]
  const input = buildSolverInput(config, { locks })
  assert.equal(input.locks.length, 1)
  assert.equal(input.locks[0].classId, 'c1')
  assert.equal(input.locks[0].period, 1) // teaching period 2 is column 1
  assert.equal(input.locks[0].subjectId, 's_math')
})

test('model: a grid round-trips through entries without losing the teacher', () => {
  const config = sampleConfig()
  const entries = [{ classId: 'c1', day: 0, period: 0, subjectId: 's_math', teacherId: 't_a', roomId: null }]
  const grids = buildGrids(config, entries, {})
  const cell = grids.c1['c1|0|0']
  assert.equal(cell.subjectId, 's_math')
  assert.equal(cell.teacherId, 't_a')
  assert.equal(cell.teachingNumber, 1)
  assert.equal(cell.manual, false)

  const roundTrip = gridToEntries(grids)
  assert.equal(roundTrip.length, 1)
  assert.equal(roundTrip[0].teacherId, 't_a')
})

test('model: a manual cell overrides the solver for the same slot', () => {
  const config = sampleConfig()
  const entries = [{ classId: 'c1', day: 0, period: 0, subjectId: 's_math', teacherId: 't_a' }]
  const manual = {
    'c1|0|0': { classId: 'c1', day: 0, period: 0, subjectId: 's_eng', teacherId: 't_b', locked: true, manual: true }
  }
  const grids = buildGrids(config, entries, manual)
  const cell = grids.c1['c1|0|0']
  assert.equal(cell.subjectId, 's_eng')
  assert.equal(cell.locked, true)
  assert.equal(cell.manual, true)

  const locks = collectLocks(grids)
  assert.equal(locks.length, 1)
  assert.equal(locks[0].subjectId, 's_eng')
})

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

function makeApp() {
  const store = createFileStore({ persistPath: null })
  const app = express()
  app.use(express.json())
  app.use('/api/tt2', createTt2Router({ store, devAuth: true }))
  return { app, store }
}

let server
let base

test.before(async () => {
  const { app } = makeApp()
  server = app.listen(0)
  await new Promise(resolve => server.once('listening', resolve))
  base = `http://127.0.0.1:${server.address().port}/api/tt2`
})

test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve))
  try {
    const pool = require('../../../db')
    await pool.end()
  } catch (_) {}
})

async function post(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  return { status: res.status, body: await res.json() }
}

async function put(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  return { status: res.status, body: await res.json() }
}

test('api: /meta describes the wizard', async () => {
  const res = await fetch(`${base}/meta`)
  const data = await res.json()
  assert.equal(res.status, 200)
  assert.ok(data.steps.length >= 9)
  assert.equal(data.devAuth, true)
})

test('api: /check reports the outstanding questions', async () => {
  const res = await post('/check', { config: sampleConfig({ schoolName: '', periodCount: 0 }) })
  assert.equal(res.status, 200)
  assert.equal(res.body.canGenerate, false)
  assert.ok(res.body.errors.length >= 2)
})

test('api: creating, generating and reading a timetable', async () => {
  const created = await post('/timetables', { name: 'Autumn term', config: sampleConfig() })
  assert.equal(created.status, 201)
  const id = created.body.timetable.id

  const generated = await post(`/timetables/${id}/generate`, {})
  assert.equal(generated.status, 200)
  assert.equal(generated.body.report.ok, true, JSON.stringify(generated.body.report.diagnostics))

  const stats = generated.body.report.stats
  assert.equal(stats.requiredLessons, 32)
  assert.equal(stats.scheduledLessons, 32)
  assert.equal(stats.completenessPct, 100)

  const fetched = await fetch(`${base}/timetables/${id}`)
  const doc = (await fetched.json()).timetable
  assert.equal(Object.keys(doc.grids).length, 2)
  assert.equal(doc.validation.ok, true)
  assert.equal(doc.validation.totals.scheduled, 32)
})

test('api: generation is refused while questions are unanswered', async () => {
  const created = await post('/timetables', { config: sampleConfig({ schoolName: '' }) })
  const id = created.body.timetable.id
  const res = await post(`/timetables/${id}/generate`, {})
  assert.equal(res.status, 400)
  assert.ok(res.body.errors.length > 0)
})

test('api: a lesson can be placed by hand and cleared again', async () => {
  const created = await post('/timetables', { config: sampleConfig() })
  const id = created.body.timetable.id
  await post(`/timetables/${id}/generate`, {})

  // Monday, teaching period 1 (column 0)
  const placed = await post(`/timetables/${id}/place`, {
    classId: 'c1', day: 0, period: 0, subjectId: 's_math', teacherId: 't_a'
  })
  assert.equal(placed.status, 200)
  assert.equal(placed.body.cell.subjectId, 's_math')
  assert.equal(placed.body.cell.teacherId, 't_a')
  assert.equal(placed.body.cell.manual, true)

  const cleared = await fetch(`${base}/timetables/${id}/cell`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ classId: 'c1', day: 0, period: 0 })
  })
  assert.equal(cleared.status, 200)
  const doc = (await cleared.json()).timetable
  assert.equal(doc.grids.c1['c1|0|0'], undefined)
})

test('api: a teacher cannot be double-booked by hand', async () => {
  const created = await post('/timetables', { config: sampleConfig() })
  const id = created.body.timetable.id
  await post(`/timetables/${id}/generate`, {})

  const res = await post(`/timetables/${id}/place`, {
    classId: 'c2', day: 0, period: 0, subjectId: 's_math', teacherId: 't_a'
  })
  assert.equal(res.status, 409)
  assert.match(res.body.error, /already teaching another class/i)
})

test('api: placing into a break is refused', async () => {
  const created = await post('/timetables', { config: sampleConfig() })
  const id = created.body.timetable.id
  // column 1 is P2, column 2 is the Short Break
  const res = await post(`/timetables/${id}/place`, {
    classId: 'c1', day: 0, period: 2, subjectId: 's_math', teacherId: 't_a'
  })
  assert.equal(res.status, 400)
  assert.match(res.body.error, /break/i)
})

test('api: a hand-pinned lesson survives a regeneration', async () => {
  const created = await post('/timetables', { config: sampleConfig() })
  const id = created.body.timetable.id
  await post(`/timetables/${id}/generate`, {})

  // Column 1 (P2) is a slot where t_c is genuinely free. Column 0 is NOT:
  // the solver puts t_c on c2 there, so placing there is correctly refused
  // with a 409 and nothing would be pinned.
  const placed = await post(`/timetables/${id}/place`, {
    classId: 'c1', day: 2, period: 1, subjectId: 's_art', teacherId: 't_c'
  })
  assert.equal(placed.status, 200)
  assert.equal(placed.body.cell.manual, true)

  const regenerated = await post(`/timetables/${id}/generate`, {})
  assert.equal(regenerated.status, 200)
  const doc = regenerated.body.timetable
  const cell = doc.grids.c1['c1|2|1']
  assert.ok(cell, 'the pinned cell disappeared')
  assert.equal(cell.subjectId, 's_art')
  assert.equal(cell.manual, true)
})

test('api: CSV export produces one block per class', async () => {
  const created = await post('/timetables', { config: sampleConfig() })
  const id = created.body.timetable.id
  await post(`/timetables/${id}/generate`, {})

  const res = await fetch(`${base}/timetables/${id}/export.csv`)
  assert.equal(res.status, 200)
  const csv = await res.text()
  assert.match(csv, /Greenwood Academy - Grade 9A/)
  assert.match(csv, /Greenwood Academy - Grade 9B/)
  assert.match(csv, /Mathematics/)
  assert.match(csv, /Short Break/)
})

test('api: documents are isolated between tenants', async () => {
  const store = createFileStore({ persistPath: null })
  const a = store.create({ tenantId: 'A', config: sampleConfig() })
  store.create({ tenantId: 'B', config: sampleConfig() })
  assert.equal(store.list('A').length, 1)
  assert.equal(store.list('B').length, 1)
  assert.equal(store.get('B', a.id), null, 'tenant B can see tenant A\'s document')
})

test('api: the store persists to disk', async () => {
  const file = path.join(require('node:os').tmpdir(), `tt2-store-${Date.now()}.json`)
  const store = createFileStore({ persistPath: file })
  const doc = store.create({ tenantId: 'dev', config: sampleConfig() })
  const reopened = createFileStore({ persistPath: file })
  assert.equal(reopened.get('dev', doc.id).config.schoolName, 'Greenwood Academy')
  require('node:fs').unlinkSync(file)
})

test('api: GET /timetables/:id/date-overrides retrieves overrides', async () => {
  const created = await post('/timetables', { config: sampleConfig() })
  const id = created.body.timetable.id

  const res = await fetch(`${base}/timetables/${id}/date-overrides`)
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.ok, true)
  assert.ok(typeof data.dateOverrides === 'object')
})

test('api: POST /timetables/:id/date-overrides creates override', async () => {
  const created = await post('/timetables', { config: sampleConfig() })
  const id = created.body.timetable.id

  const res = await post(`/timetables/${id}/date-overrides`, {
    date: '2026-11-06', // Friday
    timing: { periodDuration: 30, startTime: '09:00', breakDuration: 15 }
  })
  if (res.status !== 200) {
    console.log('Error:', res.body)
  }
  assert.equal(res.status, 200)
  assert.equal(res.body.ok, true)
  assert.ok(res.body.dateOverrides['2026-11-06'])
  assert.equal(res.body.dateOverrides['2026-11-06'].periodDuration, 30)
})

test('api: POST date override with invalid date format', async () => {
  const created = await post('/timetables', { config: sampleConfig() })
  const id = created.body.timetable.id

  const res = await post(`/timetables/${id}/date-overrides`, {
    date: 'invalid-date',
    timing: { periodDuration: 30 }
  })
  assert.equal(res.status, 400)
  assert.ok(res.body.error.includes('YYYY-MM-DD'))
})

test('api: POST date override for non-school day', async () => {
  const created = await post('/timetables', { config: sampleConfig() })
  const id = created.body.timetable.id

  // 2026-11-22 is a Saturday (not in config.days)
  const res = await post(`/timetables/${id}/date-overrides`, {
    date: '2026-11-22',
    timing: { periodDuration: 30 }
  })
  assert.equal(res.status, 400)
  assert.ok(res.body.error.includes('not a configured school day'))
})

test('api: POST date override with invalid timing', async () => {
  const created = await post('/timetables', { config: sampleConfig() })
  const id = created.body.timetable.id

  const res = await post(`/timetables/${id}/date-overrides`, {
    date: '2026-11-06',
    timing: { periodDuration: 200 } // exceeds end time
  })
  assert.equal(res.status, 400)
  assert.ok(res.body.error.includes('Invalid timing'))
})

test('api: DELETE /timetables/:id/date-overrides/:date removes override', async () => {
  const created = await post('/timetables', { config: sampleConfig() })
  const id = created.body.timetable.id

  // Create an override
  await post(`/timetables/${id}/date-overrides`, {
    date: '2026-11-06',
    timing: { periodDuration: 30 }
  })

  // Delete it
  const res = await fetch(`${base}/timetables/${id}/date-overrides/2026-11-06`, {
    method: 'DELETE'
  })
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.dateOverrides['2026-11-06'], undefined)
})

test('api: DELETE date override that does not exist', async () => {
  const created = await post('/timetables', { config: sampleConfig() })
  const id = created.body.timetable.id

  const res = await fetch(`${base}/timetables/${id}/date-overrides/2026-11-06`, {
    method: 'DELETE'
  })
  const body = await res.json()
  assert.equal(res.status, 404)
  assert.ok(body.error && body.error.includes('No override found'))
})

test('api: date overrides remain separate from recurring dayOverrides', async () => {
  const config = sampleConfig({
    dayTimingMode: 'custom',
    dayOverrides: {
      Friday: { periodDuration: 30, startTime: '08:00', breakDuration: 15 }
    }
  })
  const created = await post('/timetables', { config })
  const id = created.body.timetable.id

  // Add a date override
  await post(`/timetables/${id}/date-overrides`, {
    date: '2026-11-06',
    timing: { periodDuration: 25, startTime: '09:00' }
  })

  // Verify both exist separately
  const fetched = await fetch(`${base}/timetables/${id}`)
  const doc = (await fetched.json()).timetable
  assert.ok(doc.config.dayOverrides.Friday)
  assert.ok(doc.config.dateOverrides['2026-11-06'])
  assert.equal(doc.config.dayOverrides.Friday.periodDuration, 30)
  assert.equal(doc.config.dateOverrides['2026-11-06'].periodDuration, 25)
})

test('api: tenant isolation - cannot access another tenant\'s date overrides', async () => {
  const store = createFileStore()
  const a = store.create({ tenantId: 'A', config: sampleConfig() })
  const b = store.create({ tenantId: 'B', config: sampleConfig() })

  // Add override to tenant A's timetable via direct store manipulation
  const configA = { ...a.config, dateOverrides: { '2026-11-06': { periodDuration: 30 } } }
  store.update('A', a.id, { config: configA })

  // Tenant B cannot access tenant A's timetable
  const docB = store.get('B', a.id)
  assert.equal(docB, null)
})

test('api: POST /timetables/:id/apply-batch-timing updates multiple days', async () => {
  const created = await post('/timetables', { config: sampleConfig() })
  const id = created.body.timetable.id

  const res = await post(`/timetables/${id}/apply-batch-timing`, {
    weekdays: ['Monday', 'Wednesday', 'Friday'],
    timing: { periodDuration: 35, startTime: '08:30', breakDuration: 15 }
  })
  assert.equal(res.status, 200)
  assert.equal(res.body.ok, true)
  assert.equal(res.body.updatedCount, 3)
  assert.equal(res.body.skippedDays.length, 0)

  const fetched = await fetch(`${base}/timetables/${id}`)
  const doc = (await fetched.json()).timetable
  assert.equal(doc.config.dayTimingMode, 'custom')
  assert.equal(doc.config.dayOverrides.Monday.periodDuration, 35)
  assert.equal(doc.config.dayOverrides.Wednesday.periodDuration, 35)
  assert.equal(doc.config.dayOverrides.Friday.periodDuration, 35)
})

test('api: batch apply timing with one selected day', async () => {
  const created = await post('/timetables', { config: sampleConfig() })
  const id = created.body.timetable.id

  const res = await post(`/timetables/${id}/apply-batch-timing`, {
    weekdays: ['Tuesday'],
    timing: { periodDuration: 30, startTime: '09:00' }
  })
  assert.equal(res.status, 200)
  assert.equal(res.body.updatedCount, 1)

  const fetched = await fetch(`${base}/timetables/${id}`)
  const doc = (await fetched.json()).timetable
  assert.equal(doc.config.dayOverrides.Tuesday.periodDuration, 30)
  assert.equal(doc.config.dayOverrides.Monday, undefined) // Unselected day unchanged
})

test('api: batch apply timing preserves unselected weekday settings', async () => {
  const config = sampleConfig({
    dayTimingMode: 'custom',
    dayOverrides: {
      'Friday': { periodDuration: 30, startTime: '08:00', breakDuration: 15 }
    }
  })
  const created = await post('/timetables', { config })
  const id = created.body.timetable.id

  // Apply timing to Monday and Wednesday only
  const res = await post(`/timetables/${id}/apply-batch-timing`, {
    weekdays: ['Monday', 'Wednesday'],
    timing: { periodDuration: 35, startTime: '08:30' }
  })
  assert.equal(res.status, 200)

  const fetched = await fetch(`${base}/timetables/${id}`)
  const doc = (await fetched.json()).timetable
  // Friday should remain unchanged
  assert.equal(doc.config.dayOverrides.Friday.periodDuration, 30)
  assert.equal(doc.config.dayOverrides.Friday.startTime, '08:00')
  // Monday and Wednesday should be updated
  assert.equal(doc.config.dayOverrides.Monday.periodDuration, 35)
  assert.equal(doc.config.dayOverrides.Wednesday.periodDuration, 35)
})

test('api: batch apply timing does not modify date-specific overrides', async () => {
  const config = sampleConfig({
    dateOverrides: {
      '2026-11-06': { periodDuration: 25, startTime: '10:00' }
    }
  })
  const created = await post('/timetables', { config })
  const id = created.body.timetable.id

  const res = await post(`/timetables/${id}/apply-batch-timing`, {
    weekdays: ['Friday'],
    timing: { periodDuration: 35, startTime: '08:30' }
  })
  assert.equal(res.status, 200)

  const fetched = await fetch(`${base}/timetables/${id}`)
  const doc = (await fetched.json()).timetable
  // Date override should remain unchanged
  assert.ok(doc.config.dateOverrides['2026-11-06'])
  assert.equal(doc.config.dateOverrides['2026-11-06'].periodDuration, 25)
})

test('api: batch apply timing with invalid weekday', async () => {
  const created = await post('/timetables', { config: sampleConfig() })
  const id = created.body.timetable.id

  const res = await post(`/timetables/${id}/apply-batch-timing`, {
    weekdays: ['Monday', 'Funday'], // Invalid weekday
    timing: { periodDuration: 35 }
  })
  assert.equal(res.status, 200)
  assert.equal(res.body.updatedCount, 1)
  assert.equal(res.body.skippedDays.length, 1)
  assert.equal(res.body.skippedDays[0].day, 'Funday')
  assert.ok(res.body.skippedDays[0].reason.includes('Not a valid weekday'))
})

test('api: batch apply timing with non-school day', async () => {
  const created = await post('/timetables', { config: sampleConfig() })
  const id = created.body.timetable.id

  const res = await post(`/timetables/${id}/apply-batch-timing`, {
    weekdays: ['Monday', 'Saturday'], // Saturday not in config.days
    timing: { periodDuration: 35 }
  })
  assert.equal(res.status, 200)
  assert.equal(res.body.updatedCount, 1)
  assert.equal(res.body.skippedDays.length, 1)
  assert.equal(res.body.skippedDays[0].day, 'Saturday')
  assert.ok(res.body.skippedDays[0].reason.includes('Not a configured school day'))
})

test('api: batch apply timing with no weekdays selected', async () => {
  const created = await post('/timetables', { config: sampleConfig() })
  const id = created.body.timetable.id

  const res = await post(`/timetables/${id}/apply-batch-timing`, {
    weekdays: [],
    timing: { periodDuration: 35 }
  })
  assert.equal(res.status, 400)
  assert.ok(res.body.error.includes('At least one weekday'))
})

test('api: batch apply timing with invalid timing configuration', async () => {
  const created = await post('/timetables', { config: sampleConfig({ endTime: '10:00' }) })
  const id = created.body.timetable.id

  const res = await post(`/timetables/${id}/apply-batch-timing`, {
    weekdays: ['Monday'],
    timing: { periodDuration: 120 } // 6 periods * 120 min = 720 min, exceeds 10:00 end time
  })
  assert.equal(res.status, 400)
  assert.ok(res.body.error.includes('Invalid timing'))
})

test('wizard: duplicate class section is an error', () => {
  const cfg = sampleConfig()
  cfg.classes.push({ id: 'c3', name: 'Grade 9A', section: 'A' })
  cfg.classes[0].section = 'A'
  const res = validateConfig(cfg)
  assert.equal(res.canGenerate, false)
  assert.ok(res.errors.some(e => e.includes('Duplicate class')))
})

test('api: /existing-classes returns class templates', async () => {
  const res = await fetch(`${base}/existing-classes`)
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.ok, true)
  assert.ok(Array.isArray(data.classes) && data.classes.length > 0)
})

test('model: isDayOverrideActive correctly handles expiration and indefinite duration', () => {
  const indefiniteOverride = { durationType: 'indefinite' }
  assert.equal(isDayOverrideActive(indefiniteOverride), true)

  const futureDate = new Date(Date.now() + 7 * 86400000).toISOString()
  const activeWeekOverride = { durationType: 'week', expiresAt: futureDate }
  assert.equal(isDayOverrideActive(activeWeekOverride), true)

  const pastDate = new Date(Date.now() - 86400000).toISOString()
  const expiredOverride = { durationType: 'week', expiresAt: pastDate }
  assert.equal(isDayOverrideActive(expiredOverride), false)

  // Empty or missing override
  assert.equal(isDayOverrideActive(null), false)
  assert.equal(isDayOverrideActive({}), true) // legacy override with no expiresAt defaults active
})

test('validator: formats human-readable validation errors without database IDs', () => {
  const config = {
    days: ['Monday'],
    periods: [1, 2, 3, 4, 5, 6, 7],
    classes: [{ id: 'class_19', name: 'Class 7', section: 'APS' }],
    subjects: [{ id: 'subject_ic8s94', name: 'English' }],
    teachers: [{ id: 'teacher_1', name: 'Mr. Smith' }],
    requirements: [
      { classId: 'class_19', subjectId: 'subject_ic8s94', periodsPerWeek: 6, teacherId: 'teacher_1' }
    ]
  }

  // 7 periods scheduled when 6 are required
  const entries = Array.from({ length: 7 }, (_, i) => ({
    classId: 'class_19',
    subjectId: 'subject_ic8s94',
    teacherId: 'teacher_1',
    day: 'Monday',
    period: i + 1
  }))

  const result = validateTimetable(config, entries)
  assert.equal(result.ok, false)
  const extraLessonError = result.hard.find(iss => iss.code === 'H_EXTRA_LESSON')
  assert.ok(extraLessonError, 'Expected H_EXTRA_LESSON issue')
  assert.ok(extraLessonError.message.includes('Class 7 (APS) – English'), 'Message should include formatted class and subject name')
  assert.ok(extraLessonError.message.includes('7 periods have been scheduled, but only 6 are required. Remove 1 period.'), 'Message should explain action')
  assert.ok(!extraLessonError.message.includes('class_19'), 'Message must not contain technical class ID')
  assert.ok(!extraLessonError.message.includes('subject_ic8s94'), 'Message must not contain technical subject ID')
})

test('api: batch apply timing supports durationType and expiresAt', async () => {
  const created = await post('/timetables', { config: sampleConfig() })
  const id = created.body.timetable.id
  const res = await post(`/timetables/${id}/apply-batch-timing`, {
    weekdays: ['Monday', 'Tuesday'],
    timing: { startTime: '08:30', periodDuration: 35 },
    durationType: 'week'
  })
  assert.equal(res.status, 200)
  assert.equal(res.body.ok, true)
  assert.equal(res.body.timetable.config.dayOverrides.Monday.durationType, 'week')
  assert.ok(res.body.timetable.config.dayOverrides.Monday.expiresAt)
  const expireDate = new Date(res.body.timetable.config.dayOverrides.Monday.expiresAt)
  assert.ok(expireDate.getTime() > Date.now())
})


