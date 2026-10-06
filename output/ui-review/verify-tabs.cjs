const { chromium } = require('playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const base = process.argv[2] || 'http://127.0.0.1:3007';
const artifactPrefix = process.env.UI_REVIEW_PREFIX || '';
const report = { checks: [], errors: [], screenshots: [] };
const assert = (condition, message) => { if (!condition) throw new Error(message); };
async function check(name, fn) { try { report.checks.push({ name, pass: true, result: await fn() }); console.log('PASS', name); } catch (error) { report.checks.push({ name, pass: false, error: error.message }); console.log('FAIL', name, error.message); } }
async function shot(page, file) { file = artifactPrefix + file; await page.screenshot({ path: path.join(__dirname, file), fullPage: true }); report.screenshots.push(file); }
async function active(page, name) {
  assert(await page.getByRole('tab', { name, exact: true }).getAttribute('aria-selected') === 'true', `${name} not selected`);
  assert(await page.getByRole('tabpanel').count() === 1, `Visible panels ${await page.getByRole('tabpanel').count()}`);
  assert(await page.getByRole('tabpanel', { name, exact: true }).isVisible(), `${name} panel not visible`);
}
async function noOverflow(page) { const d = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth })); assert(d.document <= d.viewport + 1, JSON.stringify(d)); return d; }
function silence(seconds = 20) {
  const rate = 8000, length = rate * 2 * seconds, wav = Buffer.alloc(44 + length);
  wav.write('RIFF'); wav.writeUInt32LE(36 + length, 4); wav.write('WAVE', 8); wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(length, 40); return wav;
}
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    ctx.setDefaultNavigationTimeout(120000); ctx.setDefaultTimeout(60000);
    const page = await ctx.newPage(); page.on('pageerror', e => report.errors.push(e.message));
    await page.goto(base + '/');
    await page.locator('[aria-label="Conversation history"] button[aria-label^="Open "]').first().waitFor();
    const fixture = await page.evaluate(() => Object.keys(localStorage).map(key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }).find(data => data?.meetings?.length)?.meetings[0]);
    assert(fixture, 'No isolated sample fixture');
    await page.locator('[aria-label="Conversation history"] button[aria-label^="Open "]').first().click();
    await page.getByRole('tablist', { name: 'Conversation details' }).waitFor();
    await check('Detail has exactly four accessible tabs and one visible panel', async () => {
      assert(await page.getByRole('tab').count() === 4, 'Four tabs absent');
      for (const name of ['Summary', 'Actions', 'Transcript', 'Audio']) { await page.getByRole('tab', { name, exact: true }).click(); await active(page, name); await shot(page, `detail-${name.toLowerCase()}-desktop.png`); }
      return noOverflow(page);
    });
    await check('Detail tab arrow, Home and End keys move selection and focus', async () => {
      const summary = page.getByRole('tab', { name: 'Summary', exact: true });
      await summary.click(); await summary.press('ArrowRight'); await active(page, 'Actions');
      assert(await page.getByRole('tab', { name: 'Actions', exact: true }).evaluate(e => e === document.activeElement), 'ArrowRight focus');
      await page.getByRole('tab', { name: 'Actions', exact: true }).press('End'); await active(page, 'Audio');
      await page.getByRole('tab', { name: 'Audio', exact: true }).press('Home'); await active(page, 'Summary');
      await summary.press('ArrowLeft'); await active(page, 'Audio');
      return { wrapping: true, home: true, end: true };
    });
    await check('Transcript search survives summary and audio tab changes', async () => {
      await page.getByRole('tab', { name: 'Transcript', exact: true }).click();
      await page.getByRole('textbox', { name: 'Search transcript' }).fill('pilot');
      await page.getByRole('tab', { name: 'Summary', exact: true }).click();
      await page.getByRole('tab', { name: 'Audio', exact: true }).click();
      await page.getByRole('tab', { name: 'Transcript', exact: true }).click();
      assert(await page.getByRole('textbox', { name: 'Search transcript' }).inputValue() === 'pilot', 'Transcript query reset');
      await page.getByRole('textbox', { name: 'Search transcript' }).fill('');
    });
    await check('Detail mobile tabs and panels avoid horizontal overflow', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      for (const name of ['Summary', 'Actions', 'Transcript', 'Audio']) { await page.getByRole('tab', { name, exact: true }).click(); await active(page, name); await noOverflow(page); await shot(page, `detail-${name.toLowerCase()}-mobile.png`); }
      await page.setViewportSize({ width: 320, height: 844 });
      for (const name of ['Summary', 'Actions', 'Transcript', 'Audio']) { await page.getByRole('tab', { name, exact: true }).click(); await noOverflow(page); }
      return { widths: [390, 320] };
    });
    await ctx.close();

    if (!process.env.UI_PUBLIC_ONLY) {
    const live = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    live.setDefaultNavigationTimeout(120000); live.setDefaultTimeout(60000);
    const livePage = await live.newPage(); livePage.on('pageerror', e => report.errors.push(e.message));
    const recording = { ...fixture, id: 'ui-test-recording', recordingId: null, recordingUrl: base + '/__ui-test-audio.wav', recordingProgress: { ...fixture.recordingProgress, durationSeconds: 20 } };
    await livePage.route('**/api/meetings', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ source: 'ui-test-fixture', meetings: [recording] }) }));
    await livePage.route('**/api/integrations', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"integrations":{}}' }));
    await livePage.route('**/api/devices', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"devices":[]}' }));
    await livePage.route('**/__ui-test-audio.wav', route => {
      const wav = silence();
      const range = route.request().headers().range;
      const match = range?.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = Number(match[1]), end = match[2] ? Math.min(Number(match[2]), wav.length - 1) : wav.length - 1;
        return route.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${wav.length}` }, body: wav.subarray(start, end + 1) });
      }
      return route.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: wav });
    });
    await check('Local fixture playback position, speed and media element persist across tabs', async () => {
      await livePage.goto(base + '/dashboard');
      await livePage.locator('[aria-label="Conversation history"] button[aria-label^="Open "]').first().waitFor();
      await livePage.locator('[aria-label="Conversation history"] button[aria-label^="Open "]').first().click();
      assert(await livePage.locator('dt', { hasText: /^Duration$/ }).locator('..').locator('dd').innerText() === '20 sec', 'Original capture length was rounded up');
      await livePage.getByRole('tab', { name: 'Audio', exact: true }).click();
      assert(await livePage.getByRole('tabpanel', { name: 'Audio', exact: true }).getByText('Duration · 20 sec', { exact: true }).isVisible(), 'Audio source duration is inaccurate');
      const speed = livePage.getByRole('combobox', { name: 'Playback speed' });
      await livePage.waitForFunction(() => { const select = document.querySelector('select[aria-label="Playback speed"]'); return select && !select.disabled; }, null, { timeout: 15000 });
      await speed.selectOption('1.5');
      await livePage.locator('audio').evaluate(player => { window.__testAudio = player; player.currentTime = 7; });
      await livePage.waitForFunction(() => { const player = document.querySelector('audio'); return !player.seeking && Math.abs(player.currentTime - 7) < .1; }, null, { timeout: 10000 });
      await livePage.getByRole('tab', { name: 'Summary', exact: true }).click();
      await livePage.getByRole('tab', { name: 'Actions', exact: true }).click();
      await livePage.getByRole('tab', { name: 'Transcript', exact: true }).click();
      await livePage.getByRole('tab', { name: 'Audio', exact: true }).click();
      assert(await speed.inputValue() === '1.5', 'Playback speed reset');
      const state = await livePage.locator('audio').evaluate(player => ({ sameElement: window.__testAudio === player, time: player.currentTime, speed: player.playbackRate, duration: player.duration }));
      assert(state.sameElement && Math.abs(state.time - 7) < .1 && state.speed === 1.5, JSON.stringify(state));
      await shot(livePage, 'detail-local-fixture-audio.png');
      return state;
    });
    await check('Transcript controls playback and hiding replay pauses without losing progress', async () => {
      await livePage.getByRole('tab', { name: 'Transcript', exact: true }).click();
      await livePage.getByRole('tabpanel', { name: 'Transcript', exact: true }).getByRole('button', { name: 'Play recording', exact: true }).click();
      await livePage.getByRole('tabpanel', { name: 'Transcript', exact: true }).getByRole('button', { name: 'Pause recording', exact: true }).waitFor();
      const playing = await livePage.locator('audio').evaluate(player => ({ playing: !player.paused, time: player.currentTime }));
      assert(playing.playing, 'Transcript play did not start');
      await livePage.getByRole('tab', { name: 'Audio', exact: true }).click();
      assert(await livePage.locator('audio').evaluate(player => !player.paused), 'Audio tab unexpectedly paused');
      await livePage.getByRole('tab', { name: 'Transcript', exact: true }).click();
      await livePage.getByRole('tabpanel', { name: 'Transcript', exact: true }).getByRole('button', { name: 'Pause recording', exact: true }).click();
      await livePage.getByRole('tabpanel', { name: 'Transcript', exact: true }).getByRole('button', { name: 'Play recording', exact: true }).waitFor();
      assert(await livePage.locator('audio').evaluate(player => player.paused), 'Transcript pause failed');
      await livePage.getByRole('tabpanel', { name: 'Transcript', exact: true }).getByRole('button', { name: 'Play recording', exact: true }).click();
      await livePage.getByRole('tabpanel', { name: 'Transcript', exact: true }).getByRole('button', { name: 'Pause recording', exact: true }).waitFor();
      await livePage.getByRole('tab', { name: 'Summary', exact: true }).click();
      const hidden = await livePage.locator('audio').evaluate(player => ({ paused: player.paused, time: player.currentTime, sameElement: window.__testAudio === player }));
      assert(hidden.paused && hidden.time >= playing.time && hidden.sameElement, JSON.stringify(hidden));
      await livePage.getByRole('tab', { name: 'Actions', exact: true }).click();
      const actions = await livePage.locator('audio').evaluate(player => ({ paused: player.paused, time: player.currentTime }));
      assert(actions.paused && Math.abs(actions.time - hidden.time) < .1, JSON.stringify(actions));
      await livePage.getByRole('tab', { name: 'Transcript', exact: true }).click();
      await shot(livePage, 'detail-local-fixture-transcript.png');
      await noOverflow(livePage);
      return { startedAt: playing.time, pausedAt: hidden.time, sameElement: hidden.sameElement };
    });
    await live.close();
    }
    await check('Detail test has no runtime errors', async () => assert(report.errors.length === 0, JSON.stringify(report.errors)));
  } finally { await browser.close(); await fs.writeFile(path.join(__dirname, artifactPrefix + 'tabs-report.json'), JSON.stringify(report, null, 2)); }
  console.log(JSON.stringify({ passed: report.checks.filter(c => c.pass).length, failed: report.checks.filter(c => !c.pass).length, screenshots: report.screenshots.length }, null, 2));
  process.exitCode = report.checks.some(c => !c.pass) ? 1 : 0;
})().catch(async error => { report.fatalError = error.stack; await fs.writeFile(path.join(__dirname, artifactPrefix + 'tabs-report.json'), JSON.stringify(report, null, 2)); console.error(error); process.exitCode = 1; });
