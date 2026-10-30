# Timetable Solver — Design

Status: **built and tested locally.** No SQL has been executed, no existing The Eye
file has been changed, nothing has been deployed.

Files:

| File | Purpose |
|---|---|
| `timetable/solver.js` | Deterministic generator + preflight impossibility diagnostics |
| `timetable/validator.js` | Independent validator (shares no state with the solver) |
| `unit-tests/timetable.solver.test.js` | 30 `node:test` cases |
| `unit-tests/fixtures.js` | Realistic / scaled / impossible fixtures |
| `unit-tests/benchmark.js` | Generation-time benchmark |
| `timetable/PROPOSED_SCHEMA.sql` | **Proposed** PostgreSQL DDL — not executed |

## 1. Interface

```js
const { generateTimetable } = require('./solver')
const { validateTimetable } = require('./validator')

const result = generateTimetable(config, { nodeBudget: 300000, timeBudgetMs: 5000 })
const report = validateTimetable(config, result.entries)  // independent second opinion
```

`generateTimetable` returns plain JSON-safe data:

```js
{
  ok: boolean,          // true ONLY when 100% complete AND validator-clean
  entries: [{ classId, day, period, subjectId, teacherId, roomId?, locked }],
  stats: { generationMs, nodeCount, requiredLessons, scheduledLessons,
           completenessPct, aborted },
  violations: [],       // hard violations found by the independent validator
  softPenalties: [],    // preferences that could not be honoured (never blocking)
  diagnostics: [],      // why generation failed — always present when ok=false
  score: number         // soft penalty total, lower is better
}
```

Input is plain configuration data (what Phase 2 of the module will store in
PostgreSQL). No database, no framework, no dependencies — the module can be unit
tested and reasoned about in isolation.

```js
{
  days: ['Monday', ...],
  periods: [{ label: 'P1', kind: 'teaching'|'break'|'lunch', start, end }],
  classes: [{ id, name }],
  subjects: [{ id, name, difficult }],
  teachers: [{ id, subjectIds, unavailableSlots, maxPerDay, maxPerWeek }],
  requirements: [{ classId, subjectId, periodsPerWeek, teacherIds?, roomId? }],
  rooms: [{ id, unavailableSlots }],                       // optional
  locks: [{ classId, day, period, subjectId, teacherId }], // optional
  preferences: { maxSameSubjectPerDay, avoidConsecutiveDifficult,
                 balanceClassDays, balanceTeacherDays }
}
```

`day` is an index into `days`; `period` is an index into `periods`. Everything is
per-school configuration: nothing about days, periods or subjects is hardcoded.

## 2. Hard constraints (never violated)

| # | Rule | Enforced by |
|---|---|---|
| H1 | A teacher is never in two classes at the same time | search + validator |
| H2 | A class never has two lessons at the same time | search + validator |
| H3 | Lessons only in `kind: 'teaching'` periods (breaks/lunch excluded) | search + validator |
| H4 | Exactly `periodsPerWeek` periods for every class/subject requirement | search + validator |
| H5 | Only teachers qualified for the subject (and assigned to that class/subject) | search + validator |
| H6 | Teacher availability (`unavailableSlots`) is respected | search + validator |
| H7 | `maxPerDay` / `maxPerWeek` workload limits are respected | search + validator |
| H8 | Room availability and one-class-per-room-per-period | search + validator |
| H9 | Locked lessons are preserved exactly | pre-placement + validator |
| H10 | No lesson exists that no requirement asked for | validator |

## 3. Soft preferences (scoring only — never block a valid timetable)

| # | Preference | Penalty |
|---|---|---|
| S1 | At most `maxSameSubjectPerDay` periods of one subject per class per day | +10 per extra |
| S2 | No two `difficult` subjects back to back for the same class (breaks do not separate) | +15 |
| S3 | A teacher's day should be one contiguous block rather than several fragments | +5 per extra block |

These are reported in `softPenalties` with counts and messages so a user can see
what was not achieved, and they are used as the value-ordering heuristic during
search — but they never turn `ok` false.

## 4. Algorithm

1. **Parse & validate the configuration.** Unknown class/subject/teacher/room ids,
   bad period counts or missing days return immediately as `CFG_*` diagnostics.
2. **Preflight impossibility checks** (cheap, deterministic, before searching):
   - `D_CLASS_OVERFLOW` — a class needs more periods than the week contains
   - `D_NO_TEACHER` — a requirement has no qualified teacher
   - `D_REQUIREMENT_CAPACITY` — too few (slot, teacher) pairs for the demand
   - `D_TEACHER_OVERLOAD` — a sole eligible teacher is over their capacity
   - `D_POOL_OVERLOAD` — a shared teacher pool is over-subscribed
   - `D_BAD_LOCK`, `D_LOCK_CLASH`, `D_LOCK_NON_TEACHING`, `D_LOCK_UNAVAILABLE`,
     `D_LOCK_INELIGIBLE`, `D_LOCK_OVERFLOW`, `D_LOCK_NO_REQUIREMENT`
3. **Search**: forward checking with **most-constrained-variable** ordering.
   At every node the solver recomputes the feasible (slot, teacher) domain of each
   unsatisfied requirement, picks the one with the fewest options, and tries its
   values in heuristic order. A requirement with an empty domain proves the branch
   dead, so the solver backtracks. There is **no randomness anywhere** — the same
   input always yields the same output (asserted by a test).
   - Domain sizes are cached and invalidated precisely (same class, same teacher,
     same room), which is what keeps a 40-class school under a second.
   - Budgets: `nodeBudget` and `timeBudgetMs`. Exceeding either returns
     `S_SEARCH_BUDGET` / `S_TIME_BUDGET` diagnostics, never a partial "success".
4. **Independent validation** of the produced entries by `validator.js`, which
   re-derives H1–H10 from the raw configuration without using any solver state.
5. **Verdict**: `ok = solved && completeness === 100% && validator reports zero
   hard violations`. Otherwise the result carries `S_INCOMPLETE` plus the blocker
   explanation (which class/subject could not be placed and why: clashes,
   availability, workload limits, room conflicts, exhausted class slots).

## 5. Measured results

`node unit-tests/benchmark.js` (Windows, Node 24):

| School | Classes | Lessons | Generation (median) | Search nodes | Result |
|---|---|---|---|---|---|
| Realistic | 8 | 272/272 | **25 ms** | 272 | ok, 0 violations |
| Medium | 12 | 408/408 | **48 ms** | 408 | ok, 0 violations |
| Large | 20 | 680/680 | **163 ms** | 680 | ok, 0 violations |
| Very large | 40 | 1360/1360 | **950 ms** | 1360 | ok, 0 violations |

Independent validation of a 40-class timetable: 15 ms. `node --test` suite: **30/30
passing** in ~0.7 s.

## 6. What is deliberately *not* in v1

- Labs needing consecutive period pairs (rooms and room availability are in,
  adjacency rules for labs are not).
- Parent/subject-teacher preferences such as "no Maths after lunch" beyond the
  `difficult` flag — the preference hook exists (`preferences`) but no UI yet.
- Multi-week or termly timetables: one week is the unit.
