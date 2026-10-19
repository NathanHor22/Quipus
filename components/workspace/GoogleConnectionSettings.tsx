"use client";
import { useEffect, useState } from "react";
import type { GoogleConnectionStatus } from "@/lib/google-connection";
import styles from "./workspace.module.css";
import connection from "./google-connection.module.css";

export function GoogleConnectionSettings({ sample, accountIdentity }: { sample: boolean; accountIdentity?: string | null }) {
  return <GoogleConnectionSettingsSession key={JSON.stringify([sample, accountIdentity || null])} sample={sample} />;
}

function GoogleConnectionSettingsSession({ sample }: { sample: boolean }) {
  const [status, setStatus] = useState<GoogleConnectionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (sample) return;
    const controller = new AbortController();
    void fetch("/api/google/status", { cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(value => { if (!controller.signal.aborted) setStatus(value); }).catch(() => { if (!controller.signal.aborted) setMessage("Connection status is unavailable."); });
    return () => controller.abort();
  }, [sample]);
  async function update(disconnect: boolean) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/google/status", { method: disconnect ? "DELETE" : "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Please try again.");
      if (disconnect) {
        setStatus(result.connection || { state: "not_connected", email: null, checkedAt: null, scopes: [] });
        setMessage(result.disconnected === false ? "The connection changed while disconnecting. Review the current account." : result.revoked ? "Google disconnected." : "Disconnected from Quipus. Remove its access in your Google account to complete revocation.");
      } else { setStatus(result); setMessage(result.state === "connected" ? "Connection checked." : "Reconnect to restore Calendar access."); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Please try again."); }
    finally { setBusy(false); }
  }
  return <section className={styles.settingsCard}>
    <h2>Google Calendar</h2>
    <p>Review and approve invitations before they are sent.</p>
    <p role="status">{sample ? "Sample calendar" : status?.state === "connected" ? "Connected" : status?.state === "needs_reconnect" ? "Reconnect required" : status?.state === "not_connected" ? "Not connected" : "Status unavailable"}</p>
    {status?.email && <p>Connected account: {status.email}</p>}
    {!sample && <div className={connection.actions}>
      <a className={styles.secondaryButton} href="/api/google/connect?returnTo=%2Fdashboard%2Fsettings">{status?.state === "connected" ? "Reconnect" : "Connect Google Calendar"}</a>
      {status && status.state !== "not_connected" && <>
        <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => void update(false)}>Check connection</button>
        <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => void update(true)}>Disconnect</button>
      </>}
    </div>}
    {message && <p role="status">{message}</p>}
  </section>;
}
