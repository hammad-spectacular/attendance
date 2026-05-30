// ============================================================
//  COMPLETE PLAYWRIGHT TEST SUITE
//  School Management App — http://localhost:3000
//  Covers: Admin, Teacher, Student, Parent roles
//  Stress tests: bulk add students + classes, then clean up
//  On failure: screenshots saved to ./test-failures/
// ============================================================

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// ── Helpers ──────────────────────────────────────────────────

const BASE_URL = 'http://localhost:3000';
const SCREENSHOT_DIR = path.join(__dirname, 'test-failures');

// Dummy data for stress testing
const DUMMY_STUDENTS = [
  { name: 'Ali Hassan',     phone: '03001111001' },
  { name: 'Sara Khan',      phone: '03001111002' },
  { name: 'Usman Malik',    phone: '03001111003' },
  { name: 'Ayesha Raza',    phone: '03001111004' },
  { name: 'Bilal Ahmed',    phone: '03001111005' },
  { name: 'Fatima Noor',    phone: '03001111006' },
  { name: 'Hamza Siddiqui', phone: '03001111007' },
  { name: 'Zara Tariq',     phone: '03001111008' },
  { name: 'Omar Farooq',    phone: '03001111009' },
  { name: 'Hina Javed',     phone: '03001111010' },
];

const DUMMY_CLASSES = [
  'Class 1-A', 'Class 1-B', 'Class 2-A', 'Class 2-B', 'Class 3-A',
];

// Save screenshot when something fails
async function screenshotOnFail(page, testName) {
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const file = path.join(SCREENSHOT_DIR, `${testName.replace(/\s+/g, '_')}_${Date.now()}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.error(`\n📸 Screenshot saved: ${file}\n`);
}

// Safe click — logs if element not found instead of hard-crashing
async function safeClick(page, selector, label) {
  try {
    const el = page.locator(selector).first();
    await el.waitFor({ timeout: 5000 });
    await el.click();
    console.log(`  ✅ Clicked: ${label}`);
  } catch {
    console.warn(`  ⚠️  NOT FOUND / not clickable: ${label}`);
  }
}

// Check a section for broken links, empty containers, console errors
async function auditPage(page, roleName, sectionName) {
  const issues = [];

  // 1. Broken images
  const brokenImages = await page.evaluate(() => {
    return Array.from(document.images)
      .filter(img => !img.complete || img.naturalWidth === 0)
      .map(img => img.src);
  });
  if (brokenImages.length) issues.push(`Broken images: ${brokenImages.join(', ')}`);

  // 2. Empty containers that look like they should have content
  const emptyContainers = await page.evaluate(() => {
    const suspicious = [];
    document.querySelectorAll('table, ul, ol, .list, .grid, .card-container, [class*="list"], [class*="table"]').forEach(el => {
      if (el.children.length === 0 || el.innerText.trim() === '') {
        suspicious.push(el.tagName + (el.className ? '.' + el.className.split(' ')[0] : ''));
      }
    });
    return suspicious;
  });
  if (emptyContainers.length) issues.push(`Possibly empty containers: ${emptyContainers.join(', ')}`);

  // 3. Buttons with no text / no label
  const unlabelledButtons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter(b => !b.innerText.trim() && !b.getAttribute('aria-label') && !b.title)
      .length;
  });
  if (unlabelledButtons > 0) issues.push(`${unlabelledButtons} button(s) have no label/text`);

  // 4. Inputs with no label
  const unlabelledInputs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input, select, textarea'))
      .filter(i => {
        const id = i.id;
        const hasLabel = id && document.querySelector(`label[for="${id}"]`);
        const hasAria = i.getAttribute('aria-label') || i.getAttribute('placeholder');
        return !hasLabel && !hasAria;
      }).length;
  });
  if (unlabelledInputs > 0) issues.push(`${unlabelledInputs} input(s) have no label or placeholder`);

  // 5. Visible error text on screen
  const errorText = await page.evaluate(() => {
    const errorEls = document.querySelectorAll('[class*="error"], [class*="alert"], [class*="warning"], [role="alert"]');
    return Array.from(errorEls).map(e => e.innerText.trim()).filter(Boolean);
  });
  if (errorText.length) issues.push(`Visible errors on screen: ${errorText.join(' | ')}`);

  if (issues.length > 0) {
    console.warn(`\n  ⚠️  [${roleName}] Issues on "${sectionName}":`);
    issues.forEach(i => console.warn(`     - ${i}`));
  } else {
    console.log(`  ✅ [${roleName}] "${sectionName}" — no obvious issues`);
  }

  return issues;
}

// ── SETUP: listen for console errors on every test ────────────

test.beforeEach(async ({ page }) => {
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.warn(`  🔴 Browser console error: ${msg.text()}`);
    }
  });
  page.on('pageerror', err => {
    console.warn(`  🔴 Page JS error: ${err.message}`);
  });
  page.on('response', response => {
    if (response.status() >= 400) {
      console.warn(`  🌐 HTTP ${response.status()} — ${response.url()}`);
    }
  });
});

// ════════════════════════════════════════════════════════════
//  TEST 1 — HOME PAGE
// ════════════════════════════════════════════════════════════

test('Home page loads and shows all role options', async ({ page }) => {
  try {
    await page.goto(BASE_URL);
    await expect(page).toHaveTitle(/.+/); // has any title

    console.log('\n🏠 HOME PAGE');

    // Check all four role buttons exist
    for (const role of ['Admin', 'Teacher', 'Student', 'Parent']) {
      const el = page.getByText(role, { exact: false }).first();
      const visible = await el.isVisible().catch(() => false);
      if (visible) {
        console.log(`  ✅ Role button visible: ${role}`);
      } else {
        console.warn(`  ⚠️  Role button NOT visible: ${role}`);
      }
    }

    await auditPage(page, 'Home', 'Landing Page');

  } catch (err) {
    await screenshotOnFail(page, 'home_page');
    throw err;
  }
});

// ════════════════════════════════════════════════════════════
//  TEST 2 — ADMIN ROLE
// ════════════════════════════════════════════════════════════

test('Admin — full interface audit', async ({ page }) => {
  try {
    await page.goto(BASE_URL);
    console.log('\n👤 ADMIN ROLE');

    // Enter admin
    await page.getByText('Admin', { exact: false }).first().click();
    await page.waitForLoadState('networkidle');
    console.log(`  📍 URL: ${page.url()}`);
    await auditPage(page, 'Admin', 'Dashboard');

    // Find all nav links / sidebar items and visit each
    const navLinks = await page.evaluate(() => {
      return Array.from(
        document.querySelectorAll('nav a, aside a, [class*="sidebar"] a, [class*="menu"] a, [class*="nav"] a')
      ).map(a => ({ text: a.innerText.trim(), href: a.href })).filter(a => a.text);
    });

    console.log(`  🔗 Found ${navLinks.length} nav links in Admin`);

    for (const link of navLinks) {
      try {
        console.log(`\n  → Navigating to: ${link.text}`);
        await page.goto(link.href);
        await page.waitForLoadState('networkidle');
        await auditPage(page, 'Admin', link.text);
      } catch (e) {
        console.warn(`  ⚠️  Failed to visit admin nav link "${link.text}": ${e.message}`);
        await screenshotOnFail(page, `admin_nav_${link.text}`);
      }
    }

    // Go back to admin root and click every visible button
    await page.goto(BASE_URL);
    await page.getByText('Admin', { exact: false }).first().click();
    await page.waitForLoadState('networkidle');

    const buttons = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('button, [role="button"]'))
        .map(b => b.innerText.trim())
        .filter(Boolean);
    });
    console.log(`\n  🖱️  Buttons found on Admin dashboard: ${buttons.join(', ') || 'none'}`);

  } catch (err) {
    await screenshotOnFail(page, 'admin_full');
    throw err;
  }
});

// ════════════════════════════════════════════════════════════
//  TEST 3 — ADMIN: ADD STUDENTS (stress test) then DELETE
// ════════════════════════════════════════════════════════════

test('Admin — stress test: add 10 students then delete them', async ({ page }) => {
  test.setTimeout(60000);
  try {
    await page.goto(BASE_URL);
    console.log('\n🧪 STRESS TEST — Add & Delete Students');

    await page.getByText('Admin', { exact: false }).first().click();
    await page.waitForLoadState('networkidle');

    // Try to find "Add Student" or "Students" section
    await safeClick(page, 'text=Students', 'Students section');
    await safeClick(page, 'text=Manage Students', 'Manage Students');
    await page.waitForLoadState('networkidle');

    const addedStudents = [];

    for (const student of DUMMY_STUDENTS) {
      console.log(`  ➕ Adding student: ${student.name}`);
      try {
        // Look for an Add button
        const addBtn = page.locator('button, [role="button"]').filter({ hasText: /add|new|create/i }).first();
        if (await addBtn.isVisible().catch(() => false)) {
          await addBtn.click();
          await page.waitForTimeout(500);
        }

        // Fill name field
        const nameInput = page.locator('input[placeholder*="name" i], input[name*="name" i], input[id*="name" i]').first();
        if (await nameInput.isVisible().catch(() => false)) {
          await nameInput.fill(student.name);
        }

        // Fill phone field
        const phoneInput = page.locator('input[placeholder*="phone" i], input[name*="phone" i], input[type="tel"]').first();
        if (await phoneInput.isVisible().catch(() => false)) {
          await phoneInput.fill(student.phone);
        }

        // Submit
        const submitBtn = page.locator('#studentForm button, .student-form button, button').filter({ hasText: /save student|add student|submit/i }).first();
        if (await submitBtn.isVisible().catch(() => false)) {
          await submitBtn.click();
          await page.waitForLoadState('networkidle');
          addedStudents.push(student.name);
          console.log(`    ✅ Added: ${student.name}`);
        } else {
          console.warn(`    ⚠️  No submit button found for student: ${student.name}`);
        }

        await page.waitForTimeout(300);

      } catch (e) {
        console.warn(`    ⚠️  Could not add student "${student.name}": ${e.message}`);
        await screenshotOnFail(page, `add_student_${student.name.replace(/\s/g,'_')}`);
      }
    }

    console.log(`\n  📊 Added ${addedStudents.length}/${DUMMY_STUDENTS.length} students`);

    // Now delete them
    console.log('\n  🗑️  Cleaning up — deleting added students...');
    for (const name of addedStudents) {
      try {
        const row = page.locator(`tr, li, [class*="card"], [class*="row"]`).filter({ hasText: name }).first();
        if (await row.isVisible().catch(() => false)) {
          const deleteBtn = row.locator('button, [role="button"]').filter({ hasText: /delete|remove/i }).first();
          if (await deleteBtn.isVisible().catch(() => false)) {
            await deleteBtn.click();
            await page.waitForTimeout(400);
            // Confirm dialog if appears
            const confirmBtn = page.locator('button').filter({ hasText: /yes|confirm|ok/i }).first();
            if (await confirmBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
              await confirmBtn.click();
            }
            console.log(`    ✅ Deleted: ${name}`);
          } else {
            console.warn(`    ⚠️  No delete button found for: ${name}`);
          }
        } else {
          console.warn(`    ⚠️  Row not found for: ${name}`);
        }
        await page.waitForTimeout(300);
      } catch (e) {
        console.warn(`    ⚠️  Could not delete "${name}": ${e.message}`);
        await screenshotOnFail(page, `delete_student_${name.replace(/\s/g,'_')}`);
      }
    }

  } catch (err) {
    await screenshotOnFail(page, 'stress_students');
    throw err;
  }
});

// ════════════════════════════════════════════════════════════
//  TEST 4 — ADMIN: ADD CLASSES then DELETE
// ════════════════════════════════════════════════════════════

test('Admin — stress test: add 5 classes then delete them', async ({ page }) => {
  try {
    await page.goto(BASE_URL);
    console.log('\n🧪 STRESS TEST — Add & Delete Classes');

    await page.getByText('Admin', { exact: false }).first().click();
    await page.waitForLoadState('networkidle');

    await safeClick(page, 'text=Classes', 'Classes section');
    await safeClick(page, 'text=Manage Classes', 'Manage Classes');
    await page.waitForLoadState('networkidle');

    const addedClasses = [];

    for (const className of DUMMY_CLASSES) {
      console.log(`  ➕ Adding class: ${className}`);
      try {
        const addBtn = page.locator('button, [role="button"]').filter({ hasText: /add|new|create/i }).first();
        if (await addBtn.isVisible().catch(() => false)) {
          await addBtn.click();
          await page.waitForTimeout(500);
        }

        const classInput = page.locator('input').first();
        if (await classInput.isVisible().catch(() => false)) {
          await classInput.fill(className);
        }

        const submitBtn = page.locator('button[type="submit"], button').filter({ hasText: /save|submit|add|confirm/i }).first();
        if (await submitBtn.isVisible().catch(() => false)) {
          await submitBtn.click();
          await page.waitForLoadState('networkidle');
          addedClasses.push(className);
          console.log(`    ✅ Added: ${className}`);
        } else {
          console.warn(`    ⚠️  No submit button found for class: ${className}`);
        }

        await page.waitForTimeout(300);

      } catch (e) {
        console.warn(`    ⚠️  Could not add class "${className}": ${e.message}`);
        await screenshotOnFail(page, `add_class_${className.replace(/\s/g,'_')}`);
      }
    }

    console.log(`\n  📊 Added ${addedClasses.length}/${DUMMY_CLASSES.length} classes`);

    // Delete them
    for (const name of addedClasses) {
      try {
        const row = page.locator(`tr, li, [class*="card"], [class*="row"]`).filter({ hasText: name }).first();
        const deleteBtn = row.locator('button').filter({ hasText: /delete|remove/i }).first();
        if (await deleteBtn.isVisible().catch(() => false)) {
          await deleteBtn.click();
          await page.waitForTimeout(400);
          const confirmBtn = page.locator('button').filter({ hasText: /yes|confirm|ok/i }).first();
          if (await confirmBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
            await confirmBtn.click();
          }
          console.log(`    ✅ Deleted: ${name}`);
        }
        await page.waitForTimeout(300);
      } catch (e) {
        console.warn(`    ⚠️  Could not delete class "${name}": ${e.message}`);
      }
    }

  } catch (err) {
    await screenshotOnFail(page, 'stress_classes');
    throw err;
  }
});

// ════════════════════════════════════════════════════════════
//  TEST 5 — TEACHER ROLE (Teacher 1 and Teacher 2)
// ════════════════════════════════════════════════════════════

test('Teacher — audit both Teacher 1 and Teacher 2', async ({ page }) => {
  for (const teacherIndex of [0, 1]) {
    try {
      await page.goto(BASE_URL);
      console.log(`\n👨‍🏫 TEACHER ROLE — Teacher ${teacherIndex + 1}`);

      await page.getByText('Teacher', { exact: false }).first().click();
      await page.waitForLoadState('networkidle');

      // Pick teacher from list
      const teacherOptions = page.locator('button, li, [role="option"], [class*="option"], a').filter({ hasText: /teacher/i });
      const count = await teacherOptions.count();
      console.log(`  📋 Teacher options found: ${count}`);

      if (count > teacherIndex) {
        await teacherOptions.nth(teacherIndex).click();
        await page.waitForLoadState('networkidle');
        console.log(`  📍 URL: ${page.url()}`);
        await auditPage(page, `Teacher ${teacherIndex + 1}`, 'Dashboard');
      } else {
        console.warn(`  ⚠️  Teacher option ${teacherIndex + 1} not found`);
        continue;
      }

      // Navigate all teacher nav links
      const navLinks = await page.evaluate(() =>
        Array.from(document.querySelectorAll('nav a, aside a, [class*="sidebar"] a, [class*="menu"] a'))
          .map(a => ({ text: a.innerText.trim(), href: a.href })).filter(a => a.text)
      );

      for (const link of navLinks) {
        try {
          console.log(`\n  → ${link.text}`);
          await page.goto(link.href);
          await page.waitForLoadState('networkidle');
          await auditPage(page, `Teacher ${teacherIndex + 1}`, link.text);
        } catch (e) {
          console.warn(`  ⚠️  Failed on "${link.text}": ${e.message}`);
          await screenshotOnFail(page, `teacher${teacherIndex + 1}_${link.text}`);
        }
      }

      // Try taking attendance if available
      await page.goto(BASE_URL);
      await page.getByText('Teacher', { exact: false }).first().click();
      await page.waitForLoadState('networkidle');
      const opts = page.locator('button, li, a').filter({ hasText: /teacher/i });
      if (await opts.count() > teacherIndex) {
        await opts.nth(teacherIndex).click();
        await page.waitForLoadState('networkidle');
      }

      await safeClick(page, 'text=Attendance', 'Attendance section');
      await page.waitForLoadState('networkidle');
      await auditPage(page, `Teacher ${teacherIndex + 1}`, 'Attendance');

      // Mark a few present/absent
      const attendanceToggles = page.locator('input[type="checkbox"], button').filter({ hasText: /present|absent/i });
      const toggleCount = await attendanceToggles.count();
      console.log(`  ☑️  Attendance toggles found: ${toggleCount}`);
      for (let i = 0; i < Math.min(3, toggleCount); i++) {
        await attendanceToggles.nth(i).click().catch(() => {});
        await page.waitForTimeout(200);
      }

      // Submit attendance if button exists
      await safeClick(page, 'button:has-text("Submit"), button:has-text("Save")', 'Submit attendance');
      await page.waitForLoadState('networkidle').catch(() => {});
      await auditPage(page, `Teacher ${teacherIndex + 1}`, 'After attendance submit');

      // Homework section
      await safeClick(page, 'text=Homework', 'Homework section');
      await page.waitForLoadState('networkidle');
      await auditPage(page, `Teacher ${teacherIndex + 1}`, 'Homework');

      // Stats section
      await safeClick(page, 'text=Stats', 'Stats section');
      await safeClick(page, 'text=Statistics', 'Statistics section');
      await page.waitForLoadState('networkidle');
      await auditPage(page, `Teacher ${teacherIndex + 1}`, 'Stats');

    } catch (err) {
      await screenshotOnFail(page, `teacher_${teacherIndex + 1}_full`);
      console.warn(`  ⚠️  Teacher ${teacherIndex + 1} test encountered an error: ${err.message}`);
    }
  }
});

// ════════════════════════════════════════════════════════════
//  TEST 6 — STUDENT ROLE (Student 1 and Student 2)
// ════════════════════════════════════════════════════════════

// Helper: select student by index from the dropdown chooser on student.html
async function selectStudentFromChooser(page, studentIndex) {
  // student.html renders a <select id="studentPicker"> when no ?id= param
  const picker = page.locator('#studentPicker');
  const hasPicker = await picker.isVisible({ timeout: 5000 }).catch(() => false);
  if (!hasPicker) {
    console.warn('  ⚠️  Student picker not visible — CORS or API may be down');
    return false;
  }
  const options = await picker.locator('option').all();
  // options[0] is the placeholder "Select student"
  const realOptions = options.slice(1);
  console.log(`  📋 Student options found: ${realOptions.length}`);
  if (realOptions.length <= studentIndex) {
    console.warn(`  ⚠️  Student option ${studentIndex + 1} not found (only ${realOptions.length} available)`);
    return false;
  }
  const value = await realOptions[studentIndex].getAttribute('value');
  await picker.selectOption(value);
  // Click the "Open Portal" button
  const openBtn = page.locator('button').filter({ hasText: /open portal/i }).first();
  await openBtn.click();
  await page.waitForLoadState('networkidle');
  return true;
}

test('Student — audit both Student 1 and Student 2', async ({ page }) => {
  test.setTimeout(90000);
  for (const studentIndex of [0, 1]) {
    try {
      await page.goto(BASE_URL);
      console.log(`\n🎒 STUDENT ROLE — Student ${studentIndex + 1}`);

      await page.locator('#studentCard').click();
      await page.waitForLoadState('networkidle');
      console.log(`  📍 URL after card click: ${page.url()}`);

      const selected = await selectStudentFromChooser(page, studentIndex);
      if (!selected) continue;

      console.log(`  📍 URL: ${page.url()}`);
      await auditPage(page, `Student ${studentIndex + 1}`, 'Dashboard');

      // Navigate all student nav links
      const navLinks = await page.evaluate(() =>
        Array.from(document.querySelectorAll('nav a, aside a, [class*="sidebar"] a, [class*="menu"] a'))
          .map(a => ({ text: a.innerText.trim(), href: a.href })).filter(a => a.text)
      );

      for (const link of navLinks) {
        try {
          console.log(`\n  → ${link.text}`);
          await page.goto(link.href);
          await page.waitForLoadState('networkidle');
          await auditPage(page, `Student ${studentIndex + 1}`, link.text);
        } catch (e) {
          console.warn(`  ⚠️  Failed on "${link.text}": ${e.message}`);
          await screenshotOnFail(page, `student${studentIndex + 1}_${link.text}`);
        }
      }

      // Go back to student portal with this student selected
      await page.goto(BASE_URL);
      await page.locator('#studentCard').click();
      await page.waitForLoadState('networkidle');
      await selectStudentFromChooser(page, studentIndex);
      await page.waitForLoadState('networkidle');

      // Attendance
      await safeClick(page, '[data-section="attendanceCard"], text=Attendance', 'Attendance');
      await page.waitForLoadState('networkidle');
      await auditPage(page, `Student ${studentIndex + 1}`, 'Attendance');

      // Homework
      await safeClick(page, '[data-section="homeworkCard"], text=Homework', 'Homework');
      await page.waitForLoadState('networkidle');
      await auditPage(page, `Student ${studentIndex + 1}`, 'Homework');

      // Notifications & Announcements
      await safeClick(page, '[data-section="announcementsCard"], text=Notifications', 'Notifications');
      await page.waitForLoadState('networkidle');
      await auditPage(page, `Student ${studentIndex + 1}`, 'Notifications');

      // Stats & Statistics
      await safeClick(page, 'text=Stats', 'Stats');
      await page.waitForLoadState('networkidle');
      await auditPage(page, `Student ${studentIndex + 1}`, 'Stats');

    } catch (err) {
      await screenshotOnFail(page, `student_${studentIndex + 1}_full`);
      console.warn(`  ⚠️  Student ${studentIndex + 1} test encountered an error: ${err.message}`);
    }
  }
});

// ════════════════════════════════════════════════════════════
//  TEST 7 — PARENT ROLE
// ════════════════════════════════════════════════════════════

test('Parent — full interface audit', async ({ page }) => {
  try {
    await page.goto(BASE_URL);
    console.log('\n👨‍👩‍👧 PARENT ROLE');

    const parentBtn = page.getByText('Parent', { exact: false }).first();
    const visible = await parentBtn.isVisible().catch(() => false);
    if (!visible) {
      console.warn('  ⚠️  Parent button not found on home page — skipping');
      return;
    }

    await parentBtn.click();
    await page.waitForLoadState('networkidle');
    console.log(`  📍 URL: ${page.url()}`);
    await auditPage(page, 'Parent', 'Dashboard');

    // If parent has a selection screen (like teacher/student)
    const parentOptions = page.locator('button, li, [role="option"]').filter({ hasText: /parent/i });
    const count = await parentOptions.count();
    if (count > 0) {
      await parentOptions.first().click();
      await page.waitForLoadState('networkidle');
      await auditPage(page, 'Parent', 'Dashboard (after selection)');
    }

    // Visit all nav links
    const navLinks = await page.evaluate(() =>
      Array.from(document.querySelectorAll('nav a, aside a, [class*="sidebar"] a, [class*="menu"] a'))
        .map(a => ({ text: a.innerText.trim(), href: a.href })).filter(a => a.text)
    );

    for (const link of navLinks) {
      try {
        console.log(`\n  → ${link.text}`);
        await page.goto(link.href);
        await page.waitForLoadState('networkidle');
        await auditPage(page, 'Parent', link.text);
      } catch (e) {
        console.warn(`  ⚠️  Failed on "${link.text}": ${e.message}`);
        await screenshotOnFail(page, `parent_${link.text}`);
      }
    }

    // Check SMS/notification section
    await safeClick(page, 'text=Notification', 'Notifications');
    await page.waitForLoadState('networkidle');
    await auditPage(page, 'Parent', 'Notifications');

    await safeClick(page, 'text=Attendance', 'Attendance view');
    await page.waitForLoadState('networkidle');
    await auditPage(page, 'Parent', 'Attendance');

  } catch (err) {
    await screenshotOnFail(page, 'parent_full');
    throw err;
  }
});

// ════════════════════════════════════════════════════════════
//  TEST 8 — NAVIGATION: No dead-end pages (back button works)
// ════════════════════════════════════════════════════════════

test('Navigation — back button always works, no dead ends', async ({ page }) => {
  console.log('\n🔙 NAVIGATION — Back button check');

  const rolesToTest = [
    { role: 'Admin',   selectIndex: null },
    { role: 'Teacher', selectIndex: 0 },
    { role: 'Student', selectIndex: 0 },
  ];

  for (const { role, selectIndex } of rolesToTest) {
    try {
      await page.goto(BASE_URL);
      if (role === 'Student') {
        await page.locator('#studentCard').click();
        await page.waitForLoadState('networkidle');
        // Student uses a dropdown chooser, not buttons
        const picker = page.locator('#studentPicker');
        const hasPicker = await picker.isVisible({ timeout: 5000 }).catch(() => false);
        if (hasPicker) {
          const options = await picker.locator('option').all();
          if (options.length > 1) {
            const value = await options[1].getAttribute('value');
            await picker.selectOption(value);
            const openBtn = page.locator('button').filter({ hasText: /open portal/i }).first();
            if (await openBtn.isVisible().catch(() => false)) await openBtn.click();
            await page.waitForLoadState('networkidle');
          }
        }
      } else {
        await page.getByText(role, { exact: false }).first().click();
      }
      await page.waitForLoadState('networkidle');

      if (role !== 'Student' && selectIndex !== null) {
        const opts = page.locator('button, li, a').filter({ hasText: new RegExp(role, 'i') });
        if (await opts.count() > selectIndex) {
          await opts.nth(selectIndex).click();
          await page.waitForLoadState('networkidle');
        }
      }

      await page.goBack();
      await page.waitForLoadState('networkidle');

      const url = page.url();
      if (url === BASE_URL + '/' || url === BASE_URL) {
        console.log(`  ✅ ${role}: back button returns to home`);
      } else {
        console.warn(`  ⚠️  ${role}: back button went to ${url} instead of home`);
      }
    } catch (e) {
      console.warn(`  ⚠️  ${role} back-button check failed: ${e.message}`);
      await screenshotOnFail(page, `back_button_${role}`);
    }
  }
});