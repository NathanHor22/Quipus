"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { readSetupPreferences, setupStorageKey } from "@/lib/workspace/setup";
import styles from "./quipus.module.css";

export function CalendarConnection({ email, connected }: { email: string; connected: boolean | undefined }) {
  const params = useSearchParams();
  const result = params.get("google");
  const [dismissed, setDismissed] = useState(true);
  const key = `quipus:calendar-later:${email}`;
  useEffect(() => {
    try { setDismissed(localStorage.getItem(key) === "1" || readSetupPreferences(localStorage.getItem(setupStorageKey(email))).calendarSkipped); }
    catch { setDismissed(false); }
  }, [key]);
  if (connected !== false || (dismissed && result !== "denied" && result !== "error")) return null;
  return <section className={styles.connectionPrompt} aria-label="Connect your calendar">
    <div><h2>Bring your calendar along.</h2><p>{result === "denied" ? "Calendar access wasn’t granted. You can keep using Quipus and connect when you’re ready." : result === "error" ? "Google couldn’t finish connecting. Your conversations are safe; you can try again." : "You’re signed in. Connect Google Calendar to add the follow-ups you approve."} Each invitation still needs your approval.</p></div>
    <div className={styles.connectionActions}>
      <a className={styles.actionButton} href="/api/google/connect?returnTo=%2Fdashboard">Connect Calendar</a>
      <button className={styles.textLink} onClick={() => {
        setDismissed(true);
        try {
          localStorage.setItem(key, "1");
          const setupKey = setupStorageKey(email);
          localStorage.setItem(setupKey, JSON.stringify({ ...readSetupPreferences(localStorage.getItem(setupKey)), calendarSkipped: true }));
        } catch {}
        const url = new URL(window.location.href); url.searchParams.delete("google"); window.history.replaceState({}, "", url);
      }}>Later, in settings</button>
    </div>
  </section>;
}
