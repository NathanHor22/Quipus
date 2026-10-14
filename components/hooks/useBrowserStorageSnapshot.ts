"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  readBrowserStorage,
  subscribeBrowserStorage,
  type BrowserStorageOptions,
} from "@/lib/browser/storage";

// A null server snapshot keeps stored account data out of SSR and initial hydration.
const serverSnapshot = () => null;

export function useBrowserStorageSnapshot(
  key: string | null,
  { fallbackKey, eventName }: BrowserStorageOptions = {},
): string | null {
  const subscribe = useCallback(
    (notify: () => void) => subscribeBrowserStorage(key, notify, { fallbackKey, eventName }),
    [key, fallbackKey, eventName],
  );
  const getSnapshot = useCallback(
    () => key === null ? null : readBrowserStorage(key, fallbackKey),
    [key, fallbackKey],
  );
  return useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
}
