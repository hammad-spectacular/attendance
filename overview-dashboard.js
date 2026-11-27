(function () {
  'use strict';

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
    return parts.slice(0, 2).map(p => (p[0] ? p[0].toUpperCase() : '')).join('') || 'AD';
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

  function consolidatePriorities(rawPriorities) {
    const list = Array.isArray(rawPriorities) ? rawPriorities : [];
    const seen = new Set();
    const out = [];
    const hasUnassigned = list.some(p => p && p.id === 'unassigned-classes');

    const actionLabels = {
      'unassigned-classes': 'Assign Teacher \u2192',
      'unmarked-attendance': 'Mark Attendance \u2192',
      'overdue-fees': 'Review Balances \u2192',
      'absent-today': 'View Absentees \u2192',
      'pending-complaints': 'Review Complaints \u2192',
    };

    for (const item of list) {
      if (!item || !item.id) continue;
      if (item.id === 'teacher-coverage' || (item.id === 'timetable-unplaced' && hasUnassigned)) {
        continue;
      }
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push({
        ...item,
        actionLabel: actionLabels[item.id] || item.actionLabel || 'Open \u2192',
      });
    }
    return out;
  }

  function renderHeaderMeta(data, consolidatedPriorities) {
    const now = new Date();
    const greetEl = document.getElementById('ovGreeting');
    if (greetEl) {
      greetEl.textContent = `${greetingForHour(now.getHours())}, ${data.adminName || 'Administrator'}`;
    }

    const dateEl = document.getElementById('ovDateline');
    if (dateEl) {
      const dStr = now.toLocaleDateString('en-US', {
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
      });
      const tStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      dateEl.textContent = `${dStr} \u00B7 Updated ${tStr}`;
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
    if (roleEl) roleEl.textContent = data.adminRole === 'super_admin' ? 'Super Administrator' : 'Administrator';

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
      const count = consolidatedPriorities.length;
      if (count > 0) {
        dot.textContent = count > 9 ? '9+' : String(count);
        dot.style.display = 'inline-flex';
      } else {
        dot.style.display = 'none';
      }
    }
  }

  function renderKpis(data, priorities) {
    const el = document.getElementById('ovKpiGrid');
    if (!el) return;

    const attPct = data.attendance.pctToday;
    const attTone = attPct === null ? 'indigo' : (attPct >= 85 ? 'green' : 'amber');
    const attVal = attPct !== null ? `${attPct}%` : '\u2014';
    const attSub = data.attendance.markedTotal > 0
      ? `${data.attendance.presentToday.toLocaleString()} of ${data.students.active.toLocaleString()} present`
      : 'Not marked today';

    let feeTone = 'indigo';
    let feeVal = 'Disabled';
    let feeSub = 'Module disabled';
    let feeTab = 'tab-classes';
    if (data.fees && data.fees.enabled) {
      const fpct = data.fees.collectionPct;
      feeTone = fpct === null ? 'indigo' : (fpct >= 80 ? 'green' : 'amber');
      feeVal = fpct !== null ? `${fpct}%` : formatPKR(data.fees.collected);
      feeSub = `${formatPKR(data.fees.collected)} collected \u00B7 ${formatPKR(data.fees.outstanding)} due`;
      feeTab = 'tab-fees';
    }

    const priCount = priorities.length;
    const priTone = priCount > 0 ? 'red' : 'green';
    const priSub = priCount > 0
      ? `${priCount} item${priCount === 1 ? '' : 's'} need action`
      : 'All clear';

    el.innerHTML = `
      <button type="button" class="ov-kpi-card" data-nav-tab="tab-students">
        <div class="ov-kpi-top">
          <span class="ov-kpi-title">Total Students</span>
          <span class="ov-kpi-icon indigo" aria-hidden="true"><i class="fas fa-user-graduate"></i></span>
        </div>
        <div class="ov-kpi-value">${data.students.active.toLocaleString()}</div>
        <div class="ov-kpi-sub">${data.students.classCount} classes \u00B7 ${data.students.newThisMonth} new this month</div>
      </button>
      <button type="button" class="ov-kpi-card" data-nav-tab="tab-attendance">
        <div class="ov-kpi-top">
          <span class="ov-kpi-title">Today's Attendance</span>
          <span class="ov-kpi-icon ${attTone}" aria-hidden="true"><i class="fas fa-clipboard-check"></i></span>
        </div>
        <div class="ov-kpi-value">${attVal}</div>
        <div class="ov-kpi-sub">${esc(attSub)}</div>
      </button>
      <button type="button" class="ov-kpi-card" data-nav-tab="${feeTab}">
        <div class="ov-kpi-top">
          <span class="ov-kpi-title">Fee Collection</span>
          <span class="ov-kpi-icon ${feeTone}" aria-hidden="true"><i class="fas fa-wallet"></i></span>
        </div>
        <div class="ov-kpi-value">${esc(feeVal)}</div>
        <div class="ov-kpi-sub">${esc(feeSub)}</div>
      </button>
      <button type="button" class="ov-kpi-card" onclick="document.getElementById('ovPriorityCard')?.scrollIntoView({behavior:'smooth'})">
        <div class="ov-kpi-top">
          <span class="ov-kpi-title">Open Priorities</span>
          <span class="ov-kpi-icon ${priTone}" aria-hidden="true"><i class="fas fa-circle-exclamation"></i></span>
        </div>
        <div class="ov-kpi-value">${priCount}</div>
        <div class="ov-kpi-sub">${esc(priSub)}</div>
      </button>`;
  }

  function renderPriorityInbox(priorities) {
    const el = document.getElementById('ovPriorityCard');
    if (!el) return;
    const shown = showAllPriorities ? priorities : priorities.slice(0, 5);

    const listHtml = shown.length > 0
      ? shown.map(item => `
          <div class="ov-inbox-item">
            <div class="ov-inbox-left">
              <div class="ov-count-badge ${esc(item.severity)}">${item.count}</div>
              <div style="min-width:0;">
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
      : `<div class="ov-empty"><i class="fas fa-circle-check" style="color:var(--eye-green);margin-right:6px;"></i>All clear — no pending issues.</div>`;

    el.innerHTML = `
      <div class="ov-card-head">
        <div>
          <div class="ov-card-title">Priority Inbox</div>
        </div>
        ${priorities.length > 5 ? `<button type="button" class="ov-card-action" id="ovTogglePrioritiesBtn">${showAllPriorities ? 'Show less' : 'View all \u2192'}</button>` : ''}
      </div>
      <div class="ov-inbox-list">${listHtml}</div>`;

    const toggleBtn = document.getElementById('ovTogglePrioritiesBtn');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        showAllPriorities = !showAllPriorities;
        renderPriorityInbox(priorities);
      });
    }
  }

  function renderQuickActions(data) {
    const el = document.getElementById('ovQuickActionsCard');
    if (!el) return;
    const f = data.features || {};

    const actions = [];
    if (f.student_management !== false) {
      actions.push({ label: 'Add Student', icon: 'fa-plus', tab: 'tab-students' });
    }
    if (f.fees) {
      actions.push({ label: 'Receive Fee', icon: 'fa-receipt', href: '/voucher-generator.html#collect' });
    }
    if (f.attendance !== false) {
      actions.push({ label: 'Mark Attendance', icon: 'fa-clipboard-check', tab: 'tab-attendance' });
    }
    if (f.fees) {
      actions.push({ label: 'Fee Voucher', icon: 'fa-file-invoice-dollar', href: '/voucher-generator.html#generate' });
    }

    el.innerHTML = `
      <div class="ov-card-head">
        <div>
          <div class="ov-card-title">Quick Actions</div>
        </div>
      </div>
      <div class="ov-actions-grid">
        ${actions.map(a => `
          <button type="button" class="ov-action-btn"
            ${a.tab ? `data-nav-tab="${esc(a.tab)}"` : ''}
            ${a.href ? `data-nav-href="${esc(a.href)}"` : ''}>
            <i class="fas ${esc(a.icon)}"></i>
            <span>${esc(a.label)}</span>
          </button>`).join('')}
        <button type="button" class="ov-action-primary" data-nav-tab="tab-classes">
          <span>Manage Classes &amp; Services</span>
          <i class="fas fa-arrow-right"></i>
        </button>
      </div>`;
  }

  function renderAttendanceTrend(data) {
    const el = document.getElementById('ovTrendCard');
    if (!el) return;
    const trend = data.attendance.trend || [];

    if (trend.length === 0) {
      el.innerHTML = `
        <div class="ov-card-head">
          <div>
            <div class="ov-card-title">Attendance Trend</div>
          </div>
          <button type="button" class="ov-card-action" data-nav-tab="tab-stats">Report &rarr;</button>
        </div>
        <div class="ov-empty">No attendance records yet.</div>`;
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

    const hasAbsences = data.attendance.absentToday > 0;
    const footerMsg = hasAbsences
      ? `${data.attendance.absentToday} absent today`
      : 'No absences today';

    el.innerHTML = `
      <div class="ov-card-head">
        <div>
          <div class="ov-card-title">Attendance Trend</div>
          <div class="ov-card-sub">Last ${trend.length} school day${trend.length === 1 ? '' : 's'}</div>
        </div>
        <button type="button" class="ov-card-action" data-nav-tab="tab-stats">Report &rarr;</button>
      </div>
      <div class="ov-trend-bars">${barsHtml}</div>
      <div class="ov-trend-footer ${hasAbsences ? 'warn' : 'ok'}">
        <i class="fas ${hasAbsences ? 'fa-circle-exclamation' : 'fa-circle-check'}"></i>
        <span>${esc(footerMsg)}</span>
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
      : `<div class="ov-empty">No upcoming exams or announcements.</div>`;

    el.innerHTML = `
      <div class="ov-card-head">
        <div>
          <div class="ov-card-title">Campus Schedule</div>
          <div class="ov-card-sub">Exams &amp; notices</div>
        </div>
        <button type="button" class="ov-card-action" data-nav-href="/datesheet.html">Datesheet &rarr;</button>
      </div>
      ${bodyHtml}`;
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

    const errBanner = document.getElementById('ovErrorBanner');
    if (errBanner) errBanner.style.display = 'none';

    const branchId = window.appData?.selectedBranchId || 'all';
    const yearEl = document.getElementById('academicYearSelect');
    const year = yearEl ? yearEl.value : 'all';

    try {
      const qs = new URLSearchParams({ branch_id: String(branchId), year: String(year) });
      const res = await window.apiFetch(`/api/dashboard/overview?${qs.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const priorities = consolidatePriorities(data.priorities);

      renderHeaderMeta(data, priorities);
      renderKpis(data, priorities);
      renderPriorityInbox(priorities);
      renderQuickActions(data);
      renderAttendanceTrend(data);
      renderSchedule(data);
      bindOverviewNavClicks();
    } catch (err) {
      console.error('Overview load error:', err);
      if (errBanner) {
        errBanner.style.display = 'flex';
        errBanner.innerHTML = `
          <div>
            <div class="ov-error-title">Could not load live school overview</div>
            <div class="ov-error-desc">${esc(err.message || 'Network or server error')}</div>
          </div>
          <button type="button" class="ov-retry-btn" onclick="window.loadOverviewDashboard()">Retry</button>`;
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
    const toggleBtn = document.getElementById('eyeSidebarToggleBtn');
    if (toggleBtn && shell) {
      if (window.innerWidth > 960 && localStorage.getItem('eye-sidebar-collapsed') === '1') {
        shell.classList.add('sidebar-collapsed');
      }
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.innerWidth <= 960) {
          shell.classList.toggle('mobile-drawer-open');
        } else {
          shell.classList.toggle('sidebar-collapsed');
          localStorage.setItem('eye-sidebar-collapsed', shell.classList.contains('sidebar-collapsed') ? '1' : '0');
        }
      });
      document.addEventListener('click', (e) => {
        const sidebar = document.getElementById('eyeSidebar');
        if (shell.classList.contains('mobile-drawer-open') && sidebar && !sidebar.contains(e.target) && !toggleBtn.contains(e.target)) {
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
