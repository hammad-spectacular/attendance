const { test, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('path');

test.describe.configure({ mode: 'serial' });

const fixtures = {
  teachers: [{ id: 11, name: 'Teacher Fixture', phone: '03001234567', class_id: 21, login_id: 'T001' }],
  students: [{ id: 31, name: 'Student Fixture', phone: '03001234568', class_id: 21, roll_no: 'S001', login_id: 'S001' }],
  classes: [{ id: 21, name: 'Grade One', section: 'A', teacher_id: 11 }],
  attendance: [{ id: 41, student_id: 31, name: 'Student Fixture', phone: '03001234568', class_id: 21, class_name: 'Grade One', class_section: 'A', roll_no: 'S001', date: '2026-11-02', status: 'Present', marked_by: 'Teacher Fixture' }],
  announcements: [{ id: 51, message: 'Announcement Fixture', author: 'Admin', created_at: '2026-11-02T10:00:00.000Z' }],
  fees: [{ id: 71, student_id: 31, student_name: 'Student Fixture', class_id: 21, class_name: 'Grade One', month_year: new Date().toISOString().slice(0, 7), amount_due: 5000, amount_paid: 2000, status: 'partial' }],
  complaints: { complaints: [
    { id: 81, role: 'teacher', category: 'Other', subject: 'Teacher Fixture Complaint', author_name: 'Teacher Fixture', user_id: 11, status: 'new', created_at: '2026-11-02T10:00:00.000Z', description: 'Teacher complaint fixture' },
    { id: 82, role: 'student', category: 'Other', subject: 'Student Fixture Complaint', author_name: 'Student Fixture', user_id: 31, status: 'new', created_at: '2026-11-02T11:00:00.000Z', description: 'Student complaint fixture' }
  ] },
  coordinators: [{ id: 91, name: 'Coordinator Fixture', login_id: 'C001', grant_management: true }]
};

let server;
let baseUrl;

async function getFreePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const { port } = probe.address();
  await new Promise(resolve => probe.close(resolve));
  return port;
}

test.beforeAll(async () => {
  const projectRoot = path.resolve(__dirname, '..');
  const serverPath = path.join(projectRoot, 'serverg.js');
  const port = await getFreePort();
  const bootstrap = `
    const Module = require('node:module');
    const serverPath = ${JSON.stringify(serverPath)};
    const originalLoad = Module._load;
    const pool = {
      query: async () => ({ rows: [], rowCount: 0 }),
      connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release() {} }),
      end: async () => {}
    };
    Module._load = function(request, parent, isMain) {
      if (request === './db' && parent && parent.filename === serverPath) return pool;
      return originalLoad.call(this, request, parent, isMain);
    };
    require(serverPath);
  `;
  server = spawn(process.execPath, ['-e', bootstrap], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(port), JWT_SECRET: 'playwright-test-secret' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let serverOutput = '';
  server.stdout.on('data', chunk => { serverOutput += chunk.toString(); });
  server.stderr.on('data', chunk => { serverOutput += chunk.toString(); });
  baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Test server exited during startup:\n${serverOutput}`);
    try {
      const response = await fetch(`${baseUrl}/tt2/`);
      if (response.ok) return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Test server did not start:\n${serverOutput}`);
});

test.afterAll(async () => {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise(resolve => server.once('exit', resolve));
  server.kill();
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2000))]);
});

async function openMockedAdmin(page, hash = '') {
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => consoleErrors.push(error.message));

  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    const responses = {
      '/api/auth/me': { role: 'admin', is_first_login: false, name: 'Fixture Admin', login_id: 'A001' },
      '/api/admin/bootstrap': {
        branches: [],
        features: ['student_management', 'teacher_management', 'fees', 'coordinator_portal'].map(key => ({ key, enabled: true }))
      },
      '/api/auth/capacity': { student_limit: 100, student_count: 1, teacher_limit: 50, teacher_count: 1 },
      '/api/teachers': fixtures.teachers,
      '/api/students': fixtures.students,
      '/api/classes': fixtures.classes,
      '/api/attendance/all': fixtures.attendance,
      '/api/attendance': fixtures.attendance,
      '/api/announcements': fixtures.announcements,
      '/api/fees/payments': fixtures.fees,
      '/api/fees/structures': [],
      '/api/coordinators': fixtures.coordinators,
      '/api/complaints': fixtures.complaints,
      '/api/tt2/meta': { ok: true, steps: [], defaults: {} },
      '/api/tt2/timetables': []
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(responses[pathname] ?? [])
    });
  });

  await page.goto(`${baseUrl}/admin.html${hash}`);
  await page.waitForFunction(() => window.appData?.bootstrapLoaded && window.appData.teachers?.length === 1);
  await expect(page.locator('#teachersTableWrap tbody tr')).toHaveCount(1);
  return consoleErrors;
}

test('admin tab links do not duplicate content panel IDs', async ({ page }) => {
  await openMockedAdmin(page);

  const duplicateIds = await page.locator('[id]').evaluateAll(elements => {
    const seen = new Set();
    const duplicates = new Set();
    for (const element of elements) {
      if (seen.has(element.id)) duplicates.add(element.id);
      seen.add(element.id);
    }
    return [...duplicates];
  });
  expect(duplicateIds).toEqual([]);
});

test('each admin tab opens its panel and renders its fixture rows without console errors', async ({ page }) => {
  const consoleErrors = await openMockedAdmin(page);
  const tabs = [
    { id: 'tab-teachers', rows: '#teachersTableWrap tbody tr', nameInput: '#row-tab-teachers-11 input[type="text"].inline-edit-input', text: 'Teacher Fixture' },
    { id: 'tab-students', rows: '#studentsTableWrap tbody tr', nameInput: '#row-tab-students-31 input[type="text"].inline-edit-input', text: 'Student Fixture' },
    { id: 'tab-classes', rows: '#classesTableWrap tbody tr', text: 'Grade One' },
    { id: 'tab-attendance', rows: '#attendanceTableWrap tbody tr', text: 'Student Fixture' },
    { id: 'tab-stats', rows: '#statsTableWrap tbody tr', text: 'Student Fixture' },
    { id: 'tab-announcements', rows: '#announcementsList tbody tr', text: 'Announcement Fixture' },
    { id: 'tab-fees', rows: '#feesTableWrap .fee-card', text: 'Student Fixture' },
    { id: 'tab-branches', rows: '#branchesList > *', emptyState: '#branchesEmpty' },
    { id: 'tab-coordinators', rows: '#coordinatorsTableWrap > *', text: 'Coordinator Fixture' }
  ];

  for (const tab of tabs) {
    if (tab.id === 'tab-attendance' || tab.id === 'tab-stats') {
      const attendanceMenu = page.locator('#tab-attendance-menu');
      await attendanceMenu.hover();
      await attendanceMenu.locator(`.nav-dropdown-item[data-section="${tab.id}"]`).click();
    } else {
      await page.locator(`.tab-btn[data-section="${tab.id}"]`).first().click();
    }
    const panel = page.locator(`.tab-content[id="${tab.id}"]`);
    await expect(panel).toBeVisible();
    if (tab.emptyState) {
      await expect(page.locator(tab.emptyState)).toBeVisible();
    } else {
      const rows = page.locator(tab.rows);
      await expect(rows.first()).toBeVisible();
      await expect(rows).toHaveCount(1);
      if (tab.nameInput) await expect(page.locator(tab.nameInput).first()).toHaveValue(tab.text);
      else if (tab.text) await expect(rows.first()).toContainText(tab.text);
    }
  }

  expect(consoleErrors).toEqual([]);
});

test('Attendance dropdown contains exactly Attendance and Stats with descriptions', async ({ page }) => {
  await openMockedAdmin(page);
  const attendanceMenu = page.locator('#tab-attendance-menu');
  const items = attendanceMenu.locator('.nav-dropdown-item');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('Attendance');
  await expect(items.nth(0)).toContainText('Mark and view attendance.');
  await expect(items.nth(1)).toContainText('Stats');
  await expect(items.nth(1)).toContainText('See attendance numbers.');
  await expect(page.locator('#tabNavInner > .nav-tab-item > .tab-btn').filter({ hasText: 'Stats' })).toHaveCount(0);

  await attendanceMenu.locator(':scope > .tab-btn').click();
  await expect(page.locator('.tab-content[id="tab-attendance"]')).toBeVisible();
  await expect(page.locator('#attendanceTableWrap tbody tr')).toHaveCount(1);
});

for (const tabId of ['tab-students', 'tab-fees', 'tab-stats']) {
  test(`direct hash #${tabId} opens the correct panel`, async ({ page }) => {
    await openMockedAdmin(page, `#${tabId}`);
    await expect(page.locator(`.tab-content[id="${tabId}"]`)).toBeVisible();
    if (tabId === 'tab-stats') {
      await expect(page.locator('#tab-attendance-menu > .tab-btn')).toHaveClass(/active/);
    }
  });
}

for (const complaint of [
  { label: 'Teacher complaints', role: 'teacher', subject: 'Teacher Fixture Complaint' },
  { label: 'Student complaints', role: 'student', subject: 'Student Fixture Complaint' }
]) {
  test(`${complaint.label} opens the complaints panel and applies its role filter`, async ({ page }) => {
    const consoleErrors = await openMockedAdmin(page);
    const menu = page.locator('#tab-complaints-menu');
    await menu.locator(':scope > button').click();
    await menu.locator('.nav-dropdown-item', { hasText: complaint.label }).click();

    await expect(page.locator('.tab-content[id="tab-complaints"]')).toBeVisible();
    await expect(page.locator('#complaintRoleFilter')).toHaveValue(complaint.role);
    await expect(page.locator('#complaintsTableBody tr')).toHaveCount(1);
    await expect(page.locator('#complaintsTableBody tr').first()).toContainText(complaint.subject);
    expect(consoleErrors).toEqual([]);
  });
}

test('mobile menu opens and closes on successive taps after repeated setup', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openMockedAdmin(page);
  await page.evaluate(() => {
    setupSectionTabs();
    setupSectionTabs();
  });

  const nav = page.locator('#tabNav');
  const toggle = page.locator('#mobileNavToggle');
  await toggle.click();
  await expect(nav).toHaveClass(/open/);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(nav).not.toHaveClass(/open/);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('mobile Attendance dropdown keeps its submenu tappable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openMockedAdmin(page);
  const nav = page.locator('#tabNav');
  const toggle = page.locator('#mobileNavToggle');
  const attendanceMenu = page.locator('#tab-attendance-menu');

  await toggle.click();
  await expect(nav).toHaveClass(/open/);
  await attendanceMenu.locator(':scope > .tab-btn').click();
  await expect(page.locator('.tab-content[id="tab-attendance"]')).toBeVisible();
  await expect(nav).toHaveClass(/open/);
  await expect(attendanceMenu.locator(':scope > .tab-btn')).toHaveAttribute('aria-expanded', 'true');

  await attendanceMenu.locator('.nav-dropdown-item[data-section="tab-stats"]').click();
  await expect(page.locator('.tab-content[id="tab-stats"]')).toBeVisible();
  await expect(nav).not.toHaveClass(/open/);

  await toggle.click();
  await attendanceMenu.locator(':scope > .tab-btn').click();
  await expect(attendanceMenu.locator(':scope > .tab-btn')).toHaveAttribute('aria-expanded', 'true');
  await attendanceMenu.locator('.nav-dropdown-item[data-section="tab-attendance"]').click();
  await expect(page.locator('.tab-content[id="tab-attendance"]')).toBeVisible();
  await expect(nav).not.toHaveClass(/open/);
});

test('Generate Time Table opens the served TT2 page and loads its assets', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('auth_token', 'test-token'));
  const consoleErrors = await openMockedAdmin(page);
  const navigationResponse = page.waitForNavigation();
  const scriptResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/tt2/app.js');
  const configResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/tt2/config/defaults.js');
  const styleResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/tt2/style.css');
  const metaResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/tt2/meta');
  const listResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/tt2/timetables');
  const timetableRequests = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/tt2/')) timetableRequests.push(request);
  });

  const automatedMenu = page.locator('#tab-automated');
  await automatedMenu.locator(':scope > .tab-btn').click();
  await automatedMenu.getByRole('menuitem', { name: /Generate Time Table/ }).click();
  const response = await navigationResponse;
  expect(response.status()).toBe(200);
  await expect(page).toHaveURL(`${baseUrl}/tt2/`);
  await expect(page.locator('#screen-list')).toBeVisible();

  expect((await scriptResponse).status()).toBe(200);
  expect((await configResponse).status()).toBe(200);
  expect((await styleResponse).status()).toBe(200);
  expect((await metaResponse).status()).toBe(200);
  expect((await listResponse).status()).toBe(200);
  expect(timetableRequests.length).toBeGreaterThanOrEqual(2);
  for (const request of timetableRequests) {
    expect(request.headers().authorization).toBe('Bearer test-token');
  }
  await page.getByRole('link', { name: 'Back to Admin' }).first().click();
  await expect(page).toHaveURL(`${baseUrl}/admin.html`);
  expect(consoleErrors).toEqual([]);
});
