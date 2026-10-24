const fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright-core');
const { createStaticPreview } = require('../electron/agent/static-preview.cjs');
async function inspect(project, output) {
  fs.mkdirSync(output, { recursive: true });
  const server = createStaticPreview(project);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
  const result = { project, inspectedAt: new Date().toISOString(), views: [] };
  try {
    for (const view of [{ label: 'desktop', width: 1440, height: 900 }, { label: 'mobile', width: 390, height: 844 }, { label: 'reduced-motion', width: 1440, height: 900, reduce: true }]) {
      const context = await browser.newContext({ viewport: { width: view.width, height: view.height }, reducedMotion: view.reduce ? 'reduce' : 'no-preference' });
      try {
        const page = await context.newPage();
        await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'networkidle', timeout: 30000 });
        const record = { ...view };
        const nav = () => page.locator('#nav').evaluate(el => ({ background: getComputedStyle(el).backgroundColor, className: el.className }));
        record.navTop = await nav();
        await page.evaluate(() => scrollTo(0, 300)); await page.waitForTimeout(150); record.navScrolled = await nav();
        await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(150); record.navReturned = await nav();
        if (view.label === 'mobile') {
          await page.locator('#menuBtn').click(); record.menuOpens = await page.locator('#mobileMenu').isVisible();
          await page.locator('#mobileMenu a').first().click(); record.menuCloses = !await page.locator('#mobileMenu').isVisible();
        }
        await page.locator('#fTo').fill('Independent Test'); record.greetingUpdates = (await page.locator('#pTo').innerText()).includes('Independent Test');
        if (view.label === 'desktop') {
          record.motion = [];
          for (const progress of [0, 0.5, 1.1, 0]) {
            await page.locator('#craft').evaluate((el, p) => { const box = el.getBoundingClientRect(); scrollTo(0, box.top + scrollY + p * (box.height - innerHeight)); }, progress);
            await page.waitForTimeout(200);
            record.motion.push(await page.locator('#craft').evaluate((el, p) => ({ progress: p, scrollY, pin: [...el.querySelectorAll('*')].filter(n => getComputedStyle(n).position === 'sticky').map(n => ({ top: n.getBoundingClientRect().top })), layers: [...el.querySelectorAll('.layer')].map(n => ({ transform: getComputedStyle(n).transform, opacity: getComputedStyle(n).opacity })) }), progress));
          }
        }
        await page.evaluate(() => { document.querySelectorAll('img').forEach(el => el.loading = 'eager'); scrollTo(0, 0); });
        await page.waitForTimeout(1200);
        record.metrics = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1, brokenImages: [...document.images].filter(i => i.complete && !i.naturalWidth).map(i => i.currentSrc), hiddenHeading: (() => { const h = document.querySelector('h1'); return !h || getComputedStyle(h).opacity === '0'; })() }));
        record.screenshot = path.join(output, `${view.label}.jpg`);
        await page.screenshot({ path: record.screenshot, type: 'jpeg', quality: 80 });
        result.views.push(record);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
  fs.writeFileSync(path.join(output, 'inspection.json'), JSON.stringify(result, null, 2));
  return result;
}
if (require.main === module) inspect(process.argv[2], process.argv[3]).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { inspect };
