const { chromium } = require('playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const base = process.argv[2] || 'http://127.0.0.1:3007';
const directory = path.join(__dirname, 'owned-visual');
const report = { checks: [], screenshots: [], runtimeErrors: [], externalRequests: [] };
const assert = (condition, message) => { if (!condition) throw new Error(message); };
async function check(name, fn) { try { report.checks.push({ name, pass: true, result: await fn() }); console.log('PASS', name); } catch (error) { report.checks.push({ name, pass: false, error: error.message }); console.log('FAIL', name, error.message); } }
async function shot(page, name) { await page.screenshot({ path: path.join(directory, name), fullPage: true }); report.screenshots.push(name); }
async function noOverflow(page) { const result = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth })); assert(result.document <= result.viewport + 1, JSON.stringify(result)); return result; }
async function frames(surface) { const result = await surface.locator('button').evaluateAll(buttons => buttons.filter(button => button.getBoundingClientRect().width && button.getBoundingClientRect().height).map(button => ({ text: button.textContent.trim(), width: getComputedStyle(button).borderTopWidth, style: getComputedStyle(button).borderTopStyle, radius: getComputedStyle(button).borderTopLeftRadius }))); assert(result.every(button => Number.parseFloat(button.width) >= 1 && button.style !== 'none' && Number.parseFloat(button.radius) <= 4), JSON.stringify(result)); return result; }

(async () => {
  await fs.mkdir(directory, { recursive: true });
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    context.setDefaultNavigationTimeout(120000); context.setDefaultTimeout(60000);
    await context.route('**/*', route => { if (new URL(route.request().url()).origin !== base) { report.externalRequests.push(route.request().url()); return route.abort(); } return route.continue(); });
    const page = await context.newPage(); page.on('pageerror', error => report.runtimeErrors.push(error.message));
    for (const width of [1440, 390, 320]) {
      await check(`Centred login at ${width}px has faithful logo above the glass panel`, async () => {
        await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
        const response = await page.goto(base + '/login'); assert(response.status() === 200, `HTTP ${response.status()}`);
        await page.getByRole('heading', { name: 'Keep every conversation moving.' }).waitFor();
        await page.waitForFunction(() => [...document.images].some(image => image.alt === 'Quipus' && image.complete && image.naturalWidth > 0));
        const geometry = await page.locator('section[aria-labelledby="login-title"]').evaluate(panel => { const logo = document.querySelector('img[alt="Quipus"]').getBoundingClientRect(), card = panel.getBoundingClientRect(), css = getComputedStyle(panel); return { viewport: innerWidth, logoCenter: (logo.left + logo.right) / 2, cardCenter: (card.left + card.right) / 2, logoBottom: logo.bottom, cardTop: card.top, radius: css.borderTopLeftRadius, blur: css.backdropFilter, background: css.backgroundImage }; });
        assert(Math.abs(geometry.logoCenter - width / 2) < 1 && Math.abs(geometry.cardCenter - width / 2) < 1 && geometry.logoBottom < geometry.cardTop, JSON.stringify(geometry));
        assert(geometry.radius === '3px' && geometry.blur === 'blur(16px)' && geometry.background.includes('gradient'), JSON.stringify(geometry));
        assert(await page.getByRole('link', { name: 'Explore a sample workspace', exact: true }).isVisible(), 'Sample access absent');
        await noOverflow(page); await shot(page, `login-${width}.png`); return geometry;
      });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await check('OS reduced motion presents static decorations and immediate login heading', async () => { assert(await page.locator('[data-quipus-motion="off"]').count() === 1, 'Reduced motion enabled'); assert(await page.locator('h1[data-revealing="true"]').count() === 0, 'Login heading still scrambling'); const state = await page.locator('[data-fragment]').first().evaluate(fragment => getComputedStyle(fragment).animationName); assert(state === 'none', state); return { animation: state }; });
    await check('Client navigation retains readable dark login and ivory logo backing', async () => {
      await page.goto(base + '/'); await page.getByRole('button', { name: 'Switch to dark theme', exact: true }).waitFor(); await page.getByRole('button', { name: 'Switch to dark theme', exact: true }).click(); await page.getByRole('link', { name: /Sign in.*Google/ }).click(); await page.waitForURL('**/login**'); await page.locator('a[aria-label="Explore Quipus"]').waitFor(); await page.getByRole('heading', { name: 'Keep every conversation moving.' }).waitFor();
      const colors = await page.getByRole('heading', { name: 'Keep every conversation moving.' }).evaluate(heading => ({ theme: document.documentElement.dataset.theme, text: getComputedStyle(heading).color, logo: getComputedStyle(document.querySelector('a[aria-label="Explore Quipus"]')).backgroundColor })); assert(colors.theme === 'dark' && colors.text === 'rgb(245, 243, 237)' && colors.logo === 'rgb(245, 243, 237)', JSON.stringify(colors)); await noOverflow(page); await shot(page, 'login-dark.png'); return colors;
    });
    await page.goto(base + '/'); await page.locator('[aria-label="Conversation history"] button[aria-label^="Open "]').first().waitFor();
    await page.locator('[aria-label="Conversation history"] button[aria-label^="Open "]').first().click();
    await check('Conversation detail uses framed controls and compact glass cards', async () => {
      await page.getByRole('tablist', { name: 'Conversation details' }).waitFor();
      const surface = page.getByRole('button', { name: 'Back to conversations', exact: true }).locator('..');
      const buttons = await frames(surface); assert(await surface.locator('svg.lucide-sparkles, svg.lucide-calendar-days').count() === 0, 'Decorative AI/calendar icons remain'); await noOverflow(page); await shot(page, 'detail-desktop.png'); return { buttons };
    });
    await check('Dark transcript is readable and remains framed', async () => {
      const switchDark = page.getByRole('button', { name: 'Switch to dark theme', exact: true }); if (await switchDark.count()) await switchDark.click(); await page.getByRole('tab', { name: 'Transcript', exact: true }).click(); const pane = page.getByRole('tabpanel', { name: 'Transcript', exact: true }); await frames(pane); await noOverflow(page); await shot(page, 'transcript-dark.png'); await page.getByRole('button', { name: 'Switch to light theme', exact: true }).click();
    });
    await page.getByRole('button', { name: 'Back to conversations', exact: true }).click(); await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Conversations', exact: true }).click(); await page.getByRole('button', { name: 'People & companies', exact: true }).click(); await page.getByRole('button').filter({ has: page.getByRole('heading', { name: 'Mr Chung', exact: true }) }).click();
    await check('Client history uses framed source navigation and glass panels', async () => { const profile = page.locator('[aria-label="Client history for Mr Chung"]'); await profile.waitFor(); const buttons = await frames(profile); await noOverflow(page); await shot(page, 'client-desktop.png'); return { buttons }; });
    await check('Client history remains readable at 320px and in dark mode', async () => { await page.setViewportSize({ width: 320, height: 844 }); const title = await page.getByRole('heading', { name: 'Mr Chung', exact: true }).boundingBox(); assert(title.width > 140 && title.height < 70, JSON.stringify(title)); await noOverflow(page); await shot(page, 'client-mobile-320.png'); await page.getByRole('button', { name: 'Switch to dark theme', exact: true }).click(); await noOverflow(page); await shot(page, 'client-dark-mobile-320.png'); });
    await check('Owned UI has no runtime exceptions or external requests', async () => { assert(report.runtimeErrors.length === 0, JSON.stringify(report.runtimeErrors)); assert(report.externalRequests.length === 0, JSON.stringify(report.externalRequests)); });
    await context.close();
  } finally { await browser.close(); await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2)); }
  console.log(JSON.stringify({ passed: report.checks.filter(item => item.pass).length, failed: report.checks.filter(item => !item.pass).length, screenshots: report.screenshots.length }, null, 2)); process.exitCode = report.checks.some(item => !item.pass) ? 1 : 0;
})().catch(async error => { report.fatalError = error.stack; await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2)); console.error(error); process.exitCode = 1; });
