"use client";
import { useCallback, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { readSetupPreferences, setupStorageKey } from "@/lib/workspace/setup";
import {
  notifyBrowserStorage,
  SETUP_PREFERENCES_EVENT,
  subscribeBrowserStorage,
} from "@/lib/browser/storage";
import styles from "./quipus.module.css";

const temporaryDismissals = new Set<string>();
// Keep the prompt hidden during SSR until this account's browser preference is read.
const serverDismissed = () => true;

export function CalendarConnection({ email, connected }: { email: string; connected: boolean | undefined }) {
  const params = useSearchParams();
  const result = params.get("google");
  const key = `quipus:calendar-later:${email}`;
  const setupKey = setupStorageKey(email);
  const subscribePreferences = useCallback(
    (notify: () => void) => subscribeBrowserStorage(key, notify, {
      fallbackKey: setupKey,
      eventName: SETUP_PREFERENCES_EVENT,
    }),
    [key, setupKey],
  );
  const readDismissed = useCallback(() => {
    if (temporaryDismissals.has(key)) return true;
    try {
      return localStorage.getItem(key) === "1" ||
        readSetupPreferences(localStorage.getItem(setupKey)).calendarSkipped;
    } catch { return false; }
  }, [key, setupKey]);
  const dismissed = useSyncExternalStore(subscribePreferences, readDismissed, serverDismissed);
  if (connected !== false || (dismissed && result !== "denied" && result !== "error")) return null;
  return <section className={styles.connectionPrompt} aria-label="Connect your calendar">
    <div><h2>Connect Google Calendar</h2><p>{result === "denied" ? "Calendar access wasn’t granted. You can keep using Quipus and connect when you’re ready." : result === "error" ? "Google couldn’t finish connecting. Your conversations are safe; you can try again." : "You’re signed in. Connect Google Calendar to add the follow-ups you approve."} Each invitation still needs your approval.</p></div>
    <div className={styles.connectionActions}>
      <a className={styles.actionButton} href="/api/google/connect?returnTo=%2Fdashboard">Connect Calendar</a>
      <button className={styles.actionButton} onClick={() => {
        temporaryDismissals.add(key);
        try {
          localStorage.setItem(key, "1");
          const setupKey = setupStorageKey(email);
          localStorage.setItem(setupKey, JSON.stringify({ ...readSetupPreferences(localStorage.getItem(setupKey)), calendarSkipped: true }));
          temporaryDismissals.delete(key);
        } catch { /* The in-memory choice still works when storage is unavailable. */ }
        notifyBrowserStorage(SETUP_PREFERENCES_EVENT);
        const url = new URL(window.location.href); url.searchParams.delete("google"); window.history.replaceState({}, "", url);
      }}>Later, in settings</button>
    </div>
  </section>;
}
