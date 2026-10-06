const { chromium } = require('../node_modules/playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const base = process.argv[2] || 'http://127.0.0.1:3007';
const baseOrigin = new URL(base).origin;
const report = { base, createdAt: new Date().toISOString(), checks: [], errors: [], blockedRequests: [], retryRequests: [], screenshots: [] };
const assert = (condition, message) => { if (!condition) throw new Error(message); };
let diagnosticPage;
async function check(name, fn) { try { report.checks.push({ name, pass: true, result: await fn() }); console.log('PASS', name); } catch (error) { const failure = { name, pass: false, error: error.stack }; if (diagnosticPage && !diagnosticPage.isClosed()) { failure.url = diagnosticPage.url(); failure.visibleText = (await diagnosticPage.locator('body').innerText()).slice(0, 7000); await shot(diagnosticPage, `failure-${report.checks.length + 1}.png`); } report.checks.push(failure); console.log('FAIL', name, error.message, failure.url); } }
async function shot(page, file) { await page.screenshot({ path: path.join(__dirname, file), fullPage: true }); report.screenshots.push(file); }
async function noOverflow(page) { const state = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth })); assert(state.document <= state.viewport + 1, JSON.stringify(state)); return state; }
function silence(seconds = 20) {
  const rate = 8000, length = rate * 2 * seconds, wav = Buffer.alloc(44 + length);
  wav.write('RIFF'); wav.writeUInt32LE(36 + length, 4); wav.write('WAVE', 8); wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(length, 40); return wav;
}
const recordingId = '12345678-1234-4123-8123-123456789012';
const fixtureBase = { id: 'ui-recording-flow', title: 'Local recording fixture', startAt: '2026-10-06T02:00:00.000Z', endAt: '2026-10-06T02:05:00.000Z', source: 'hardware', status: 'processing', contacts: [{ id: 'ui-client', name: 'UI Fixture Client', company: 'Local Test Company', email: 'fixture@example.test' }], transcript: [], insight: null, followUps: [], recordingId, recordingUrl: base + '/__flow-audio.wav' };
let sequence = 0;
const progressFixture = (stage, extras = {}) => ({ ...fixtureBase, recordingProgress: { stage, updatedAt: new Date(Date.UTC(2026, 9, 6, 2, 6, ++sequence)).toISOString(), ...extras } });
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    const page = await context.newPage();
    diagnosticPage = page;
    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(120000);
    page.on('pageerror', error => report.errors.push(error.message));
    let fixture = { ...progressFixture('uploading', { uploadedBytes: 120, totalBytes: 1000 }), recordingId: null, recordingUrl: null };
    let retryStatus = 202;
    let requests = 0;
    await context.route('**/*', async route => {
      const request = route.request(); const url = new URL(request.url());
      if (url.origin !== baseOrigin) { report.blockedRequests.push(request.url()); return route.abort('blockedbyclient'); }
      if (url.pathname === '/api/meetings') { requests++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ source: 'ui-test-fixture', meetings: [fixture] }) }); }
      if (url.pathname === '/api/integrations') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"integrations":{"google":true}}' });
      if (url.pathname === '/api/devices') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ devices: [{ id: 'ui-device', name: 'Local Fixture Device', status: 'online', battery_level: 80, last_seen_at: new Date().toISOString() }] }) });
      if (url.pathname === `/api/recordings/${recordingId}/retry`) {
        report.retryRequests.push({ method: request.method(), path: url.pathname, body: request.postData(), status: retryStatus });
        if (retryStatus === 202) { fixture = progressFixture('queued'); return route.fulfill({ status: 202, contentType: 'application/json', body: '{"accepted":true}' }); }
        return route.fulfill({ status: retryStatus, contentType: 'application/json', body: '{"error":"Temporary queue outage. Please retry."}' });
      }
      if (url.pathname === `/api/recordings/${recordingId}/playback`) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: base + '/__flow-audio.wav', expiresAt: new Date(Date.now() + 7200000).toISOString() }) });
      if (url.pathname === '/__flow-audio.wav') {
        const wav = silence(), match = request.headers().range?.match(/bytes=(\d+)-(\d*)/);
        if (match) { const start = Number(match[1]), end = match[2] ? Math.min(Number(match[2]), wav.length - 1) : wav.length - 1; return route.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${wav.length}` }, body: wav.subarray(start, end + 1) }); }
        return route.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: wav });
      }
      if (url.pathname.startsWith('/api/')) { report.blockedRequests.push(url.pathname); return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Unconfigured isolated UI fixture."}' }); }
      return route.continue();
    });
    async function refresh(next) { fixture = next; const previous = requests; await page.evaluate(() => dispatchEvent(new Event('focus'))); await page.waitForFunction(() => true); const deadline = Date.now() + 15000; while (requests <= previous && Date.now() < deadline) await page.waitForTimeout(100); assert(requests > previous, 'No workspace refresh'); }
    const homeProgress = () => page.getByRole('region', { name: 'Recordings in progress', exact: true }).getByRole('region', { name: 'Recording progress', exact: true });
    await page.goto(base + '/dashboard', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.getByRole('navigation', { name: 'Main navigation' }).waitFor({ timeout: 60000 });
    await check('Uploading displays only actual byte progress and no premature playback', async () => {
      await homeProgress().getByRole('heading', { name: 'Uploading', exact: true }).waitFor();
      assert(await homeProgress().getByRole('progressbar').getAttribute('value') === '12', 'Measured upload percent missing');
      assert(await homeProgress().getByRole('button', { name: 'Play recording', exact: true }).count() === 0, 'Premature playback');
      await shot(page, 'uploading-desktop.png'); return noOverflow(page);
    });
    await check('Progress is a framed glass surface with a proper button system', async () => {
      const style = await homeProgress().evaluate(element => { const computed = getComputedStyle(element); return { padding: computed.paddingTop, border: computed.borderTopWidth, background: computed.backgroundImage, blur: computed.backdropFilter, radius: computed.borderBottomLeftRadius }; });
      assert(style.padding === '24px' && style.border === '1px' && style.background.includes('gradient') && style.blur.includes('blur') && style.radius === '3px', JSON.stringify(style));
      return style;
    });
    await check('100% byte upload waits for archive confirmation', async () => {
      await refresh({ ...progressFixture('uploading', { uploadedBytes: 1000, totalBytes: 1000 }), recordingId: null, recordingUrl: null });
      await homeProgress().getByText('All bytes reported uploaded. Confirming the complete recording.', { exact: true }).waitFor();
      assert(await homeProgress().getByRole('button', { name: 'Play recording', exact: true }).count() === 0, '100% prematurely enables playback');
      return { percent: await homeProgress().getByRole('progressbar').getAttribute('value') };
    });
    await check('Archived audio is available before transcription and opens the Audio tab', async () => {
      await refresh(progressFixture('queued'));
      await homeProgress().getByRole('heading', { name: 'Audio available', exact: true }).waitFor();
      assert(await homeProgress().getByRole('progressbar').count() === 0, 'Invented processing progress');
      await homeProgress().getByRole('button', { name: 'Play recording', exact: true }).click();
      const audioTab = page.getByRole('tab', { name: 'Audio', exact: true }); await audioTab.waitFor();
      assert(await audioTab.getAttribute('aria-selected') === 'true', 'Audio shortcut opened wrong tab');
      await page.waitForFunction(() => { const player = document.querySelector('audio'); return player && Number.isFinite(player.duration) && player.duration > 0; }, null, { timeout: 15000 });
      const audio = await page.locator('audio').evaluate(player => ({ duration: player.duration, source: player.src }));
      assert(audio.duration === 20, JSON.stringify(audio));
      await shot(page, 'audio-available-desktop.png'); return audio;
    });
    await check('Transcript and report stages remain explicit without AI percentages', async () => {
      for (const [stage, label] of [['transcribing', 'Preparing transcript'], ['consolidating', 'Preparing report'], ['researching', 'Preparing report']]) {
        await refresh(progressFixture(stage));
        const progress = page.getByRole('region', { name: 'Recording progress', exact: true });
        await progress.getByRole('heading', { name: label, exact: true }).waitFor();
        assert(await progress.getByRole('progressbar').count() === 0, `${stage} has fake percentage`);
        assert(!/%/.test(await progress.innerText()), `${stage} has percentage text`);
        assert(await page.getByRole('tab', { name: 'Audio', exact: true }).getAttribute('aria-selected') === 'true', 'Status refresh lost selected tab');
        assert(await page.locator('audio').count() === 1, 'Audio disappeared during processing');
      }
      await shot(page, 'report-processing-desktop.png'); return { stages: ['transcribing', 'consolidating', 'researching'] };
    });
    await check('Failed recording remains replayable and failed retry reports an actionable error', async () => {
      fixture = { ...progressFixture('failed', { error: 'Recognition failed.' }), status: 'failed' };
      await page.goto(base + '/dashboard');
      const recovery = page.getByRole('region', { name: 'Recording progress', exact: true });
      await recovery.getByRole('heading', { name: 'Processing needs attention', exact: true }).waitFor();
      assert(await recovery.getByRole('button', { name: 'Play recording', exact: true }).isEnabled(), 'Failed audio inaccessible');
      retryStatus = 503;
      await recovery.getByRole('button', { name: 'Retry processing', exact: true }).click();
      await recovery.getByRole('status').getByText('Temporary queue outage. Please retry.', { exact: true }).waitFor();
      assert(await recovery.getByRole('button', { name: 'Retry processing', exact: true }).isEnabled(), 'Failed retry locked button');
      await shot(page, 'failed-retry-desktop.png'); return { originalAudioRetained: fixture.recordingUrl === fixtureBase.recordingUrl };
    });
    await check('Accepted retry sends one empty-body POST and refreshes to queued audio', async () => {
      const before = report.retryRequests.length; retryStatus = 202;
      const recovery = page.getByRole('region', { name: 'Recording progress', exact: true });
      await recovery.getByRole('button', { name: 'Retry processing', exact: true }).click();
      await homeProgress().getByRole('heading', { name: 'Audio available', exact: true }).waitFor();
      assert(report.retryRequests.length === before + 1, 'Retry submitted more than once');
      const request = report.retryRequests.at(-1);
      assert(request.method === 'POST' && request.body === null && request.path === `/api/recordings/${recordingId}/retry`, JSON.stringify(request));
      assert(fixture.recordingId === recordingId && fixture.recordingUrl === fixtureBase.recordingUrl, 'Retry replaced original recording');
      assert(await page.getByRole('button', { name: 'Retry processing', exact: true }).count() === 0, 'Retry remains enabled while queued');
      return request;
    });
    await check('Journal failed-recording playback shortcut selects Audio', async () => {
      fixture = { ...progressFixture('failed', { error: 'Recognition failed.' }), status: 'failed' };
      await page.goto(base + '/dashboard/conversations');
      const recovery = page.getByRole('region', { name: 'Recording progress', exact: true });
      await recovery.getByRole('button', { name: 'Play recording', exact: true }).click();
      await page.getByRole('tab', { name: 'Audio', exact: true }).waitFor();
      assert(await page.getByRole('tab', { name: 'Audio', exact: true }).getAttribute('aria-selected') === 'true', 'Journal Play recording selected Summary');
      await shot(page, 'failed-audio-desktop.png');
    });
    await check('Ready report supersedes delayed session metadata and removes retry', async () => {
      await refresh({ ...progressFixture('queued'), status: 'ready', transcript: [{ speaker: 'Speaker 1', text: 'Please send the proposal.', startSeconds: 1, endSeconds: 2 }], insight: { meetingType: 'Client conversation', intent: 'Proposal review', interestLevel: 'high', wants: 'Proposal', concern: '', promised: 'Send the proposal', next: 'Send proposal', keyPoints: ['The client asked for a proposal.'], commitments: [], executiveSummary: 'The client asked for a proposal.' } });
      await page.locator('header').getByText('ready', { exact: true }).waitFor();
      assert(await page.getByRole('region', { name: 'Recording progress', exact: true }).count() === 0, 'Completed detail still displays an in-progress panel');
      assert(await page.getByRole('button', { name: 'Retry processing', exact: true }).count() === 0, 'Ready report permits retry');
      await page.getByRole('tab', { name: 'Summary', exact: true }).click();
      assert(await page.getByRole('tabpanel', { name: 'Summary', exact: true }).getByText('The client asked for a proposal.', { exact: true }).first().isVisible(), 'Ready summary absent');
      return noOverflow(page);
    });
    await check('Unconfirmed capture duration is honest and original WAV metadata wins over calendar placeholders', async () => {
      fixture = { ...progressFixture('uploading', { captureEndedAt: null, durationSeconds: null }), endAt: '2026-10-06T02:00:01.000Z', recordingId: null, recordingUrl: null };
      await page.goto(base + '/dashboard/conversations/' + fixture.id);
      const duration = page.locator('dt').filter({ hasText: /^Duration$/ }).locator('..').locator('dd');
      await duration.getByText('Not confirmed', { exact: true }).waitFor();
      await refresh({ ...progressFixture('queued', { captureEndedAt: null, durationSeconds: 20 }), endAt: '2026-10-06T02:00:01.000Z' });
      await duration.getByText('20 sec', { exact: true }).waitFor();
      await shot(page, 'confirmed-wav-duration-desktop.png');
      return { pending: 'Not confirmed', confirmed: await duration.innerText() };
    });
    await check('Processing and recovery remain usable at 320px', async () => {
      await page.setViewportSize({ width: 320, height: 844 });
      for (const [stage, status] of [['uploading', 'processing'], ['transcribing', 'processing'], ['failed', 'failed']]) {
        fixture = { ...progressFixture(stage, stage === 'uploading' ? { uploadedBytes: 100, totalBytes: 1000 } : {}), status, ...(stage === 'uploading' ? { recordingId: null, recordingUrl: null } : {}) };
        await page.goto(base + '/dashboard');
        await page.getByRole('region', { name: 'Recording progress', exact: true }).waitFor(); await noOverflow(page);
        await shot(page, `processing-${stage}-mobile-320.png`);
      }
      return { width: 320 };
    });
    await check('No unexpected application runtime errors', async () => assert(report.errors.length === 0, JSON.stringify(report.errors)));
    await check('Removed motion control stays absent and OS reduced motion is respected', async () => {
      assert(await page.getByRole('button', { name: /decorative motion|Motion on|Motion off/ }).count() === 0, 'Visible motion control remains');
      assert(await page.locator('[data-quipus-motion="off"]').count() === 1, 'Reduced motion is enabled');
      assert(await page.locator('[data-fragment]').first().evaluate(element => getComputedStyle(element).animationName) === 'none', 'Reduced motion fragments animate');
      return { visibleToggle: false, respectsOS: true };
    });
    await context.close();
    const moving = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference', serviceWorkers: 'block' });
    await moving.route('**/*', route => new URL(route.request().url()).origin === baseOrigin ? route.continue() : route.abort('blockedbyclient'));
    const movingPage = await moving.newPage();
    diagnosticPage = movingPage;
    movingPage.on('pageerror', error => report.errors.push(error.message));
    await check('Normal decorative motion pauses when the page is hidden without exposing controls', async () => {
      await movingPage.goto(base + '/');
      await movingPage.locator('[data-quipus-motion="on"]').waitFor();
      assert(await movingPage.getByRole('button', { name: /decorative motion|Motion on|Motion off/ }).count() === 0, 'Motion control reappeared');
      await movingPage.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
      await movingPage.locator('[data-quipus-visibility="hidden"]').waitFor();
      const state = await movingPage.locator('[data-fragment]').first().evaluate(element => getComputedStyle(element).animationPlayState);
      assert(state === 'paused', 'Hidden tab decorations run');
      await movingPage.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
      await movingPage.locator('[data-quipus-visibility="visible"]').waitFor();
      const resumed = await movingPage.locator('[data-fragment]').first().evaluate(element => getComputedStyle(element).animationPlayState);
      assert(resumed === 'running', 'Visible tab motion did not resume');
      return { hidden: state, visible: resumed };
    });
    await moving.close();
  } finally { await browser.close(); await fs.writeFile(path.join(__dirname, 'flow-report.json'), JSON.stringify(report, null, 2)); }
  console.log(JSON.stringify({ passed: report.checks.filter(c => c.pass).length, failed: report.checks.filter(c => !c.pass).length, errors: report.errors.length, screenshots: report.screenshots.length }, null, 2));
  process.exitCode = report.checks.some(c => !c.pass) ? 1 : 0;
})().catch(async error => { report.fatalError = error.stack; await fs.writeFile(path.join(__dirname, 'flow-report.json'), JSON.stringify(report, null, 2)); console.error(error); process.exitCode = 1; });
