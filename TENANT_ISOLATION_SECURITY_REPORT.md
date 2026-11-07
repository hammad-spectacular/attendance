# Tenant Isolation and Security Report

## Executive Summary

This report documents the current state of tenant isolation in The Eye application, identifies security risks, and describes fixes applied during the feature/timetable-database branch work.

**Critical Finding:** Most routes correctly filter by tenant_id from the authenticated JWT, but one table (teacher_attendance_manual_changes) lacks a tenant_id column and some routes were trusting client-provided tenant values.

---

## Tables with Tenant Isolation

The following tables have a `tenant_id` column and are correctly scoped:

| Table | Has tenant_id | Notes |
|-------|---------------|-------|
| organizations | N/A | This IS the tenant table (school_code is the tenant identifier) |
| admins | Yes (line 711) | Properly filtered in all queries |
| teachers | Yes (line 722) | Properly filtered in all queries |
| students | Yes (line 732) | Properly filtered in all queries |
| classes | Yes (line 753) | Properly filtered in all queries |
| attendance | Yes (line 752) | Properly filtered in all queries |
| homework | Yes (line 754) | Properly filtered in all queries |
| announcements | Yes (line 755) | Properly filtered in all queries |
| branches | No* | Uses school_id FK to organizations (tenant_id equivalent) |
| fee_structures | Yes (line 890) | Properly filtered in all queries |
| fee_payments | Yes (line 905) | Properly filtered in all queries |
| complaints | Yes (line 1068) | Properly filtered in all queries |
| datesheets | Yes (line 1051) | Properly filtered in all queries |
| teacher_attendance | Yes (line 542) | Properly filtered in all queries |
| qr_attendance_sessions | Yes (line 567) | Properly filtered in all queries |
| qr_attendance_settings | Yes (line 585) | Properly filtered in all queries |
| tt2_timetables | Yes | From PostgreSQL adapter work |

**Catalog tables (no tenant_id needed):**
- tenant_features - Global feature catalogue
- tenant_grants - Has school_id FK to organizations (tenant_id equivalent)
- school_requests - Superadmin-only for new school signup

---

## Missing Tenant Isolation

### 1. teacher_attendance_manual_changes Table

**Issue:** This table does NOT have a `tenant_id` column.

**Current schema:**
```sql
CREATE TABLE IF NOT EXISTS teacher_attendance_manual_changes (
  id SERIAL PRIMARY KEY,
  attendance_id INTEGER NOT NULL REFERENCES teacher_attendance(id) ON DELETE CASCADE,
  changed_by INTEGER NOT NULL REFERENCES admins(id) ON DELETE SET NULL,
  changed_by_role VARCHAR(20) NOT NULL,
  old_check_in_time TIMESTAMPTZ,
  new_check_in_time TIMESTAMPTZ,
  old_check_out_time TIMESTAMPTZ,
  new_check_out_time TIMESTAMPTZ,
  old_status VARCHAR(20),
  new_status VARCHAR(20),
  note TEXT NOT NULL,
  changed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
```

**Risk:** While the query for manual changes history (line 4561-4575) joins through `teacher_attendance` which does have tenant_id, this is an indirect dependency. If future queries are added that don't join through teacher_attendance, they could expose cross-tenant data.

**Recommendation:** Add `tenant_id VARCHAR(10) NOT NULL REFERENCES organizations(school_code) ON DELETE CASCADE` and an index, then migrate existing data.

---

## Routes Fixed (Client-Provided Tenant Values)

### Before (SECURITY ISSUE):

**GET /api/attendance/qr/setting** (line 4495-4497):
```javascript
const { tenant_id } = req.query  // ❌ Trusted client value
```

**POST /api/attendance/qr/setting** (line 4526-4528):
```javascript
const { tenant_id } = req.body  // ❌ Trusted client value
```

### After (FIXED):

Both routes now use:
```javascript
const { tenant_id } = req.user  // ✅ From authenticated JWT
```

---

## ID-Based Routes with Tenant and Role Checks

The following routes correctly verify that a record belongs to the authenticated tenant AND check role permissions:

| Route | Tenant Check | Role Check | Status |
|-------|--------------|------------|--------|
| DELETE /api/coordinators/:id | `WHERE id = $1 AND tenant_id = $2` | requireAuth(['admin']) | ✅ Good |
| DELETE /api/classes/:id | `WHERE id = $1 AND tenant_id = $2` | requireAuth(['admin', 'super_admin']) | ✅ Good |
| POST /api/classes/:id/assign-teacher | `WHERE id = $1 AND tenant_id = $2` | requireAuth(['admin', 'super_admin']) | ✅ Good |
| PUT /api/classes/:id | `WHERE id = $1 AND tenant_id = $2` | requireAuth(['admin', 'super_admin']) | ✅ Good |
| PUT /api/teachers/:id | `WHERE id = $1 AND tenant_id = $2` | requireAuth(['admin', 'super_admin']) | ✅ Good |
| DELETE /api/teachers/:id | `WHERE id = $1 AND tenant_id = $2` | requireAuth(['admin', 'super_admin']) | ✅ Good |
| GET /api/students/:id | `WHERE id = $1 AND tenant_id = $2` | requireAuth(['admin', 'teacher', 'super_admin']) | ✅ Good |
| PUT /api/students/:id | `WHERE id = $1 AND tenant_id = $2` | requireAuth(['admin', 'super_admin']) | ✅ Good |
| PUT /api/students/:id/name | `WHERE id = $1 AND tenant_id = $2` | requireAuth(['admin', 'super_admin']) | ✅ Good |
| DELETE /api/students/:id | `WHERE id = $1 AND tenant_id = $2` | requireAuth(['admin', 'super_admin']) | ✅ Good |
| DELETE /api/homework/:id | `WHERE id = $1 AND tenant_id = $2` | requireAuth(['teacher', 'admin']) | ✅ Good |
| PATCH /api/branches/:id | Superadmin cross-tenant allowed | requireAuth(['super_admin']) | ✅ Legitimate |
| PATCH /api/branches/:id/admin | `WHERE id = $1 AND school_id = $2` | requireAuth(['admin']) | ✅ Good |
| PATCH /api/coordinators/:id | `WHERE id = $1 AND tenant_id = $2` | requireAuth(['admin']) | ✅ Good |

---

## Login Collision Prevention

### Current Implementation

Login queries (lines 1386-1391) correctly filter by both `tenant_id` and `login_id`:

```javascript
SELECT id, role, email, email_verified_at, 1 AS src_order
FROM students WHERE tenant_id = $1 AND login_id = $2

SELECT id, role, email, email_verified_at, 2 AS src_order
FROM teachers WHERE tenant_id = $1 AND login_id = $2

SELECT id, role, email, email_verified_at, 3 AS src_order
FROM admins WHERE tenant_id = $1 AND login_id = $2
```

**Status:** ✅ Usernames/logins cannot collide across academies because the WHERE clause requires a match on both tenant_id and login_id.

---

## Feature Access Control

### Applied Fixes

1. **QR Attendance Routes:**
   - POST /api/attendance/qr/generate - Feature check added
   - GET /api/attendance/qr/status - Feature check added
   - GET /api/attendance/qr/setting - Feature check added, tenant_id source fixed
   - POST /api/attendance/qr/setting - Feature check added, tenant_id source fixed
   - GET /api/attendance/manual-changes - Feature check added
   - GET /api/attendance/staff - Feature check added
   - POST /api/attendance/staff/manual - Feature check added
   - POST /api/attendance/teacher/checkin - Feature check added

2. **Timetable Routes:**
   - All /api/tt2 routes have feature check via `tt2FeatureCheck` middleware

3. **Frontend Hiding:**
   - menu-config.js has `dataFeatureKey` attributes for QR attendance and timetable
   - shared-nav.js hides menu items when feature is not enabled
   - Fetches enabled features from /api/features endpoint

4. **Feature Defaults:**
   - BASIC (default ON): attendance, student_management, teacher_management, fees, coordinator_management, coordinator_portal
   - ADVANCED (default OFF): student_portal, teacher_portal, whatsapp, biometric, qr_attendance, timetable

5. **Superadmin Control:**
   - Only super_admin can toggle features via PATCH /api/tenant-features/:school_id/:feature_key
   - Academy admins cannot enable features
   - Basic features marked as always-on in UI

---

## Uploaded Files, Caches, and In-Memory Data

### Current State

**No dedicated file upload system found in serverg.js.** The application does not appear to handle file uploads (documents, images, etc.) that would need tenant separation.

**In-memory state:**
- No global in-memory caches that mix tenant data
- All data reads go through PostgreSQL with tenant_id filters
- JWT carries tenant_id, role, branch_id from authentication

**Status:** ✅ No file upload system requiring tenant separation. No in-memory caches mixing tenant data.

---

## CSV Exports

### Current State

No CSV export routes were found in serverg.js. If CSV exports are added in the future, they must:
1. Filter by req.user.tenant_id
2. Not accept tenant_id from query/body
3. Use feature checks if for a gated feature

---

## PostgreSQL Row-Level Security (RLS)

### What is RLS?

PostgreSQL Row-Level Security allows you to define policies at the database level that automatically filter rows based on the current database user or session variables. It acts as a second safety net - even if application code has a bug, the database itself will reject cross-tenant access.

### Example RLS Policy

```sql
ALTER TABLE students ENABLE ROW LEVEL SECURITY;

CREATE POLICY student_tenant_isolation ON students
  FOR ALL
  TO app_user
  USING (tenant_id = current_setting('app.current_tenant')::VARCHAR(10));
```

The application would set `current_tenant` at the start of each request:
```sql
SET app.current_tenant = 'ABC1';
```

### Pros and Cons

**Pros:**
- Defense in depth: database enforces isolation even if app code has bugs
- Impossible to accidentally forget a WHERE clause
- Audit-friendly: policies are visible in database schema

**Cons:**
- Requires changing how connections are managed (per-request SET commands)
- More complex to test and debug
- Performance overhead (though minimal for simple policies)
- Requires a database user per tenant or session variables

### Recommendation

RLS is a valuable second safety net, but:
1. **Do not apply without approval** - This is a database schema change
2. **Current application-level filtering is robust** - All queries already filter by tenant_id
3. **RLS adds complexity** - Connection pooling and per-request settings need careful design

If you want RLS as a defense-in-depth measure, the migration would:
1. Add a SET command at the start of each request to set the tenant context
2. Enable RLS on all tenant-scoped tables
3. Create policies that filter by the tenant context variable
4. Test thoroughly with connection pooling

---

## Separate Database and Deployment for Second Academy

### What It Would Take

To run a second academy on a fully separate database and deployment:

**Database Level:**
1. Create a new Neon database (or a separate project)
2. Run the full schema migration (all CREATE TABLE statements)
3. No data sharing between academies - completely isolated

**Application Level:**
1. Deploy a separate instance of the Node.js application
2. Configure separate DATABASE_URL environment variable
3. Separate JWT_SECRET (so tokens can't be cross-used)
4. Separate Render/Vercel deployment or separate VPS
5. Separate domain (e.g., academy2.the-eye.app)

**Pros:**
- Complete isolation - no possible cross-tenant access at any layer
- Can scale databases independently
- Different plans/pricing per academy
- Backup/restore is per-academy

**Cons:**
- Higher cost (multiple Neon projects, multiple deployments)
- More operational overhead (monitoring, updates, deployments for each)
- Feature updates must be deployed to each instance separately
- No centralized admin panel (unless you build a cross-academy admin)

**Current Multi-Tenant Approach (Single Database):**
- Lower cost
- Single deployment to manage
- Centralized superadmin panel
- Risk: bug in application code could theoretically expose cross-tenant data (mitigated by current tenant_id filtering)

---

## Plain-Language Summary

### What Was Exposed or At Risk

1. **QR setting routes** were accepting tenant_id from the query string and request body instead of the authenticated token. This could have allowed an attacker to view or modify another academy's QR settings by guessing their tenant_id.

2. **teacher_attendance_manual_changes table** lacks a tenant_id column. While current queries filter through the attendance record (which has tenant_id), future queries could accidentally expose cross-tenant data.

### What Was Changed

1. **Fixed QR setting routes** (serverg.js):
   - GET /api/attendance/qr/setting now uses req.user.tenant_id
   - POST /api/attendance/qr/setting now uses req.user.tenant_id
   - Both no longer trust client-provided tenant values

2. **Added feature checks** to all QR attendance and timetable routes:
   - QR generate, status, setting, manual-changes, staff view, manual edit, teacher check-in
   - All tt2 routes via middleware
   - Returns friendly message when feature disabled

3. **Created migration** (002_feature_defaults_migration.sql):
   - Sets BASIC features to default ON
   - Sets ADVANCED features to default OFF
   - Preserves existing academy settings via explicit grant rows

4. **Frontend feature hiding** already in place:
   - menu-config.js has dataFeatureKey attributes
   - shared-nav.js hides disabled features
   - Fetches enabled features from server

### Remaining Recommendation

Add tenant_id column to teacher_attendance_manual_changes table for complete isolation. This requires a migration to:
1. Add tenant_id column
2. Backfill existing rows from teacher_attendance
3. Add index
4. Update queries to filter by tenant_id directly

---

## Files Changed

1. **serverg.js** - Fixed QR setting tenant_id source, added feature checks to QR routes
2. **migrations/002_feature_defaults_migration.sql** - New migration file for feature defaults

---

## Command to Start App Locally

```bash
npm start
```

Or for development with auto-reload:

```bash
npm run dev
```

The app will run on `http://localhost:3000`.
