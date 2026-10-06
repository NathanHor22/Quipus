const { chromium } = require('../node_modules/playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const base = process.argv[2] || 'http://127.0.0.1:3007';
const report = { base, checks: [], mutations: [], externalRequests: [], runtimeErrors: [], screenshots: [] };
const assert = (value, message) => { if (!value) throw new Error(message); };
async function check(name, fn) { try { const result = await fn(); report.checks.push({ name, pass: true, result }); console.log('PASS', name); } catch (error) { report.checks.push({ name, pass: false, error: error.message }); console.log('FAIL', name, error.message); } }
async function shot(page, name) { await page.screenshot({ path: path.join(__dirname, name), fullPage: true }); report.screenshots.push(name); }
async function nav(page, name) { await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name, exact: true }).click(); if (name !== 'Home') await page.getByRole('heading', { name, level: 1, exact: true }).waitFor(); }
async function review(page) { const dialog = page.getByRole('dialog', { name: 'Ready when you are.' }); await dialog.waitFor(); assert(await dialog.getByRole('textbox', { name: 'Meeting title' }).inputValue(), 'Review title absent'); assert(report.mutations.length === 0, 'Mutation occurred before final approval'); return dialog; }
async function closeReview(page) { await page.getByRole('dialog', { name: 'Ready when you are.' }).getByRole('button', { name: 'Cancel', exact: true }).click(); }
async function sampleState(page) { return page.evaluate(() => { const key = Object.keys(localStorage).find(key => { try { return JSON.parse(localStorage.getItem(key))?.meetings?.length; } catch { return false; } }); return { key, data: JSON.parse(localStorage.getItem(key)) }; }); }
async function calendarState(page) { const surface = page.locator('[aria-label="Meeting calendar"]'); return { month: await surface.getByRole('heading', { level: 2 }).innerText(), date: await surface.locator('button[aria-pressed="true"][aria-label]').getAttribute('aria-label') }; }

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    context.setDefaultNavigationTimeout(120000); context.setDefaultTimeout(60000);
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== base) { report.externalRequests.push(request.url()); return route.abort(); }
      if (url.pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(request.method())) { report.mutations.push({ method: request.method(), url: request.url() }); return route.fulfill({ status: 501, contentType: 'application/json', body: '{"error":"Isolated QA prevents external actions"}' }); }
      return route.continue();
    });
    const page = await context.newPage(); page.on('pageerror', error => report.runtimeErrors.push(error.message));
    const response = await page.goto(base + '/'); assert(response.status() === 200, `HTTP ${response.status()}`);
    await page.locator('[aria-label="Conversation history"] button[aria-label^="Open "]').first().waitFor();
    let seed = await sampleState(page);
    const chung = seed.data.meetings.find(meeting => meeting.contacts[0]?.id === 'sample:chung' && meeting.insight);
    const aisyah = seed.data.meetings.find(meeting => meeting.contacts[0]?.id === 'sample:aisyah' && meeting.insight);
    assert(chung && aisyah, 'Expected isolated sample fixtures');
    const earlier = structuredClone(chung); earlier.id = 'sample:qa:chung-prior'; earlier.title = 'Previous Chung planning discussion'; earlier.startAt = new Date(Date.parse(chung.startAt) - 14 * 86400000).toISOString(); earlier.endAt = new Date(Date.parse(earlier.startAt) + 30 * 60000).toISOString(); earlier.followUps = []; earlier.insight.commitments = [{ ownerType: 'user', description: 'Prepare the prior meeting review', status: 'open', dueAt: null }];
    const group = structuredClone(chung); group.id = 'sample:qa:group'; group.title = 'Shared client review'; group.contacts = [chung.contacts[0], aisyah.contacts[0]]; group.startAt = new Date(Date.parse(chung.startAt) + 2 * 3600000).toISOString(); group.endAt = new Date(Date.parse(group.startAt) + 30 * 60000).toISOString(); group.followUps = []; group.insight.commitments = [{ ownerType: 'contact', description: 'An unnamed participant promised', status: 'open', dueAt: null }];
    seed.data.meetings.push(earlier, group);
    await page.evaluate(({ key, data }) => localStorage.setItem(key, JSON.stringify(data)), seed);
    await page.reload();
    await page.getByRole('button', { name: 'Review follow-up', exact: true }).waitFor();
    const originalEvents = seed.data.meetings.filter(meeting => meeting.source === 'calendar').length;

    await check('Home approval opens review without creating an event or sending a request', async () => {
      await page.getByRole('button', { name: 'Review follow-up', exact: true }).click(); await review(page); await shot(page, 'home-review.png'); await closeReview(page);
      assert((await sampleState(page)).data.meetings.filter(meeting => meeting.source === 'calendar').length === originalEvents, 'Home review created an event');
    });
    await nav(page, 'Calendar');
    await check('Every calendar rail approval opens review first', async () => {
      const rail = page.locator('[aria-label="Meeting approvals"]');
      const entries = rail.getByRole('button', { name: /^(Review invitation|Complete details)$/ });
      await entries.first().waitFor();
      const count = await entries.count(); assert(count === 2, `Expected 2 pending approvals, saw ${count}`);
      for (let index = 0; index < count; index++) { await entries.nth(index).click(); await review(page); await closeReview(page); }
      return { approvalsReviewed: count };
    });
    await check('Calendar recording popup has the shared four tabs and preserves month/date on close', async () => {
      const before = await calendarState(page);
      await page.locator('[aria-label="Meeting calendar"] button[title]').filter({ has: page.locator('strong', { hasText: 'Mr Chung' }) }).first().click();
      const modal = page.getByRole('dialog', { name: 'Meeting details' }); await modal.waitFor();
      assert(await modal.evaluate(dialog => dialog instanceof HTMLDialogElement && dialog.open), 'Popup is not a native open dialog');
      assert(await modal.getByRole('button', { name: 'Close meeting', exact: true }).count() === 0, 'Duplicate close control remains');
      assert(await modal.getByText('Report ready', { exact: true }).count() === 0, 'Completed processing milestones obscure the report');
      assert(await modal.getByRole('tab').count() === 4, 'Shared tabs absent');
      for (const tab of ['Summary', 'Actions', 'Transcript', 'Audio']) { await modal.getByRole('tab', { name: tab, exact: true }).click(); assert(await modal.getByRole('tabpanel').count() === 1, `Multiple panels for ${tab}`); }
      await modal.getByRole('tab', { name: 'Actions', exact: true }).click();
      await modal.getByRole('button', { name: 'Review meeting details', exact: true }).click(); await review(page); await shot(page, 'calendar-popup-review.png'); await closeReview(page);
      await modal.getByRole('tab', { name: 'Summary', exact: true }).click(); await shot(page, 'calendar-popup-summary.png');
      await modal.getByRole('button', { name: 'Close', exact: true }).click();
      assert(JSON.stringify(await calendarState(page)) === JSON.stringify(before), 'Close changed calendar context');
      return before;
    });
    await check('Full conversation approval reviews and Back restores the filtered history', async () => {
      await nav(page, 'Conversations'); await page.getByRole('textbox', { name: 'Search conversations' }).fill('Chung');
      const rows = page.locator('[aria-label="Conversation history"] button[aria-label^="Open "]');
      await rows.filter({ hasText: 'Bangsar' }).nth(1).click();
      await page.getByRole('tab', { name: 'Actions', exact: true }).click();
      await page.getByRole('button', { name: 'Review meeting details', exact: true }).click(); await review(page); await closeReview(page);
      await page.getByRole('button', { name: 'Back to conversations', exact: true }).click();
      assert(await page.getByRole('textbox', { name: 'Search conversations' }).inputValue() === 'Chung', 'History search lost');
    });
    await check('Final sample approval creates one event and persistent confirmation opens that event', async () => {
      await nav(page, 'Home'); await page.getByRole('button', { name: 'Review follow-up', exact: true }).click(); const dialog = await review(page);
      await dialog.getByRole('textbox', { name: 'Meeting title' }).fill('UI review sample meeting');
      await dialog.getByRole('button', { name: 'Approve sample meeting', exact: true }).click();
      const receipt = page.locator('[aria-label="Invitation confirmation"]'); await receipt.waitFor();
      assert(await receipt.getByRole('heading', { name: 'UI review sample meeting', exact: true }).isVisible(), 'Receipt does not identify event');
      const state = await sampleState(page); const event = state.data.meetings.find(meeting => meeting.title === 'UI review sample meeting' && meeting.source === 'calendar');
      assert(event && state.data.meetings.filter(meeting => meeting.source === 'calendar').length === originalEvents + 1, 'Did not create exactly one sample event');
      assert(report.mutations.length === 0, 'Sample approval called a real endpoint');
      await nav(page, 'Devices'); assert(await receipt.isVisible(), 'Confirmation disappeared across navigation'); await nav(page, 'Home'); await shot(page, 'approval-confirmation.png');
      await receipt.getByRole('button', { name: 'View calendar event', exact: true }).click(); const modal = page.getByRole('dialog', { name: 'Meeting details' }); await modal.waitFor();
      assert(await modal.getByRole('heading', { name: 'UI review sample meeting', exact: true }).last().isVisible(), 'View event opened wrong event');
      assert(await modal.getByRole('tab').count() === 4, 'Created event lost linked conversation');
      await shot(page, 'approved-calendar-event.png'); await modal.getByRole('button', { name: 'Close', exact: true }).click();
      return { eventId: event.id };
    });
    await check('Client profile shows every prior meeting and Back restores client and search', async () => {
      await nav(page, 'Conversations'); await page.getByRole('button', { name: 'People & companies', exact: true }).click(); await page.getByRole('textbox', { name: 'Search people' }).fill('Chung');
      await page.getByRole('button').filter({ has: page.getByRole('heading', { name: 'Mr Chung', exact: true }) }).click();
      const profile = page.locator('[aria-label="Client history for Mr Chung"]'); await profile.waitFor(); const profileURL = page.url();
      const rows = profile.locator('[aria-label="Prior meetings"] button'); assert(await rows.count() === 3, `Expected all 3 linked meetings, saw ${await rows.count()}`);
      assert(!await profile.getByText('An unnamed participant promised', { exact: true }).count(), 'Attributed an unnamed group commitment to this client');
      await shot(page, 'client-history.png'); await rows.first().click(); await page.getByRole('button', { name: 'Back to client history', exact: true }).click(); await profile.waitFor(); assert(page.url() === profileURL, 'Back lost selected client');
      await profile.getByRole('button', { name: 'People & companies', exact: true }).click(); assert(await page.getByRole('textbox', { name: 'Search people' }).inputValue() === 'Chung', 'People search lost');
      return { priorMeetings: 3 };
    });
    await check('Contact correction opens directly, saves across history and stays closed', async () => {
      await page.getByRole('button').filter({ has: page.getByRole('heading', { name: 'Mr Chung', exact: true }) }).click(); await page.getByRole('button', { name: 'Correct details', exact: true }).click();
      const name = page.getByRole('textbox', { name: 'Name', exact: true }); await name.waitFor(); assert(await name.inputValue() === 'Mr Chung', 'Wrong contact opened');
      await name.fill('Mr Chung reviewed'); await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.waitForTimeout(250); assert(await page.getByRole('textbox', { name: 'Name', exact: true }).count() === 0, 'Saved form reopened');
      await page.getByRole('tab', { name: 'Actions', exact: true }).click(); await page.getByRole('tab', { name: 'Summary', exact: true }).click(); assert(await page.getByRole('textbox', { name: 'Name', exact: true }).count() === 0, 'Tab change reopened correction');
      await page.getByRole('button', { name: 'Back to client history', exact: true }).click(); const profile = page.locator('[aria-label="Client history for Mr Chung reviewed"]'); await profile.waitFor();
      assert(await profile.getByRole('heading', { name: 'Mr Chung reviewed', exact: true }).isVisible(), 'Profile did not update');
      const state = await sampleState(page); assert(state.data.meetings.filter(meeting => meeting.contacts.some(contact => contact.id === 'sample:chung')).every(meeting => meeting.contacts.find(contact => contact.id === 'sample:chung').name === 'Mr Chung reviewed'), 'Related meetings retain stale contact');
      await shot(page, 'client-correction-saved.png');
    });
    await check('A secondary participant correction selects that person rather than the first participant', async () => {
      await page.getByRole('button', { name: 'People & companies', exact: true }).click(); await page.getByRole('textbox', { name: 'Search people' }).fill('Aisyah');
      await page.getByRole('button').filter({ has: page.getByRole('heading', { name: 'Aisyah Rahman', exact: true }) }).click(); await page.getByRole('button', { name: 'Correct details', exact: true }).click();
      await page.getByRole('textbox', { name: 'Name', exact: true }).waitFor(); assert(await page.getByRole('textbox', { name: 'Name', exact: true }).inputValue() === 'Aisyah Rahman', 'Edited first participant');
      assert(await page.getByRole('textbox', { name: 'Company', exact: true }).inputValue() === 'Nusa Retail', 'Wrong company'); assert(new URL(page.url()).searchParams.get('contact') === 'sample:aisyah', 'Selected contact missing from route');
      await shot(page, 'secondary-contact-correction.png'); await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await page.getByRole('button', { name: 'Back to client history', exact: true }).click();
    });
    await check('Mobile calendar popup retains four tabs without overflow', async () => {
      await page.setViewportSize({ width: 390, height: 844 }); await nav(page, 'Calendar');
      await page.locator('[aria-label="Meeting calendar"] button[title]').filter({ has: page.locator('strong', { hasText: 'Mr Chung reviewed' }) }).first().click();
      const modal = page.getByRole('dialog', { name: 'Meeting details' }); await modal.waitFor();
      for (const tab of ['Summary', 'Actions', 'Transcript', 'Audio']) { await modal.getByRole('tab', { name: tab, exact: true }).click(); const dimensions = await modal.evaluate(dialog => ({ viewport: innerWidth, right: dialog.getBoundingClientRect().right, client: dialog.clientWidth, scroll: dialog.scrollWidth, overflow: [...dialog.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > dialog.getBoundingClientRect().right - 1).map(el => ({ tag: el.tagName, class: el.className, text: el.textContent.slice(0, 100), width: el.getBoundingClientRect().width, right: el.getBoundingClientRect().right })) })); assert(dimensions.right <= dimensions.viewport + 1 && dimensions.scroll <= dimensions.client + 1, `${tab}: ${JSON.stringify(dimensions)}`); }
      await modal.getByRole('tab', { name: 'Summary', exact: true }).click(); await shot(page, 'calendar-popup-mobile.png'); await modal.getByRole('button', { name: 'Close', exact: true }).click();
    });
    await check('A mismatched contact ID never opens another personâ€™s correction form', async () => {
      const url = new URL(base + '/'); url.searchParams.set('mode', 'sample'); url.searchParams.set('view', 'conversations'); url.searchParams.set('conversation', group.id); url.searchParams.set('edit', 'contact'); url.searchParams.set('contact', 'sample:missing-person');
      await page.goto(url.toString()); await page.getByText('This contact is not linked to this conversation', { exact: true }).waitFor(); assert(await page.getByRole('textbox', { name: 'Name', exact: true }).count() === 0, 'Mismatch edited another person');
    });
    await check('All sample flow operations stayed local and produced no runtime errors', async () => { assert(report.mutations.length === 0, JSON.stringify(report.mutations)); assert(report.externalRequests.length === 0, JSON.stringify(report.externalRequests)); assert(report.runtimeErrors.length === 0, JSON.stringify(report.runtimeErrors)); });
    await context.close();
  } finally { await browser.close(); await fs.writeFile(path.join(__dirname, 'conversation-flow-report.json'), JSON.stringify(report, null, 2)); }
  console.log(JSON.stringify({ passed: report.checks.filter(check => check.pass).length, failed: report.checks.filter(check => !check.pass).length, screenshots: report.screenshots.length }, null, 2)); process.exitCode = report.checks.some(check => !check.pass) ? 1 : 0;
})().catch(async error => { report.fatalError = error.stack; await fs.writeFile(path.join(__dirname, 'conversation-flow-report.json'), JSON.stringify(report, null, 2)); console.error(error); process.exitCode = 1; });

