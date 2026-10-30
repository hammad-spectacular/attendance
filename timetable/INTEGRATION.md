# Integrating the timetable module into The Eye

Status: **the mount is verified by an automated test** (`unit-tests/timetable.routes.test.js`
→ *"mounts under The Eye's requireAuth exactly as INTEGRATION.md documents"*), which
constructs this exact Express stack with The Eye's real `requireAuth` and a real
Eye-shaped JWT. The PostgreSQL driver is the one piece that has **not** been executed
(see Limitations).

## 1. What runs where

```
timetable/
  solver.js            pure solver            shared (standalone + production)
  validator.js         pure validator         shared
  routes.js            router FACTORY         shared — auth is injected, never duplicated
  store.js             memory driver          standalone + tests
  store.pg.js          PostgreSQL driver      production only (untested, see below)
  sample-data.js       two seed schools       standalone + tests
  dev-server.js        dev launcher            standalone ONLY (never deployed)
  public/              the UI                 shared: mounted at /timetable in The Eye
  PROPOSED_SCHEMA.sql  migration              reviewable, NOT executed
```

The standalone server is **not** a second implementation: it mounts the same
`createTimetableRouter()` and the same `requireAuth` that production uses, with a
forced dev-only JWT secret and a memory store.

## 2. The three lines to add to `serverg.js` (after the existing API routes)

```js
const { createTimetableRouter } = require('./timetable/routes')
const { createPgStore } = require('./timetable/store.pg')
const timetableStore = createPgStore(pool)

app.use('/api/timetable', requireAuth(['super_admin', 'admin', 'coordinator', 'teacher']),
  createTimetableRouter({
    store: timetableStore,
    featureEnabled: async (tenantId) => {
      const r = await pool.query(
        `SELECT COALESCE(g.enabled, f.default_enabled) AS enabled
           FROM tenant_features f
           LEFT JOIN tenant_grants g ON g.feature_key = f.key AND g.school_id = $1
          WHERE f.key = 'timetable'`,
        [tenantId]
      )
      return r.rows.length ? r.rows[0].enabled : true   // fail open, like isPortalEnabled()
    },
    guards: [requireWritableBranch()]                   // coordinators stay branch-locked
  }))

// The module UI (same files the dev server serves):
app.use('/timetable', express.static(path.join(__dirname, 'timetable/public')))
```

Because `requireAuth` is mounted **outside** and also injected **inside** the
factory, the router's own role policy still applies: teachers get read-only,
students are refused by `requireAuth` itself.

## 3. Navigation tab

Add to the admin page's tab list (same pattern as `data-feature-key="fees"`):

```html
<button class="tab" data-feature-key="timetable" data-page="/timetable/index.html">Timetable</button>
```

No new login: the UI reads the existing `localStorage.auth_token` (the key
`public/auth-utils.js` already writes) and redirects to `/index.html` when it is
missing or expired. In standalone mode `GET /api/timetable/meta` reports
`devAuth: true` and the identity picker appears instead.

## 4. Database migration (review first, run on a DEV database only)

1. Copy `timetable/PROPOSED_SCHEMA.sql`.
2. Apply it to a **development** database (never the production Neon connection):
   `psql "$DEV_DATABASE_URL" -f timetable/PROPOSED_SCHEMA.sql`
3. It is additive only: new tables + one `tenant_features` catalogue row
   (`'timetable'`, `default_enabled = false`). No existing table is altered.
4. Verify: `SELECT key, default_enabled FROM tenant_features WHERE key = 'timetable';`

The feature stays **off** for every school until the Super Admin grants it, so
deploying the code before the UI is harmless.

## 5. Verification checklist before going live

| Step | Status |
|---|---|
| Router works under the real `requireAuth` with a real Eye JWT | ✅ automated test |
| Feature flag gate (403 when disabled) | ✅ automated test |
| Role policy: teacher read-only, student refused | ✅ automated test |
| Tenant isolation between two schools | ✅ automated test |
| Solver + validator through the API (both modes) | ✅ automated test |
| `store.pg.js` against a real database | ❌ **not run** — no dev DB in this workspace |
| Navigation tab renders inside admin.html | ❌ not done (needs approval to edit admin.html) |
| End-to-end login through The Eye's own login page | ❌ not run — serverg.js requires the production DB to boot |

To close the last row: boot `serverg.js` against a dev database with the
migration applied, sign in through `/index.html`, open `/timetable/`, then run
`npm run test:unit` again — the suite must stay green.

## 6. Conventions kept

- `tenant_id` always comes from `req.user.tenant_id` (the JWT), never the body.
- Every pg query is parameterised and tenant-filtered first, like `serverg.js`.
- Errors are JSON `{ error }`; API 404 matches `serverg.js` exactly.
- No new npm dependencies; `package.json` only gained two scripts
  (`test:unit`, `dev:timetable`).
