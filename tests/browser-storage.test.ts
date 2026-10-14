import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { useBrowserStorageSnapshot } from "../components/hooks/useBrowserStorageSnapshot";
import {
  notifyBrowserStorage,
  readBrowserStorage,
  SETUP_PREFERENCES_EVENT,
  subscribeBrowserStorage,
} from "../lib/browser/storage";

function withBrowser(run: (browser: EventTarget, values: Map<string, string>) => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map<string, string>();
  const browser = Object.assign(new EventTarget(), {
    localStorage: { getItem: (key: string) => values.get(key) ?? null },
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  try { run(browser, values); }
  finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

function storageEvent(key: string | null) {
  return Object.assign(new Event("storage"), { key });
}

test("browser snapshots prefer the current key and preserve legacy sample fallback", () => {
  withBrowser((_browser, values) => {
    values.set("legacy", "previous sample");
    assert.equal(readBrowserStorage("current", "legacy"), "previous sample");
    values.set("current", "current sample");
    assert.equal(readBrowserStorage("current", "legacy"), "current sample");
    values.set("current", "");
    assert.equal(readBrowserStorage("current", "legacy"), "previous sample");
    assert.equal(readBrowserStorage("missing"), "");
    assert.equal(readBrowserStorage(null, "legacy"), "");
  });
});

test("blocked browser storage produces a stable empty snapshot", () => {
  withBrowser((browser) => {
    Object.defineProperty(browser, "localStorage", {
      get() { throw new Error("Storage is blocked"); },
    });
    assert.equal(readBrowserStorage("account"), "");
    assert.equal(readBrowserStorage("account", "legacy"), "");
  });
});

test("storage subscriptions isolate account keys and observe clear and legacy events", () => {
  withBrowser((browser) => {
    let changes = 0;
    const unsubscribe = subscribeBrowserStorage("account:a", () => changes++, { fallbackKey: "legacy:a" });
    browser.dispatchEvent(storageEvent("account:b"));
    assert.equal(changes, 0);
    browser.dispatchEvent(storageEvent("account:a"));
    browser.dispatchEvent(storageEvent("legacy:a"));
    browser.dispatchEvent(storageEvent(null));
    assert.equal(changes, 3);
    unsubscribe();
    browser.dispatchEvent(storageEvent("account:a"));
    assert.equal(changes, 3);
  });
});

test("same-tab setup changes notify subscribers and stop after cleanup", () => {
  withBrowser(() => {
    let changes = 0;
    const unsubscribe = subscribeBrowserStorage("account", () => changes++, {
      eventName: SETUP_PREFERENCES_EVENT,
    });
    notifyBrowserStorage("quipus:unrelated");
    assert.equal(changes, 0);
    notifyBrowserStorage(SETUP_PREFERENCES_EVENT);
    assert.equal(changes, 1);
    unsubscribe();
    notifyBrowserStorage(SETUP_PREFERENCES_EVENT);
    assert.equal(changes, 1);
  });
});

test("disabled browser storage does not subscribe or read a fallback account", () => {
  withBrowser((browser, values) => {
    values.set("legacy", "private sample");
    let changes = 0;
    const unsubscribe = subscribeBrowserStorage(null, () => changes++, {
      fallbackKey: "legacy",
      eventName: SETUP_PREFERENCES_EVENT,
    });
    browser.dispatchEvent(storageEvent("legacy"));
    notifyBrowserStorage(SETUP_PREFERENCES_EVENT);
    assert.equal(changes, 0);
    assert.equal(readBrowserStorage(null, "legacy"), "");
    unsubscribe();
  });
});

test("storage hooks keep account data out of the server-rendered HTML", () => {
  withBrowser((_browser, values) => {
    values.set("account", "private stored content");
    function StoragePreview() {
      const snapshot = useBrowserStorageSnapshot("account");
      return createElement("span", null, snapshot ?? "loading");
    }
    assert.equal(renderToString(createElement(StoragePreview)), "<span>loading</span>");
  });
});