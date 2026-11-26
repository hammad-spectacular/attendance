(function () {
  'use strict';

  let lastOverviewData = null;
  let showAllPriorities = false;
  let searchTimer = null;

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatPKR(num) {
    const n = Number(num) || 0;
    if (n >= 1000000) return 'PKR ' + (n / 1000000).toFixed(2) + 'M';
    return 'PKR ' + Math.round(n).toLocaleString('en-PK');
  }

  function greetingForHour(h) {
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }

  function initials(name) {
    const parts = String(name || 'Admin').trim().split(/\s+/);
    return parts.slice(0, 2).map(p => p[0] ? p[0].toUpperCase() : '').join('') || 'AD';
  }

  function buildRingSvg(pct, color) {
    const r = 32;
    const c = 2 * Math.PI * r;
    const clamped = pct == null ? 0 : Math.max(0, Math.min(100, Number(pct)));
    const dash = (clamped / 100) * c;
    return `
      <svg viewBox="0 0 78 78" aria-hidden="true">
        <circle cx="39" cy="39" r="${r}" fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="6.5"></circle>
        <circle cx="39" cy="39" r="${r}" fill="none" stroke="${color}" stroke-width="6.5"
          stroke-linecap="round" stroke-dasharray="${dash.toFixed(1)} ${c.toFixed(1)}"></circle>
      </svg>`;
  }

  function buildDonutSvg(pct) {
    const r = 42;
    const c = 2 * Math.PI * r;
    const clamped = pct == null ? 0 : Math.max(0, Math.min(100, Number(pct)));
    const dash = (clamped / 100) * c;
    return `
      <svg viewBox="0 0 108 108" width="108" height="108" style="transform:rotate(-90deg)" aria-hidden="true">
        <circle cx="54" cy="54" r="${r}" fill="none" stroke="var(--eye-border)" stroke-width="11"></circle>
        <circle cx="54" cy="54" r="${r}" fill="none" stroke="#17675F" stroke-width="11"
          stroke-linecap="round" stroke-dasharray="${dash.toFixed(1)} ${c.toFixed(1)}"></circle>
      </svg>`;
  }

  function navigateToTarget(tab, href, searchValue) {
    if (tab && typeof window.switchTab === 'function') {
      window.switchTab(tab, false);
      if (searchValue) {
        setTimeout(() => {
          const inputId = tab === 'tab-students' ? 'studentSearch'
            : tab === 'tab-teachers' ? 'teacherSearch'
            : null;
          if (inputId) {
            const el = document.getElementById(inputId);
            if (el) {
              el.value = searchValue;
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }
        }, 80);
      }
      return;
    }
    if (href) {
      window.location.href = href;
    }
  }

  function renderHeaderMeta(data) {
    const now = new Date();
    const greetEl = document.getElementById('ovGreeting');
    if (greetEl) {
      greetEl.textContent = `${greetingForHour(now.getHours())}, ${data.adminName || 'Administrator'}`;
    }

    const dateEl = document.getElementById('ovDateline');
    if (dateEl) {
      const dStr = now.toLocaleDateString('en-US', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      });
      const tStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      dateEl.textContent = `${dStr} · Updated ${tStr}`;
    }

    const schoolEl = document.getElementById('sidebarSchoolName');
    if (schoolEl && data.schoolName) schoolEl.textContent = data.schoolName;

    const logoEl = document.getElementById('sidebarBrandLogo');
    if (logoEl && data.schoolName) logoEl.textContent = initials(data.schoolName);

    const avatarEl = document.getElementById('topbarAvatar');
    if (avatarEl) avatarEl.textContent = initials(data.adminName);

    const nameEl = document.getElementById('topbarAdminName');
    if (nameEl) nameEl.textContent = data.adminName || 'Administrator';

    const roleEl = document.getElementById('topbarAdminRole');
    if (roleEl) roleEl.textContent = data.adminRole === 'super_admin' ? 'Super Administrator' : 'School Administrator';

    const crumbEl = document.getElementById('ovBreadcrumb');
    if (crumbEl) {
      const sel = document.getElementById('branchSelector');
      const branchLabel = sel && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].text : 'All Branches';
      crumbEl.textContent = `ADMINISTRATION / ${branchLabel.toUpperCase()}`;
    }

    const footerCampus = document.getElementById('sidebarCampusLabel');
    if (footerCampus) {
      const sel = document.getElementById('branchSelector');
      footerCampus.textContent = sel && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].text : 'All Campuses';
    }

    const dot = document.getElementById('notifBadgeDot');
    if (dot) {
      const count = (data.priorities || []).length;
      if (count > 0) {
        dot.textContent = count > 9 ? '9+' : String(count);
        dot.style.display = 'inline-flex';
      } else {
        dot.style.display = 'none';
      }
    }
  }

  function renderHealthPanel(data) {
    const el = document.getElementById('ovHealthPanel');
    if (!el) return;

    const priCount = (data.priorities || []).length;
    const scoreHtml = data.operatingScore !== null
      ? `<div class="ov-score-pill"><strong>${data.operatingScore}</strong><span>/ 100 Operating Score</span></div>`
      : `<div class="ov-score-pill"><strong>Live</strong><span>Operational Monitor</span></div>`;

    const priPill = priCount > 0
      ? `<div class="ov-priority-pill"><i class="fas fa-circle-exclamation"></i> ${priCount} priorit${priCount === 1 ? 'y needs' : 'ies need'} attention</div>`
      : `<div class="ov-priority-pill healthy"><i class="fas fa-circle-check"></i> All tracked systems healthy</div>`;

    const attPct = data.attendance.pctToday;
    const attSub = data.attendance.markedTotal > 0
      ? `${data.attendance.presentToday.toLocaleString()} of ${data.students.active.toLocaleString()} present`
      : 'No attendance marked today';

    const tchPct = data.staff.availabilityPct;
    const tchSub = data.staff.qrAttendanceEnabled
      ? (data.staff.presentTeachers !== null ? `${data.staff.presentTeachers} of ${data.staff.totalTeachers} present` : 'No check-ins today')
      : 'QR attendance disabled';

    const feePct = data.fees.enabled ? data.fees.collectionPct : null;
    const feeSub = data.fees.enabled
      ? (data.fees.expected > 0 ? `${formatPKR(data.fees.collected)} of ${formatPKR(data.fees.expected)}` : 'No active fee obligations')
      : 'Fees module disabled';

    const priRingPct = Math.min(100, priCount * 15);
    const priRingSub = priCount > 0 ? `${priCount} open alert${priCount === 1 ? '' : 's'}` : 'No pending alerts';

    el.innerHTML = `
      <div>
        <div class="ov-health-title">School health today</div>
        <div class="ov-health-desc">
          ${priCount > 0
            ? `Core operations are running. ${priCount} operational item${priCount === 1 ? '' : 's'} require administrative review.`
            : 'Core attendance, staffing, and fee operations are currently in good standing.'}
        </div>
        <div class="ov-health-badges">
          ${scoreHtml}
          ${priPill}
        </div>
        <button type="button" class="ov-health-link" onclick="document.getElementById('ovPriorityCard')?.scrollIntoView({behavior:'smooth'})">
          Open priority inbox &rarr;
        </button>
      </div>
      <div class="ov-rings-grid">
        <div class="ov-ring-item" data-nav-tab="tab-attendance">
          <div class="ov-ring-svg">
            ${buildRingSvg(attPct, '#5CB890')}
            <div class="ov-ring-val">${attPct !== null ? attPct + '%' : '—'}</div>
          </div>
          <div class="ov-ring-label">Student Attendance</div>
          <div class="ov-ring-sub">${esc(attSub)}</div>
        </div>
        <div class="ov-ring-item" data-nav-tab="tab-qr-attendance">
          <div class="ov-ring-svg">
            ${buildRingSvg(tchPct, '#E5A94B')}
            <div class="ov-ring-val">${tchPct !== null ? tchPct + '%' : 'N/A'}</div>
          </div>
          <div class="ov-ring-label">Teacher Availability</div>
          <div class="ov-ring-sub">${esc(tchSub)}</div>
        </div>
        <div class="ov-ring-item" data-nav-tab="tab-fees">
          <div class="ov-ring-svg">
            ${buildRingSvg(feePct, '#668ED0')}
            <div class="ov-ring-val">${feePct !== null ? feePct + '%' : '—'}</div>
          </div>
          <div class="ov-ring-label">Fee Collection</div>
          <div class="ov-ring-sub">${esc(feeSub)}</div>
        </div>
        <div class="ov-ring-item" onclick="document.getElementById('ovPriorityCard')?.scrollIntoView({behavior:'smooth'})">
          <div class="ov-ring-svg">
            ${buildRingSvg(priRingPct, '#D96E63')}
            <div class="ov-ring-val">${priCount}</div>
          </div>
          <div class="ov-ring-label">Priority Work</div>
          <div class="ov-ring-sub">${esc(priRingSub)}</div>
        </div>
      </div>`;
  }

  function renderKpis(data) {
    const el = document.getElementById('ovKpiGrid');
    if (!el) return;

    const feeCard = data.fees.enabled
      ? `
        <button type="button" class="ov-kpi-card" data-nav-tab="tab-fees">
          <div class="ov-kpi-top">
            <span class="ov-kpi-title">Outstanding fees</span>
            <span class="ov-live-badge">LIVE</span>
          </div>
          <div class="ov-kpi-value">${esc(formatPKR(data.fees.outstanding))}</div>
          <div class="ov-kpi-sub">${data.fees.overdueAccounts} overdue account${data.fees.overdueAccounts === 1 ? '' : 's'} · ${data.fees.studentsWithDues} with dues</div>
        </button>`
      : `
        <button type="button" class="ov-kpi-card" data-nav-tab="tab-classes">
          <div class="ov-kpi-top">
            <span class="ov-kpi-title">Classes &amp; sections</span>
            <span class="ov-live-badge">LIVE</span>
          </div>
          <div class="ov-kpi-value">${data.students.classCount}</div>
          <div class="ov-kpi-sub">${data.staff.unassignedClasses} needing teacher assignment</div>
        </button>`;

    const staffSub = data.staff.qrAttendanceEnabled && data.staff.presentTeachers !== null
      ? `${data.staff.presentTeachers} present · ${data.staff.unassignedClasses} unassigned class${data.staff.unassignedClasses === 1 ? '' : 'es'}`
      : `${data.staff.unassignedClasses} class${data.staff.unassignedClasses === 1 ? '' : 'es'} without assigned teacher`;

    el.innerHTML = `
      <button type="button" class="ov-kpi-card" data-nav-tab="tab-students">
        <div class="ov-kpi-top">
          <span class="ov-kpi-title">Students</span>
          <span class="ov-live-badge">LIVE</span>
        </div>
        <div class="ov-kpi-value">${data.students.active.toLocaleString()}</div>
        <div class="ov-kpi-sub">${data.students.classCount} classes · ${data.students.newThisMonth} new this month</div>
      </button>
      <button type="button" class="ov-kpi-card" data-nav-tab="tab-teachers">
        <div class="ov-kpi-top">
          <span class="ov-kpi-title">Teaching staff</span>
          <span class="ov-live-badge">LIVE</span>
        </div>
        <div class="ov-kpi-value">${data.staff.totalTeachers}</div>
        <div class="ov-kpi-sub">${esc(staffSub)}</div>
      </button>
      ${feeCard}
      <button type="button" class="ov-kpi-card" data-nav-tab="tab-students">
        <div class="ov-kpi-top">
          <span class="ov-kpi-title">Recent admissions</span>
          <span class="ov-live-badge">30D</span>
        </div>
        <div class="ov-kpi-value">${data.admissions.recentCount}</div>
        <div class="ov-kpi-sub">Enrolled this month · ${data.students.frozen} inactive</div>
      </button>`;
  }

  function renderPriorityInbox(data) {
    const el = document.getElementById('ovPriorityCard');
    if (!el) return;
    const all = data.priorities || [];
    const shown = showAllPriorities ? all : all.slice(0, 6);

    const listHtml = shown.length > 0
      ? shown.map(item => `
          <div class="ov-inbox-item">
            <div class="ov-inbox-left">
              <div class="ov-count-badge ${esc(item.severity)}">${item.count}</div>
              <div>
                <div class="ov-inbox-title">${esc(item.title)}</div>
                <div class="ov-inbox-meta">${esc(item.meta)}</div>
              </div>
            </div>
            <button type="button" class="ov-inbox-btn"
              ${item.targetTab ? `data-nav-tab="${esc(item.targetTab)}"` : ''}
              ${item.targetHref ? `data-nav-href="${esc(item.targetHref)}"` : ''}>
              ${esc(item.actionLabel)}
            </button>
          </div>`).join('')
      : `<div class="ov-empty"><i class="fas fa-circle-check" style="color:var(--eye-teal-mid);margin-right:6px;"></i>No urgent issues require action right now.</div>`;

    el.innerHTML = `
      <div class="ov-card-head">
        <div>
          <div class="ov-card-title">Priority inbox</div>
          <div class="ov-card-sub">${all.length} item${all.length === 1 ? '' : 's'} across school operations</div>
        </div>
        ${all.length > 6 ? `<button type="button" class="ov-card-action" id="ovTogglePrioritiesBtn">${showAllPriorities ? 'Show less' : 'View all →'}</button>` : ''}
      </div>
      <div class="ov-inbox-list">${listHtml}</div>`;

    const toggleBtn = document.getElementById('ovTogglePrioritiesBtn');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        showAllPriorities = !showAllPriorities;
        renderPriorityInbox(data);
      });
    }
  }

  function renderFeeRecovery(data) {
    const el = document.getElementById('ovFeeRecoveryCard');
    if (!el) return;

    if (!data.fees.enabled) {
      el.innerHTML = `
        <div class="ov-card-head">
          <div>
            <div class="ov-card-title">Fee recovery</div>
            <div class="ov-card-sub">Student fee ledger</div>
          </div>
        </div>
        <div class="ov-empty">Fees module is currently disabled for this tenant.</div>`;
      return;
    }

    const f = data.fees;
    const pct = f.collectionPct !== null ? f.collectionPct : 0;
    const monthLabel = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    el.innerHTML = `
      <div class="ov-card-head">
        <div>
          <div class="ov-card-title">Fee recovery</div>
          <div class="ov-card-sub">${esc(monthLabel)}</div>
        </div>
        <button type="button" class="ov-card-action" data-nav-tab="tab-fees">View ledger &rarr;</button>
      </div>
      <div class="ov-fee-body">
        <div class="ov-donut-wrap">
          ${buildDonutSvg(pct)}
          <div class="ov-donut-center">
            <strong>${f.collectionPct !== null ? pct + '%' : '—'}</strong>
            <span>collected</span>
          </div>
        </div>
        <div class="ov-fee-legend">
          <div>
            <div class="ov-fee-stat-label"><span class="ov-dot" style="background:#17675F"></span> Collected</div>
            <div class="ov-fee-stat-val">${esc(formatPKR(f.collected))}</div>
          </div>
          <div>
            <div class="ov-fee-stat-label"><span class="ov-dot" style="background:#E5A94B"></span> Outstanding</div>
            <div class="ov-fee-stat-val">${esc(formatPKR(f.outstanding))}</div>
          </div>
        </div>
      </div>
      <div class="ov-overdue-banner">
        <div>
          <strong>${esc(formatPKR(f.overdue))} past due</strong>
          <span>${f.overdueAccounts} account${f.overdueAccounts === 1 ? '' : 's'} overdue</span>
        </div>
        <button type="button" class="ov-card-action" data-nav-tab="tab-fees">Review &rarr;</button>
      </div>`;
  }

  function renderQuickActions(data) {
    const el = document.getElementById('ovQuickActionsCard');
    if (!el) return;
    const f = data.features || {};

    const actions = [];
    if (f.student_management !== false) {
      actions.push({ label: 'Add student', icon: 'fa-plus', tab: 'tab-students' });
    }
    if (f.fees) {
      actions.push({ label: 'Receive fee', icon: 'fa-receipt', href: '/voucher-generator.html#collect' });
    }
    if (f.attendance !== false) {
      actions.push({ label: 'Mark attendance', icon: 'fa-clipboard-check', tab: 'tab-attendance' });
    }
    if (f.teacher_management !== false) {
      actions.push({ label: 'Add staff', icon: 'fa-user-plus', tab: 'tab-teachers' });
    }
    if (f.fees) {
      actions.push({ label: 'Generate fee voucher', icon: 'fa-file-invoice-dollar', href: '/voucher-generator.html#generate' });
    }

    el.innerHTML = `
      <div class="ov-card-head">
        <div>
          <div class="ov-card-title">Quick actions</div>
          <div class="ov-card-sub">Common office tasks</div>
        </div>
      </div>
      <div class="ov-actions-list">
        ${actions.map(a => `
          <button type="button" class="ov-action-btn"
            ${a.tab ? `data-nav-tab="${esc(a.tab)}"` : ''}
            ${a.href ? `data-nav-href="${esc(a.href)}"` : ''}>
            <i class="fas ${esc(a.icon)}" style="color:var(--eye-teal-mid)"></i>
            <span>${esc(a.label)}</span>
          </button>`).join('')}
        <button type="button" class="ov-action-primary" data-nav-tab="tab-classes">
          <span>View all services</span>
          <i class="fas fa-arrow-right"></i>
        </button>
      </div>`;
  }

  function renderSchedule(data) {
    const el = document.getElementById('ovScheduleCard');
    if (!el) return;
    const items = data.schedule || [];

    const bodyHtml = items.length > 0
      ? `<div class="ov-schedule-list">
          ${items.map(s => `
            <div class="ov-schedule-row" style="cursor:pointer"
              ${s.tab ? `data-nav-tab="${esc(s.tab)}"` : ''}
              ${s.href ? `data-nav-href="${esc(s.href)}"` : ''}>
              <div class="ov-schedule-time">${esc(s.time)}</div>
              <div class="ov-schedule-title">${esc(s.title)}</div>
              <div class="ov-schedule-dept">${esc(s.department)}</div>
            </div>`).join('')}
         </div>`
      : `<div class="ov-empty">No scheduled exams or announcements posted yet.</div>`;

    el.innerHTML = `
      <div class="ov-card-head">
        <div>
          <div class="ov-card-title">Campus schedule</div>
          <div class="ov-card-sub">Exams &amp; school notices</div>
        </div>
        <button type="button" class="ov-card-action" data-nav-href="/datesheet.html">Datesheet &rarr;</button>
      </div>
      ${bodyHtml}`;
  }

  function renderAttendanceTrend(data) {
    const el = document.getElementById('ovTrendCard');
    if (!el) return;
    const trend = data.attendance.trend || [];

    if (trend.length === 0) {
      el.innerHTML = `
        <div class="ov-card-head">
          <div>
            <div class="ov-card-title">Attendance trend</div>
            <div class="ov-card-sub">Last five school days</div>
          </div>
          <button type="button" class="ov-card-action" data-nav-tab="tab-stats">Attendance report &rarr;</button>
        </div>
        <div class="ov-empty">No attendance records available yet.</div>`;
      return;
    }

    const barsHtml = trend.map((d, idx) => {
      const isLast = idx === trend.length - 1;
      const heightPct = Math.max(12, Math.min(100, d.pct));
      return `
        <div class="ov-bar-col ${isLast ? 'today' : ''}" title="${esc(d.date)}: ${d.present}/${d.total} present (${d.pct}%)">
          <div class="ov-bar-pct">${d.pct}%</div>
          <div class="ov-bar-fill" style="height:${heightPct}%"></div>
          <div class="ov-bar-day">${esc(d.day)}</div>
        </div>`;
    }).join('');

    const footerMsg = data.attendance.absentToday > 0
      ? `${data.attendance.absentToday} student${data.attendance.absentToday === 1 ? '' : 's'} absent today`
      : 'No absences recorded today';

    el.innerHTML = `
      <div class="ov-card-head">
        <div>
          <div class="ov-card-title">Attendance trend</div>
          <div class="ov-card-sub">Last ${trend.length} recorded day${trend.length === 1 ? '' : 's'}</div>
        </div>
        <button type="button" class="ov-card-action" data-nav-tab="tab-stats">Attendance report &rarr;</button>
      </div>
      <div class="ov-trend-bars">${barsHtml}</div>
      <div class="ov-trend-footer" style="${data.attendance.absentToday > 0 ? '' : 'color:var(--eye-teal-mid)'}">${esc(footerMsg)}</div>`;
  }

  function renderTeacherCoverage(data) {
    const el = document.getElementById('ovCoverageCard');
    if (!el) return;
    const s = data.staff;
    const items = s.coverItems || [];

    const headSub = s.qrAttendanceEnabled && s.presentTeachers !== null
      ? `${s.presentTeachers} / ${s.totalTeachers} present`
      : `${s.totalTeachers} teaching staff`;

    const banner = items.length > 0
      ? `<div class="ov-cover-banner">
           <strong>${items.length} item${items.length === 1 ? '' : 's'} need cover / assignment</strong>
           <span>Review class &amp; timetable coverage</span>
         </div>`
      : `<div class="ov-cover-banner">
           <strong>All classes covered</strong>
           <span>Every active class has an assigned teacher</span>
         </div>`;

    const listHtml = items.slice(0, 3).map(c => `
      <div class="ov-schedule-row" style="grid-template-columns:1fr auto;">
        <div>
          <div class="ov-schedule-title">${esc(c.label)}</div>
          <div class="ov-schedule-dept">${esc(c.detail)}</div>
        </div>
        <button type="button" class="ov-inbox-btn"
          ${c.actionTab ? `data-nav-tab="${esc(c.actionTab)}"` : ''}
          ${c.actionHref ? `data-nav-href="${esc(c.actionHref)}"` : ''}>
          Assign &rarr;
        </button>
      </div>`).join('');

    el.innerHTML = `
      <div class="ov-card-head">
        <div>
          <div class="ov-card-title">Teacher coverage</div>
          <div class="ov-card-sub">${esc(headSub)}</div>
        </div>
        <button type="button" class="ov-card-action" data-nav-tab="tab-classes">Manage cover &rarr;</button>
      </div>
      ${banner}
      ${listHtml}`;
  }

  function bindOverviewNavClicks() {
    const root = document.getElementById('tab-overview');
    if (!root || root.dataset.navBound) return;
    root.dataset.navBound = '1';
    root.addEventListener('click', (e) => {
      const target = e.target.closest('[data-nav-tab], [data-nav-href]');
      if (!target) return;
      const tab = target.getAttribute('data-nav-tab');
      const href = target.getAttribute('data-nav-href');
      navigateToTarget(tab, href);
    });
  }

  async function loadOverviewDashboard() {
    const overviewTab = document.getElementById('tab-overview');
    if (!overviewTab) return;

    const branchId = window.appData?.selectedBranchId || 'all';
    const yearEl = document.getElementById('academicYearSelect');
    const year = yearEl ? yearEl.value : 'all';

    try {
      const qs = new URLSearchParams({ branch_id: String(branchId), year: String(year) });
      const res = await window.apiFetch(`/api/dashboard/overview?${qs.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      lastOverviewData = data;

      renderHeaderMeta(data);
      renderHealthPanel(data);
      renderKpis(data);
      renderPriorityInbox(data);
      renderFeeRecovery(data);
      renderQuickActions(data);
      renderSchedule(data);
      renderAttendanceTrend(data);
      renderTeacherCoverage(data);
      bindOverviewNavClicks();
    } catch (err) {
      console.error('Overview load error:', err);
      const hp = document.getElementById('ovHealthPanel');
      if (hp) {
        hp.innerHTML = `
          <div>
            <div class="ov-health-title">Could not load live school overview</div>
            <div class="ov-health-desc">${esc(err.message || 'Network or server error')}</div>
            <button type="button" class="ov-health-link" onclick="window.loadOverviewDashboard()">Retry &rarr;</button>
          </div>`;
      }
    }
  }

  function setupGlobalSearch() {
    const input = document.getElementById('globalSearchInput');
    const panel = document.getElementById('globalSearchResults');
    if (!input || !panel) return;

    input.addEventListener('input', () => {
      const q = input.value.trim();
      clearTimeout(searchTimer);
      if (q.length < 2) {
        panel.classList.remove('open');
        panel.innerHTML = '';
        return;
      }
      searchTimer = setTimeout(async () => {
        try {
          const branchId = window.appData?.selectedBranchId || 'all';
          const res = await window.apiFetch(`/api/dashboard/search?q=${encodeURIComponent(q)}&branch_id=${encodeURIComponent(branchId)}`);
          if (!res.ok) return;
          const data = await res.json();
          const items = data.results || [];
          if (items.length === 0) {
            panel.innerHTML = `<div class="ov-empty" style="padding:10px">No matching records found.</div>`;
          } else {
            panel.innerHTML = items.map(r => `
              <button type="button" class="eye-search-item" data-tab="${esc(r.targetTab)}" data-search="${esc(r.searchValue)}">
                <div>
                  <div style="font-weight:700;font-size:0.82rem">${esc(r.title)}</div>
                  <div style="font-size:0.72rem;color:var(--eye-muted)">${esc(r.subtitle)}</div>
                </div>
                <span class="ov-live-badge">${esc(r.type)}</span>
              </button>`).join('');
          }
          panel.classList.add('open');
        } catch (e) {
          console.error('Global search error:', e);
        }
      }, 240);
    });

    panel.addEventListener('click', (e) => {
      const btn = e.target.closest('.eye-search-item');
      if (!btn) return;
      panel.classList.remove('open');
      navigateToTarget(btn.dataset.tab, null, btn.dataset.search);
    });

    document.addEventListener('click', (e) => {
      if (!input.contains(e.target) && !panel.contains(e.target)) {
        panel.classList.remove('open');
      }
    });
  }

  function setupSidebarShell() {
    const shell = document.getElementById('eyeShell');
    const collapseBtn = document.getElementById('sidebarCollapseBtn');
    const mobileBtn = document.getElementById('eyeMobileMenuBtn');
    if (collapseBtn && shell) {
      if (localStorage.getItem('eye-sidebar-collapsed') === '1') {
        shell.classList.add('sidebar-collapsed');
      }
      collapseBtn.addEventListener('click', () => {
        shell.classList.toggle('sidebar-collapsed');
        localStorage.setItem('eye-sidebar-collapsed', shell.classList.contains('sidebar-collapsed') ? '1' : '0');
      });
    }
    if (mobileBtn && shell) {
      mobileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        shell.classList.toggle('mobile-drawer-open');
      });
      document.addEventListener('click', (e) => {
        const sidebar = document.getElementById('eyeSidebar');
        if (shell.classList.contains('mobile-drawer-open') && sidebar && !sidebar.contains(e.target) && !mobileBtn.contains(e.target)) {
          shell.classList.remove('mobile-drawer-open');
        }
      });
    }

    const yearSel = document.getElementById('academicYearSelect');
    if (yearSel) {
      yearSel.addEventListener('change', () => {
        const lbl = document.getElementById('sidebarYearLabel');
        if (lbl) lbl.textContent = yearSel.value === 'all' ? 'All Years' : yearSel.value;
        loadOverviewDashboard();
      });
    }
  }

  window.loadOverviewDashboard = loadOverviewDashboard;

  document.addEventListener('DOMContentLoaded', () => {
    setupSidebarShell();
    setupGlobalSearch();
    loadOverviewDashboard();
  });
})();
