import { test, expect } from '@playwright/test';
import path from 'path';
import net from 'net';
import { spawn } from 'child_process';

const projectRoot = path.resolve(__dirname, '..');
const serverPath = path.join(projectRoot, 'serverg.js');
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
  server.stdout.on('data', c => { serverOutput += c.toString(); });
  server.stderr.on('data', c => { serverOutput += c.toString(); });
  baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Test server exited:\n${serverOutput}`);
    try {
      const r = await fetch(`${baseUrl}/tt2/`);
      if (r.ok) return;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`Test server did not start:\n${serverOutput}`);
});

test.afterAll(async () => {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise(r => server.once('exit', r));
  server.kill();
  await Promise.race([exited, new Promise(r => setTimeout(r, 2000))]);
});

const OBLIGATIONS = [
  { id: 1, studentId: 31, studentName: 'Student Fixture', studentRoll: 'S001', classId: 21, className: 'Grade One', feeName: 'Tuition Fee', category: 'tuition', frequency: 'monthly', originalAmount: '1000.00', discountAmount: '0.00', finalAmount: '1000.00', paidAmount: '0.00', remaining: '1000.00', periodLabel: 'Nov 2026', dueDate: '2026-11-10', status: 'unpaid', payStatus: 'unpaid' },
  { id: 2, studentId: 32, studentName: 'Second Student', studentRoll: 'S002', classId: 21, className: 'Grade One', feeName: 'Tuition Fee', category: 'tuition', frequency: 'monthly', originalAmount: '800.00', discountAmount: '0.00', finalAmount: '800.00', paidAmount: '200.00', remaining: '600.00', periodLabel: 'Nov 2026', dueDate: '2026-11-10', status: 'unpaid', payStatus: 'partially_paid' }
];

test('Collect Fee grid renders students from obligations API', async ({ page }) => {
  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    const responses = {
      '/api/auth/me': { role: 'admin', is_first_login: false, name: 'Fixture Admin', login_id: 'A001' },
      '/api/admin/bootstrap': { branches: [], features: [{ key: 'fees', enabled: true }, { key: 'student_management', enabled: true }] },
      '/api/auth/capacity': { student_limit: 100, student_count: 2, teacher_limit: 50, teacher_count: 1 },
      '/api/teachers': [{ id: 11, name: 'Teacher Fixture', phone: '0300', class_id: 21, login_id: 'T001' }],
      '/api/students': [],
      '/api/classes': [{ id: 21, name: 'Grade', section: 'One' }],
      '/api/fee-management/bootstrap': {
        students: [
          { id: 31, name: 'Student Fixture', rollNo: 'S001', admissionNumber: 'S001', classId: 21, className: 'Grade One', branchId: null, branchName: null, admissionDate: '2025-01-01', frozen: false },
          { id: 32, name: 'Second Student', rollNo: 'S002', admissionNumber: 'S002', classId: 21, className: 'Grade One', branchId: null, branchName: null, admissionDate: '2025-01-01', frozen: false }
        ],
        classes: [{ id: 21, name: 'Grade', section: 'One', label: 'Grade One' }],
        items: [], categories: ['tuition', 'admission', 'other'], frequencies: ['monthly']
      },
      '/api/fee-management/obligations': OBLIGATIONS,
      '/api/fee-management/summary': { assigned: '3600.00', collected: '200.00', outstanding: '1600.00', overdue: '0.00', studentsWithDues: 2 },
      '/api/fee-management/payments': []
    };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(responses[pathname] ?? []) });
  });

  await page.goto(`${baseUrl}/admin.html#tab-fees`);
  await page.waitForFunction(() => window.appData?.bootstrapLoaded);
  await page.locator('#feeSubTabBtn-collect').click();

  const wrap = page.locator('#feeCollectTableWrap');
  await expect(wrap.locator('tbody tr')).toHaveCount(2, { timeout: 10000 });
  await expect(wrap).toContainText('Student Fixture');
  await expect(wrap).toContainText('Second Student');

  // Search filter narrows to one student.
  await page.locator('#feeCollectSearch').fill('Second');
  await expect(wrap.locator('tbody tr')).toHaveCount(1);
  await expect(wrap).toContainText('Second Student');

  // Category filter injected into the filter row.
  await page.locator('#feeCollectSearch').fill('');
  await page.locator('#feeCollectCategoryFilter').selectOption('tuition');
  await expect(wrap.locator('tbody tr')).toHaveCount(2);

  // Pending tab renders obligation rows.
  await page.locator('#feeSubTabBtn-pending').click();
  await expect(page.locator('#feePendingTableWrap tbody tr')).toHaveCount(2, { timeout: 10000 });
  await expect(page.locator('#feePendingTableWrap')).toContainText('Tuition Fee');

  // Config tab renders (empty state, no crash).
  await page.locator('#feeSubTabBtn-config').click();
  await expect(page.locator('#feeSubTab-config')).toBeVisible();

  const fatal = consoleErrors.filter(e => !/favicon|net::|Failed to load resource/.test(e));
  expect(fatal).toEqual([]);
});
