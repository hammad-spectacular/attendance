const { test, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

test.describe.configure({ mode: 'serial' });

const fixtures = {
  teachers: [{ id: 11, name: 'Teacher Fixture', phone: '03001234567', class_id: 21, login_id: 'T001' }],
  students: [{ id: 31, name: 'Student Fixture', phone: '03001234568', class_id: 21, roll_no: 'S001', login_id: 'S001' }],
  classes: [{ id: 21, name: 'Grade One', section: 'A', teacher_id: 11 }],
  attendance: [],
  announcements: [],
  fees: [],
  complaints: { complaints: [] },
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

async function openMockedAdmin(page, { qrEnabled = false } = {}) {
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => consoleErrors.push(error.message));

  const featureKeys = ['student_management', 'teacher_management', 'fees', 'coordinator_portal'];
  if (qrEnabled) featureKeys.push('qr_attendance');

  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    const responses = {
      '/api/auth/me': { role: 'admin', is_first_login: false, name: 'Fixture Admin', login_id: 'A001' },
      '/api/admin/bootstrap': {
        branches: [],
        features: featureKeys.map(key => ({ key, enabled: true }))
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
      '/api/tt2/timetables': [],
      '/api/attendance/qr/status': { active: false },
      '/api/attendance/staff': []
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(responses[pathname] ?? [])
    });
  });

  await page.goto(`${baseUrl}/admin.html`);
  await page.waitForFunction(() => window.appData?.bootstrapLoaded);
  return consoleErrors;
}

test('every headcount sits in the capacity strip, not in the header', async ({ page }) => {
  await openMockedAdmin(page);

  const strip = page.locator('#capacityStrip');
  await expect(strip).toBeVisible();
  await expect(strip).toContainText('Students:');
  await expect(strip).toContainText('Teachers:');
  await expect(strip).toContainText('Coordinators:');
  await expect(page.locator('#capStudents')).toHaveText('1 / 100');
  await expect(page.locator('#capTeachers')).toHaveText('1 / 50');
  await expect(page.locator('#capCoordinators')).toHaveText('1');

  // The student count must not sit next to the theme toggle any more.
  await expect(page.locator('#headerStudentCount')).toHaveCount(0);
  await expect(page.locator('#headerCapStudents')).toHaveCount(0);
});

test('QR Attendance says it will be available soon while the module is switched off', async ({ page }) => {
  const consoleErrors = await openMockedAdmin(page, { qrEnabled: false });

  const attendanceMenu = page.locator('#tab-attendance-menu');
  await attendanceMenu.hover();
  const qrItem = attendanceMenu.locator('.nav-dropdown-item[data-section="tab-qr-attendance"]');
  await expect(qrItem).toBeVisible();
  await expect(qrItem).toContainText('available soon');

  await qrItem.click();
  const panel = page.locator('#tab-qr-attendance');
  await expect(panel).toBeVisible();
  await expect(page.locator('#qrSoonBadge')).toBeVisible();
  await expect(page.locator('#qrSoonBadge')).toContainText('Coming Soon');
  await expect(page.locator('#qrComingSoonBanner')).toBeVisible();
  await expect(page.locator('#qrComingSoonBanner')).toContainText('QR Attendance will be available soon');
  await expect(page.locator('#generateQRBtn')).toBeDisabled();

  expect(consoleErrors).toEqual([]);
});

test('QR Attendance hides the coming soon notice once the module is switched on', async ({ page }) => {
  const consoleErrors = await openMockedAdmin(page, { qrEnabled: true });

  const attendanceMenu = page.locator('#tab-attendance-menu');
  await attendanceMenu.hover();
  await attendanceMenu.locator('.nav-dropdown-item[data-section="tab-qr-attendance"]').click();

  await expect(page.locator('#tab-qr-attendance')).toBeVisible();
  await expect(page.locator('#qrSoonBadge')).toBeHidden();
  await expect(page.locator('#qrComingSoonBanner')).toBeHidden();
  await expect(page.locator('#generateQRBtn')).toBeEnabled();

  expect(consoleErrors).toEqual([]);
});
