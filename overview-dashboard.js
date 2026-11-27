(function () {
  'use strict';

  let showAllPriorities = false;
  let searchTimer = null;
  let lastAdminName = 'Administrator';
  let lastDateline = '';

  const TAB_TITLES = {
    'tab-overview': null,
    'tab-students': 'Students',
    'tab-classes': 'Classes & Sections',
    'tab-attendance': 'Attendance',
    'tab-stats': 'Attendance Stats',
    'tab-announcements': 'Announcements',
    'tab-qr-attendance': 'QR Staff Attendance',
    'tab-fees': 'Fees & Accounts',
    'tab-teachers': 'Teachers',
    'tab-coordinators': 'Coordinators',
    'tab-complaints': 'Complaints',
    'tab-branches': 'Branches',
  };

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

  function shortDateLabel(isoDate) {
    if (!isoDate) return '';
    const d = new Date(isoDate + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function updateHeaderForTab(tabId) {
    const titleEl = document.getElementById('ovGreeting');
    const dateEl = document.getElementById('ovDateline');
    const active = tabId || 'tab-overview';
    const customTitle = TAB_TITLES[active];

    if (titleEl) {
      if (customTitle) {
        titleEl.textContent = customTitle;
      } else {
        const now = new Date();
        titleEl.textContent = `${greetingForHour(now.getHours())}, ${lastAdminName}`;
      }
    }
    if (dateEl) {
      dateEl.style.display = customTitle ? 'none' : 'block';
      if (!customTitle && lastDateline) {
        dateEl.textContent = lastDateline;
      }
    }
  }

  function navigateToTarget(tab, href, searchValue) {
    if (tab && typeof window.switchTab === 'function') {
      window.switchTab(tab, false);
      if (searchValue) {
        setTimeout(() => {
          const inputId = tab === 'tab-students' ? 'studentSearchInput'
            : tab === 'tab-teachers' ? 'teacherSearchInput'
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
      'unassigned-classes': 'Assign',
      'unmarked-attendance': 'Mark',
      'overdue-fees': 'Review',
      'absent-today': 'View',
      'pending-complaints': 'Review',
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
        actionLabel: actionLabels[item.id] || 'Open',
      });
    }
    return out;
  }

  function renderHeaderMeta(data, consolidatedPriorities) {
    const now = new Date();
    lastAdminName = data.adminName || 'Administrator';
    const dStr = now.toLocaleDateString('en-US', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
    });
    const tStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    lastDateline = `${dStr} · Updated ${tStr}`;

    const activePanel = document.querySelector('.tab-content.active');
    updateHeaderForTab(activePanel ? activePanel.id : 'tab-overview');

    const schoolEl = document.getElementById('sidebarSchoolName');
    if (schoolEl && data.schoolName) schoolEl.textContent = data.schoolName;

    const logoEl = document.getElementById('sidebarBrandLogo');
    if (logoEl && data.schoolName) logoEl.textContent = initials(data.schoolName);

    const avatarEl = document.getElementById('topbarAvatar');
    if (avatarEl) avatarEl.textContent = initials(data.adminName);

    const railAvatarEl = document.getElementById('railAvatar');
    if (railAvatarEl) railAvatarEl.textContent = initials(data.adminName);

    const nameEl = document.getElementById('topbarAdminName');
    if (nameEl) nameEl.textContent = lastAdminName;

    const roleEl = document.getElementById('topbarAdminRole');
    if (roleEl) roleEl.textContent = data.adminRole === 'super_admin' ? 'Super administrator' : 'Administrator';

    const crumbEl = document.getElementById('ovBreadcrumb');
    if (crumbEl) {
      const sel = document.getElementById('branchSelector');
      const branchLabel = sel && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].text : 'All branches';
      crumbEl.textContent = `Administration / ${branchLabel}`;
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

    const stuCount = data.students.active || 0;
    const stuSub = stuCount > 0
      ? `${data.students.classCount} classes · ${data.students.newThisMonth} new this month`
      : '<span class="ov-kpi-action">Add first student &rarr;</span>';

    const attPct = data.attendance.pctToday;
    const attMarked = data.attendance.markedTotal > 0;
    const attTone = !attMarked ? 'primary' : (attPct >= 85 ? 'green' : 'amber');
    const attVal = attMarked && attPct !== null ? `${attPct}%` : 'Not marked';
    const attSub = attMarked
      ? `${data.attendance.presentToday.toLocaleString()} of ${stuCount.toLocaleString()} present`
      : '<span class="ov-kpi-action">Mark attendance &rarr;</span>';

    let feeTone = 'primary';
    let feeVal = 'Disabled';
    let feeSub = 'Fees module not enabled';
    let feeTab = 'tab-classes';
    if (data.fees && data.fees.enabled) {
      feeTab = 'tab-fees';
      if (data.fees.expected > 0) {
        const fpct = data.fees.collectionPct;
        feeTone = fpct === null ? 'primary' : (fpct >= 80 ? 'green' : 'amber');
        feeVal = fpct !== null ? `${fpct}%` : formatPKR(data.fees.collected);
        feeSub = `${formatPKR(data.fees.collected)} collected · ${formatPKR(data.fees.outstanding)} due`;
      } else {
        feeVal = 'No dues';
        feeSub = '<span class="ov-kpi-action">Set up fees &rarr;</span>';
      }
    }

    const priCount = priorities.length;
    const priTone = priCount > 0 ? 'red' : 'green';
    const priSub = priCount > 0
      ? `${priCount} item${priCount === 1 ? '' : 's'} need attention`
      : 'All systems clear';

    el.innerHTML = `
      <button type="button" class="ov-kpi-card" data-nav-tab="tab-students">
        <div class="ov-kpi-top">
          <span class="ov-kpi-title">Total students</span>
          <span class="ov-kpi-icon primary" aria-hidden="true"><i class="fas fa-user-graduate"></i></span>
        </div>
        <div class="ov-kpi-value">${stuCount.toLocaleString()}</div>
        <div class="ov-kpi-sub">${stuSub}</div>
      </button>
      <button type="button" class="ov-kpi-card is-accent" data-nav-tab="tab-attendance">
        <div class="ov-kpi-top">
          <span class="ov-kpi-title">Today's attendance</span>
          <span class="ov-kpi-icon ${attTone}" aria-hidden="true"><i class="fas fa-clipboard-check"></i></span>
        </div>
        <div class="ov-kpi-value" style="${!attMarked ? 'font-size:20px;' : ''}">${attVal}</div>
        <div class="ov-kpi-sub">${attSub}</div>
      </button>
      <button type="button" class="ov-kpi-card" data-nav-tab="${feeTab}">
        <div class="ov-kpi-top">
          <span class="ov-kpi-title">Fee collection</span>
          <span class="ov-kpi-icon ${feeTone}" aria-hidden="true"><i class="fas fa-wallet"></i></span>
        </div>
        <div class="ov-kpi-value" style="${data.fees && data.fees.enabled && data.fees.expected === 0 ? 'font-size:20px;' : ''}">${esc(feeVal)}</div>
        <div class="ov-kpi-sub">${feeSub}</div>
      </button>
      <button type="button" class="ov-kpi-card" onclick="document.getElementById('ovPriorityCard')?.scrollIntoView({behavior:'smooth'})">
        <div class="ov-kpi-top">
          <span class="ov-kpi-title">Open priorities</span>
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
              <span class="ov-severity-dot ${esc(item.severity)}" aria-hidden="true"></span>
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
      : `<div class="ov-empty">
           <span>No urgent issues require action right now.</span>
         </div>`;

    el.innerHTML = `
      <div class="ov-card-head">
        <div>
          <div class="ov-card-title">Priority inbox</div>
          <div class="ov-card-sub">${priorities.length} open item${priorities.length === 1 ? '' : 's'}</div>
        </div>
        ${priorities.length > 5 ? `<button type="button" class="ov-card-action" id="ovTogglePrioritiesBtn">${showAllPriorities ? 'Show less' : 'View all'}</button>` : ''}
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
      actions.push({ label: 'Add student', icon: 'fa-plus', tab: 'tab-students' });
    }
    if (f.fees) {
      actions.push({ label: 'Receive fee', icon: 'fa-receipt', href: '/voucher-generator.html#collect' });
    }
    if (f.attendance !== false) {
      actions.push({ label: 'Mark attendance', icon: 'fa-clipboard-check', tab: 'tab-attendance' });
    }
    if (f.fees) {
      actions.push({ label: 'Fee voucher', icon: 'fa-file-invoice-dollar', href: '/voucher-generator.html#generate' });
    }
    actions.push({ label: 'Manage classes', icon: 'fa-book-open', tab: 'tab-classes' });
    if (f.teacher_management !== false) {
      actions.push({ label: 'Add staff', icon: 'fa-user-plus', tab: 'tab-teachers' });
    }

    el.innerHTML = `
      <div class="ov-card-head">
        <div>
          <div class="ov-card-title">Quick actions</div>
        </div>
      </div>
      <div class="ov-actions-grid">
        ${actions.map(a => `
          <button type="button" class="ov-action-btn"
            ${a.tab ? `data-nav-tab="${esc(a.tab)}"` : ''}
            ${a.href ? `data-nav-href="${esc(a.href)}"` : ''}>
            <i class="fas ${esc(a.icon)}" aria-hidden="true"></i>
            <span>${esc(a.label)}</span>
          </button>`).join('')}
      </div>`;
  }

  function renderAttendanceTrend(data) {
    const el = document.getElementById('ovTrendCard');
    if (!el) return;
    const trend = data.attendance.trend || [];
    const markedToday = data.attendance.markedTotal > 0;

    if (trend.length === 0) {
      el.innerHTML = `
        <div class="ov-card-head">
          <div>
            <div class="ov-card-title">Attendance trend</div>
          </div>
          <button type="button" class="ov-card-action" data-nav-tab="tab-stats">View report &rarr;</button>
        </div>
        <div class="ov-empty">
          <span>No attendance records yet. Mark daily attendance to see trends.</span>
          <button type="button" class="ov-empty-action" data-nav-tab="tab-attendance">Mark attendance</button>
        </div>`;
      return;
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    const barsHtml = trend.map((d, idx) => {
      const isToday = d.date === todayIso || (idx === trend.length - 1 && markedToday);
      const heightPct = Math.max(12, Math.min(100, d.pct));
      const shortDate = shortDateLabel(d.date);
      return `
        <div class="ov-bar-col ${isToday ? 'today' : ''}" title="${esc(d.date)}: ${d.present}/${d.total} present (${d.pct}%)">
          <div class="ov-bar-pct">${d.pct}%</div>
          <div class="ov-bar-fill" style="height:${heightPct}%"></div>
          <div class="ov-bar-day">${esc(d.day)}${shortDate ? `<br>${esc(shortDate)}` : ''}${isToday ? '<br>(Today)' : ''}</div>
        </div>`;
    }).join('');

    let footerClass = 'neutral';
    let footerIcon = 'fa-clock';
    let footerMsg = 'Attendance not marked yet';
    if (markedToday) {
      if (data.attendance.absentToday > 0) {
        footerClass = 'warn';
        footerIcon = 'fa-circle-exclamation';
        footerMsg = `${data.attendance.absentToday} student${data.attendance.absentToday === 1 ? '' : 's'} absent today`;
      } else {
        footerClass = 'ok';
        footerIcon = 'fa-circle-check';
        footerMsg = 'No absences today';
      }
    }

    el.innerHTML = `
      <div class="ov-card-head">
        <div>
          <div class="ov-card-title">Attendance trend</div>
          <div class="ov-card-sub">Last ${trend.length} recorded day${trend.length === 1 ? '' : 's'}</div>
        </div>
        <button type="button" class="ov-card-action" data-nav-tab="tab-stats">View report &rarr;</button>
      </div>
      <div class="ov-trend-bars">${barsHtml}</div>
      <div class="ov-trend-footer ${footerClass}">
        <i class="fas ${footerIcon}" aria-hidden="true"></i>
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
      : `<div class="ov-empty">
           <span>No upcoming exams or school notices posted yet.</span>
           <div style="display:flex;gap:8px;">
             <button type="button" class="ov-empty-action" data-nav-href="/datesheet.html">Add datesheet</button>
             <button type="button" class="ov-empty-action" data-nav-tab="tab-announcements">Post notice</button>
           </div>
         </div>`;

    el.innerHTML = `
      <div class="ov-card-head">
        <div>
          <div class="ov-card-title">Campus schedule</div>
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

    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.focus();
        input.select();
      }
    });

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
                  <div style="font-weight:600;font-size:13px">${esc(r.title)}</div>
                  <div style="font-size:12px;color:var(--text-secondary)">${esc(r.subtitle)}</div>
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
      if (window.innerWidth > 960 && localStorage.getItem('eye-sidebar-collapsed') !== '0') {
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
        loadOverviewDashboard();
      });
    }
  }

  window.updateHeaderForTab = updateHeaderForTab;
  window.loadOverviewDashboard = loadOverviewDashboard;

  document.addEventListener('DOMContentLoaded', () => {
    setupSidebarShell();
    setupGlobalSearch();
    loadOverviewDashboard();
  });
})();
