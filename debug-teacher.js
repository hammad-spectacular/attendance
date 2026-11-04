const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
  await page.goto('file://' + path.resolve(__dirname, 'public', 'teacher.html'));
  const html = await page.locator('#tabNavInner').innerHTML();
  console.log('teacher tabNavInner HTML:', html);
  await browser.close();
})();

