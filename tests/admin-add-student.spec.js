// Add-student flow: name + optional phone only, roll number assigned by the system.
const { test, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('path');

test.describe.configure({ mode: 'serial' });

const fixtures = {
  teachers: [{ id: 11, name: 'Teacher Fixture', phone: '03001234567', class_id: 21, login_id: 'T001' }],
  classes: [
    { id: 21, name: 'Grade One', section: 'A', teacher_id: 11 },
    { id: 22, name: 'Grade Two', section: 'B', teacher_id: 11 }
  ],
  students: [
    { id: 31, name: 'Ali Hassan', phone: '03001234568', class_id: 21, roll_no: '1', login_id: 'S001' }
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

// Opens the admin page with every API mocked, and records every create-student call.
async function openMockedAdmin(page) {
  const createCalls = [];

  await page.route('**/api/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (pathname === '/api/auth/create-student') {
      const body = request.postDataJSON();
      createCalls.push(body);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          student_id: 'TEST-S002',
          student: { id: 32, name: body.name, roll_no: '2', phone: body.phone, class_id: body.class_id },
          credentials_issued: false
        })
      });
      return;
    }

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

  await page.goto(`${baseUrl}/admin.html#tab-students`);
  await page.waitForFunction(() => window.appData?.bootstrapLoaded && window.appData.students?.length === 1);
  await page.locator('#addStudentToggleBtn').click();
  await expect(page.locator('#addStudentForm')).toHaveClass(/open/);
  return createCalls;
}

test('the add-student form asks for a name and an optional phone only', async ({ page }) => {
  await openMockedAdmin(page);

  // The roll number is not typed by the admin any more.
  await expect(page.locator('#addStudentForm #studentRoll')).toHaveCount(0);
  await expect(page.locator('#addStudentForm')).toContainText('assigned automatically');

  // The phone number is optional, but still an 11-digit number when given.
  const phone = page.locator('#studentPhone');
  await expect(phone).toBeVisible();
  await expect(phone).not.toHaveAttribute('required', /.*/);
  await expect(phone).toHaveAttribute('pattern', '[0-9]{11}');
});

test('a student can be added with just a name and a class', async ({ page }) => {
  const createCalls = await openMockedAdmin(page);

  await page.locator('#studentName').fill('Bilal Khan');
  await page.locator('#studentClass').selectOption('21');
  await page.locator('button[onclick="saveStudent()"]').click();

  await expect.poll(() => createCalls.length).toBe(1);
  const body = createCalls[0];
  expect(body.name).toBe('Bilal Khan');
  expect(body.class_id).toBe(21);
  expect(body.phone).toBeNull();
  // No roll number is sent - the system assigns it.
  expect(body).not.toHaveProperty('roll_no');
});

test('a phone number is optional but must be exactly 11 digits', async ({ page }) => {
  const createCalls = await openMockedAdmin(page);

  await page.locator('#studentName').fill('Chen Wei');
  await page.locator('#studentClass').selectOption('21');

  // Too short: the form refuses to save and nothing is sent.
  await page.locator('#studentPhone').fill('0300123456');
  await page.locator('button[onclick="saveStudent()"]').click();
  await expect(page.locator('.toast')).toContainText('11 digits');
  expect(createCalls.length).toBe(0);

  // Formatting characters are stripped as they type.
  await page.locator('#studentPhone').fill('0300-123 4567');
  await expect(page.locator('#studentPhone')).toHaveValue('03001234567');

  await page.locator('button[onclick="saveStudent()"]').click();
  await expect.poll(() => createCalls.length).toBe(1);
  expect(createCalls[0].phone).toBe('03001234567');
  expect(createCalls[0]).not.toHaveProperty('roll_no');
});
