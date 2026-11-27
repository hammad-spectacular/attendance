'use strict'

const express = require('express')
const { branchFilter } = require('./authMiddleware')
const FM = require('./fee-management')

/**
 * Dashboard aggregation & global search router.
 * Reuses existing tables, fee-management status rules, and feature gates
 * without duplicating business logic or fabricating metrics.
 */
function createDashboardRouter({ pool, requireAuth }) {
  const router = express.Router()
  const auth = requireAuth(['admin', 'super_admin'])

  function resolveBranchId(req) {
    const forced = branchFilter(req.user)
    if (forced != null) return forced
    const raw = req.query.branch_id
    if (raw === undefined || raw === null || raw === '' || raw === 'all') return null
    const parsed = parseInt(raw, 10)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  }

  function resolveYearBounds(yearParam) {
    if (!yearParam || yearParam === 'all') return null
    const m = String(yearParam).trim().match(/^(\d{4})(?:-(\d{2,4}))?$/)
    if (!m) return null
    const startYear = parseInt(m[1], 10)
    let endYear = startYear + 1
    if (m[2]) {
      endYear = m[2].length === 2
        ? Math.floor(startYear / 100) * 100 + parseInt(m[2], 10)
        : parseInt(m[2], 10)
    }
    // Standard academic year window: Aug 1 of startYear through Jul 31 of endYear
    return {
      label: `${startYear}-${String(endYear).slice(-2)}`,
      start: `${startYear}-08-01`,
      end: `${endYear}-07-31`,
    }
  }

  async function loadFeatureMap(tenantId) {
    const [featuresRes, grantsRes] = await Promise.all([
      pool.query('SELECT key, default_enabled FROM tenant_features'),
      pool.query('SELECT feature_key, enabled FROM tenant_grants WHERE school_id = $1', [tenantId]),
    ])
    const grants = new Map(grantsRes.rows.map(r => [r.feature_key, r.enabled]))
    const map = {}
    for (const f of featuresRes.rows) {
      map[f.key] = grants.has(f.key) ? grants.get(f.key) === true : f.default_enabled === true
    }
    return map
  }

  /**
   * GET /api/dashboard/overview
   * Returns aggregated, tenant- & branch-isolated metrics for the Admin Overview.
   */
  router.get('/overview', auth, async (req, res) => {
    try {
      const tenantId = req.user.tenant_id
      const branchId = resolveBranchId(req)
      const yearBounds = resolveYearBounds(req.query.year)
      const todayIso = new Date().toISOString().slice(0, 10)

      const features = await loadFeatureMap(tenantId)

      // 1. Organization & Admin identity
      const orgPromise = pool.query(
        'SELECT school_code, school_name FROM organizations WHERE school_code = $1',
        [tenantId]
      )
      const adminPromise = pool.query(
        'SELECT id, name, login_id, role FROM admins WHERE id = $1',
        [req.user.user_id]
      )

      // 2. Students summary (active, frozen, new this month, total classes)
      const stuParams = [tenantId]
      const stuBranch = branchId ? (stuParams.push(branchId), ` AND branch_id = $${stuParams.length}`) : ''
      const studentsPromise = pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE COALESCE(is_frozen, false) = false)::int AS active_count,
           COUNT(*) FILTER (WHERE COALESCE(is_frozen, false) = true)::int AS frozen_count,
           COUNT(*) FILTER (WHERE created_at >= date_trunc('month', CURRENT_DATE))::int AS new_this_month
         FROM students
         WHERE tenant_id = $1${stuBranch}`,
        stuParams
      )

      const clsParams = [tenantId]
      const clsBranch = branchId ? (clsParams.push(branchId), ` AND branch_id = $${clsParams.length}`) : ''
      const classesPromise = pool.query(
        `SELECT c.id, c.name, c.section,
                EXISTS (
                  SELECT 1 FROM teachers t
                  WHERE t.class_id = c.id AND t.tenant_id = $1
                ) AS has_teacher
         FROM classes c
         WHERE c.tenant_id = $1${clsBranch}
         ORDER BY c.name, c.section`,
        clsParams
      )

      // 3. Teachers summary
      const tchParams = [tenantId]
      const tchBranch = branchId ? (tchParams.push(branchId), ` AND branch_id = $${tchParams.length}`) : ''
      const teachersPromise = pool.query(
        `SELECT id, name, class_id FROM teachers WHERE tenant_id = $1${tchBranch}`,
        tchParams
      )

      // 4. Student attendance today + last 5 school days
      const attParams = [tenantId]
      const attBranch = branchId ? (attParams.push(branchId), ` AND s.branch_id = $${attParams.length}`) : ''
      const attTodayPromise = pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE LOWER(a.status) = 'present')::int AS present_count,
           COUNT(*) FILTER (WHERE LOWER(a.status) = 'absent')::int AS absent_count,
           COUNT(*) FILTER (WHERE LOWER(a.status) = 'late')::int AS late_count,
           COUNT(DISTINCT s.class_id)::int AS marked_classes
         FROM attendance a
         JOIN students s ON s.id = a.student_id AND s.tenant_id = $1
         WHERE a.tenant_id = $1 AND a.date = CURRENT_DATE${attBranch}`,
        attParams
      )

      const attTrendParams = [tenantId]
      const attTrendBranch = branchId ? (attTrendParams.push(branchId), ` AND s.branch_id = $${attTrendParams.length}`) : ''
      let attTrendYear = ''
      if (yearBounds) {
        attTrendParams.push(yearBounds.start, yearBounds.end)
        attTrendYear = ` AND a.date BETWEEN $${attTrendParams.length - 1}::date AND $${attTrendParams.length}::date`
      }
      const attTrendPromise = pool.query(
        `SELECT
           a.date::text AS date,
           TO_CHAR(a.date, 'Dy') AS day_label,
           COUNT(*) FILTER (WHERE LOWER(a.status) IN ('present', 'late'))::int AS present_count,
           COUNT(*) FILTER (WHERE LOWER(a.status) = 'absent')::int AS absent_count,
           COUNT(*)::int AS total_count
         FROM attendance a
         JOIN students s ON s.id = a.student_id AND s.tenant_id = $1
         WHERE a.tenant_id = $1
           AND a.date <= CURRENT_DATE${attTrendBranch}${attTrendYear}
         GROUP BY a.date
         ORDER BY a.date DESC
         LIMIT 5`,
        attTrendParams
      )

      const yearsPromise = pool.query(
        `SELECT DISTINCT
           CASE WHEN EXTRACT(MONTH FROM d)::int >= 8
             THEN EXTRACT(YEAR FROM d)::int || '-' || RIGHT((EXTRACT(YEAR FROM d)::int + 1)::text, 2)
             ELSE (EXTRACT(YEAR FROM d)::int - 1)::text || '-' || RIGHT(EXTRACT(YEAR FROM d)::int::text, 2)
           END AS ay
         FROM (
           SELECT date AS d FROM attendance WHERE tenant_id = $1 AND date IS NOT NULL
           UNION ALL
           SELECT COALESCE(billing_period_start, due_date, created_at::date) AS d FROM student_fee_obligations WHERE tenant_id = $1
         ) sub
         ORDER BY ay DESC`,
        [tenantId]
      ).catch(() => ({ rows: [] }))

      // Classes with active students that have not had attendance marked today
      const unmarkedParams = [tenantId]
      const unmarkedBranch = branchId ? (unmarkedParams.push(branchId), ` AND c.branch_id = $${unmarkedParams.length}`) : ''
      const unmarkedClassesPromise = pool.query(
        `SELECT c.id, c.name, c.section, COUNT(s.id)::int AS student_count
         FROM classes c
         JOIN students s ON s.class_id = c.id AND s.tenant_id = $1 AND COALESCE(s.is_frozen, false) = false
         WHERE c.tenant_id = $1${unmarkedBranch}
           AND NOT EXISTS (
             SELECT 1 FROM attendance a
             WHERE a.student_id = s.id AND a.tenant_id = $1 AND a.date = CURRENT_DATE
           )
         GROUP BY c.id, c.name, c.section
         ORDER BY c.name, c.section`,
        unmarkedParams
      )

      // 5. Staff / Teacher QR attendance today (only when qr_attendance is enabled)
      let teacherAttPromise = Promise.resolve(null)
      if (features.qr_attendance) {
        const taParams = [tenantId]
        const taBranch = branchId ? (taParams.push(branchId), ` AND ta.branch_id = $${taParams.length}`) : ''
        teacherAttPromise = pool.query(
          `SELECT COUNT(DISTINCT ta.teacher_id)::int AS present_teachers
           FROM teacher_attendance ta
           JOIN teachers t ON t.id = ta.teacher_id AND t.tenant_id = $1
           WHERE ta.tenant_id = $1 AND ta.date = CURRENT_DATE${taBranch}`,
          taParams
        ).catch(() => null)
      }

      // 6. Fee recovery (only when fees is enabled, using student_fee_obligations + student_fee_payments)
      let feePromise = Promise.resolve(null)
      if (features.fees) {
        const feeParams = [tenantId]
        const feeBranch = branchId ? (feeParams.push(branchId), ` AND o.branch_id = $${feeParams.length}`) : ''
        let feeYear = ''
        if (yearBounds) {
          feeParams.push(yearBounds.start, yearBounds.end)
          feeYear = ` AND COALESCE(o.billing_period_start, o.due_date, o.created_at::date) BETWEEN $${feeParams.length - 1}::date AND $${feeParams.length}::date`
        }
        feePromise = pool.query(
          `SELECT o.id, o.student_id, o.final_amount, o.due_date, o.status,
                  COALESCE((
                    SELECT SUM(p.amount) FROM student_fee_payments p
                    WHERE p.obligation_id = o.id AND p.tenant_id = o.tenant_id AND p.status = 'completed'
                  ), 0) AS paid_amount
           FROM student_fee_obligations o
           WHERE o.tenant_id = $1
             AND o.status NOT IN ('cancelled', 'waived', 'exempt')${feeBranch}${feeYear}`,
          feeParams
        ).catch(() => null)
      }

      // 7. Timetable coverage (only when timetable is enabled)
      let timetablePromise = Promise.resolve(null)
      if (features.timetable) {
        timetablePromise = pool.query(
          `SELECT id, name, config, grids, report, generated_at
           FROM tt2_timetables
           WHERE tenant_id = $1
           ORDER BY updated_at DESC
           LIMIT 1`,
          [tenantId]
        ).catch(() => null)
      }

      // 8. Datesheets (upcoming / today exam items)
      const dsParams = [tenantId]
      const dsBranch = branchId ? (dsParams.push(branchId), ` AND (branch_id = $${dsParams.length} OR branch_id IS NULL)`) : ''
      const datesheetPromise = pool.query(
        `SELECT id, title, scope, class_name, data, published_at
         FROM datesheets
         WHERE tenant_id = $1${dsBranch}
         ORDER BY published_at DESC NULLS LAST, id DESC
         LIMIT 3`,
        dsParams
      ).catch(() => ({ rows: [] }))

      // 9. Complaints & Announcements
      const compParams = [tenantId]
      const compBranch = branchId ? (compParams.push(branchId), ` AND (branch_id = $${compParams.length} OR branch_id IS NULL)`) : ''
      const complaintsPromise = pool.query(
        `SELECT COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count,
                COUNT(*) FILTER (WHERE status = 'pending' AND role = 'teacher')::int AS teacher_pending,
                COUNT(*) FILTER (WHERE status = 'pending' AND role = 'student')::int AS student_pending
         FROM complaints
         WHERE tenant_id = $1${compBranch}`,
        compParams
      ).catch(() => ({ rows: [{ pending_count: 0, teacher_pending: 0, student_pending: 0 }] }))

      const announcementsPromise = pool.query(
        `SELECT id, title, message, author, created_at
         FROM announcements
         WHERE tenant_id = $1
         ORDER BY created_at DESC
         LIMIT 5`,
        [tenantId]
      ).catch(() => ({ rows: [] }))

      const [
        orgRes,
        adminRes,
        stuRes,
        clsRes,
        tchRes,
        attTodayRes,
        attTrendRes,
        unmarkedRes,
        teacherAttRes,
        feeRes,
        ttRes,
        dsRes,
        compRes,
        annRes,
        yearsRes,
      ] = await Promise.all([
        orgPromise,
        adminPromise,
        studentsPromise,
        classesPromise,
        teachersPromise,
        attTodayPromise,
        attTrendPromise,
        unmarkedClassesPromise,
        teacherAttPromise,
        feePromise,
        timetablePromise,
        datesheetPromise,
        complaintsPromise,
        announcementsPromise,
        yearsPromise,
      ])

      const schoolName = orgRes.rows[0]?.school_name || 'Cedar School'
      const adminUser = adminRes.rows[0] || { name: req.user.login_id || 'Administrator', role: req.user.role }

      // Students & classes
      const stu = stuRes.rows[0] || { active_count: 0, frozen_count: 0, new_this_month: 0 }
      const classes = clsRes.rows || []
      const classesWithoutTeacher = classes.filter(c => !c.has_teacher)

      // Teachers
      const teachers = tchRes.rows || []
      const totalTeachers = teachers.length
      const presentTeachers = teacherAttRes && teacherAttRes.rows[0]
        ? teacherAttRes.rows[0].present_teachers
        : null
      const teacherPct = (presentTeachers !== null && totalTeachers > 0)
        ? Math.round((presentTeachers / totalTeachers) * 1000) / 10
        : null

      // Student attendance today
      const attToday = attTodayRes.rows[0] || { present_count: 0, absent_count: 0, late_count: 0, marked_classes: 0 }
      const markedPresent = attToday.present_count + attToday.late_count
      const markedTotal = markedPresent + attToday.absent_count
      const studentAttPct = stu.active_count > 0 && markedTotal > 0
        ? Math.round((markedPresent / stu.active_count) * 1000) / 10
        : null

      const trend = (attTrendRes.rows || []).reverse().map(row => ({
        date: row.date,
        day: row.day_label,
        present: row.present_count,
        absent: row.absent_count,
        total: row.total_count,
        pct: row.total_count > 0 ? Math.round((row.present_count / row.total_count) * 1000) / 10 : 0,
      }))

      // Fee recovery
      let feeSummary = null
      if (features.fees && feeRes) {
        let assigned = 0
        let collected = 0
        let overdue = 0
        const dueStudents = new Set()
        const overdueStudents = new Set()

        for (const r of feeRes.rows) {
          const finalAmt = Number(r.final_amount) || 0
          const paidAmt = Number(r.paid_amount) || 0
          const rem = Math.max(0, finalAmt - paidAmt)
          assigned += finalAmt
          collected += Math.min(finalAmt, paidAmt)
          if (rem > 0) {
            dueStudents.add(r.student_id)
            const payStatus = FM.effectiveStatus(
              {
                status: r.status,
                remaining: rem.toFixed(2),
                paid: paidAmt.toFixed(2),
                due_date: r.due_date ? String(r.due_date).slice(0, 10) : null,
              },
              todayIso
            )
            if (payStatus === 'overdue') {
              overdue += rem
              overdueStudents.add(r.student_id)
            }
          }
        }
        const outstanding = Math.max(0, assigned - collected)
        const collectionPct = assigned > 0 ? Math.round((collected / assigned) * 100) : null
        feeSummary = {
          enabled: true,
          expected: Math.round(assigned * 100) / 100,
          collected: Math.round(collected * 100) / 100,
          outstanding: Math.round(outstanding * 100) / 100,
          overdue: Math.round(overdue * 100) / 100,
          collectionPct,
          studentsWithDues: dueStudents.size,
          overdueAccounts: overdueStudents.size,
          obligationsCount: feeRes.rows.length,
        }
      } else {
        feeSummary = { enabled: false }
      }

      // Timetable & cover gaps
      let timetableCoverIssues = []
      if (features.timetable && ttRes && ttRes.rows[0]) {
        const tt = ttRes.rows[0]
        if (tt.report && Array.isArray(tt.report.unplaced)) {
          timetableCoverIssues = tt.report.unplaced.slice(0, 5).map(u => ({
            label: `${u.className || u.classId || 'Class'} — ${u.subjectName || u.subjectId || 'Subject'}`,
            detail: u.reason || 'Unassigned slot in timetable',
            actionHref: '/tt2/',
          }))
        }
      }

      const coverItems = [
        ...classesWithoutTeacher.slice(0, 5).map(c => ({
          label: `${c.name}${c.section ? ' (' + c.section + ')' : ''}`,
          detail: 'No class teacher assigned',
          actionTab: 'tab-classes',
        })),
        ...timetableCoverIssues,
      ]

      // Campus schedule from datesheets + announcements (real data only)
      const scheduleItems = []
      for (const ds of dsRes.rows || []) {
        const entries = Array.isArray(ds.data?.entries) ? ds.data.entries
          : Array.isArray(ds.data?.schedule) ? ds.data.schedule
          : []
        for (const entry of entries) {
          const entryDate = entry.date ? String(entry.date).slice(0, 10) : null
          if (!entryDate || entryDate >= todayIso) {
            scheduleItems.push({
              time: entry.time || entry.startTime || (entryDate === todayIso ? 'Today' : entryDate || 'Exam'),
              title: `${entry.subject || entry.title || ds.title}${entry.className ? ' — ' + entry.className : ''}`,
              department: ds.scope || 'Exams',
              href: '/datesheet.html',
            })
            if (scheduleItems.length >= 4) break
          }
        }
        if (scheduleItems.length >= 4) break
      }

      for (const ann of annRes.rows || []) {
        if (scheduleItems.length >= 5) break
        const dt = ann.created_at ? new Date(ann.created_at) : null
        scheduleItems.push({
          time: dt ? dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Notice',
          title: ann.title || (ann.message ? ann.message.slice(0, 48) : 'School announcement'),
          department: ann.author || 'Announcement',
          tab: 'tab-announcements',
        })
      }

      // Priority Inbox (real operational issues)
      const priorities = []
      if (feeSummary.enabled && feeSummary.overdueAccounts > 0) {
        priorities.push({
          id: 'overdue-fees',
          count: feeSummary.overdueAccounts,
          title: `${feeSummary.overdueAccounts} Overdue Fee Account${feeSummary.overdueAccounts === 1 ? '' : 's'}`,
          meta: 'Accounts office · Past due date',
          severity: 'critical',
          actionLabel: 'Review balances →',
          targetTab: 'tab-fees',
        })
      }
      if (classesWithoutTeacher.length > 0) {
        priorities.push({
          id: 'unassigned-classes',
          count: classesWithoutTeacher.length,
          title: `${classesWithoutTeacher.length} Class${classesWithoutTeacher.length === 1 ? '' : 'es'} Need Teacher Assignment`,
          meta: 'Academic department · Missing class teacher',
          severity: 'high',
          actionLabel: 'Assign teacher →',
          targetTab: 'tab-classes',
        })
      }
      if (features.attendance && unmarkedRes.rows.length > 0) {
        priorities.push({
          id: 'unmarked-attendance',
          count: unmarkedRes.rows.length,
          title: `${unmarkedRes.rows.length} Class${unmarkedRes.rows.length === 1 ? '' : 'es'} Attendance Pending Today`,
          meta: 'Attendance · Not yet submitted today',
          severity: 'high',
          actionLabel: 'Mark attendance →',
          targetTab: 'tab-attendance',
        })
      }
      if (attToday.absent_count > 0) {
        priorities.push({
          id: 'absent-today',
          count: attToday.absent_count,
          title: `${attToday.absent_count} Student${attToday.absent_count === 1 ? '' : 's'} Absent Today`,
          meta: 'Daily attendance · Today',
          severity: 'medium',
          actionLabel: 'View absentees →',
          targetTab: 'tab-stats',
        })
      }
      const pendingComplaints = compRes.rows[0]?.pending_count || 0
      if (pendingComplaints > 0) {
        priorities.push({
          id: 'pending-complaints',
          count: pendingComplaints,
          title: `${pendingComplaints} Open Complaint${pendingComplaints === 1 ? '' : 's'}`,
          meta: 'Administration · Awaiting review',
          severity: 'medium',
          actionLabel: 'Review complaints →',
          targetTab: 'tab-complaints',
        })
      }
      if (timetableCoverIssues.length > 0) {
        priorities.push({
          id: 'timetable-unplaced',
          count: timetableCoverIssues.length,
          title: `${timetableCoverIssues.length} Unplaced Timetable Slot${timetableCoverIssues.length === 1 ? '' : 's'}`,
          meta: 'Timetable · Needs scheduling',
          severity: 'info',
          actionLabel: 'Open timetable →',
          targetHref: '/tt2/',
        })
      }

      // Operating score: only compute when real metrics exist (no arbitrary fallback)
      const scoreParts = []
      if (studentAttPct !== null) scoreParts.push(studentAttPct)
      if (teacherPct !== null) scoreParts.push(teacherPct)
      if (feeSummary.enabled && feeSummary.collectionPct !== null) scoreParts.push(feeSummary.collectionPct)
      const operatingScore = scoreParts.length > 0
        ? Math.round(scoreParts.reduce((a, b) => a + b, 0) / scoreParts.length)
        : null

      const nowDt = new Date()
      const curStartYr = nowDt.getMonth() >= 7 ? nowDt.getFullYear() : nowDt.getFullYear() - 1
      const currentAcademicYear = `${curStartYr}-${String(curStartYr + 1).slice(-2)}`
      const dbYears = (yearsRes && Array.isArray(yearsRes.rows)) ? yearsRes.rows.map(r => r.ay).filter(Boolean) : []
      const availableYears = Array.from(new Set([currentAcademicYear, ...dbYears]))
      const yearHasData = !yearBounds || trend.length > 0 || (feeSummary && feeSummary.obligationsCount > 0) || (yearBounds.label === currentAcademicYear)

      res.json({
        generatedAt: new Date().toISOString(),
        schoolName,
        adminName: adminUser.name,
        adminRole: adminUser.role,
        branchId,
        selectedYear: yearBounds ? yearBounds.label : currentAcademicYear,
        currentAcademicYear,
        availableYears,
        yearHasData,
        features,
        operatingScore,
        students: {
          active: stu.active_count,
          frozen: stu.frozen_count,
          newThisMonth: stu.new_this_month,
          classCount: classes.length,
        },
        staff: {
          totalTeachers,
          presentTeachers,
          absentTeachers: presentTeachers !== null ? Math.max(0, totalTeachers - presentTeachers) : null,
          availabilityPct: teacherPct,
          qrAttendanceEnabled: !!features.qr_attendance,
          unassignedClasses: classesWithoutTeacher.length,
          coverItems,
        },
        attendance: {
          enabled: !!features.attendance,
          presentToday: markedPresent,
          absentToday: attToday.absent_count,
          markedTotal,
          pctToday: studentAttPct,
          unmarkedClasses: unmarkedRes.rows.length,
          trend,
        },
        fees: feeSummary,
        admissions: {
          supported: false,
          recentCount: stu.new_this_month,
          note: 'Direct enrollment active (no separate pending-application queue)',
        },
        complaints: compRes.rows[0] || { pending_count: 0, teacher_pending: 0, student_pending: 0 },
        priorities,
        schedule: scheduleItems,
      })
    } catch (err) {
      console.error('Dashboard overview error:', err)
      res.status(500).json({ error: 'Could not load dashboard overview.' })
    }
  })

  /**
   * GET /api/dashboard/search?q=...
   * Tenant- and branch-isolated global search across students, teachers, classes, and fee receipts.
   */
  router.get('/search', auth, async (req, res) => {
    try {
      const tenantId = req.user.tenant_id
      const branchId = resolveBranchId(req)
      const q = String(req.query.q || '').trim()
      if (q.length < 2) return res.json({ results: [] })

      const like = `%${q}%`
      const features = await loadFeatureMap(tenantId)

      const stuParams = [tenantId, like]
      const stuBranch = branchId ? (stuParams.push(branchId), ` AND s.branch_id = $${stuParams.length}`) : ''
      const stuQ = features.student_management
        ? pool.query(
            `SELECT s.id, s.name, s.roll_no, c.name AS class_name
             FROM students s
             LEFT JOIN classes c ON c.id = s.class_id
             WHERE s.tenant_id = $1 AND (s.name ILIKE $2 OR COALESCE(s.roll_no,'') ILIKE $2 OR COALESCE(s.login_id,'') ILIKE $2)${stuBranch}
             ORDER BY s.name LIMIT 5`,
            stuParams
          )
        : Promise.resolve({ rows: [] })

      const tchParams = [tenantId, like]
      const tchBranch = branchId ? (tchParams.push(branchId), ` AND t.branch_id = $${tchParams.length}`) : ''
      const tchQ = features.teacher_management
        ? pool.query(
            `SELECT t.id, t.name, t.phone
             FROM teachers t
             WHERE t.tenant_id = $1 AND (t.name ILIKE $2 OR COALESCE(t.phone,'') ILIKE $2)${tchBranch}
             ORDER BY t.name LIMIT 5`,
            tchParams
          )
        : Promise.resolve({ rows: [] })

      const clsParams = [tenantId, like]
      const clsBranch = branchId ? (clsParams.push(branchId), ` AND branch_id = $${clsParams.length}`) : ''
      const clsQ = pool.query(
        `SELECT id, name, section
         FROM classes
         WHERE tenant_id = $1 AND (name ILIKE $2 OR COALESCE(section,'') ILIKE $2)${clsBranch}
         ORDER BY name LIMIT 4`,
        clsParams
      )

      const feeQ = features.fees
        ? pool.query(
            `SELECT DISTINCT p.receipt_no, s.name AS student_name, p.payment_date::text AS payment_date
             FROM student_fee_payments p
             JOIN students s ON s.id = p.student_id AND s.tenant_id = $1
             WHERE p.tenant_id = $1 AND p.receipt_no ILIKE $2${branchId ? ' AND s.branch_id = $3' : ''}
             ORDER BY p.payment_date DESC LIMIT 4`,
            branchId ? [tenantId, like, branchId] : [tenantId, like]
          ).catch(() => ({ rows: [] }))
        : Promise.resolve({ rows: [] })

      const [stuR, tchR, clsR, feeR] = await Promise.all([stuQ, tchQ, clsQ, feeQ])

      const results = [
        ...stuR.rows.map(r => ({
          type: 'Student',
          title: r.name,
          subtitle: [r.class_name, r.roll_no ? `Roll #${r.roll_no}` : null].filter(Boolean).join(' · ') || 'Student',
          targetTab: 'tab-students',
          searchValue: r.name,
        })),
        ...tchR.rows.map(r => ({
          type: 'Teacher',
          title: r.name,
          subtitle: r.phone || 'Teaching Staff',
          targetTab: 'tab-teachers',
          searchValue: r.name,
        })),
        ...clsR.rows.map(r => ({
          type: 'Class',
          title: r.section ? `${r.name} (${r.section})` : r.name,
          subtitle: 'Academic Class',
          targetTab: 'tab-classes',
          searchValue: r.name,
        })),
        ...feeR.rows.map(r => ({
          type: 'Receipt',
          title: r.receipt_no,
          subtitle: `${r.student_name} · ${r.payment_date}`,
          targetTab: 'tab-fees',
          searchValue: r.receipt_no,
        })),
      ]

      res.json({ results })
    } catch (err) {
      console.error('Dashboard search error:', err)
      res.status(500).json({ error: 'Search failed.' })
    }
  })

  return router
}

module.exports = { createDashboardRouter }
