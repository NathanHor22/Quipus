"use client";

import { useCallback, useSyncExternalStore } from "react";

export function useMediaQuery(query: string, serverValue?: boolean): boolean;
export function useMediaQuery(query: string, serverValue: null): boolean | null;
export function useMediaQuery(query: string, serverValue: boolean | null = false) {
  const subscribe = useCallback((notify: () => void) => {
    const media = window.matchMedia(query);
    media.addEventListener("change", notify);
    return () => media.removeEventListener("change", notify);
  }, [query]);
  const read = useCallback(() => window.matchMedia(query).matches, [query]);
  const readServer = useCallback(() => serverValue, [serverValue]);
  return useSyncExternalStore(subscribe, read, readServer);
}
