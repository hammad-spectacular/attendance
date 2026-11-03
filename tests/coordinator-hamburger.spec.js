const { test, expect } = require('@playwright/test');
const path = require('path');

const BASE_URL = 'http://127.0.0.1:3339';
const screenshotDir = process.env.COORDINATOR_NAV_SCREENSHOT_DIR;
const captureLabel = process.env.COORDINATOR_NAV_CAPTURE || 'capture';

async function mockApi(page, role = 'coordinator') {
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'mock-coordinator-nav-token');
  });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    let body = [];

    if (url.pathname === '/api/coordinator/me') {
      body = {
        profile: { name: 'Navigation Test Coordinator', login_id: 'test-coordinator' },
        branch: { name: 'Test Branch', status: 'active' },
        classes: [{ id: 1, name: 'Test Class', section: 'A' }]
      };
    } else if (url.pathname === '/api/attendance/today') {
      body = { today: '2026-11-03' };
    } else if (url.pathname === '/api/students') {
      body = Array.from({ length: 30 }, (_, index) => ({
        id: index + 1,
        name: `Test Student ${index + 1}`,
        roll_no: `${index + 1}`,
        phone: `030000000${String(index + 1).padStart(2, '0')}`
      }));
    } else if (url.pathname === '/api/auth/me') {
      body = { id: 1, role, is_first_login: false, token: 'mock-coordinator-nav-token' };
    } else if (url.pathname === '/api/admin/bootstrap') {
      body = { branches: [], features: [], school: { school_code: 'TEST' } };
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body)
    });
  });
}

async function openCoordinator(page, width, height = 812) {
  await page.setViewportSize({ width, height });
  await mockApi(page, 'coordinator');
  await page.goto(`${BASE_URL}/coordinator.html`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#tabNavInner .tab-btn')).toHaveCount(3);
  await expect(page.locator('.branch-card')).toBeVisible();
}

async function captureCoordinatorState(page, width) {
  const state = await page.evaluate(() => {
    const describe = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        id: element.id,
        tag: element.tagName.toLowerCase(),
        text: element.innerText.trim().replace(/\s+/g, ' ').slice(0, 100),
        className: typeof element.className === 'string' ? element.className : '',
        display: style.display,
        visibility: style.visibility,
        position: style.position,
        zIndex: style.zIndex,
        visible: element.checkVisibility(),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
      };
    };
    const byId = id => document.getElementById(id);
    const menuLike = [
      byId('headerMenuToggle'),
      byId('mobileNavToggle'),
      byId('headerMenuPanel'),
      byId('tabNav'),
      byId('tabNavInner')
    ].filter(Boolean).map(describe);
    const tabs = ['navMark', 'navRecords', 'navAnnouncements']
      .map(id => byId(id))
      .filter(Boolean)
      .map(describe);
    const header = document.querySelector('.header');
    const tabNav = byId('tabNav');
    const headerRect = header.getBoundingClientRect();
    const headerPoint = document.elementFromPoint(
      Math.round(headerRect.left + headerRect.width / 2),
      Math.max(0, Math.round(headerRect.top + headerRect.height / 2))
    );
    return {
      viewport: { width: innerWidth, height: innerHeight },
      scrollY,
      menuLike,
      tabs,
      header: {
        ...describe(header),
        elementAtCenter: headerPoint ? `${headerPoint.tagName.toLowerCase()}${headerPoint.id ? '#' + headerPoint.id : ''}` : null,
        centerHitIsInsideHeader: Boolean(headerPoint && header.contains(headerPoint))
      },
      tabNav: describe(tabNav)
    };
  });
  console.log(`COORDINATOR ${width}px ${state.scrollY ? 'after-scroll' : 'load'}: ${JSON.stringify(state)}`);
  const suffix = `${captureLabel}-${width}-${state.scrollY ? 'scroll' : 'load'}.png`;
  if (screenshotDir) {
    await page.screenshot({ path: path.join(screenshotDir, suffix) });
  }
}

test('Coordinator baseline: capture menu controls and tab visibility at load and after scrolling', async ({ page }) => {
  for (const width of [375, 1440]) {
    await openCoordinator(page, width, 700);
    await captureCoordinatorState(page, width);
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(600);
    await page.waitForTimeout(100);
    await captureCoordinatorState(page, width);
  }
});

test('Coordinator phone menu has one hamburger and closes after navigation, outside click, or Escape', async ({ page }) => {
  await openCoordinator(page, 375);
  const toggle = page.locator('#headerMenuToggle');
  const panel = page.locator('#headerMenuPanel');
  const nav = page.locator('#tabNav');
  const tabs = page.locator('#tabNavInner > .tab-btn');

  await expect(page.locator('#mobileNavToggle')).toHaveCount(0);
  await expect(page.locator('.header-icon-mobile')).toBeVisible();
  await expect(page.locator('.header-icon-desktop')).toBeHidden();
  await expect(toggle).toBeVisible();
  await expect(nav).toBeHidden();
  await expect(panel).toBeHidden();
  await expect(tabs.first()).toBeHidden();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(tabs.first()).toBeVisible();
  await tabs.filter({ hasText: 'Saved records' }).click();
  await expect(page.locator('#subRecords')).toBeVisible();
  await expect(panel).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await toggle.click();
  await page.mouse.click(10, 690);
  await expect(panel).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await toggle.click();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('Coordinator desktop shows three tabs in one row and no hamburger', async ({ page }) => {
  await openCoordinator(page, 1440, 800);
  await expect(page.locator('#mobileNavToggle')).toHaveCount(0);
  await expect(page.locator('.header-icon-mobile')).toBeHidden();
  await expect(page.locator('.header-icon-desktop')).toBeVisible();

  const tabs = page.locator('#tabNavInner > .tab-btn');
  await expect(tabs).toHaveCount(3);
  for (const tab of await tabs.all()) await expect(tab).toBeVisible();
  const tabLayout = await tabs.evaluateAll(items => items.map(item => {
    const rect = item.getBoundingClientRect();
    return { x: Math.round(rect.x), y: Math.round(rect.y) };
  }));
  expect(new Set(tabLayout.map(item => item.y)).size).toBe(1);
});

test('Coordinator header stays above the page while scrolling at phone and laptop widths', async ({ page }) => {
  for (const width of [375, 1440]) {
    await openCoordinator(page, width, 700);
    const before = await page.locator('.header').evaluate(el => ({
      top: el.getBoundingClientRect().top,
      bottom: el.getBoundingClientRect().bottom
    }));
    const firstCardTop = await page.locator('.branch-card').evaluate(el => el.getBoundingClientRect().top);
    expect(firstCardTop).toBeGreaterThanOrEqual(before.bottom);

    await page.evaluate(() => window.scrollTo(0, 600));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(600);
    const after = await page.locator('.header').evaluate(el => ({
      top: el.getBoundingClientRect().top,
      hitInsideHeader: (() => {
        const rect = el.getBoundingClientRect();
        const point = document.elementFromPoint(
          Math.round(rect.left + rect.width / 2),
          Math.max(0, Math.round(rect.top + rect.height / 2))
        );
        return Boolean(point && el.contains(point));
      })()
    }));
    expect(after.top).toBe(before.top);
    expect(after.hitInsideHeader).toBe(true);
  }
});

for (const pageName of ['admin', 'teacher', 'student']) {
  test(`${pageName} mobile section hamburger still opens and closes`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await mockApi(page, pageName);
    await page.goto(`${BASE_URL}/${pageName}.html`, { waitUntil: 'domcontentloaded' });
    const toggle = page.locator('#mobileNavToggle');
    const nav = page.locator('#tabNav');
    const tabs = page.locator('#tabNavInner .tab-btn');

    await expect(toggle).toBeVisible();
    const initialMenuState = await page.evaluate(() => ({
      navClass: document.getElementById('tabNav').className,
      expanded: document.getElementById('mobileNavToggle').getAttribute('aria-expanded'),
      firstTabDisplay: getComputedStyle(document.querySelector('#tabNavInner .tab-btn')).display,
      firstTabVisible: document.querySelector('#tabNavInner .tab-btn').checkVisibility()
    }));
    console.log(`${pageName} mobile menu at load: ${JSON.stringify(initialMenuState)}`);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(nav).toHaveClass(/open/);
    await expect(tabs.first()).toBeVisible();
    await page.mouse.click(10, 790);
    await expect(nav).not.toHaveClass(/open/);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.click();
    await page.keyboard.press('Escape');
    await expect(nav).not.toHaveClass(/open/);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.click();
    await tabs.first().click();
    await expect(nav).not.toHaveClass(/open/);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
}
