// Real Chromium UI with a simulated GATT peripheral. Hardware/radio and OS PIN
// dialogs still require acceptance testing on Windows and Android.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const destination = path.join(repository, ".tools", "bluetooth-browser-evidence");
await mkdir(destination, { recursive: true });
const profile = await mkdtemp(path.join(destination, "chromium-"));
const bundle = path.join(destination, "fixture.js");
await build({ stdin: { contents:
  'import {createRoot} from "react-dom/client"; import {BluetoothRecorderSetup} from "./components/workspace/BluetoothRecorderSetup"; const root=createRoot(document.getElementById("app"));window.dispose=()=>root.unmount();root.render(<BluetoothRecorderSetup onConnected={()=>{window.verified=true;document.getElementById("done").textContent="Verified online";}}/>);',
  resolveDir: repository, loader: "tsx" }, outfile: bundle, bundle: true,
  jsx: "automatic", format: "esm", tsconfig: path.join(repository, "tsconfig.json"),
});
const mock = String.raw`
const mode=new URLSearchParams(location.search).get('case');
window.writes=[];window.apiBodies=[];window.cloudChecks=0;window.verified=false;window.protectedReads=0;
const status=()=>({v:1,state:window.writes.some(f=>f[0]===3)?'saved':'ready',error:'',savedSsid:'',networks:[{ssid:'Office & Lab',secured:true}]});
const bytes=v=>new DataView(new TextEncoder().encode(JSON.stringify(v)).buffer);
const gatt={connected:false,async connect(){this.connected=true;return this},disconnect(){this.connected=false},async getPrimaryService(){return {async getCharacteristic(id){return {
async readValue(){if(id.endsWith('0002'))return bytes({v:1,firmware:'0.10.0-quipus',backend:mode==='wrong-site'?'https://other.example':location.origin,hardwareId:'esp32s3:aabbccddeeff',available:true});window.protectedReads++;if(mode==='unmount')await new Promise(resolve=>setTimeout(resolve,3000));return bytes(status())},
async writeValueWithResponse(frame){if(mode==='disconnect'&&window.writes.length===2){gatt.connected=false;throw new DOMException('Disconnected','NetworkError')}window.writes.push([...frame])}
}}}}};
window.gatt=gatt;Object.defineProperty(navigator,'bluetooth',{configurable:true,value:mode==='unsupported'?undefined:{async requestDevice(options){window.filters=options;if(mode==='cancel')throw new DOMException('Cancelled','NotFoundError');return {name:'Quipus-BT-EEFF',gatt}}}});
window.fetch=async(url,options={})=>{if(url==='/api/devices/pairing'){window.apiBodies.push(JSON.parse(options.body));return new Response(JSON.stringify({pairing:{code:'ABCDE-23456',expiresAt:new Date(Date.now()+600000).toISOString()}}),{status:201,headers:{'content-type':'application/json'}})}if(url==='/api/devices'){window.cloudChecks++;return new Response(JSON.stringify({devices:[{hardware_id:window.cloudChecks===1?'another-recorder':'esp32s3:aabbccddeeff',status:'online',last_seen_at:new Date().toISOString()}]}),{headers:{'content-type':'application/json'}})}throw new Error('Unexpected request '+url)};
`;
const server = http.createServer(async (request, response) => {
  if (request.url === "/fixture.js") { response.setHeader("content-type", "text/javascript"); response.end(await readFile(bundle)); }
  else if (request.url === "/fixture.css") { response.setHeader("content-type", "text/css"); response.end(await readFile(bundle.replace(/js$/, "css"))); }
  else { response.setHeader("content-type", "text/html"); response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>body{font:16px system-ui;margin:0;color:#193628}#app{max-width:560px;margin:16px auto;padding:8px;box-sizing:border-box}</style><div id="app"></div><p id="done"></p><script>'+mock+'</script><script type="module" src="/fixture.js"></script>'); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + server.address().port;
assert(process.env.QUIPUS_CHROMIUM_EXECUTABLE, "Set QUIPUS_CHROMIUM_EXECUTABLE");
const browser = spawn(process.env.QUIPUS_CHROMIUM_EXECUTABLE, ["--no-sandbox", "--headless=new", "--disable-gpu", "--remote-debugging-port=0", "--user-data-dir="+profile, "about:blank"], { stdio: "ignore" });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(action, label) {
  for(let attempt=0;attempt<160;attempt++){try {if(await action())return;}catch{}await pause(50);}
  throw new Error("Timed out: "+label);
}
let socket;
try {
  let port;
  await until(async()=>{port=(await readFile(path.join(profile,"DevToolsActivePort"),"utf8")).split("\n")[0];return port},"debugging port");
  const tabs=await(await fetch("http://127.0.0.1:"+port+"/json/list")).json();
  socket=new WebSocket(tabs.find(tab=>tab.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
  const pending=new Map();let id=0;const exceptions=[];
  socket.onmessage=message=>{const event=JSON.parse(message.data);if(event.method==='Runtime.exceptionThrown')exceptions.push(event.params.exceptionDetails);const call=pending.get(event.id);if(call){pending.delete(event.id);event.error?call.reject(new Error(JSON.stringify(event.error))):call.resolve(event.result)}};
  function cdp(method,params={}){return new Promise((resolve,reject)=>{const number=++id;pending.set(number,{resolve,reject});socket.send(JSON.stringify({id:number,method,params}))})}
  async function evaluate(expression){const result=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value}
  await cdp('Runtime.enable');
  async function navigate(mode,width=390){await cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<620});await cdp('Page.navigate',{url:origin+'/?case='+mode});await until(()=>evaluate("!!document.querySelector('button')"),mode+' render');await pause(150)}
  const click=()=>evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Connect with Bluetooth').click()");
  for(const mode of ['cancel','wrong-site','unsupported']){
    await navigate(mode);
    if(mode==='unsupported'){assert.equal(await evaluate("document.querySelector('button').disabled"),true);continue;}
    await click();
    await until(()=>evaluate("!!document.querySelector('[role=alert]')"),mode+' error');
    assert.equal(await evaluate('window.writes.length'),0);
    if(mode==='wrong-site')assert.equal(await evaluate('window.protectedReads'),0);
  }
  await navigate('unmount');
  await click();
  await until(()=>evaluate('window.protectedReads>0'), 'protected pairing read');
  await evaluate('window.dispose()');
  assert.equal(await evaluate('window.gatt.connected'),false,'navigation closes an in-progress OS pairing connection');
  for(const mode of ['success','disconnect']){
    await navigate(mode,mode==='success'?320:1200);
    await click();
    await until(()=>evaluate("!!document.querySelector('form') && ![...document.querySelectorAll('button')].find(b=>b.textContent==='Save and connect').disabled"),mode+' network form');
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
    await evaluate("(()=>{const inputs=document.querySelectorAll('input:not([type=checkbox])');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(inputs[0],'Office & Lab');inputs[0].dispatchEvent(new Event('input',{bubbles:true}));setter.call(inputs[1],'a+b&c=d123');inputs[1].dispatchEvent(new Event('input',{bubbles:true}));})()");
    await pause(100);
    await writeFile(path.join(destination,mode+'-network.png'),Buffer.from((await cdp('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await evaluate("document.querySelector('form').requestSubmit()");
    if(mode==='success'){
      await until(()=>evaluate('window.cloudChecks===1'), 'first cloud check');
      assert.equal(await evaluate('window.verified'),false,'another recorder cannot certify success');
      await until(()=>evaluate('window.verified'), 'exact recorder verified');
      assert.equal(await evaluate("window.apiBodies.every(b=>JSON.stringify(b)===''+JSON.stringify({name:'My Quipus'}))"),true,'Wi-Fi secrets never enter API requests');
      assert.equal(await evaluate("window.writes.some(f=>f[0]===3)"),true);
      const form=await evaluate("new URLSearchParams(new TextDecoder().decode(new Uint8Array(window.writes.filter(f=>f[0]===2).flatMap(f=>f.slice(3))))).get('password')");
      assert.equal(form,'a+b&c=d123');
      assert.equal(await evaluate("!!document.querySelector('input[type=password]')"),false,'password removed after submission');
    }else{
      await until(()=>evaluate("!!document.querySelector('[role=alert]')"),'disconnect error');
      assert.equal(await evaluate('window.verified'),false);
      assert.equal(await evaluate('window.writes.some(f=>f[0]===3)'),false);
    }
  }
  assert.deepEqual(exceptions,[]);
  console.log('PASS: real Chromium UI, 320px mobile/desktop, permissions, cancellation, wrong backend, Unicode framing, interrupted transfer, no credential API leak and exact-device cloud verification. Peripheral and OS PIN are simulated.');
  await Promise.race([cdp('Browser.close').catch(()=>{}),pause(1000)]);
} finally {
  socket?.close();browser.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await pause(300);await rm(profile,{recursive:true,force:true}).catch(()=>{});
}
