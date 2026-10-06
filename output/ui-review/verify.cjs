const { chromium } = require('playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');

const baseURL = process.argv[2] || 'http://127.0.0.1:3007';
const directory = __dirname;
const artifactPrefix = process.env.UI_REVIEW_PREFIX || '';
const report = { baseURL, createdAt: new Date().toISOString(), checks: [], pageErrors: [], consoleErrors: [], screenshots: [] };

function assert(condition, message) { if (!condition) throw new Error(message); }
async function check(name, fn) {
  try { const result = await fn(); report.checks.push({ name, status: 'pass', result }); console.log('PASS', name); }
  catch (error) { report.checks.push({ name, status: 'fail', error: error.message }); console.log('FAIL', name, error.message); }
}
async function screenshot(page, filename) {
  filename = artifactPrefix + filename;
  await page.screenshot({ path: path.join(directory, filename), fullPage: true, animations: 'allow' });
  report.screenshots.push(filename);
}
async function noOverflow(page) {
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert(dimensions.document <= dimensions.viewport + 1, JSON.stringify(dimensions));
  return dimensions;
}
function track(page) {
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
}
async function ready(page) {
  await page.getByRole('navigation', { name: 'Main navigation' }).waitFor({ state: 'visible', timeout: 60000 });
  await page.getByRole('button', { name: /decorative motion/ }).waitFor({ state: 'visible' });
  await page.locator('[data-quipus-motion="on"]').waitFor({ state: 'attached' });
  await page.locator('[aria-label="Conversation history"] button[aria-label^="Open "]').first().waitFor({ state: 'visible' });
}
async function nav(page, name) {
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name, exact: true }).click();
  if (name !== 'Home') await page.getByRole('heading', { level: 1, name, exact: true }).waitFor({ state: 'visible' });
  await page.waitForTimeout(950);
}

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference', serviceWorkers: 'block' });
    await context.addInitScript(() => {
      window.__quipusRevealFrames = [];
      new MutationObserver(() => {
        const heading = document.querySelector('h1[data-revealing="true"]');
        if (heading && window.__quipusRevealFrames.length < 50) window.__quipusRevealFrames.push({ time: performance.now(), text: heading.textContent, height: heading.getBoundingClientRect().height });
      }).observe(document, { subtree: true, attributes: true, childList: true, characterData: true });
    });
    const page = await context.newPage(); track(page);
    await check('Public sample renders before sign-in', async () => {
      const response = await page.goto(baseURL + '/', { waitUntil: 'domcontentloaded', timeout: 120000 });
      assert(response.status() === 200, `HTTP ${response.status()}`);
      await ready(page);
      assert(await page.getByText('Sample meetings. Approvals stay in this demo.', { exact: false }).isVisible(), 'Sample notice absent');
      return { rows: await page.locator('[aria-label="Conversation history"] button[aria-label^="Open "]').count() };
    });
    await check('Initial heading reveal scrambles then settles without resizing', async () => {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelector('h1[data-revealing="true"]'), { timeout: 10000 });
      await page.waitForTimeout(240);
      await screenshot(page, 'home-heading-reveal.png');
      await page.waitForTimeout(950);
      const frames = await page.evaluate(() => window.__quipusRevealFrames);
      const heights = frames.map(frame => frame.height);
      assert(frames.length > 2, 'No scramble frames captured');
      assert(Math.max(...heights) - Math.min(...heights) < 1, 'Heading height changed during reveal');
      assert(await page.locator('h1[data-revealing="false"]').isVisible(), 'Heading did not settle');
      return { frames: frames.length, heights: [...new Set(heights)], sample: frames.slice(0, 3) };
    });
    await screenshot(page, 'home-desktop.png');
    await check('Desktop header stays in one grid row', async () => {
      const header = await page.getByRole('banner').evaluate(element => ({ display: getComputedStyle(element).display, height: element.getBoundingClientRect().height, padding: getComputedStyle(element).padding, width: element.getBoundingClientRect().width }));
      assert(header.display === 'grid' && header.height < 110, JSON.stringify(header));
      return header;
    });
    await check('Desktop home has no document overflow', () => noOverflow(page));
    await check('History is compact and background persists across tabs', async () => {
      const rows = page.locator('[aria-label="Conversation history"] button[aria-label^="Open "]');
      const count = await rows.count();
      assert(count > 0 && count <= 6, `Expected 1–6 rows, received ${count}`);
      const box = await rows.first().boundingBox();
      assert(box.height >= 60 && box.height <= 70, `Row height ${box.height}`);
      await page.evaluate(() => { window.__originalBackdrop = document.querySelector('[data-active]'); });
      for (const tab of ['Calendar', 'Devices', 'Conversations', 'Home']) await nav(page, tab);
      assert(await page.evaluate(() => window.__originalBackdrop === document.querySelector('[data-active]')), 'Background remounted');
      return { rows: count, rowHeight: box.height };
    });
    await check('Search persists through tabs and conversation details', async () => {
      const first = page.locator('[aria-label="Conversation history"] button[aria-label^="Open "]').first();
      const name = (await first.locator('strong').innerText()).split(' ')[0];
      await page.getByRole('textbox', { name: 'Search conversations' }).fill(name);
      await nav(page, 'Calendar');
      await screenshot(page, 'calendar-desktop.png');
      await nav(page, 'Conversations');
      assert(await page.getByRole('textbox', { name: 'Search conversations' }).inputValue() === name, 'Search reset across tabs');
      const filtered = page.locator('[aria-label="Conversation history"] button[aria-label^="Open "]');
      assert(await filtered.count() > 0, 'No matching rows');
      await filtered.first().click();
      await page.getByRole('button', { name: 'All conversations', exact: true }).waitFor({ state: 'visible' });
      await page.waitForTimeout(950);
      await screenshot(page, 'conversation-desktop.png');
      await page.getByRole('button', { name: 'All conversations', exact: true }).click();
      await page.getByRole('textbox', { name: 'Search conversations' }).waitFor();
      assert(await page.getByRole('textbox', { name: 'Search conversations' }).inputValue() === name, 'Search reset after details');
      await page.getByLabel('Filter conversation date').fill('2026-10-06');
      await nav(page, 'Devices');
      await screenshot(page, 'devices-desktop.png');
      await nav(page, 'Home');
      assert(await page.getByLabel('Filter conversation date').inputValue() === '2026-10-06', 'Date reset across tabs');
      await page.getByRole('button', { name: 'Clear conversation filters' }).click();
      return { retainedQuery: name, retainedDate: '2026-10-06' };
    });
    await check('Motion pause stops decorations and persists across routes', async () => {
      await page.getByRole('button', { name: 'Pause decorative motion' }).click();
      assert(await page.locator('[data-quipus-motion="off"]').count() === 1, 'Motion did not pause');
      const state = await page.locator('[data-fragment]').first().evaluate(element => getComputedStyle(element).animationPlayState);
      assert(state === 'paused', `Animation state ${state}`);
      await nav(page, 'Calendar');
      assert(await page.locator('[data-quipus-motion="off"]').count() === 1, 'Motion preference reset');
      await page.getByRole('button', { name: 'Enable decorative motion' }).click();
      return { pausedState: state };
    });
    await check('Optional dark theme remains readable and avoids overflow', async () => {
      await page.getByRole('button', { name: 'Switch to dark theme' }).click();
      assert(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'Theme not applied');
      await nav(page, 'Home');
      await screenshot(page, 'home-dark-desktop.png');
      await noOverflow(page);
      await page.getByRole('button', { name: 'Switch to light theme' }).click();
    });
    await check('Login desktop retains supplied logo and sample access', async () => {
      const response = await page.goto(baseURL + '/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
      assert(response.status() === 200, `HTTP ${response.status()}`);
      await page.getByRole('heading', { name: 'Keep every conversation moving.' }).waitFor();
      await page.waitForTimeout(1000);
      const logo = page.getByRole('img', { name: 'Quipus', exact: true });
      await page.waitForFunction(() => [...document.querySelectorAll('img')].some(image => image.alt === 'Quipus' && image.complete && image.naturalWidth > 0), null, { timeout: 15000 });
      assert(await logo.evaluate(image => image.complete && image.naturalWidth > 0), 'Supplied logo not loaded');
      assert(await page.getByRole('link', { name: 'Explore a sample workspace' }).isVisible(), 'Sample access absent');
      assert(await page.getByRole('button', { name: 'Continue with Google' }).count() + await page.getByRole('link', { name: 'Explore a sample workspace' }).count() > 0, 'Auth or sample action absent');
      await screenshot(page, 'login-desktop.png');
      return noOverflow(page);
    });
    await check('Login inherits dark theme through client navigation with readable logo and text', async () => {
      await page.goto(baseURL + '/', { waitUntil: 'domcontentloaded' });
      await ready(page);
      await page.getByRole('button', { name: 'Switch to dark theme' }).click();
      await page.getByRole('link', { name: /Sign in.*Google/ }).click();
      await page.getByRole('heading', { name: 'Keep every conversation moving.' }).waitFor();
      await page.waitForTimeout(1000);
      const colors = await page.getByRole('heading', { name: 'Keep every conversation moving.' }).evaluate(heading => ({ theme: document.documentElement.dataset.theme, text: getComputedStyle(heading).color, background: getComputedStyle(document.body).backgroundColor, logoBacking: getComputedStyle(document.querySelector('a[aria-label="Explore Quipus"]')).backgroundColor }));
      assert(colors.theme === 'dark' && colors.text === 'rgb(245, 243, 237)' && colors.background === 'rgb(11, 22, 37)' && colors.logoBacking === 'rgb(245, 243, 237)', JSON.stringify(colors));
      await screenshot(page, 'login-dark-desktop.png');
      await noOverflow(page);
      return colors;
    });
    await context.close();

    for (const width of [390, 320]) {
      const mobile = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, reducedMotion: 'no-preference', serviceWorkers: 'block' });
      const mobilePage = await mobile.newPage(); track(mobilePage);
      await check(`Mobile ${width}px home and navigation avoid overflow`, async () => {
        await mobilePage.goto(baseURL + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await ready(mobilePage); await mobilePage.waitForTimeout(950);
        await screenshot(mobilePage, `home-mobile-${width}.png`);
        await noOverflow(mobilePage);
        for (const tab of ['Calendar', 'Devices', 'Conversations']) { await nav(mobilePage, tab); await noOverflow(mobilePage); }
        await screenshot(mobilePage, `history-mobile-${width}.png`);
      });
      await check(`Mobile ${width}px login avoids overflow`, async () => {
        await mobilePage.goto(baseURL + '/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await mobilePage.getByRole('link', { name: 'Explore a sample workspace' }).waitFor();
        await mobilePage.waitForTimeout(950);
        await screenshot(mobilePage, `login-mobile-${width}.png`);
        return noOverflow(mobilePage);
      });
      await mobile.close();
    }

    const reduced = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    const reducedPage = await reduced.newPage(); track(reducedPage);
    await check('Reduced-motion preference shows static decorations and immediate headings', async () => {
      await reducedPage.goto(baseURL + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      const toggle = reducedPage.getByRole('button', { name: 'Enable decorative motion' });
      await toggle.waitFor();
      assert(await toggle.isDisabled(), 'Reduced-motion preference can be overridden');
      assert(await reducedPage.locator('[data-quipus-motion="off"]').count() === 1, 'Reduced motion enabled');
      assert(await reducedPage.locator('h1[data-revealing="true"]').count() === 0, 'Heading scrambling under reduced motion');
      const state = await reducedPage.locator('[data-fragment]').first().evaluate(element => getComputedStyle(element).animationName);
      assert(state === 'none', `Reduced animation ${state}`);
      await screenshot(reducedPage, 'home-reduced-motion.png');
      return { animationName: state };
    });
    await reduced.close();
    await check('No application runtime exceptions', async () => assert(report.pageErrors.length === 0, JSON.stringify(report.pageErrors)));
  } finally {
    await browser.close();
    await fs.writeFile(path.join(directory, artifactPrefix + 'report.json'), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ passed: report.checks.filter(check => check.status === 'pass').length, failed: report.checks.filter(check => check.status === 'fail').length, pageErrors: report.pageErrors.length, consoleErrors: report.consoleErrors.length, screenshots: report.screenshots.length }, null, 2));
  process.exitCode = report.checks.some(check => check.status === 'fail') ? 1 : 0;
})().catch(async error => { report.fatalError = error.stack; await fs.writeFile(path.join(directory, artifactPrefix + 'report.json'), JSON.stringify(report, null, 2)); console.error(error); process.exitCode = 1; });
