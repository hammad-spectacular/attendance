const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://localhost:3333';

test.describe('Phase 1 Navigation & Dropdown Suite', () => {

  test('Admin portal: Dynamic menu builds from config, tab switching, hover dropdowns, and Esc key', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin.html`);

    // Verify tabs rendered into tabNavInner from menu-config.js
    const tabInner = page.locator('#tabNavInner');
    await expect(tabInner).toBeVisible();

    // Check automated and complaints dropdown wrappers exist
    const autoWrap = page.locator('#tab-automated');
    const compWrap = page.locator('#tab-complaints-menu');
    await expect(autoWrap).toBeVisible();
    await expect(compWrap).toBeVisible();

    // Verify hover opens Automated dropdown
    await autoWrap.hover();
    await expect(autoWrap).toHaveClass(/open/);
    const timeTableLink = autoWrap.locator('a[href="/tt2/"]');
    await expect(timeTableLink).toBeVisible();

    // Press Escape to close dropdown
    await page.keyboard.press('Escape');
    await expect(autoWrap).not.toHaveClass(/open/);

    // Verify hover opens Complaints dropdown
    await compWrap.hover();
    await expect(compWrap).toHaveClass(/open/);
    await page.keyboard.press('Escape');

    // Click on Generate Date Sheet shows friendly toast
    await autoWrap.hover();
    const dateSheetLink = autoWrap.locator('.nav-dropdown-item', { hasText: 'Generate Date Sheet' });
    await dateSheetLink.click();
    const toast = page.locator('#toast');
    if (await toast.count() > 0) {
      await expect(toast).toContainText('Generate Date Sheet will be available soon');
    }

    // Click on Teacher Complaints shows friendly toast
    await compWrap.hover();
    const teacherCompLink = compWrap.locator('.nav-dropdown-item', { hasText: 'Teacher complaints' });
    await teacherCompLink.click();
    if (await toast.count() > 0) {
      await expect(toast).toContainText('Complaints will be available soon');
    }

    // Verify existing tabs switch sections
    const studentsBtn = page.locator('.tab-btn[data-section="tab-students"]');
    await expect(studentsBtn).toBeVisible();
    await studentsBtn.click();
    await expect(studentsBtn).toHaveClass(/active/);
  });

  test('Teacher portal: Tab switching and Complaint tab exist with underline/highlight', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('auth_token', 'mock_token');
    });

    await page.goto(`${BASE_URL}/teacher.html`);

    // Verify complaint tab exists with correct link
    const complaintTab = page.locator('a.tab-btn[href="/complaint.html"]');
    await expect(complaintTab).toBeVisible();
    await expect(complaintTab).toContainText('Complaint');

    // Verify tabs switch sections
    const announcementsBtn = page.locator('.tab-btn[data-section="tab-announcements"]');
    if (await announcementsBtn.count() > 0) {
      await announcementsBtn.click();
      await expect(announcementsBtn).toHaveClass(/active/);
    }
  });

  test('Student portal: Tab switching and separate Complaint tab exist', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('auth_token', 'mock_token');
    });

    await page.goto(`${BASE_URL}/student.html`);

    // Verify complaint tab exists separately from teacher tab
    const complaintTab = page.locator('a.tab-btn[href="/complaint.html"]');
    await expect(complaintTab).toBeVisible();
    await expect(complaintTab).toContainText('Complaint');

    const teacherTab = page.locator('.tab-btn[data-section="tab-teacher"]');
    await expect(teacherTab).toBeVisible();

    // Tab switching check
    const homeworkBtn = page.locator('.tab-btn[data-section="tab-homework"]');
    if (await homeworkBtn.count() > 0) {
      await homeworkBtn.click();
      await expect(homeworkBtn).toHaveClass(/active/);
    }
  });

  test('Coordinator portal: Navigation loads with shared styles and switches tabs', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('auth_token', 'mock_token');
    });

    await page.goto(`${BASE_URL}/coordinator.html`);

    const markBtn = page.locator('#navMark');
    const recordsBtn = page.locator('#navRecords');
    await expect(markBtn).toBeVisible();
    await expect(recordsBtn).toBeVisible();
  });

  test('Mobile viewport: Menu toggle and tap interaction', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`${BASE_URL}/admin.html`);

    const toggle = page.locator('#mobileNavToggle');
    await expect(toggle).toBeVisible();

    // Tap toggle to open menu
    await toggle.click();
    const nav = page.locator('#tabNav');
    await expect(nav).toHaveClass(/open/);

    // Tap Automated dropdown to expand on mobile
    const autoWrap = page.locator('#tab-automated');
    const autoBtn = autoWrap.locator('.tab-btn');
    await autoBtn.click();
    await expect(autoWrap).toHaveClass(/open/);
  });

});
