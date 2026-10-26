"use client";
import { useState } from "react";
import type { WorkspaceAccount } from "./Workspace";
import styles from "./workspace.module.css";
import q from "./quipus.module.css";
import { validTimezone } from "@/lib/quipus-profile";

export function ProfileSettings({ account, sample, onSaved, embedded = false }: {
  account: WorkspaceAccount | null; sample: boolean; onSaved: (account: WorkspaceAccount | null) => void; embedded?: boolean;
}) {
  const [name, setName] = useState(account?.displayName || "");
  const [timezone, setTimezone] = useState(validTimezone(account?.timezone));
  const zones = Array.from(new Set([timezone, "Asia/Kuala_Lumpur", "UTC", ...Intl.supportedValuesOf("timeZone")])).sort();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return <section className={embedded ? undefined : styles.settingsCard} aria-label={embedded ? "Profile settings" : undefined}>
    {!embedded && <h2>A little more you.</h2>}<p>Your name and timezone follow you from the dashboard to your Quipus.</p>
    <form className={q.profileForm} onSubmit={async e => {
      e.preventDefault(); setBusy(true); setMessage("");
      try {
        if (sample) { setMessage("This is the public sample. Sign in to personalise your own Quipus."); return; }
        const response = await fetch("/api/profile", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ preferredName: name.trim(), timezone }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Your name could not be saved.");
        onSaved(account ? { ...account, displayName: result.name, timezone: result.timezone } : null);
        setMessage(`Saved${name.trim() ? `, ${name.trim().split(/\s+/)[0]}` : ""}. Your Quipus will use this name.`);
      } catch (error) { setMessage(error instanceof Error ? error.message : "Please try again."); }
      finally { setBusy(false); }
    }}>
      <label>What should we call you?<input name="preferredName" value={name} onChange={e => setName(e.target.value)} placeholder="Your preferred name" maxLength={80} autoComplete="given-name" required /></label>
      <label>Your timezone<select value={timezone} onChange={e => setTimezone(e.target.value)}>{zones.map(zone => <option key={zone} value={zone}>{zone.replaceAll("_", " ")}</option>)}</select></label>
      <button className={q.actionButton} disabled={busy} type="submit">{busy ? "Saving…" : "Save profile"}</button>
      {message && <p role="status">{message}</p>}
    </form>
  </section>;
}
