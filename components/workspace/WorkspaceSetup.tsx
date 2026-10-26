"use client";

import { useId, useState } from "react";
import { useBrowserStorageSnapshot } from "@/components/hooks/useBrowserStorageSnapshot";
import { notifyBrowserStorage, SETUP_PREFERENCES_EVENT } from "@/lib/browser/storage";
import {
  readSetupPreferences,
  setupStorageKey,
  workspaceSetupStep,
  type SetupPreferences,
} from "@/lib/workspace/setup";
import styles from "./setup.module.css";

export type WorkspaceSetupProps = {
  account: { email: string; displayName?: string | null };
  calendarConnected?: boolean;
  devicePaired?: boolean;
  hasRecording: boolean;
  onPair: () => void;
  onFirstRecording: () => void;
};

export function WorkspaceSetup({ account, calendarConnected, devicePaired, hasRecording, onPair, onFirstRecording }: WorkspaceSetupProps) {
  const headingId = useId();
  const key = setupStorageKey(account.email);
  const stored = useBrowserStorageSnapshot(key, { eventName: SETUP_PREFERENCES_EVENT });
  const [memoryPreferences, setMemoryPreferences] = useState<{ key: string; value: SetupPreferences } | null>(null);
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);
  const preferences = memoryPreferences?.key === key ? memoryPreferences.value : readSetupPreferences(stored);
  const setPreferences = (update: (current: SetupPreferences) => SetupPreferences) => {
    const next = update(preferences);
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setMemoryPreferences(null);
      notifyBrowserStorage(SETUP_PREFERENCES_EVENT);
    } catch {
      // Keep setup usable in this tab when browser storage is blocked.
      setMemoryPreferences({ key, value: next });
    }
  };

  const step = workspaceSetupStep({ devicePaired, hasRecording, calendarConnected, calendarSkipped: preferences.calendarSkipped });
  const checkingCalendar = calendarConnected === undefined && !preferences.calendarSkipped;
  if (stored === null || step === "complete") return null;

  const title = step === "pair" ? "Connect your Quipus."
    : step === "record" ? "Try your first recording."
    : step === "calendar" ? "Add your calendar, if you like."
    : checkingCalendar ? "Checking your calendar connection." : "Checking your recorder.";
  const count = Number(devicePaired === true) + Number(hasRecording) + Number(calendarConnected === true || preferences.calendarSkipped);

  const expanded = expandedAccount === key && !preferences.collapsed;
  if (!expanded) {
    return <section className={styles.resume} aria-label="Get started">
      <div><strong>Get started</strong><span>{count} of 3 complete</span></div>
      <button className={styles.secondary} type="button" aria-expanded={false} onClick={() => {
        setPreferences(current => ({ ...current, collapsed: false }));
        setExpandedAccount(key);
      }}>Continue setup</button>
    </section>;
  }

  return <section className={styles.setup} aria-labelledby={headingId}>
    <header className={styles.header}>
      <div><span className={styles.kicker}>GET STARTED</span><h2 id={headingId}>{title}</h2></div>
      <button className={styles.secondary} type="button" aria-expanded={true} onClick={() => {
        setPreferences(current => ({ ...current, collapsed: true }));
        setExpandedAccount(null);
      }}>Hide setup</button>
    </header>
    <ol className={styles.progress} aria-label="Setup progress">
      <li data-complete={calendarConnected === true || preferences.calendarSkipped} aria-current={step === "calendar" ? "step" : undefined}><span>01</span><strong>Calendar <em>Optional</em></strong><small>{calendarConnected === true ? "Connected" : preferences.calendarSkipped ? "Skipped for now" : calendarConnected === undefined ? "Checking" : "Approve follow-ups here"}</small></li>
      <li data-complete={devicePaired === true} aria-current={step === "pair" ? "step" : undefined}><span>02</span><strong>Pair recorder</strong><small>{devicePaired === true ? "Paired" : devicePaired === undefined ? "Checking" : "Next step"}</small></li>
      <li data-complete={hasRecording} aria-current={step === "record" ? "step" : undefined}><span>03</span><strong>First upload</strong><small>{hasRecording ? "Recording received" : "Waiting for a recording"}</small></li>
    </ol>
    <div className={styles.currentStep}>
      <div>
        {step === "pair" && <p>Connect your Quipus to send recordings to this account.</p>}
        {step === "record" && <p>Start a session on your Quipus, confirm consent, then stop when you’re done. Your recording appears here once it uploads.</p>}
        {step === "calendar" && <p>Connect Google Calendar to schedule the follow-ups you approve. You can also do this later.</p>}
        {step === "checking" && <p role="status">{checkingCalendar ? "Checking your Google Calendar connection…" : "Checking for your paired Quipus…"}</p>}
        <small>{count} of 3 complete</small>
      </div>
      <div className={styles.actions}>
        {(step === "pair" || (step === "checking" && !checkingCalendar)) && <button className={styles.primary} type="button" onClick={onPair}>Open device setup</button>}
        {step === "record" && <button className={styles.primary} type="button" onClick={onFirstRecording}>Check recorder</button>}
        {step === "calendar" && <>
          <a className={styles.primary} href="/api/google/connect?returnTo=%2Fdashboard">Connect Google Calendar</a>
          <button className={styles.secondary} type="button" onClick={() => setPreferences(current => ({ ...current, calendarSkipped: true }))}>Skip for now</button>
        </>}
      </div>
    </div>
  </section>;
}
