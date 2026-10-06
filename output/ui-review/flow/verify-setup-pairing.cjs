const { chromium } = require('../node_modules/playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const base = process.argv[2] || 'http://127.0.0.1:3007';
const prefix = process.env.QUIPUS_SETUP_QA_PREFIX || '';
const report = { base, checks: [], pageErrors: [], unexpectedApiRequests: [], screenshots: [] };
const assert = (value, message) => { if (!value) throw new Error(message); };
async function check(name, fn) { try { report.checks.push({ name, pass: true, result: await fn() }); console.log('PASS', name); } catch(error) { report.checks.push({ name, pass: false, error: error.message }); console.log('FAIL', name, error.message); } }
async function shot(page, name) { await page.screenshot({ path: path.join(__dirname, prefix + name), fullPage: true }); report.screenshots.push(prefix + name); }
async function overflow(page) { const d = await page.evaluate(() => ({ viewport:innerWidth, document:document.documentElement.scrollWidth })); assert(d.document <= d.viewport + 1, JSON.stringify(d)); return d; }
const makeDevice = () => ({ id:'f0000000-0000-4000-8000-000000000001', name:'Local test Quipus', model:'ESP32-S3 touchscreen fixture', firmware_version:'local-review', last_seen_at:new Date().toISOString(), status:'online', device_state:'ready', state_version:1, battery_level:81, network_type:'wifi', free_heap_bytes:110000, last_error:null });
(async()=> {
  const browser = await chromium.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true });
  try {
    const ctx = await browser.newContext({ viewport:{width:1440,height:1000}, reducedMotion:'reduce', serviceWorkers:'block' });
    const page = await ctx.newPage(); page.on('pageerror', e=>report.pageErrors.push(e.message));
    let devices=[], codes=0, revokes=0, expiresSoon=false, failGet=false;
    await page.route('**/api/**', r=>{ report.unexpectedApiRequests.push(r.request().url());return r.fulfill({status:400,contentType:'application/json',body:'{"error":"Blocked unmatched test API"}'}); });
    await page.route('**/api/devices', r=>r.fulfill({status:failGet?503:200,contentType:'application/json',body:JSON.stringify(failGet?{error:'Simulated connection check failure. Return this phone or laptop to internet and retry.'}:{devices})}));
    await page.route('**/api/devices/pairing', r=>{assert(r.request().method()==='POST','Wrong pairing method');codes++;return r.fulfill({status:201,contentType:'application/json',body:JSON.stringify({pairing:{code:codes%2?'ABCDE-23456':'FGHJK-789AB',expiresAt:new Date(Date.now()+(expiresSoon?2000:600000)).toISOString()}})}); });
    await page.route('**/api/devices/f0000000-0000-4000-8000-000000000001', r=>{ assert(r.request().method()==='PATCH','Wrong revoke method');revokes++;devices=[];return r.fulfill({status:200,contentType:'application/json',body:'{"revoked":true}'}); });
    await page.goto(base+'/flow-review-local',{waitUntil:'domcontentloaded',timeout:120000});
    const guide=page.getByRole('region',{name:'Quipus pairing setup'});
    await guide.waitFor({timeout:60000});
    await check('Calendar first, optional skip, account-scoped resume',async()=>{
      await page.getByRole('heading',{name:'Add your calendar, if you like.'}).waitFor();
      assert((await page.getByRole('link',{name:'Connect Google Calendar'}).getAttribute('href')).startsWith('/api/google/connect'),'Wrong connect href');
      await page.getByRole('button',{name:'Skip for now'}).click();
      await page.getByRole('heading',{name:'Connect your Quipus.'}).waitFor();
      await page.getByRole('button',{name:'Continue later'}).click();await page.reload();await page.getByRole('button',{name:'Resume setup'}).waitFor();
      await page.getByRole('button',{name:'Switch test account'}).click();await page.getByRole('heading',{name:'Add your calendar, if you like.'}).waitFor();
      assert(await page.getByRole('button',{name:'Resume setup'}).count()===0,'Cross-account collapse');
      await page.getByRole('button',{name:'Unknown calendar fixture'}).click();await page.getByRole('heading',{name:'Checking your calendar connection.'}).waitFor();
      assert(await page.getByRole('link',{name:'Connect Google Calendar'}).count()===0,'Unknown treated as disconnected');
      await page.getByRole('button',{name:'Continue later'}).click();await page.getByRole('button',{name:'Resume setup'}).click();
      await page.getByRole('button',{name:'Disconnected calendar fixture'}).click();await page.getByRole('heading',{name:'Add your calendar, if you like.'}).waitFor();
      await page.getByRole('button',{name:'Switch test account'}).click();await page.getByRole('button',{name:'Resume setup'}).click();await page.getByRole('heading',{name:'Connect your Quipus.'}).waitFor();
      await shot(page,'setup-pair-desktop.png');return{calendarOptional:true,unknownHonest:true,resumeAccountScoped:true};
    });
    await check('Four pairing stages explain same phone/laptop and wait for actual contact',async()=>{
      await guide.getByRole('button',{name:'Create pairing code',exact:true}).click();await guide.getByRole('heading',{name:'Join the recorder’s Wi-Fi.'}).waitFor();
      assert((await guide.innerText()).includes('Creating a code does not turn on its setup network.'),'Fake setup-network claim');
      assert((await guide.innerText()).includes('browser cannot verify'),'No Wi-Fi honesty');
      await guide.getByRole('button',{name:'I joined the recorder’s Wi-Fi'}).click();
      assert(await guide.getByRole('link',{name:'Open 192.168.4.1',exact:true}).getAttribute('href')==='http://192.168.4.1/','Wrong setup address');
      await shot(page,'pairing-save-desktop.png');await guide.getByRole('button',{name:'I saved the setup details'}).click();await guide.getByRole('heading',{name:'Return to internet and verify.'}).waitFor();
      assert(await page.getByRole('region',{name:'Quipus device health'}).count()===0,'Fake success');await shot(page,'pairing-waiting-desktop.png');return{stages:4};
    });
    await check('Unexpired pairing code/step resume and stay account scoped',async()=>{
      await page.reload();await page.getByRole('heading',{name:'Return to internet and verify.'}).waitFor();assert((await guide.innerText()).includes('ABCDE-23456'),'Code missing on reload');
      await page.getByRole('button',{name:'Switch test account'}).click();await page.getByRole('heading',{name:'Create your pairing code.'}).waitFor();assert(!(await guide.innerText()).includes('ABCDE-23456'),'Other account exposed code');
      await page.getByRole('button',{name:'Switch test account'}).click();await page.getByRole('heading',{name:'Return to internet and verify.'}).waitFor();
    });
    await check('Expiry clears stored secret and permits a new code',async()=>{
      expiresSoon=true;await guide.getByRole('button',{name:'Create new code'}).click();await page.getByText('Your code has expired.',{exact:false}).waitFor({timeout:10000});
      assert(await guide.getByRole('button',{name:'I joined the recorder’s Wi-Fi'}).isDisabled(),'Expired code accepted');assert(await page.evaluate(()=>localStorage.getItem('quipus:pairing:flow-owner%40example.test'))===null,'Expired secret remains');await shot(page,'pairing-expired-desktop.png');
      expiresSoon=false;await guide.getByRole('button',{name:'Create new code'}).click();await page.getByRole('heading',{name:'Join the recorder’s Wi-Fi.'}).waitFor();await guide.getByRole('button',{name:'I joined the recorder’s Wi-Fi'}).click();await guide.getByRole('button',{name:'I saved the setup details'}).click();return{codes};
    });
    await check('Failed connection check recovers to actual mocked device contact',async()=>{
      failGet=true;await guide.getByRole('button',{name:'Check connection now'}).click();await page.getByRole('button',{name:'Retry connection check'}).waitFor();await shot(page,'pairing-retry-desktop.png');
      failGet=false;devices=[makeDevice()];await page.getByRole('button',{name:'Retry connection check'}).click();await page.getByRole('region',{name:'Quipus device health'}).waitFor();
      assert(await page.getByText('Online',{exact:true}).isVisible(),'Fresh contact not online');assert(await page.getByText('81%',{exact:true}).isVisible(),'Battery missing');assert((await page.getByRole('region',{name:'Test the recorder'}).innerText()).includes('Computer'),'Test instructions absent');assert(await page.evaluate(()=>localStorage.getItem('quipus:pairing:flow-owner%40example.test'))===null,'Used code remains');await shot(page,'paired-device-desktop.png');
    });
    await check('Stale heartbeat never displays old online flag as a live connection',async()=>{
      devices=[{...makeDevice(),last_seen_at:new Date(Date.now()-3600000).toISOString()}];await page.getByRole('button',{name:'Refresh status'}).click();await page.getByText('No recent heartbeat',{exact:true}).waitFor();assert(await page.getByText('Online',{exact:true}).count()===0,'Stale marked online');assert((await page.getByRole('region',{name:'Quipus device health'}).innerText()).includes('last-reported values'),'No stale-value disclosure');await shot(page,'paired-device-stale.png');
    });
    await check('Revoke opens review; Cancel and Escape submit no API request',async()=>{
      await page.getByRole('button',{name:'Revoke device'}).click();const dialog=page.getByRole('dialog',{name:'Remove Local test Quipus?'});await dialog.waitFor();assert(revokes===0,'Open revoked');await shot(page,'revoke-confirmation-desktop.png');await dialog.getByRole('button',{name:'Keep device'}).click();await dialog.waitFor({state:'hidden'});assert(revokes===0,'Cancel revoked');
      await page.getByRole('button',{name:'Revoke device'}).click();await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert(revokes===0,'Escape revoked');return{cancelSafe:true,escapeSafe:true};
    });
    await check('Onboarding completes only after actual fixture pairing and uploaded recording',async()=>{
      await page.getByRole('button',{name:'Toggle paired fixture'}).click();await page.getByRole('heading',{name:'Try your first recording.'}).waitFor();await page.getByRole('button',{name:'Toggle recording fixture'}).click();assert(await page.getByRole('button',{name:'Continue later'}).count()===0,'Not complete');await page.getByRole('button',{name:'Toggle recording fixture'}).click();await page.getByRole('heading',{name:'Try your first recording.'}).waitFor();
    });
    await check('Onboarding/paired health avoid 390px and 320px overflow',async()=>{
      const results=[];for(const width of [390,320]) {await page.setViewportSize({width,height:844});results.push(await overflow(page));await shot(page,`paired-device-mobile-${width}.png`);}return results;
    });
    await check('Confirmed revoke uses mocked API once and returns to pairing',async()=>{
      await page.getByRole('button',{name:'Revoke device'}).click();await page.getByRole('dialog').getByRole('button',{name:'Confirm revoke'}).click();await page.getByRole('heading',{name:'Create your pairing code.'}).waitFor();assert(revokes===1,'Duplicate/missing revoke');await overflow(page);await shot(page,'pairing-mobile-320.png');return{mockedRevokes:revokes};
    });
    await ctx.close();
  } finally { await browser.close();await fs.writeFile(path.join(__dirname,prefix+'setup-pairing-report.json'),JSON.stringify(report,null,2)); }
  assert(report.pageErrors.length===0,'Browser errors '+JSON.stringify(report.pageErrors));assert(report.unexpectedApiRequests.length===0,'Unmatched APIs '+JSON.stringify(report.unexpectedApiRequests));assert(report.checks.every(c=>c.pass),'One or more setup checks failed');
})().catch(e=>{console.error(e);process.exitCode=1;});

