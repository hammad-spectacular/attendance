const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://localhost:3333';

test('Coordinator navigation uses one mobile menu and restores the desktop row', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'mock_token');
  });
  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    const body = pathname === '/api/coordinator/me'
      ? { profile: { name: 'Test Coordinator' }, classes: [] }
      : pathname === '/api/attendance/today'
        ? { today: '2026-11-03' }
        : [];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body)
    });
  });

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${BASE_URL}/coordinator.html`);

  const header = page.locator('.header');
  const toggle = page.locator('#headerMenuToggle');
  const menu = page.locator('#headerMenuPanel');
  const tabNav = page.locator('#tabNav');
  const sectionLinks = page.locator('#tabNavInner > .tab-btn');

  await expect(toggle).toBeVisible();
  await expect(page.locator('.header-icon-mobile')).toBeVisible();
  await expect(page.locator('.header-icon-desktop')).toBeHidden();
  await expect(tabNav).toBeHidden();
  await expect(page.locator('#mobileNavToggle')).toHaveCount(0);
  await expect(menu).toBeHidden();
  expect(await page.locator('#tabNavInner').evaluate(el => el.parentElement.id)).toBe('headerMenuPanel');
  await expect(sectionLinks).toHaveCount(3);
  await expect(sectionLinks.first()).toBeHidden();

  await toggle.click();
  await expect(menu).toBeVisible();
  await expect(sectionLinks.first()).toBeVisible();
  await sectionLinks.filter({ hasText: 'Announcements' }).click();
  await expect(page.locator('#subAnnouncements')).toBeVisible();
  await expect(menu).toBeHidden();

  await toggle.click();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  await toggle.click();
  await page.mouse.click(10, 780);
  await expect(menu).toBeHidden();

  await page.setViewportSize({ width: 768, height: 812 });
  await expect(page.locator('.header-icon-mobile')).toBeVisible();
  await expect(tabNav).toBeHidden();

  await page.setViewportSize({ width: 769, height: 812 });
  await expect(tabNav).toBeVisible();
  expect(await page.locator('#tabNavInner').evaluate(el => el.parentElement.id)).toBe('tabNav');
  await expect(page.locator('.header-icon-mobile')).toBeHidden();
  await expect(page.locator('.header-icon-desktop')).toBeVisible();
  expect(await page.locator('#tabNavInner').evaluate(el => getComputedStyle(el).flexDirection)).toBe('row');
  expect(await header.evaluate(el => getComputedStyle(el).zIndex)).toBe('60');
  expect(await tabNav.evaluate(el => getComputedStyle(el).boxShadow)).toBe('none');
  expect(pageErrors).toEqual([]);
});
