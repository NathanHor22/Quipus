import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const firmware = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repository = path.resolve(firmware, "../..");
const destination = path.join(repository, "output", "wifi-setup");
await mkdir(destination, { recursive: true });
const profile = await mkdtemp(path.join(destination, "chromium-"));
const board = await readFile(path.join(firmware, "main", "lantern_board.h"), "utf8");
const website = process.env.QUIPUS_WEB_ORIGIN || board.match(/#define LANTERN_API_BASE_URL "([^"]+)"/)[1];
const returnScript = await readFile(path.join(firmware, "main", "setup-return.js"), "utf8");
async function render(name) {
  return (await readFile(path.join(firmware, "main", name), "utf8"))
    .replace("<!-- QUIPUS_SETUP_RETURN -->", "<script>" + returnScript + "</script>")
    .replaceAll("{{QUIPUS_WEB_ORIGIN}}", website);
}
const html = await render("setup-portal.html");
const savedHtml = await render("setup-saved.html");
let state = { wifi_connected: true, paired: false, connected_ssid: "Office Wi-Fi", saved_ssid: "Office Wi-Fi", ip: "10.0.0.8", last_error: "" };
let submissionError = false;
let submitted = null;
let cloudOnline = false;
const cloudRequests = [];
const server = http.createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  if (request.url === "/status") {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(state));
  } else if (request.url === "/configure") {
    let body = "";
    for await (const chunk of request) body += chunk;
    submitted = new URLSearchParams(body);
    response.statusCode = submissionError ? 400 : 200;
    response.setHeader("Content-Type", "text/plain");
    response.end(submissionError ? "The pairing code has expired. Create a new code in your dashboard." : "Settings saved");
  } else if (request.url === "/favicon.ico") {
    response.statusCode = 204;
    response.end();
  } else {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(request.url === "/saved" ? savedHtml : html);
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + server.address().port;
let executable = process.env.QUIPUS_CHROMIUM_EXECUTABLE;
if (!executable) {
  assert(process.env.LOCALAPPDATA, "Set QUIPUS_CHROMIUM_EXECUTABLE to a local Chromium executable.");
  const installed = await readdir(path.join(process.env.LOCALAPPDATA, "ms-playwright"));
  const chromium = installed.filter((entry) => /^chromium-\d+$/.test(entry)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))[0];
  assert(chromium, "Install Chromium to run the local portal browser check.");
  executable = path.join(process.env.LOCALAPPDATA, "ms-playwright", chromium, "chrome-win64", "chrome.exe");
}
const sandbox = process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : [];
const browser = spawn(executable, [...sandbox, "--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + profile, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-gpu", "about:blank"], { windowsHide: true, stdio: "ignore" });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(action, description) {
  for (let i = 0; i < 100; i++) {
    try { const result = await action(); if (result) return result; } catch {}
    await sleep(50);
  }
  throw new Error("Timed out: " + description);
}
let socket;
try {
  const port = await until(async () => (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0], "Chromium debugging port");
  const tabs = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
  socket = new WebSocket(tabs.find((tab) => tab.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  const exceptions = [];
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.method === "Runtime.exceptionThrown") exceptions.push(data.params.exceptionDetails);
    if (data.method === "Fetch.requestPaused") {
      const { requestId, request } = data.params;
      cloudRequests.push(request.url);
      const picture = new URL(request.url).pathname === "/quipus-icon-192.png";
      const action = cloudOnline
        ? cdp("Fetch.fulfillRequest", { requestId, responseCode: 200,
          responseHeaders: [{ name: "Content-Type", value: picture ? "image/png" : "text/html" }],
          body: picture ? "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZsAAAAASUVORK5CYII=" : Buffer.from("<title>Quipus dashboard</title><p>Device verification</p>").toString("base64") })
        : cdp("Fetch.failRequest", { requestId, errorReason: "InternetDisconnected" });
      action.catch((error) => exceptions.push(error.message));
    }
    const entry = pending.get(data.id);
    if (entry) { pending.delete(data.id); data.error ? entry.reject(new Error(JSON.stringify(data.error))) : entry.resolve(data.result); }
  };
  function cdp(method, params = {}) {
    const id = ++nextId;
    return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  }
  async function evaluate(expression) {
    const value = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (value.exceptionDetails) throw new Error(JSON.stringify(value.exceptionDetails));
    return value.result.value;
  }
  await cdp("Runtime.enable");
  await cdp("Page.enable");
  await cdp("Fetch.enable", { patterns: [{ urlPattern: website + "/*" }] });
  async function navigate(width, height, filename, hash = "") {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 620 });
    await cdp("Page.navigate", { url: origin + "/?case=" + filename + hash });
    await until(() => evaluate("document.readyState === 'complete' && document.getElementById('wifi-state').textContent === " + JSON.stringify(state.wifi_connected ? "Connected" : "Not connected")), filename + " status");
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true, filename + " must not overflow horizontally");
    assert.equal(await evaluate("[...document.querySelectorAll('button,input,summary')].filter(e=>e.getClientRects().length).every(e=>e.getBoundingClientRect().width >= 40)"), true, "Controls need usable hit targets");
    const picture = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(path.join(destination, filename + ".png"), Buffer.from(picture.data, "base64"));
  }
  await navigate(1200, 900, "desktop-connected-unpaired");
  assert.equal(await evaluate("document.getElementById('network').open"), false);
  assert.equal(await evaluate("document.getElementById('code').required"), true);
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  assert.equal(await evaluate("document.activeElement.tagName"), "SUMMARY");
  assert.equal(await evaluate("getComputedStyle(document.activeElement).outlineStyle"), "solid");
  await navigate(390, 844, "mobile-connected-unpaired");
  await navigate(320, 740, "small-mobile-connected-unpaired");
  await navigate(390, 844, "mobile-invalid-handoff", "#code=%3Cscript%3Ealert(1)%3C/script%3E");
  assert.equal(await evaluate("document.getElementById('code').value"), "", "Malformed handoff codes are ignored");
  await navigate(390, 844, "mobile-dashboard-handoff", "#code=ABCDE-23456&return=https://example.com");
  assert.equal(await evaluate("document.getElementById('code').value"), "ABCDE-23456");
  assert.equal(await evaluate("location.hash"), "", "The pairing code is cleared from browser history");
  assert.equal(await evaluate("document.querySelector('[data-quipus-dashboard]').href"), website + "/dashboard/devices", "Fragment input cannot change the return destination");
  await evaluate("document.getElementById('code').value='ABCDE-FGHIJ'");
  submissionError = true;
  await evaluate("document.getElementById('setup-form').requestSubmit()");
  await until(() => evaluate("!document.getElementById('save').disabled && !document.getElementById('error').hidden"), "inline error");
  assert.match(await evaluate("document.getElementById('error').textContent"), /expired/);
  assert.equal(submitted.get("code"), "ABCDE-FGHIJ");
  assert.equal(submitted.get("ssid"), "", "Connected Wi-Fi may be reused");
  submissionError = false;
  await evaluate("document.getElementById('setup-form').requestSubmit()");
  await until(() => evaluate("!document.getElementById('saved').hidden"), "saved state");
  assert.equal(await evaluate("document.activeElement.id"), "saved");
  assert.equal(await evaluate("document.getElementById('saved').textContent.includes('Keep it powered on.')"), true);
  await writeFile(path.join(destination, "mobile-saved.png"), Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await until(() => cloudRequests.length > 0, "offline website probe");
  assert.equal(await evaluate("location.origin"), origin, "No redirect while the website is offline");
  cloudOnline = true;
  await evaluate("window.dispatchEvent(new Event('online'))");
  await until(() => evaluate("document.title === 'Quipus dashboard'"), "return to the existing website");
  assert.equal(await evaluate("location.href"), website + "/dashboard/devices");
  assert(cloudRequests.every((url) => !url.includes("ABCDE") && !url.includes("FGHIJ") && !url.includes("Office")), "Cloud probes never receive setup form values");
  cloudOnline = false;
  await cdp("Page.navigate", { url: origin + "/saved" });
  await until(() => evaluate("document.readyState === 'complete' && document.querySelector('[data-return-auto]') !== null"), "plain form confirmation");
  assert.equal(await evaluate("document.querySelector('[data-quipus-dashboard]').href"), website + "/dashboard/devices");
  cloudOnline = true;
  await evaluate("window.dispatchEvent(new Event('online'))");
  await until(() => evaluate("document.title === 'Quipus dashboard'"), "plain form return to website");
  cloudOnline = false;
  state = { ...state, paired: false, reset_pending: true, wifi_connected: false, connected_ssid: "" };
  await navigate(390, 844, "mobile-reset-wifi-recovery", "#code=ABCDE-23456");
  assert.equal(await evaluate("document.getElementById('account-state').textContent"), "Resetting");
  assert.equal(await evaluate("document.getElementById('code').disabled"), true);
  assert.equal(await evaluate("document.getElementById('code').required"), false);
  assert.equal(await evaluate("document.getElementById('pairing').hidden"), true);
  assert.equal(await evaluate("document.getElementById('reset-note').hidden"), false);
  assert.equal(await evaluate("document.getElementById('save').textContent"), "Save Wi-Fi");
  await evaluate("document.getElementById('ssid').value='Recovery Wi-Fi';document.getElementById('password').value='test-only';document.getElementById('setup-form').requestSubmit()");
  await until(() => evaluate("!document.getElementById('saved').hidden"), "reset-only Wi-Fi saved");
  assert.equal(submitted.get("ssid"), "Recovery Wi-Fi");
  assert.equal(submitted.has("code"), false, "Reset recovery must never submit a pairing code");
  state = { ...state, paired: true, reset_pending: false };
  await navigate(390, 844, "mobile-paired", "#code=ABCDE-23456");
  assert.equal(await evaluate("document.getElementById('code').disabled"), true);
  assert.equal(await evaluate("document.getElementById('pairing').hidden"), true);
  assert.equal(await evaluate("new FormData(document.getElementById('setup-form')).has('code')"), false, "A handoff code cannot replace an already paired account");
  state = { ...state, wifi_connected: false, connected_ssid: "", saved_ssid: "", paired: false };
  await navigate(390, 844, "mobile-new-device");
  assert.equal(await evaluate("document.getElementById('network').open"), true);
  await evaluate("document.getElementById('reveal').click()");
  assert.equal(await evaluate("document.getElementById('password').type"), "text");
  await evaluate("document.getElementById('reveal').click()");
  assert.equal(await evaluate("document.getElementById('password').type"), "password");
  await evaluate("document.getElementById('code').value='ABCDE-FGHIJ';document.getElementById('setup-form').requestSubmit()");
  assert.equal(await evaluate("document.activeElement.id"), "ssid");
  assert.match(await evaluate("document.getElementById('error').textContent"), /2.4 GHz/);
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  assert.equal(await evaluate("getComputedStyle(document.getElementById('save')).transitionDuration"), "0s");
  assert.equal(exceptions.length, 0, "No browser script errors");
  console.log("PASS: desktop + 390/320px mobile, dashboard code handoff, fixed return destination, offline wait and online redirect for both confirmation pages, connected/unpaired/paired/new-device states, keyboard focus, password reveal, inline errors, no horizontal overflow, reduced motion.");
  console.log("Visual evidence: " + destination);
  await cdp("Browser.close").catch(() => {});
} finally {
  socket?.close();
  browser.kill();
  await new Promise((resolve) => server.close(resolve));
  await sleep(500);
  // Only remove this test's generated Chromium profile, never a user's browser data.
  if (profile.startsWith(destination + path.sep) && path.basename(profile).startsWith("chromium-")) {
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}
