const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://127.0.0.1:3339';

async function mockApi(page, role, theme) {
  await page.addInitScript(({ savedRole, savedTheme }) => {
    localStorage.setItem('auth_token', `mock-${savedRole}-mobile-menu-token`);
    localStorage.setItem('attendance-theme', savedTheme);
  }, { savedRole: role, savedTheme: theme });

  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    let body = [];

    if (pathname === '/api/auth/me') {
      body = { id: 1, role, is_first_login: false };
    } else if (pathname === '/api/admin/bootstrap') {
      body = {
        branches: [{ id: 1, name: 'Test Branch', status: 'active' }],
        features: []
      };
    } else if (pathname === '/api/coordinator/me') {
      body = {
        profile: { name: 'Test Coordinator', login_id: 'test-coordinator' },
        branch: { name: 'Test Branch', status: 'active' },
        classes: [{ id: 1, name: 'Test Class', section: 'A' }]
      };
    } else if (pathname === '/api/attendance/today') {
      body = { today: '2026-11-03' };
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body)
    });
  });
}

async function openPortal(page, portal, width, theme = 'dark') {
  await page.setViewportSize({ width, height: 812 });
  await mockApi(page, portal === 'admin' ? 'admin' : 'coordinator', theme);
  await page.goto(`${BASE_URL}/${portal}.html`, { waitUntil: 'domcontentloaded' });

  if (portal === 'admin') {
    await expect(page.locator('#mobileNavToggle')).toBeVisible();
    await expect(page.locator('.tab-btn[data-section="tab-classes"]')).toHaveCount(1);
  } else {
    await expect(page.locator('#headerMenuToggle')).toBeVisible();
    await expect(page.locator('#navRecords')).toHaveCount(1);
  }
}

function contrastRatio(foreground, background) {
  const luminance = color => {
    const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('Admin mobile section menu toggles and closes on selection, outside click, or Escape', async ({ page }) => {
  await openPortal(page, 'admin', 375);
  const nav = page.locator('#tabNav');
  const toggle = page.locator('#mobileNavToggle');
  const menu = page.locator('#tabNavInner');

  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toHaveAttribute('aria-label', 'Open section menu');
  await expect(menu).toBeHidden();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toHaveAttribute('aria-label', 'Close section menu');
  await expect(toggle.locator('.tab-nav-toggle-icon')).toHaveClass(/fa-xmark/);
  await expect(nav).toHaveClass(/open/);
  await expect(menu).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeHidden();

  await toggle.click();
  await page.locator('.header').click({ position: { x: 10, y: 10 } });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await toggle.click();
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await toggle.click();
  await page.locator('.tab-btn[data-section="tab-classes"]').click();
  await expect(page.locator('#tab-classes.tab-content')).toHaveClass(/active/);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeHidden();
});

test('Admin section menu works through the tablet breakpoint and does not stick over content', async ({ page }) => {
  for (const width of [375, 768]) {
    await openPortal(page, 'admin', width);
    const toggle = page.locator('#mobileNavToggle');
    const menu = page.locator('#tabNavInner');

    await expect(toggle).toBeVisible();
    await expect(menu).toBeHidden();
    await expect(page.locator('#tabNav')).toHaveCSS('position', 'relative');

    await toggle.click();
    await expect(menu).toBeVisible();
    await toggle.click();
    await expect(menu).toBeHidden();

    const header = page.locator('.header');
    await page.evaluate(() => {
      document.body.style.minHeight = '2000px';
    });
    await header.evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
    const before = await header.evaluate(element => element.getBoundingClientRect().top);
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(600);
    const after = await header.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(
        Math.round(rect.left + rect.width / 2),
        Math.max(0, Math.round(rect.top + rect.height / 2))
      );
      return { top: rect.top, hitInsideHeader: Boolean(hit && element.contains(hit)) };
    });
    expect(after.top).toBe(before);
    expect(after.hitInsideHeader).toBe(true);
  }
});

test('Admin and coordinator navigation text follows dark and light theme contrast', async ({ page }) => {
  for (const portal of ['admin', 'coordinator']) {
    for (const theme of ['dark', 'light']) {
      await openPortal(page, portal, 375, theme);

      const toggle = page.locator(portal === 'admin' ? '#mobileNavToggle' : '#headerMenuToggle');
      const menu = page.locator(portal === 'admin' ? '#tabNavInner' : '#headerMenuPanel');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(menu).toBeVisible();
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(menu).toBeHidden();
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(menu).toBeVisible();

      const menuText = portal === 'admin'
        ? page.locator('.tab-btn[data-section="tab-classes"]')
        : page.locator('#navRecords');
      const contrast = await menuText.evaluate(element => {
        const color = getComputedStyle(element).color;
        let background = getComputedStyle(element).backgroundColor;
        for (let ancestor = element.parentElement;
          background === 'rgba(0, 0, 0, 0)' && ancestor;
          ancestor = ancestor.parentElement) {
          background = getComputedStyle(ancestor).backgroundColor;
        }
        return { color, background };
      });

      expect(contrastRatio(contrast.color, contrast.background)).toBeGreaterThanOrEqual(4.5);
    }
  }
});
