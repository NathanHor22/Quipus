const {chromium}=require('playwright-core');
const fs=require('node:fs/promises');
const path=require('node:path');
const base=process.argv[2]||'http://127.0.0.1:3007';
const prefix=process.env.UI_REVIEW_PREFIX||'glass-';
const report={checks:[],errors:[],screenshots:[]};
const assert=(ok,message)=>{if(!ok)throw Error(message)};
async function check(name,fn){try{const result=await fn();report.checks.push({name,pass:true,result});console.log('PASS',name)}catch(e){report.checks.push({name,pass:false,error:e.message});console.log('FAIL',name,e.message)}}
async function shot(page,name){const file=prefix+name+'.png';await page.screenshot({path:path.join(__dirname,file),fullPage:true});report.screenshots.push(file)}
async function overflow(page){const d=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));assert(d.document<=d.viewport+1,JSON.stringify(d));return d}
async function ready(page){await page.getByRole('navigation',{name:'Main navigation'}).waitFor();await page.locator('[aria-label="Conversation history"] button[aria-label^="Open "]').first().waitFor();await page.waitForTimeout(1050)}
async function nav(page,name){await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name,exact:true}).click();await page.waitForTimeout(1050)}
const track=page=>page.on('pageerror',e=>report.errors.push(e.message));
(async()=>{
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const ctx=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'no-preference',serviceWorkers:'block'});
 const page=await ctx.newPage();track(page);
 await check('Public sample with angular glass and compact history',async()=>{
  const response=await page.goto(base+'/');assert(response.status()===200,'HTTP '+response.status());await ready(page);
  const d=await page.locator('[aria-label="Conversation history"] button[aria-label^="Open "]').first().evaluate(e=>({height:e.getBoundingClientRect().height,panel:getComputedStyle(e.parentElement.parentElement.parentElement).backdropFilter}));
  assert(d.height>=60&&d.height<=70,JSON.stringify(d));await shot(page,'home-desktop');return overflow(page);
 });
 await check('Header is a single desktop row with text navigation',async()=>{
  const d=await page.getByRole('banner').evaluate(e=>({height:e.getBoundingClientRect().height,display:getComputedStyle(e).display,navSvg:e.querySelector('nav').querySelectorAll('svg').length}));assert(d.height<110&&d.display==='grid'&&d.navSvg===0,JSON.stringify(d));return d;
 });
 await check('Reset sample and all secondary home actions have button frames',async()=>{
  for(const name of ['Reset sample','View all','Open calendar']){
   const d=await page.getByRole('button',{name,exact:true}).evaluate(e=>({border:parseFloat(getComputedStyle(e).borderTopWidth),height:e.getBoundingClientRect().height,padding:getComputedStyle(e).padding}));assert(d.border>=1&&d.height>=32,name+':'+JSON.stringify(d));
  }
 });
 await check('Decorative motion has no user-facing toggle and persists across routes',async()=>{
  assert(await page.getByRole('button',{name:/decorative motion/}).count()===0,'Motion toggle remains');
  await page.evaluate(()=>window.__backdrop=document.querySelector('[data-active]'));
  for(const tab of ['Calendar','Devices','Conversations','Home']){await nav(page,tab);await overflow(page)}
  assert(await page.evaluate(()=>window.__backdrop===document.querySelector('[data-active]')),'Backdrop remounted');
 });
 await check('Search and date remain after opening and returning from a report',async()=>{
  await nav(page,'Conversations');
  const row=page.locator('[aria-label="Conversation history"] button[aria-label^="Open "]').first();const query=(await row.locator('strong').innerText()).split(' ')[0];
  await page.getByRole('textbox',{name:'Search conversations'}).fill(query);await row.click();await page.getByRole('tablist',{name:'Conversation details'}).waitFor();await page.waitForTimeout(950);await shot(page,'detail-desktop');
  await page.getByRole('button',{name:'Back to conversations',exact:true}).click();await page.getByRole('textbox',{name:'Search conversations'}).waitFor();assert(await page.getByRole('textbox',{name:'Search conversations'}).inputValue()===query,'Search reset');
  await page.getByLabel('Filter conversation date').fill('2026-10-06');await nav(page,'Devices');await shot(page,'devices-desktop');await nav(page,'Conversations');assert(await page.getByLabel('Filter conversation date').inputValue()==='2026-10-06','Date reset');await page.getByRole('button',{name:'Clear conversation filters'}).click();
 });
 await check('Calendar and report popup use matching panels',async()=>{
  await nav(page,'Calendar');await shot(page,'calendar-desktop');
  const event=page.locator('button').filter({hasText:'Chung'}).first();await event.click();const dialog=page.getByRole('dialog',{name:'Meeting details'});await dialog.waitFor();
  for(const tab of ['Summary','Actions','Transcript','Audio']){await dialog.getByRole('tab',{name:tab,exact:true}).click();assert(await dialog.getByRole('tabpanel',{name:tab,exact:true}).isVisible(),'Missing '+tab);await shot(page,'popup-'+tab.toLowerCase());}
  await dialog.getByRole('button',{name:'Close',exact:true}).click();return overflow(page);
 });
 await check('Settings uses framed controls and aligned panels',async()=>{await page.goto(base+'/?mode=sample&view=settings');await page.getByRole('heading',{name:'Settings',exact:true}).waitFor();await page.waitForTimeout(950);await shot(page,'settings-desktop');return overflow(page)});
 await check('Optional dark workspace stays readable',async()=>{await nav(page,'Home');await page.getByRole('button',{name:'Switch to dark theme'}).click();assert(await page.evaluate(()=>document.documentElement.dataset.theme)==='dark','Dark missing');await shot(page,'home-dark');await overflow(page);await page.getByRole('button',{name:'Switch to light theme'}).click()});
 await check('Sign-in group is centred and logo loaded',async()=>{
  const r=await page.goto(base+'/login');assert(r.status()===200,'Login '+r.status());await page.getByRole('link',{name:'Explore a sample workspace'}).waitFor();await page.waitForTimeout(1100);
  const d=await page.locator('section[aria-labelledby="login-title"]').evaluate(e=>{const b=e.getBoundingClientRect(),g=e.parentElement.getBoundingClientRect();return {x:b.x+b.width/2,y:g.y+g.height/2,width:innerWidth,height:innerHeight,loaded:[...document.querySelectorAll('img')].some(i=>i.alt==='Quipus'&&i.complete&&i.naturalWidth>0)}});
  assert(Math.abs(d.x-d.width/2)<3&&Math.abs(d.y-d.height/2)<40&&d.loaded,JSON.stringify(d));await shot(page,'login-desktop');return overflow(page);
 });
 await ctx.close();
 for(const width of [390,320]){
  const c=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce',serviceWorkers:'block'});const p=await c.newPage();track(p);
  await check('Mobile '+width+' workspace screens fit',async()=>{await p.goto(base+'/');await ready(p);await shot(p,'home-'+width);for(const tab of ['Calendar','Devices','Conversations']){await nav(p,tab);await overflow(p);await shot(p,tab.toLowerCase()+'-'+width)}return overflow(p)});
  await check('Mobile '+width+' all report tabs fit',async()=>{await p.locator('[aria-label="Conversation history"] button[aria-label^="Open "]').first().click();await p.getByRole('tablist',{name:'Conversation details'}).waitFor();for(const tab of ['Summary','Actions','Transcript','Audio']){await p.getByRole('tab',{name:tab,exact:true}).click();await overflow(p);await shot(p,'detail-'+tab.toLowerCase()+'-'+width)}});
  await check('Mobile '+width+' centred sign-in fits',async()=>{await p.goto(base+'/login');await p.getByRole('link',{name:'Explore a sample workspace'}).waitFor();await shot(p,'login-'+width);return overflow(p)});await c.close();
 }
 const c=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});const p=await c.newPage();track(p);
 await check('System reduced motion is respected without a toggle',async()=>{await p.goto(base+'/');await ready(p);assert(await p.locator('[data-quipus-motion="off"]').count()===1,'Motion active');assert(await p.locator('h1[data-revealing="true"]').count()===0,'Scramble active');assert(await p.getByRole('button',{name:/decorative motion/}).count()===0,'Toggle present');const name=await p.locator('[data-fragment]').first().evaluate(e=>getComputedStyle(e).animationName);assert(name==='none','Animation '+name);await shot(p,'reduced-motion')});await c.close();
 await check('No runtime exceptions',async()=>assert(!report.errors.length,JSON.stringify(report.errors)));
}finally{await browser.close();await fs.writeFile(path.join(__dirname,prefix+'report.json'),JSON.stringify(report,null,2))}
console.log(JSON.stringify({passed:report.checks.filter(c=>c.pass).length,failed:report.checks.filter(c=>!c.pass).length,errors:report.errors.length}));process.exitCode=report.checks.some(c=>!c.pass)?1:0;
})().catch(async e=>{report.fatal=e.stack;await fs.writeFile(path.join(__dirname,prefix+'report.json'),JSON.stringify(report,null,2));console.error(e);process.exitCode=1});
