const { chromium } = require("C:/Users/Hammad/Desktop/the eyeg/node_modules/playwright");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto("http://localhost:3000", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "C:/Users/Hammad/Desktop/the eyeg/roomy-signature/_live.png" });
  await browser.close();
  console.log("DONE");
})();
