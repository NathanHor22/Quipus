// Run: node scripts/test-auth-forms.browser.mjs
// Uses installed Chromium and isolated profiles; never loads real sessions.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { tsImport } from "tsx/esm/api";

import nextConfig from "../next.config.mjs";

const { browserMutationError } = await tsImport("../lib/request-security.ts", import.meta.url);
const configuredHeaders = (await nextConfig.headers())
  .find((rule) => rule.source === "/:path*")?.headers;
assert(configuredHeaders, "The test must use the global Next.js response headers.");
const configuredPolicy = configuredHeaders.find(
  (header) => header.key.toLowerCase() === "referrer-policy",
)?.value;
assert(configuredPolicy, "A global Referrer-Policy is required.");

async function findBrowser() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    process.platform === "win32" && process.env.PROGRAMFILES &&
      path.join(process.env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe"),
    process.platform === "win32" && process.env["PROGRAMFILES(X86)"] &&
      path.join(process.env["PROGRAMFILES(X86)"], "Microsoft/Edge/Application/msedge.exe"),
    ...(process.platform === "win32" ? [] : [
      "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]),
  ].filter(Boolean);
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    const cache = path.join(process.env.LOCALAPPDATA, "ms-playwright");
    const installed = await readdir(cache).catch(() => []);
    for (const folder of installed.filter((name) => /^chromium-\d+$/u.test(name)).sort().reverse()) {
      candidates.push(path.join(cache, folder, "chrome-win64/chrome.exe"));
    }
  }
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch {}
  }
  throw new Error("Install Chrome/Chromium or set CHROMIUM_PATH to run this browser regression.");
}

const captures = new Map();
let targetOrigin;
const server = http.createServer(async (incoming, response) => {
  const url = new URL(incoming.url, targetOrigin);
  if (url.pathname === "/favicon.ico") { response.writeHead(204); response.end(); return; }
  for (const header of configuredHeaders) response.setHeader(header.key, header.value);
  response.setHeader("Cache-Control", "no-store");
  if (incoming.method === "POST" && url.pathname === "/capture") {
    // Run the real application guard against the browser's actual headers.
    for await (const chunk of incoming) void chunk;
    const request = new Request(url, { method: "POST", headers: incoming.headers });
    const rejected = browserMutationError(request);
    const capture = {
      case: url.searchParams.get("case"),
      policy: url.searchParams.get("policy"),
      origin: incoming.headers.origin,
      site: incoming.headers["sec-fetch-site"],
      mode: incoming.headers["sec-fetch-mode"],
      status: rejected?.status ?? 200,
    };
    captures.set(capture.case, capture);
    response.writeHead(capture.status, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<!doctype html><pre>" + JSON.stringify(capture) + "</pre>");
    return;
  }
  const policy = url.searchParams.get("policy") === "baseline" ? "no-referrer" : configuredPolicy;
  response.setHeader("Referrer-Policy", policy);
  response.setHeader("Set-Cookie", "quipus-browser-test=only; Path=/; SameSite=Lax; HttpOnly");
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  const action = new URL("/capture", targetOrigin);
  action.searchParams.set("case", url.searchParams.get("case"));
  action.searchParams.set("policy", policy);
  response.end(
    '<!doctype html><form id="logout" method="post" action="' + action.href +
    '"><button type="submit">Sign out</button></form>' +
    '<script>document.getElementById("logout").requestSubmit()</script>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
targetOrigin = "http://127.0.0.1:" + server.address().port;
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "quipus-auth-forms-"));
let child;
try {
  const browser = await findBrowser();
  const cases = [
    { id: "baseline-no-referrer", policy: "baseline", crossOrigin: false },
    { id: "configured-same-origin", policy: "configured", crossOrigin: false },
    { id: "configured-cross-origin", policy: "configured", crossOrigin: true },
  ];
  for (const item of cases) {
    const form = new URL("/form", targetOrigin);
    if (item.crossOrigin) form.hostname = "localhost";
    form.searchParams.set("case", item.id);
    form.searchParams.set("policy", item.policy);
    const profile = path.join(temporaryRoot, item.id);
    await new Promise((resolve, reject) => {
      child = spawn(browser, [
        "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
        "--disable-extensions", "--no-proxy-server", "--user-data-dir=" + profile,
        "--virtual-time-budget=1500", "--dump-dom", form.href,
      ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-2000); });
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error("Browser timeout for " + item.id));
      }, 20000);
      child.once("error", (error) => { clearTimeout(timeout); reject(error); });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        if (code === 0) resolve();
        else reject(new Error("Browser exited " + code + ": " + stderr));
      });
    });
    assert(captures.has(item.id), "Native form submission was not received: " + item.id);
  }
  const baseline = captures.get("baseline-no-referrer");
  assert.equal(baseline.origin, "null");
  assert.equal(baseline.site, "same-origin");
  assert.equal(baseline.mode, "navigate");
  assert.equal(baseline.status, 403, "The regression must reproduce the original failure.");
  const sameOrigin = captures.get("configured-same-origin");
  assert.equal(sameOrigin.origin, targetOrigin);
  assert.equal(sameOrigin.site, "same-origin");
  assert.equal(sameOrigin.status, 200, "Configured headers must preserve native same-origin forms.");
  const crossOrigin = captures.get("configured-cross-origin");
  assert.equal(crossOrigin.site, "cross-site");
  assert.equal(crossOrigin.status, 403, "Cross-site form submissions must stay blocked.");
  console.log(JSON.stringify({ policy: configuredPolicy, cases: [...captures.values()] }, null, 2));
  console.log("PASS: real browser reproduces no-referrer failure; configured same-origin forms work; cross-site forms stay blocked.");
} finally {
  if (child && child.exitCode === null) child.kill();
  await new Promise((resolve) => server.close(resolve));
  // Remove only the unique test-owned profile directory, never a user's profile.
  const resolved = path.resolve(temporaryRoot);
  assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
  assert(path.basename(resolved).startsWith("quipus-auth-forms-"));
  await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
