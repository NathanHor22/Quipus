const { chromium } = require('../node_modules/playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const report = { checks: [], screenshots: [], pageErrors: [] };
const assert = (value, message) => { if (!value) throw new Error(message); };
(async () => {
  const browser = await chromium.launch({ executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true });
  try {
    const context = await browser.newContext({ viewport:{width:1440,height:1000}, reducedMotion:'reduce', serviceWorkers:'block' });
    const page = await context.newPage(); page.on('pageerror', error=>report.pageErrors.push(error.message));
    const fixture = {id:'f0000000-0000-4000-8000-000000000001',name:'Local test Quipus',model:'ESP32-S3 touchscreen fixture',firmware_version:'local-review',last_seen_at:new Date().toISOString(),status:'online',device_state:'ready',state_version:1,battery_level:81,network_type:'wifi',free_heap_bytes:110000,last_error:null};
    await page.route('**/api/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({devices:[fixture]})}));
    await page.goto('http://127.0.0.1:3007/flow-review-local',{waitUntil:'domcontentloaded',timeout:60000});
    const heading = page.getByRole('heading',{name:'Add your calendar, if you like.'});await heading.waitFor();
    const surface = await heading.evaluate(e=>{const s=getComputedStyle(e.closest('section'));return{background:s.backgroundColor,border:s.borderWidth,position:s.position,blur:s.backdropFilter}});
    assert(surface.border==='1px' && surface.position==='relative' && surface.blur.includes('blur'),'First setup surface rule still absent '+JSON.stringify(surface));
    report.checks.push({name:'First CSS rule applies after removing UTF-8 BOM',pass:true,result:surface});
    await page.screenshot({path:path.join(__dirname,'final-glass-setup-device-desktop.png'),fullPage:true});report.screenshots.push('final-glass-setup-device-desktop.png');
    await page.getByRole('button',{name:'Revoke device'}).click();const dialog=page.getByRole('dialog',{name:'Remove Local test Quipus?'});await dialog.waitFor();
    const dialogSurface=await dialog.evaluate(e=>{const s=getComputedStyle(e);return{background:s.backgroundColor,blur:s.backdropFilter,border:s.borderTopWidth}});
    assert(dialogSurface.background.includes('0.93'),'Dialog text is not backed by stronger glass '+JSON.stringify(dialogSurface));
    report.checks.push({name:'Revoke dialog uses strong frosted surface',pass:true,result:dialogSurface});
    await page.screenshot({path:path.join(__dirname,'final-glass-revoke-desktop.png'),fullPage:false});report.screenshots.push('final-glass-revoke-desktop.png');
    await dialog.getByRole('button',{name:'Keep device'}).click();
    for (const width of [390,320]) {
      await page.setViewportSize({width,height:844});
      const dimensions=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));assert(dimensions.document<=dimensions.viewport+1,'Mobile overflow '+JSON.stringify(dimensions));
      report.checks.push({name:`Setup and device at ${width}px`,pass:true,result:dimensions});
      await page.screenshot({path:path.join(__dirname,`final-glass-setup-device-mobile-${width}.png`),fullPage:true});report.screenshots.push(`final-glass-setup-device-mobile-${width}.png`);
    }
    await page.evaluate(()=>document.documentElement.dataset.theme='dark');
    await page.getByRole('button',{name:'Revoke device'}).click();await dialog.waitFor();
    const dark = await dialog.getByRole('button',{name:'Confirm revoke'}).evaluate(e=>{const s=getComputedStyle(e);return{background:s.backgroundColor,color:s.color}});
    assert(dark.color!=='rgb(255, 255, 255)','Dark pink danger button has illegible white text');
    report.checks.push({name:'Dark revoke button uses contrasting navy text',pass:true,result:dark});
    await page.screenshot({path:path.join(__dirname,'final-glass-revoke-dark-mobile.png'),fullPage:false});report.screenshots.push('final-glass-revoke-dark-mobile.png');
    assert(report.pageErrors.length===0,'Runtime errors '+JSON.stringify(report.pageErrors));
    console.log(JSON.stringify(report.checks,null,2));
    await context.close();
  } finally {await browser.close();await fs.writeFile(path.join(__dirname,'final-glass-surface-report.json'),JSON.stringify(report,null,2));}
})().catch(error=>{console.error(error);process.exitCode=1});


