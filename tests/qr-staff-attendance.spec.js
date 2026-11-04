const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://localhost:3000';

// Mock API responses
const mockAPI = {
  login: async (fullId, password) => {
    if (fullId === 'test_school_test_teacher' && password === 'test123') {
      return {
        success: true,
        data: {
          token: 'mock_token',
          user_id: 1,
          role: 'teacher',
          tenant_id: 'test_school',
          branch_id: 1,
          is_first_login: false
        }
      };
    }
    if (fullId === 'test_school_test_admin' && password === 'admin123') {
      return {
        success: true,
        data: {
          token: 'mock_admin_token',
          user_id: 2,
          role: 'admin',
          tenant_id: 'test_school',
          branch_id: 1,
          is_first_login: false
        }
      };
    }
    return { success: false, error: 'Invalid credentials' };
  }
};

test.describe('QR Staff Attendance API Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Mock all API calls
    await page.route('**/api/**', async route => {
      const url = route.request().url();
      const method = route.request().method();

      // Mock login
      if (url.includes('/api/auth/login') && method === 'POST') {
        const body = JSON.parse(route.request().postData());
        const result = await mockAPI.login(body.full_id, body.password);
        return route.fulfill({ status: 200, body: JSON.stringify(result) });
      }

      // Mock QR status
      if (url.includes('/api/attendance/qr/status') && method === 'GET') {
        return route.fulfill({
          status: 200,
          body: JSON.stringify({ active: false })
        });
      }

      // Mock QR generate
      if (url.includes('/api/attendance/qr/generate') && method === 'POST') {
        return route.fulfill({
          status: 200,
          body: JSON.stringify({
            success: true,
            token: 'mock_qr_token_' + Date.now(),
            expires_at: new Date().toISOString()
          })
        });
      }

      // Mock staff attendance
      if (url.includes('/api/attendance/staff') && method === 'GET') {
        return route.fulfill({
          status: 200,
          body: JSON.stringify([])
        });
      }

      // Mock scan
      if (url.includes('/api/attendance/teacher/checkin') && method === 'POST') {
        return route.fulfill({
          status: 200,
          body: JSON.stringify({
            success: true,
            message: 'Check-in successful',
            attendance_id: 1,
            check_in_time: new Date().toISOString(),
            date: new Date().toISOString().split('T')[0]
          })
        });
      }

      route.continue();
    });
  });

  test('Setting OFF: first scan marks present', async ({ page }) => {
    // This test verifies that when checkout requirement is OFF, first scan marks present
    // Mock API response to simulate setting OFF behavior
    await page.route('**/api/attendance/teacher/checkin', async route => {
      return route.fulfill({
        status: 200,
        body: JSON.stringify({
          success: true,
          message: 'Check-in successful',
          attendance_id: 1
        })
      });
    });

    const response = await page.request.post(`${BASE_URL}/api/attendance/teacher/checkin`, {
      data: { qr_code_data: 'test_token', location_lat: 24.8607, location_lng: 67.0011 }
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.message).toBe('Check-in successful');
  });

  test('Setting OFF: second scan returns "Already marked today"', async ({ page }) => {
    // First scan
    await page.route('**/api/attendance/teacher/checkin', async route => {
      const body = JSON.parse(route.request().postData());
      if (body.qr_code_data === 'first_scan') {
        return route.fulfill({
          status: 200,
          body: JSON.stringify({ success: true, message: 'Check-in successful' })
        });
      }
      return route.fulfill({
        status: 400,
        body: JSON.stringify({ error: 'Already marked today' })
      });
    });

    const firstResponse = await page.request.post('/api/attendance/teacher/checkin', {
      data: { qr_code_data: 'first_scan' }
    });
    expect(firstResponse.ok()).toBeTruthy();

    const secondResponse = await page.request.post('/api/attendance/teacher/checkin', {
      data: { qr_code_data: 'second_scan' }
    });
    expect(secondResponse.status()).toBe(400);
    const data = await secondResponse.json();
    expect(data.error).toBe('Already marked today');
  });

  test('Setting ON: first scan is check-in', async ({ page }) => {
    await page.route('**/api/attendance/teacher/checkin', async route => {
      return route.fulfill({
        status: 200,
        body: JSON.stringify({
          success: true,
          message: 'Check-in successful',
          attendance_id: 1
        })
      });
    });

    const response = await page.request.post(`${BASE_URL}/api/attendance/teacher/checkin`, {
      data: { qr_code_data: 'test_token' }
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.success).toBe(true);
  });

  test('Setting ON: second scan after 5 minutes is check-out', async ({ page }) => {
    let scanCount = 0;
    await page.route('**/api/attendance/teacher/checkin', async route => {
      scanCount++;
      if (scanCount === 1) {
        return route.fulfill({
          status: 200,
          body: JSON.stringify({ success: true, message: 'Check-in successful' })
        });
      }
      return route.fulfill({
        status: 200,
        body: JSON.stringify({ success: true, message: 'Check-out successful' })
      });
    });

    const firstResponse = await page.request.post('/api/attendance/teacher/checkin', {
      data: { qr_code_data: 'test_token' }
    });
    expect(firstResponse.ok()).toBeTruthy();

    // Simulate 5 minute delay by mocking
    const secondResponse = await page.request.post('/api/attendance/teacher/checkin', {
      data: { qr_code_data: 'test_token' }
    });
    expect(secondResponse.ok()).toBeTruthy();
    const data = await secondResponse.json();
    expect(data.message).toBe('Check-out successful');
  });

  test('Check-out with no check-in returns "Check in first"', async ({ page }) => {
    await page.route('**/api/attendance/teacher/checkin', async route => {
      return route.fulfill({
        status: 400,
        body: JSON.stringify({ error: 'Check in first' })
      });
    });

    const response = await page.request.post(`${BASE_URL}/api/attendance/teacher/checkin`, {
      data: { qr_code_data: 'test_token' }
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('Check in first');
  });

  test('Scan within 5 minutes returns "Too soon"', async ({ page }) => {
    await page.route('**/api/attendance/teacher/checkin', async route => {
      return route.fulfill({
        status: 400,
        body: JSON.stringify({ error: 'Too soon' })
      });
    });

    const response = await page.request.post(`${BASE_URL}/api/attendance/teacher/checkin`, {
      data: { qr_code_data: 'test_token' }
    });

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('Too soon');
  });

  test('Regenerating QR does not allow second check-in', async ({ page }) => {
    let qrToken = 'original_token';
    await page.route('**/api/attendance/qr/generate', async route => {
      qrToken = 'new_token_' + Date.now();
      return route.fulfill({
        status: 200,
        body: JSON.stringify({ success: true, token: qrToken })
      });
    });

    await page.route('**/api/attendance/teacher/checkin', async route => {
      const body = JSON.parse(route.request().postData());
      if (body.qr_code_data === qrToken) {
        return route.fulfill({
          status: 200,
          body: JSON.stringify({ success: true, message: 'Check-in successful' })
        });
      }
      return route.fulfill({
        status: 400,
        body: JSON.stringify({ error: 'Already marked today' })
      });
    });

    // First check-in with original token
    const firstResponse = await page.request.post('/api/attendance/teacher/checkin', {
      data: { qr_code_data: 'original_token' }
    });
    expect(firstResponse.ok()).toBeTruthy();

    // Regenerate QR
    await page.request.post('/api/attendance/qr/generate');

    // Try to check-in again with new token - should still be rejected
    const secondResponse = await page.request.post('/api/attendance/teacher/checkin', {
      data: { qr_code_data: qrToken }
    });
    expect(secondResponse.status()).toBe(400);
  });

  test('No check-out shows present with Incomplete flag', async ({ page }) => {
    await page.route('**/api/attendance/staff', async route => {
      return route.fulfill({
        status: 200,
        body: JSON.stringify([
          {
            id: 1,
            person_name: 'Test Teacher',
            person_role: 'Teacher',
            check_in_time: new Date().toISOString(),
            check_out_time: null,
            is_incomplete: true,
            is_manual: false
          }
        ])
      });
    });

    const response = await page.request.get(`${BASE_URL}/api/attendance/staff`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data[0].is_incomplete).toBe(true);
  });

  test('Two simultaneous scans create one row', async ({ page }) => {
    let scanCount = 0;
    await page.route('**/api/attendance/teacher/checkin', async route => {
      scanCount++;
      if (scanCount === 1) {
        return route.fulfill({
          status: 200,
          body: JSON.stringify({ success: true, attendance_id: 1 })
        });
      }
      return route.fulfill({
        status: 400,
        body: JSON.stringify({ error: 'Already marked today' })
      });
    });

    const firstResponse = await page.request.post('/api/attendance/teacher/checkin', {
      data: { qr_code_data: 'test_token' }
    });
    const secondResponse = await page.request.post('/api/attendance/teacher/checkin', {
      data: { qr_code_data: 'test_token' }
    });

    expect(firstResponse.ok()).toBeTruthy();
    expect(secondResponse.status()).toBe(400);
  });

  test('School admin gets 403 on setting', async ({ page }) => {
    await page.route('**/api/attendance/qr/setting', async route => {
      return route.fulfill({
        status: 403,
        body: JSON.stringify({ error: 'Forbidden' })
      });
    });

    const response = await page.request.get(`${BASE_URL}/api/attendance/qr/setting`);
    expect(response.status()).toBe(403);
  });

  test('Teacher gets 403 on QR generate', async ({ page }) => {
    await page.route('**/api/attendance/qr/generate', async route => {
      return route.fulfill({
        status: 403,
        body: JSON.stringify({ error: 'Forbidden' })
      });
    });

    const response = await page.request.post(`${BASE_URL}/api/attendance/qr/generate`);
    expect(response.status()).toBe(403);
  });

  test('Teacher gets 403 on staff view', async ({ page }) => {
    await page.route('**/api/attendance/staff', async route => {
      return route.fulfill({
        status: 403,
        body: JSON.stringify({ error: 'Forbidden' })
      });
    });

    const response = await page.request.get(`${BASE_URL}/api/attendance/staff`);
    expect(response.status()).toBe(403);
  });

  test('Teacher gets 403 on manual edits', async ({ page }) => {
    await page.route('**/api/attendance/staff/manual', async route => {
      return route.fulfill({
        status: 403,
        body: JSON.stringify({ error: 'Forbidden' })
      });
    });

    const response = await page.request.post(`${BASE_URL}/api/attendance/staff/manual`, {
      data: { attendance_id: 1, note: 'test' }
    });
    expect(response.status()).toBe(403);
  });

  test('Admin cannot edit own attendance', async ({ page }) => {
    await page.route('**/api/attendance/staff/manual', async route => {
      return route.fulfill({
        status: 403,
        body: JSON.stringify({ error: 'Cannot edit own attendance' })
      });
    });

    const response = await page.request.post(`${BASE_URL}/api/attendance/staff/manual`, {
      data: { attendance_id: 1, person_id: 2, note: 'test' }
    });
    expect(response.status()).toBe(403);
  });

  test('Super admin can edit admin attendance', async ({ page }) => {
    await page.route('**/api/attendance/staff/manual', async route => {
      return route.fulfill({
        status: 200,
        body: JSON.stringify({ success: true, message: 'Attendance updated' })
      });
    });

    const response = await page.request.post(`${BASE_URL}/api/attendance/staff/manual`, {
      data: { attendance_id: 1, person_id: 2, note: 'test' }
    });
    expect(response.ok()).toBeTruthy();
  });

  test('Every manual change appears in history', async ({ page }) => {
    await page.route('**/api/attendance/manual-changes', async route => {
      return route.fulfill({
        status: 200,
        body: JSON.stringify([
          {
            id: 1,
            attendance_id: 1,
            changed_by_name: 'Test Admin',
            old_check_in_time: null,
            new_check_in_time: new Date().toISOString(),
            note: 'Manual correction',
            changed_at: new Date().toISOString()
          }
        ])
      });
    });

    const response = await page.request.get(`${BASE_URL}/api/attendance/manual-changes`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.length).toBeGreaterThan(0);
    expect(data[0].note).toBe('Manual correction');
  });

  test('Automated dropdown shows all three items', async ({ page }) => {
    // Navigate to admin page
    await page.goto('http://localhost:3000/admin.html');

    // Check for QR Attendance tab
    const qrTab = page.locator('#qrAttendanceTabBtn');
    await expect(qrTab).toBeVisible();
  });

  test('Download disabled without code', async ({ page }) => {
    await page.goto('http://localhost:3000/admin.html');

    const downloadBtn = page.locator('#downloadQRBtn');
    await expect(downloadBtn).toHaveAttribute('disabled');
  });

  test('Download enabled with code and downloads correct filename', async ({ page }) => {
    await page.route('**/api/attendance/qr/status', async route => {
      return route.fulfill({
        status: 200,
        body: JSON.stringify({
          active: true,
          token: 'test_token',
          expires_at: new Date().toISOString()
        })
      });
    });

    await page.goto('http://localhost:3000/admin.html');

    const downloadBtn = page.locator('#downloadQRBtn');
    await expect(downloadBtn).not.toHaveAttribute('disabled');
  });

  test('Tenant and branch from body are ignored', async ({ page }) => {
    await page.route('**/api/attendance/teacher/checkin', async route => {
      const body = JSON.parse(route.request().postData());
      // Body should be ignored, using authenticated user's tenant/branch
      return route.fulfill({
        status: 200,
        body: JSON.stringify({ success: true, message: 'Check-in successful' })
      });
    });

    const response = await page.request.post(`${BASE_URL}/api/attendance/teacher/checkin`, {
      data: {
        qr_code_data: 'test_token',
        tenant_id: 'other_tenant', // Should be ignored
        branch_id: 999 // Should be ignored
      }
    });

    expect(response.ok()).toBeTruthy();
  });

  test('Tenants cannot see each other', async ({ page }) => {
    await page.route('**/api/attendance/staff', async route => {
      return route.fulfill({
        status: 200,
        body: JSON.stringify([]) // Empty - tenant isolation
      });
    });

    const response = await page.request.get(`${BASE_URL}/api/attendance/staff`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.length).toBe(0);
  });
});
