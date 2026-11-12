const { test, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('path');

test.describe.configure({ mode: 'serial' });

const fixtures = {
  teachers: [{ id: 11, name: 'Teacher Fixture', phone: '03001234567', class_id: 21, login_id: 'T001' }],
  classes: [
    { id: 21, name: 'Grade One', section: 'A', teacher_id: 11 },
    { id: 22, name: 'Grade Two', section: 'B', teacher_id: 11 },
    { id: 23, name: 'Grade Three', section: 'C', teacher_id: 11 }
  ],
  students: [
    { id: 31, name: 'Ali Hassan', phone: '03001234568', class_id: 21, roll_no: 'A001', login_id: 'S001' },
    { id: 32, name: 'Bilal Khan', phone: '03001234569', class_id: 22, roll_no: 'B002', login_id: 'S002' },
    { id: 33, name: 'Chen Wei', phone: '03001234570', class_id: 23, roll_no: 'C003', login_id: 'S003' }
  ],
  attendance: [],
  announcements: [],
  fees: [],
  complaints: { complaints: [] },
  coordinators: []
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

async function openMockedAdmin(page) {
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
      '/api/auth/capacity': { student_limit: 100, student_count: 3, teacher_limit: 50, teacher_count: 1 },
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

  await page.goto(`${baseUrl}/admin.html#tab-students`);
  await page.waitForFunction(() => window.appData?.bootstrapLoaded && window.appData.students?.length === 3);
  await expect(page.locator('#studentsTableWrap tbody tr')).toHaveCount(3);
  return consoleErrors;
}

test('students tab search filters the roster by name and by roll number', async ({ page }) => {
  const consoleErrors = await openMockedAdmin(page);

  const search = page.locator('#studentSearchInput');
  await search.fill('Ali');
  await expect(page.locator('#studentsTableWrap tbody tr')).toHaveCount(1);
  await expect(page.locator('#studentsTableWrap tbody tr input.inline-edit-input').first()).toHaveValue('Ali Hassan');

  await search.fill('B002');
  await expect(page.locator('#studentsTableWrap tbody tr')).toHaveCount(1);
  await expect(page.locator('#studentsTableWrap tbody tr input.inline-edit-input').first()).toHaveValue('Bilal Khan');

  await search.fill('no-such-student');
  await expect(page.locator('#studentsTableWrap tbody tr')).toHaveCount(0);

  await search.fill('');
  await expect(page.locator('#studentsTableWrap tbody tr')).toHaveCount(3);

  expect(consoleErrors).toEqual([]);
});

test('class dropdown next to the search box lists every class in the system', async ({ page }) => {
  await openMockedAdmin(page);

  const options = page.locator('#studentClassFilter option');
  await expect(options).toHaveCount(5); // All Classes + Unassigned + 3 classes
  await expect(page.locator('#studentClassFilter option', { hasText: 'Grade One' })).toHaveCount(1);
  await expect(page.locator('#studentClassFilter option', { hasText: 'Grade Two' })).toHaveCount(1);
  await expect(page.locator('#studentClassFilter option', { hasText: 'Grade Three' })).toHaveCount(1);

  await page.locator('#studentClassFilter').selectOption('22');
  await expect(page.locator('#studentsTableWrap tbody tr')).toHaveCount(1);
  await expect(page.locator('#studentsTableWrap tbody tr input.inline-edit-input').first()).toHaveValue('Bilal Khan');

  await page.locator('#studentClassFilter').selectOption('');
  await expect(page.locator('#studentsTableWrap tbody tr')).toHaveCount(3);
});

test('search and class filter combine', async ({ page }) => {
  await openMockedAdmin(page);

  await page.locator('#studentClassFilter').selectOption('22');
  await page.locator('#studentSearchInput').fill('Ali');
  await expect(page.locator('#studentsTableWrap tbody tr')).toHaveCount(0);
});

