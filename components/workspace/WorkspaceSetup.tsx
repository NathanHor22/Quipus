"use client";

import { useEffect, useId, useState } from "react";
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
  const [restoredKey, setRestoredKey] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<SetupPreferences>(() => readSetupPreferences(null));

  useEffect(() => {
    let saved: SetupPreferences;
    try { saved = readSetupPreferences(localStorage.getItem(key)); }
    catch { saved = readSetupPreferences(null); }
    setPreferences(saved);
    setRestoredKey(key);
  }, [key]);

  useEffect(() => {
    if (restoredKey !== key) return;
    try { localStorage.setItem(key, JSON.stringify(preferences)); } catch { /* Setup remains usable in this tab. */ }
  }, [key, preferences, restoredKey]);

  const step = workspaceSetupStep({ devicePaired, hasRecording, calendarConnected, calendarSkipped: preferences.calendarSkipped });
  const checkingCalendar = calendarConnected === undefined && !preferences.calendarSkipped;
  if (restoredKey !== key || step === "complete") return null;

  const title = step === "pair" ? "Connect your Quipus."
    : step === "record" ? "Try your first recording."
    : step === "calendar" ? "Add your calendar, if you like."
    : checkingCalendar ? "Checking your calendar connection." : "Checking your recorder.";
  const count = Number(devicePaired === true) + Number(hasRecording) + Number(calendarConnected === true || preferences.calendarSkipped);

  if (preferences.collapsed) {
    return <section className={styles.resume} aria-label="Resume workspace setup">
      <div><strong>Finish setting up Quipus</strong><span>{title}</span></div>
      <button className={styles.secondary} type="button" onClick={() => setPreferences(current => ({ ...current, collapsed: false }))}>Resume setup</button>
    </section>;
  }

  return <section className={styles.setup} aria-labelledby={headingId}>
    <header className={styles.header}>
      <div><span className={styles.kicker}>GET STARTED</span><h2 id={headingId}>{title}</h2></div>
      <button className={styles.secondary} type="button" onClick={() => setPreferences(current => ({ ...current, collapsed: true }))}>Continue later</button>
    </header>
    <ol className={styles.progress} aria-label="Setup progress">
      <li data-complete={calendarConnected === true || preferences.calendarSkipped} aria-current={step === "calendar" ? "step" : undefined}><span>01</span><strong>Calendar <em>Optional</em></strong><small>{calendarConnected === true ? "Connected" : preferences.calendarSkipped ? "Skipped for now" : calendarConnected === undefined ? "Checking" : "Approve follow-ups here"}</small></li>
      <li data-complete={devicePaired === true} aria-current={step === "pair" ? "step" : undefined}><span>02</span><strong>Pair recorder</strong><small>{devicePaired === true ? "Paired" : devicePaired === undefined ? "Checking" : "Next step"}</small></li>
      <li data-complete={hasRecording} aria-current={step === "record" ? "step" : undefined}><span>03</span><strong>First upload</strong><small>{hasRecording ? "Recording received" : "Waiting for a recording"}</small></li>
    </ol>
    <div className={styles.currentStep}>
      <div>
        {step === "pair" && <p>Pair the recorder to this account once. It keeps your recordings locally and uploads to your workspace when connected to saved Wi-Fi.</p>}
        {step === "record" && <p>On your recorder, choose <strong>Start session</strong>, confirm consent, record a short test and stop. Leave it powered on and connected to Wi-Fi. This step completes when a recording reaches your workspace.</p>}
        {step === "calendar" && <p>Connect Google Calendar to schedule the follow-ups you approve. Signing in and granting calendar access are separate steps. You can keep recording without connecting it.</p>}
        {step === "checking" && <p role="status">{checkingCalendar ? "Checking whether Google Calendar is connected to this account. Continue later to return to your workspace while the connection check completes." : "Checking whether this account already has a paired recorder. You can open device setup if the check takes longer than expected."}</p>}
        <small>{count} of 3 steps finished. Your progress is saved in this browser.</small>
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
