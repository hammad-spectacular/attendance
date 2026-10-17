// ============================================================
//  Reload-persistence tests (drafts)
//  Serves the repo statically and mocks the API, so no DB/backend
//  is required. Run with:
//    npx playwright test tests/persistence.spec.js --project=chromium
// ============================================================

const { test, expect } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

let server;
let base;

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/') p = '/coordinator.html';
    const file = path.join(ROOT, p);
    // Prevent path traversal out of ROOT
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  if (server) await new Promise(r => server.close(r));
});

function json(route, obj, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });
}

// ---- Coordinator API mock ------------------------------------------------
async function coordinatorApi(route) {
  const url = route.request().url();
  if (url.includes('/api/auth/me')) return json(route, { id: 9, role: 'coordinator', name: 'Coord' });
  if (url.includes('/api/coordinator/me')) {
    return json(route, {
      branch: null,
      grants: {},
      profile: { name: 'Coord', login_id: 'c1' },
      classes: [
        { id: 1, name: 'Class 1', section: 'A' },
        { id: 2, name: 'Class 2', section: 'B' }
      ]
    });
  }
  if (url.includes('/api/attendance/today')) return json(route, { today: '2026-01-02' });
  if (url.includes('/api/attendance/submit')) return json(route, { ok: true });
  if (url.includes('/api/students')) {
    return json(route, [
      { id: 101, name: 'Alice', roll_no: '1', phone: '03000000000' },
      { id: 102, name: 'Bob', roll_no: '2', phone: '03000000001' }
    ]);
  }
  if (url.includes('/api/attendance')) return json(route, []);
  return json(route, {});
}

test.describe('coordinator draft persistence', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('auth_token', 'test-token'));
    await page.route('**/api/**', coordinatorApi);
  });

  test('in-progress marks survive a reload and clear on submit', async ({ page }) => {
    await page.goto(`${base}/coordinator.html`);
    await page.waitForSelector('tr[data-student="101"]');

    // Mark student 101 Absent (not saved yet).
    await page.click('tr[data-student="101"] .st-absent');
    await expect(page.locator('tr[data-student="101"] .st-absent')).toHaveClass(/active/);

    // Draft should hold the unsaved mark.
    const key = 'draft:coord:att:1:2026-01-02';
    const before = await page.evaluate(k => window.localStorage.getItem(k), key);
    expect(before).toContain('"101":"Absent"');

    // Reload — the mark should come back.
    await page.reload();
    await page.waitForSelector('tr[data-student="101"]');
    await expect(page.locator('tr[data-student="101"] .st-absent')).toHaveClass(/active/);

    // Submitting clears the draft (server becomes source of truth).
    await page.click('#saveAttBtn');
    await expect.poll(async () => page.evaluate(k => window.localStorage.getItem(k), key)).toBeNull();
  });

  test('selected class and subtab survive a reload', async ({ page }) => {
    await page.goto(`${base}/coordinator.html`);
    await page.waitForSelector('#markClassSelect');

    await page.selectOption('#markClassSelect', '2');
    await page.waitForSelector('tr[data-student="101"]');

    await page.reload();
    await page.waitForSelector('#markClassSelect');
    await expect(page.locator('#markClassSelect')).toHaveValue('2');
  });

  test('a failed load does not leave the page stuck on the loader', async ({ page }) => {
    // Make the very first request hang up the socket so apiFetch rejects.
    await page.route('**/api/coordinator/me', route => route.abort('failed'));
    await page.goto(`${base}/coordinator.html`);
    await expect(page.locator('#app')).toContainText('Could not load your branch', { timeout: 10000 });
  });
});

// ---- Teacher API mock ----------------------------------------------------
async function teacherApi(route) {
  const url = route.request().url();
  if (url.includes('/api/auth/me')) return json(route, { id: 5, role: 'teacher', name: 'Ms T', is_first_login: false });
  if (url.includes('/api/teachers')) return json(route, [{ id: 5, name: 'Ms T', class_id: 1, class: 'Class 1' }]);
  if (url.includes('/api/classes')) return json(route, [{ id: 1, name: 'Class 1', section: 'A' }]);
  if (url.includes('/api/attendance/submit')) return json(route, { ok: true });
  if (url.includes('/api/students')) {
    return json(route, [
      { id: 101, name: 'Alice', roll_no: '1', phone: '03000000000', class_id: 1 },
      { id: 102, name: 'Bob', roll_no: '2', phone: '03000000001', class_id: 1 }
    ]);
  }
  if (url.includes('/api/attendance')) return json(route, []);
  return json(route, []);
}

test.describe('teacher draft persistence', () => {
  test('in-progress marks survive a reload', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('auth_token', 'test-token'));
    await page.route('**/api/**', teacherApi);

    await page.goto(`${base}/teacher.html`);
    await page.waitForSelector('#row-101', { timeout: 15000 });

    await page.click('#row-101 [data-action="Absent"]');
    await expect(page.locator('#row-101')).toHaveClass(/row-marked-absent/);

    const today = await page.evaluate(() => getTodayDate());
    const key = `draft:teacher:att:1:${today}`;
    const before = await page.evaluate(k => window.localStorage.getItem(k), key);
    expect(before).toContain('"101":"Absent"');

    await page.reload();
    await page.waitForSelector('#row-101', { timeout: 15000 });
    await expect(page.locator('#row-101')).toHaveClass(/row-marked-absent/);
  });
});

// ---- Admin API mock ------------------------------------------------------
async function adminApi(route) {
  const url = route.request().url();
  if (url.includes('/api/auth/me')) return json(route, { id: 1, role: 'admin', name: 'Admin', is_first_login: false, token: 't' });
  if (url.includes('/api/admin/bootstrap')) return json(route, { branches: [], features: [] });
  if (url.includes('/api/auth/capacity')) return json(route, {});
  if (url.includes('/api/classes')) return json(route, [{ id: 1, name: 'Class 1', section: 'A' }]);
  if (url.includes('/api/teachers')) return json(route, []);
  if (url.includes('/api/students')) return json(route, []);
  if (url.includes('/api/attendance/all')) return json(route, []);
  if (url.includes('/api/fees/')) return json(route, []);
  return json(route, []);
}

test.describe('admin student-form draft persistence', () => {
  test('a half-typed student form survives a reload and restores on open', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('auth_token', 'test-token'));
    await page.route('**/api/**', adminApi);

    await page.goto(`${base}/admin.html`);
    // Wait for the page to be interactive.
    await page.waitForSelector('.tab-btn', { timeout: 20000 });

    // Switch to Students tab if it's not already active.
    const studentsTabBtn = page.locator('.tab-btn[data-section="tab-students"]').first();
    if (await studentsTabBtn.isVisible()) {
      await studentsTabBtn.click();
    }

    await page.waitForSelector('#addStudentToggleBtn', { timeout: 20000 });

    await page.click('#addStudentToggleBtn');
    await page.fill('#studentName', 'Draft Kid');
    await page.fill('#studentRoll', 'R-9');

    // Draft lives in sessionStorage and holds the typed values.
    const draft = await page.evaluate(() => window.sessionStorage.getItem('draft:admin:studentForm'));
    expect(draft).toContain('Draft Kid');

    await page.reload();
    await page.waitForSelector('.tab-btn[data-section="tab-students"]', { timeout: 20000 });
    const studentsTabBtn2 = page.locator('.tab-btn[data-section="tab-students"]').first();
    await studentsTabBtn2.click();

    // The form reopens with the restored values.
    await expect(page.locator('#studentName')).toHaveValue('Draft Kid');
    await expect(page.locator('#studentRoll')).toHaveValue('R-9');
  });
});

// ---- Coordinator mobile records -----------------------------------------
// Regression: the mobile media query used to hide column 1 of EVERY
// .att-table (written for the 5-column roster), which also hid the Student
// name column in the 2-column Saved Records table. Verify names stay visible
// at phone width.
test.describe('coordinator saved records on mobile', () => {
  test('saved-records table keeps the student name column at phone width', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('auth_token', 'test-token'));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/**', coordinatorApi);
    // Provide real saved records so the table actually renders rows.
    await page.route('**/api/attendance/all', route => json(route, [
      { date: '2026-01-02', class_id: 1, class_name: 'Class 1', class_section: 'A', name: 'Alice Absentia', roll_no: '1', status: 'Absent' }
    ]));

    await page.goto(`${base}/coordinator.html`);
    await page.waitForSelector('#markClassSelect');
    await page.evaluate(() => switchSubTab('records'));
    await page.waitForSelector('#recordsWrap .att-table tbody tr');

    // The Student name cell (column 1) must stay visible on a phone.
    const nameCell = page.locator('#recordsWrap .att-table tbody tr td').first();
    await expect(nameCell).toBeVisible();
    await expect(nameCell).toContainText('Alice Absentia');
    // The Status cell must also stay visible.
    await expect(page.locator('#recordsWrap .att-table tbody .status-badge')).toBeVisible();
  });
});

// ---- Coordinator records filter summary ---------------------------------
// Regression: onRecordsFilterChanged used to rebuild the Day/Month/Year
// <select>s, which wiped the chosen value back to "All" before loadRecords
// read it — so filters appeared to do nothing. Verify the chosen value sticks,
// the plain-language "Showing" summary appears, and Clear all resets it.
test.describe('coordinator records filter feedback', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('auth_token', 'test-token'));
    await page.route('**/api/**', coordinatorApi);
    await page.route('**/api/attendance/all', route => json(route, [
      { date: '2026-01-17', class_id: 1, class_name: 'Class 1', class_section: 'A', name: 'Alice', roll_no: '1', status: 'Absent' },
      { date: '2026-02-05', class_id: 1, class_name: 'Class 1', class_section: 'A', name: 'Bob', roll_no: '2', status: 'Present' }
    ]));
    await page.goto(`${base}/coordinator.html`);
    await page.waitForSelector('#markClassSelect');
    await page.evaluate(() => switchSubTab('records'));
    await page.waitForSelector('#recDaySelect');
  });

  test('choosing a Date keeps its value, filters rows, and shows a Showing summary', async ({ page }) => {
    // Pick Date = 17.
    await page.selectOption('#recDaySelect', '17');

    // The dropdown must keep the chosen value (not be reset to "").
    await expect(page.locator('#recDaySelect')).toHaveValue('17');

    // The summary must appear and name the chosen date in plain language.
    const summary = page.locator('#recActiveFilters');
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('Date: 17');

    // Only the 17th row remains.
    await expect(page.locator('#recordsWrap .att-table tbody tr')).toHaveCount(1);
    await expect(page.locator('#recordsWrap .att-table tbody')).toContainText('Alice');

    // Clear all hides the summary and restores every row.
    await page.click('#recActiveFilters button:has-text("Clear all")');
    await expect(summary).toBeHidden();
    await expect(page.locator('#recDaySelect')).toHaveValue('');
    await expect(page.locator('#recordsWrap .att-table tbody tr')).toHaveCount(2);
  });

  test('Month and Year choices also survive and appear in the summary', async ({ page }) => {
    await page.selectOption('#recMonthSelect', '01');
    await page.selectOption('#recYearSelect', '2026');

    await expect(page.locator('#recMonthSelect')).toHaveValue('01');
    await expect(page.locator('#recYearSelect')).toHaveValue('2026');

    const summary = page.locator('#recActiveFilters');
    await expect(summary).toContainText('Month: January');
    await expect(summary).toContainText('Year: 2026');

    // Jan 2026 keeps only Alice.
    await expect(page.locator('#recordsWrap .att-table tbody tr')).toHaveCount(1);
    await expect(page.locator('#recordsWrap .att-table tbody')).toContainText('Alice');
  });
});

