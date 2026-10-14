export type BrowserStorageOptions = {
  fallbackKey?: string;
  eventName?: string;
};

export const SETUP_PREFERENCES_EVENT = "quipus:setup-preferences";

/** Return a stable primitive snapshot, including when browser storage is blocked. */
export function readBrowserStorage(key: string | null, fallbackKey?: string): string {
  if (typeof window === "undefined" || key === null) return "";
  try {
    return window.localStorage.getItem(key) ||
      (fallbackKey ? window.localStorage.getItem(fallbackKey) : "") || "";
  } catch {
    return "";
  }
}

/** Native storage events arrive from other tabs; optional app events cover this tab. */
export function subscribeBrowserStorage(
  key: string | null,
  notify: () => void,
  { fallbackKey, eventName }: BrowserStorageOptions = {},
): () => void {
  if (typeof window === "undefined" || key === null) return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === key || event.key === fallbackKey) notify();
  };
  window.addEventListener("storage", onStorage);
  if (eventName) window.addEventListener(eventName, notify);
  return () => {
    window.removeEventListener("storage", onStorage);
    if (eventName) window.removeEventListener(eventName, notify);
  };
}

export function notifyBrowserStorage(eventName: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(eventName));
}
