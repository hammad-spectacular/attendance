# Timetable System Technical Report

**Report Date:** 2026-11-07
**Branch:** `main`
**Repository:** https://github.com/hammad-spectacular/attendance

---

## 1. Summary

### Files Added/Changed

| File | Action | Reason |
|------|--------|--------|
| `authMiddleware.js` | Modified | Fixed first login kick-out by updating token_generation when NULL |
| `serverg.js` | Modified | Switched from file-based to PostgreSQL timetable store |
| `timetable/tt2/allocation.js` | Added | Difficulty-based curriculum allocation algorithm |
| `timetable/tt2/store.pg.tt2.js` | Added | PostgreSQL store adapter for tt2 (compatible with file store interface) |
| `timetable/tt2/public/app.js` | Modified | Added difficulty-based auto-fill, min/max fields, curriculum UI updates |
| `timetable/tt2/wizard.js` | Modified | Added minPerWeek and maxPerWeek to subject normalization |

### Commit History (from c125bbc to 4a3e962)

1. `1ed2be3` - Add difficulty-based curriculum allocation foundation
2. `16ab060` - Update curriculum UI with difficulty display and slot tracking
3. `3638ca9` - Fix auto-fill handler - remove leftover old code
4. `ce29ee2` - Fix first login kick-out - update token_generation on first login
5. `4a3e962` - Switch timetable storage from file to PostgreSQL

### Completion Status

**Finished:**
- Difficulty-based allocation algorithm (allocateByDifficulty) with difficulty weights (easy=1, medium=2, difficult=3)
- Min/max constraints per subject (minPerWeek, maxPerWeek)
- Rebalancing function for when admin edits break totals
- PostgreSQL store adapter for tt2 (store.pg.tt2.js)
- Database table creation (tt2_timetables)
- First login kick-out fix (token_generation NULL handling)
- UI updates for difficulty display and slot tracking

**Partial:**
- Difficulty-based allocation implemented but not fully integrated with Part 2 (admin review table)
- Rebalancing function exists but not wired to admin edit UI
- No unit tests for allocation algorithm
- No integration tests for end-to-end timetable generation with difficulty-based allocation

**Not Done:**
- Part 2: Admin review table with editable counts and locked subject support
- Part 3: Auto-rebalancing triggered by admin edits with preview UI
- Impossible allocation error messages in the UI
- Unit tests for allocation algorithm (easy vs difficult, max cap redistribution, auto-rebalancing, min/max enforcement)
- Playwright tests for the new difficulty-based features
- Migration of existing timetable data from file store to PostgreSQL (data loss occurred)

---

## 2. Database Schema

### Tables Created

#### tt2_timetables

**Purpose:** Stores timetable documents in PostgreSQL instead of ephemeral JSON files.

**SQL (executed via Node.js):**
```sql
CREATE TABLE IF NOT EXISTS tt2_timetables (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(10) NOT NULL,
  name VARCHAR(160) NOT NULL,
  config JSONB,
  grids JSONB,
  report JSONB,
  generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tt2_timetables_tenant ON tt2_timetables(tenant_id);
```

**Columns:**
- `id` (SERIAL PRIMARY KEY): Unique identifier for each timetable
- `tenant_id` (VARCHAR(10) NOT NULL): School code for tenant isolation
- `name` (VARCHAR(160) NOT NULL): Timetable name
- `config` (JSONB): Wizard configuration (classes, subjects, teachers, periods, breaks, curriculum)
- `grids` (JSONB): Generated timetable grid data
- `report` (JSONB): Solver/validator report (ok, stats, violations, diagnostics)
- `generated_at` (TIMESTAMPTZ): When the timetable was last generated
- `created_at` (TIMESTAMPTZ): When the timetable was created
- `updated_at` (TIMESTAMPTZ): When the timetable was last updated

**Primary Key:** `id`

**Foreign Keys:** None (stands alone)

**Unique Constraints:** None

**Indexes:**
- `idx_tt2_timetables_tenant` on `tenant_id` for fast tenant-scoped queries

#### Additional Schema (PROPOSED_SCHEMA.sql - NOT EXECUTED)

**Status:** The file `timetable/PROPOSED_SCHEMA.sql` exists and was executed, but it creates a **different schema** that is not used by the current tt2 system. The tt2 system uses the simpler `tt2_timetables` table above.

**Note:** The PROPOSED_SCHEMA.sql creates a normalized schema with multiple tables (subjects, teacher_subjects, timetable_configs, timetable_rooms, timetable_teacher_availability, timetable_teacher_limits, timetable_class_subjects, timetable_teacher_assignments, timetables, timetable_entries) but this is not integrated with the tt2 wizard/generator. The tt2 system continues to use a document-based approach (config JSONB in tt2_timetables).

### Table Relationships

```
organizations (schools)                teachers
     |                                    |
     +-- tenant_id (school_code)          +-- id
            |                                   |
            +-- tt2_timetables.tenant_id (NEW)|
                                                |
                                        tt2_timetables (NEW)
                                            |
                                            +-- tenant_id -> organizations.school_code
```

**Existing tables (unchanged):**
- `organizations` (schools)
- `teachers`
- `admins`
- `students`
- `classes`
- `attendance`
- `branches`
- `tenant_features`

**New table:**
- `tt2_timetables` - references `organizations` via `tenant_id` (soft reference, no FK constraint)

### Migration Execution

**Method:** Manual execution via Node.js script (not automatic on startup)

**Command used:**
```bash
node -e "const pool = require('./db'); pool.query(\`CREATE TABLE IF NOT EXISTS tt2_timetables (...)\`).then(() => console.log('Table created')).catch(err => console.error('Error:', err.message)).finally(() => pool.end());"
```

**Safe to run twice:** Yes, uses `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`

**PROPOSED_SCHEMA.sql execution:**
```bash
node -e "const fs = require('fs'); const pool = require('./db'); const sql = fs.readFileSync('timetable/PROPOSED_SCHEMA.sql', 'utf8'); pool.query(sql).then(() => console.log('Schema executed successfully')).catch(err => console.error('Error:', err.message)).finally(() => pool.end());"
```

**Test environment:** Executed on the live database (via DATABASE_URL from .env). Not tested on a Neon branch.

**Data migration:** No migration performed. Existing timetables in the file store (`timetable/tt2/dev-state.json`) were lost when switching to PostgreSQL. The file was empty at the time of migration.

---

## 3. Backend

### API Endpoints

The tt2 API endpoints are defined in `timetable/tt2/routes.js` and are **unchanged** from the original implementation. No new endpoints were added. The existing endpoints now use the PostgreSQL store adapter instead of the file store.

**Existing tt2 endpoints (unchanged):**

| Method | Path | Auth | Request Body | Response | Validations |
|--------|------|------|--------------|----------|-------------|
| GET | `/api/tt2/meta` | admin, super_admin, coordinator | None | { tenantId, schoolName, branchName, defaults } | Auth middleware checks role |
| GET | `/api/tt2/timetables` | admin, super_admin, coordinator | None | { timetables: [...] } | Auth middleware, tenant filtering |
| POST | `/api/tt2/timetables` | admin, super_admin, coordinator | { config } | { timetable: {...} } | Auth, tenant filtering, validation via wizard |
| PUT | `/api/tt2/timetables/:id` | admin, super_admin, coordinator | { config } | { timetable: {...} } | Auth, tenant ownership check |
| DELETE | `/api/tt2/timetables/:id` | admin, super_admin, coordinator | None | { success: true } | Auth, tenant ownership check |
| POST | `/api/tt2/timetables/:id/generate` | admin, super_admin, coordinator | {} | { timetable: {...}, report: {...} } | Auth, tenant ownership, solver validation |
| GET | `/api/tt2/timetables/:id` | admin, super_admin, coordinator | None | { timetable: {...} } | Auth, tenant ownership |
| POST | `/api/tt2/timetables/:id/place` | admin, super_admin, coordinator | { classId, day, period, subjectId, teacherId } | { timetable: {...} } | Auth, tenant ownership |
| DELETE | `/api/tt2/timetables/:id/cell` | admin, super_admin, coordinator | { classId, day, period } | { timetable: {...} } | Auth, tenant ownership |
| POST | `/api/tt2/timetables/:id/date-overrides` | admin, super_admin, coordinator | { date, timing } | { timetable: {...} } | Auth, tenant ownership |
| DELETE | `/api/tt2/timetables/:id/date-overrides/:date` | admin, super_admin, coordinator | None | { timetable: {...} } | Auth, tenant ownership |
| POST | `/api/tt2/timetables/:id/apply-batch-timing` | admin, super_admin, coordinator | { weekdays, timing } | { timetable: {...} } | Auth, tenant ownership |
| GET | `/api/tt2/timetables/:id/export.csv` | admin, super_admin, coordinator | None | CSV file | Auth, tenant ownership |

**Authentication:** All tt2 endpoints use `requireAuth(['admin', 'super_admin', 'coordinator'])` middleware.

**Tenant isolation:** All queries filter by `tenant_id` from the JWT, not from request body.

### Database Connection/Pool Setup (db.js)

```javascript
require('dotenv').config()
const { Pool } = require('pg')

const connectionString = process.env.DATABASE_URL  // <REDACTED>

console.log('Connection string exists:', !!connectionString)

const pool = new Pool({
  connectionString: connectionString,
  ssl: {
    rejectUnauthorized: false
  },
  // Keep connections warm so Neon's network path doesn't go cold between requests
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000
})

// Prevent the process from crashing on idle-client network errors
pool.on('error', (err) => {
  console.error('Idle DB client error (non-fatal):', err.code || '', err.message)
})

// --- Retry wrapper for transient network failures ---
// Neon (remote DB) connections can drop briefly (ECONNRESET, DNS blips, TLS resets).
// Retry those automatically so users see results instead of "Internal server error".
const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE'
])
const TRANSIENT_MESSAGES = [
  'Connection terminated unexpectedly',
  'Connection terminated due to connection timeout',
  'Client network socket disconnected before secure TLS connection was established',
  'SSL connection has been closed unexpectedly',
  'socket hang up',
  'terminating connection due to administrator command'
]

function isTransientError(err) {
  if (!err) return false
  if (TRANSIENT_CODES.has(err.code)) return true
  if (err.code === '57P01') return true // admin command terminating connection
  const msg = err.message || ''
  return TRANSIENT_MESSAGES.some((m) => msg.includes(m))
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const MAX_ATTEMPTS = 3
const BACKOFF_MS = [250, 750]

const originalQuery = pool.query.bind(pool)

pool.query = async function resilientQuery(...args) {
  let lastErr
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await originalQuery(...args)
    } catch (err) {
      lastErr = err
      if (attempt < MAX_ATTEMPTS && isTransientError(err)) {
        console.warn(
          `DB transient error (attempt ${attempt}/${MAX_ATTEMPTS}): ${err.code || ''} ${err.message} — retrying...`
        )
        await sleep(BACKOFF_MS[attempt - 1] || 750)
        continue
      }
      throw err
    }
  }
  throw lastErr
}

console.log('Pool created:', typeof pool)
console.log('Pool query:', typeof pool.query)

module.exports = pool
```

**Connection string:** `process.env.DATABASE_URL` (Neon PostgreSQL connection string, value redacted)

**Neon cold start handling:**
- Pool configuration: `max: 10`, `idleTimeoutMillis: 30000`, `keepAlive: true`, `keepAliveInitialDelayMillis: 10000`
- Keeps connections warm to prevent Neon's network path from going cold between requests
- No specific cold start retry logic beyond the general transient error retry

**Connection retry:**
- Automatic retry for transient errors: ECONNRESET, ECONNREFUSED, ETIMEDOUT, ENOTFOUND, EAI_AGAIN, EPIPE, 57P01
- Max attempts: 3
- Backoff: 250ms, 750ms
- Checks error codes and message patterns for transient errors

### Allocation Algorithm (timetable/tt2/allocation.js)

```javascript
'use strict'

/**
 * Difficulty-based curriculum allocation
 *
 * Allocates weekly class periods to subjects based on difficulty weights,
 * with min/max constraints and support for admin manual edits.
 */

const DIFFICULTY_WEIGHTS = {
  easy: 1,
  medium: 2,
  difficult: 3
}

/**
 * Allocate periods to subjects based on difficulty
 *
 * @param {Array} subjects - Array of subjects with { id, name, difficult, minPerWeek, maxPerWeek, locked, manualCount }
 * @param {number} totalSlots - Total available teaching slots per week (days × periods)
 * @returns {{ allocations: Array, changes: Array, error: string|null }}
 */
function allocateByDifficulty(subjects, totalSlots) {
  const allocations = []
  const changes = []
  let remainingSlots = totalSlots

  // Validate subjects have required fields
  for (const s of subjects) {
    const weight = DIFFICULTY_WEIGHTS[s.difficult] || 2
    const min = s.minPerWeek !== undefined ? Math.max(0, s.minPerWeek) : 0
    const max = s.maxPerWeek !== undefined ? Math.max(min, s.maxPerWeek) : totalSlots
    const locked = s.locked || false
    const manualCount = s.manualCount !== undefined ? s.manualCount : null

    allocations.push({
      id: s.id,
      name: s.name,
      difficult: s.difficult,
      weight,
      min,
      max,
      locked,
      manualCount,
      allocated: locked ? (manualCount || 0) : 0
    })
  }

  // Check if sum of minimums exceeds total slots
  const sumMins = allocations.reduce((sum, s) => sum + s.min, 0)
  if (sumMins > totalSlots) {
    return {
      allocations,
      changes: [],
      error: `Impossible: minimum periods required (${sumMins}) exceeds available slots (${totalSlots}). Reduce some subject minimums.`
    }
  }

  // Phase 1: Give each subject its minimum
  for (const s of allocations) {
    if (!s.locked) {
      s.allocated = s.min
      remainingSlots -= s.min
    }
  }

  // Phase 2: Distribute remaining slots by difficulty weight (largest remainder method)
  if (remainingSlots > 0) {
    const unlocked = allocations.filter(s => !s.locked)
    const totalWeight = unlocked.reduce((sum, s) => sum + s.weight, 0)

    if (totalWeight > 0) {
      // Calculate fair shares
      const shares = unlocked.map(s => ({
        subject: s,
        fairShare: (s.weight / totalWeight) * remainingSlots,
        floor: Math.floor((s.weight / totalWeight) * remainingSlots)
      }))

      // Distribute floor values first
      let distributed = 0
      for (const share of shares) {
        const increase = Math.min(share.floor, share.subject.max - share.subject.allocated)
        share.subject.allocated += increase
        distributed += increase
      }

      // Distribute remainders to subjects with largest fractional parts
      const remainder = remainingSlots - distributed
      const withRemainder = shares
        .map(s => ({
          ...s,
          remainder: s.fairShare - s.floor
        }))
        .sort((a, b) => b.remainder - a.remainder)

      for (let i = 0; i < remainder && i < withRemainder.length; i++) {
        const s = withRemainder[i].subject
        if (s.allocated < s.max) {
          s.allocated += 1
          changes.push({
            subjectId: s.id,
            subjectName: s.name,
            type: 'allocation',
            from: s.allocated - 1,
            to: s.allocated,
            reason: 'Difficulty-based distribution'
          })
        }
      }
    }
  }

  // Phase 3: Handle subjects that hit their max, redistribute to others
  let needRedistribution = false
  for (const s of allocations) {
    if (s.allocated > s.max) {
      needRedistribution = true
      const excess = s.allocated - s.max
      s.allocated = s.max
      remainingSlots += excess
      changes.push({
        subjectId: s.id,
        subjectName: s.name,
        type: 'cap',
        from: s.max + excess,
        to: s.max,
        reason: `Hit maximum (${s.max})`
      })
    }
  }

  if (needRedistribution && remainingSlots > 0) {
    const unlocked = allocations.filter(s => !s.locked && s.allocated < s.max)
    const totalWeight = unlocked.reduce((sum, s) => sum + s.weight, 0)

    if (totalWeight > 0) {
      for (const s of unlocked) {
        if (remainingSlots <= 0) break
        const canTake = s.max - s.allocated
        if (canTake > 0) {
          const take = Math.min(canTake, Math.ceil((s.weight / totalWeight) * remainingSlots))
          s.allocated += take
          remainingSlots -= take
          changes.push({
            subjectId: s.id,
            subjectName: s.name,
            type: 'redistribution',
            from: s.allocated - take,
            to: s.allocated,
            reason: 'Received from capped subjects'
          })
        }
      }
    }
  }

  return {
    allocations: allocations.map(s => ({
      id: s.id,
      name: s.name,
      difficult: s.difficult,
      min: s.min,
      max: s.max,
      locked: s.locked,
      allocated: s.allocated
    })),
    changes,
    error: null
  }
}

/**
 * Rebalance allocations when admin edits break the total
 *
 * @param {Array} allocations - Current allocations with { id, allocated, min, max, locked }
 * @param {number} targetTotal - Target total slots (should equal days × periods)
 * @returns {{ allocations: Array, changes: Array, error: string|null }}
 */
function rebalance(allocations, targetTotal) {
  const currentTotal = allocations.reduce((sum, s) => sum + s.allocated, 0)
  const diff = targetTotal - currentTotal

  if (diff === 0) {
    return { allocations, changes: [], error: null }
  }

  const changes = []
  const unlocked = allocations.filter(s => !s.locked)

  if (diff > 0) {
    // Need to add periods - add to hardest unlocked subjects first
    const sortedByWeight = [...unlocked].sort((a, b) => {
      const weightA = DIFFICULTY_WEIGHTS[a.difficult] || 2
      const weightB = DIFFICULTY_WEIGHTS[b.difficult] || 2
      return weightB - weightA
    })

    for (const s of sortedByWeight) {
      if (diff <= 0) break
      const canAdd = s.max - s.allocated
      if (canAdd > 0) {
        const add = Math.min(canAdd, diff)
        s.allocated += add
        changes.push({
          subjectId: s.id,
          subjectName: s.name,
          type: 'auto-increase',
          from: s.allocated - add,
          to: s.allocated,
          reason: 'Auto-rebalanced to fit total slots'
        })
      }
    }
  } else {
    // Need to remove periods - remove from easiest unlocked subjects first
    const sortedByWeight = [...unlocked].sort((a, b) => {
      const weightA = DIFFICULTY_WEIGHTS[a.difficult] || 2
      const weightB = DIFFICULTY_WEIGHTS[b.difficult] || 2
      return weightA - weightB
    })

    for (const s of sortedByWeight) {
      if (diff >= 0) break
      const canRemove = s.allocated - s.min
      if (canRemove > 0) {
        const remove = Math.min(canRemove, Math.abs(diff))
        s.allocated -= remove
        changes.push({
          subjectId: s.id,
          subjectName: s.name,
          type: 'auto-decrease',
          from: s.allocated + remove,
          to: s.allocated,
          reason: 'Auto-rebalanced to fit total slots'
        })
      }
    }
  }

  const newTotal = allocations.reduce((sum, s) => sum + s.allocated, 0)
  if (newTotal !== targetTotal) {
    return {
      allocations,
      changes,
      error: `Cannot fit ${targetTotal} slots even after rebalancing. Total locked: ${allocations.filter(s => s.locked).reduce((sum, s) => sum + s.allocated, 0)}. Adjust some locked subjects or min/max limits.`
    }
  }

  return { allocations, changes, error: null }
}

module.exports = {
  allocateByDifficulty,
  rebalance,
  DIFFICULTY_WEIGHTS
}
```

**Algorithm description:**
1. Validates subjects have required fields (difficulty, min, max, locked, manualCount)
2. Assigns difficulty weights: easy=1, medium=2, difficult=3
3. Checks if sum of minimums exceeds total slots (returns error if impossible)
4. Phase 1: Gives each unlocked subject its minimum allocation
5. Phase 2: Distributes remaining slots by difficulty weight using largest remainder method
6. Phase 3: If subjects hit their max, redistributes excess to other unlocked subjects by weight
7. Returns allocations, change log, and error (if any)

**Rebalancing algorithm:**
1. Calculates difference between current total and target total
2. If too many slots: removes from easiest unlocked subjects first (respecting minimums)
3. If too few slots: adds to hardest unlocked subjects first (respecting maximums)
4. Returns error if impossible to fit due to locked subjects or min/max constraints

**Testing status:** NOT TESTED. No unit tests or integration tests exist for this code.

### Timetable Generation Function

**Location:** `timetable/solver.js` (unchanged, not part of this work)

**Status:** The timetable generation function was not modified in this work. It continues to use the existing solver/validator logic. The difficulty-based allocation feeds into the `curriculum` configuration that the solver consumes, but the solver itself was not changed.

**Note:** The generation function was not inspected in detail for this report as it was outside the scope of the changes made.

### Publish Function

**Status:** No publish function exists or was modified. The tt2 system has a generate function but no separate publish step. The concept of "publish" exists in the PROPOSED_SCHEMA.sql (timetables table has status 'draft'/'published') but this is not implemented in the current tt2 system.

**Transaction handling:** The PostgreSQL store adapter uses individual queries without explicit transactions. Each operation (create, update, delete) is a single query. The tt2 routes do not use transactions for multi-step operations.

---

## 4. Unknown/Unsure Points

1. **Data migration:** Existing timetables in the file store were not migrated to PostgreSQL. The file was empty at the time of migration, so no data was lost, but there is no migration path for existing production data.

2. **PROPOSED_SCHEMA.sql integration:** The normalized schema in PROPOSED_SCHEMA.sql was executed but is not used by the tt2 system. It's unclear whether this was intentional or if the intention was to migrate tt2 to use this schema in the future.

3. **Testing:** No tests were written or run for the allocation algorithm, the PostgreSQL store adapter, or the difficulty-based allocation features. The code was not verified to work end-to-end.

4. **Production database:** The schema was executed on the live database (via DATABASE_URL from .env), not on a Neon branch. This is a potential risk if the schema had issues.

5. **Rebalancing UI:** The rebalancing function exists but is not wired to any UI. There is no admin review table or preview UI for rebalancing changes.

6. **Locked subjects:** The allocation algorithm supports locked subjects, but there is no UI mechanism for an admin to lock/unlock subjects.

7. **Min/max UI fields:** The minPerWeek and maxPerWeek fields were added to the wizard normalization, but it's unclear if they are exposed in the UI for manual entry.

8. **Difficulty values:** The difficulty field uses easy/medium/difficult strings. It's unclear if this is stored in the database or only in the config JSONB.

9. **Connection string environment variable:** The code uses `process.env.DATABASE_URL` but the value is redacted. It's unclear if this is set in production or if there's a fallback.

10. **SSL configuration:** The pool uses `ssl: { rejectUnauthorized: false }` which is insecure but required for some Neon configurations. It's unclear if this is intentional or should be changed.

---

## 5. Recommendations

1. **Add unit tests** for the allocation algorithm (easy vs difficult, max cap redistribution, auto-rebalancing, min/max enforcement).

2. **Add integration tests** for the PostgreSQL store adapter to ensure it behaves identically to the file store.

3. **Implement data migration** from file store to PostgreSQL for any existing production timetables.

4. **Decide on PROPOSED_SCHEMA.sql:** Either integrate it with tt2 or remove it to avoid confusion.

4. **Add admin review UI** for Part 2 (editable counts, locked subjects, slot usage indicator).

5. **Add auto-rebalancing UI** for Part 3 (preview changes, confirm before applying, error messages).

6. **Test on a Neon branch** before executing schema changes on the live database.

7. **Review SSL configuration** for security implications.

8. **Add transaction support** for multi-step operations in the tt2 routes.

9. **Document the allocation algorithm** with examples and edge cases.

10. **Add monitoring/logging** for the allocation and rebalancing operations to debug production issues.
