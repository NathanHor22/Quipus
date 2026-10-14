"use client";

import { useSyncExternalStore } from "react";

function subscribe(notify: () => void) {
  document.addEventListener("visibilitychange", notify);
  return () => document.removeEventListener("visibilitychange", notify);
}

const read = () => document.visibilityState !== "hidden";
const readServer = () => true;

/** Defaults to visible on the server, then follows the actual browser tab. */
export function usePageVisibility() {
  return useSyncExternalStore(subscribe, read, readServer);
}
