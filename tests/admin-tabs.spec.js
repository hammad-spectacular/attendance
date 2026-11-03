const { test, expect } = require('@playwright/test');
const fs = require('fs');
const http = require('http');
const path = require('path');

const publicRoot = path.resolve(__dirname, '..', 'public');
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

test.beforeAll(async () => {
  server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const relativePath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const filePath = path.resolve(publicRoot, `.${relativePath}`);
    if (!filePath.startsWith(`${publicRoot}${path.sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    fs.readFile(filePath, (error, content) => {
      if (error) {
        response.writeHead(404).end('Not found');
        return;
      }
      const extension = path.extname(filePath);
      const contentTypes = {
        '.css': 'text/css',
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.json': 'application/json',
        '.svg': 'image/svg+xml'
      };
      response.writeHead(200, { 'Content-Type': contentTypes[extension] || 'application/octet-stream' });
      response.end(content);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
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
      '/api/complaints': fixtures.complaints
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
    await page.locator(`.tab-btn[data-section="${tab.id}"]`).first().click();
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

for (const tabId of ['tab-students', 'tab-fees']) {
  test(`direct hash #${tabId} opens the correct panel`, async ({ page }) => {
    await openMockedAdmin(page, `#${tabId}`);
    await expect(page.locator(`.tab-content[id="${tabId}"]`)).toBeVisible();
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
