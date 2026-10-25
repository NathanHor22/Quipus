"use client";

import Link from "next/link";
import { DeviceTransfer } from "./DeviceTransfer";
import { BluetoothRecorderSetup } from "./BluetoothRecorderSetup";
import { Dialog } from "@/components/ui/Dialog";
import { useBrowserStorageSnapshot } from "@/components/hooks/useBrowserStorageSnapshot";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { firmwareUpdateLabel, type FirmwareUpdateStatus } from "@/lib/firmware-updates";
import type { LanternState } from "@/lib/lantern-state";
import type { WorkspaceMode } from "@/lib/workspace/model";
import {
  hasRecentHeartbeat,
  pairingSecondsRemaining,
  pairingStorageKey,
  readPairingProgress,
  recorderSetupUrl,
  type PairingProgress,
} from "@/lib/workspace/setup";
import styles from "./lantern-device.module.css";

interface DeviceRecord {
  id: string;
  name: string;
  model: string | null;
  firmware_version: string | null;
  firmware_update?: FirmwareUpdateStatus | null;
  last_seen_at: string | null;
  status: string;
  device_state: LanternState;
  state_version: number;
  battery_level: number | null;
  network_type: "wifi" | "cellular" | "offline" | null;
  free_heap_bytes: number | null;
  last_error: string | null;
}

const setupAddress = recorderSetupUrl();
const stepLabels = ["Create code", "Join recorder Wi-Fi", "Save setup", "Verify connection"];

function relativeLastSeen(value: string | null, now: number) {
  if (!value) return "No heartbeat received yet";
  const elapsed = now - Date.parse(value);
  if (!Number.isFinite(elapsed) || elapsed < -30_000) return "Heartbeat time unavailable";
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 1) return "Last seen just now";
  if (minutes < 60) return `Last seen ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last seen ${hours} hr ago`;
  return `Last seen ${Math.floor(hours / 24)} day${hours >= 48 ? "s" : ""} ago`;
}

function heapLabel(bytes: number | null) {
  return bytes == null ? "Not reported" : `${Math.max(0, bytes / 1024).toFixed(0)} KB`;
}

type LanternDevicePanelProps = {
  mode: WorkspaceMode;
  integrations: Record<string, boolean>;
  conversationCount: number;
  accountEmail?: string | null;
  hasRecording?: boolean;
};

export function LanternDevicePanel(props: LanternDevicePanelProps) {
  return <DeviceSession key={JSON.stringify([props.mode, props.accountEmail?.trim().toLowerCase() || null])} {...props} />;
}

function DeviceSession({
  mode,
  accountEmail,
}: LanternDevicePanelProps) {
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [loading, setLoading] = useState(mode === "live");
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [deviceNotice, setDeviceNotice] = useState<string | null>(null);
  const [pairing, setPairing] = useState<PairingProgress | null>(null);
  const [step, setStep] = useState<PairingProgress["step"]>(0);
  const [pairingRestored, setPairingRestored] = useState(mode !== "live");
  const [working, setWorking] = useState(false);
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [wifiSetupOpen, setWifiSetupOpen] = useState(false);
  const request = useRef<AbortController | null>(null);
  const actionRequest = useRef<AbortController | null>(null);
  const storageKey = accountEmail ? pairingStorageKey(accountEmail) : null;
  const codeActive = Boolean(pairing && pairingSecondsRemaining(pairing.expiresAt, now) > 0);

  const savedPairing = useBrowserStorageSnapshot(mode === "live" ? storageKey : null);
  if (!pairingRestored && savedPairing !== null) {
    const saved = readPairingProgress(savedPairing, now);
    setPairingRestored(true);
    setPairing(saved);
    setStep(saved?.step || 0);
  }

  useEffect(() => {
    if (mode !== "live" || !storageKey || !pairingRestored) return;
    try {
      if (pairing && codeActive && devices.length === 0)
        localStorage.setItem(storageKey, JSON.stringify({ ...pairing, step }));
      else localStorage.removeItem(storageKey);
    } catch { /* Pairing remains usable in this tab. */ }
  }, [codeActive, devices.length, mode, pairing, pairingRestored, step, storageKey]);

  useEffect(() => {
    const update = () => { if (!document.hidden) setNow(Date.now()); };
    const interval = window.setInterval(update, codeActive && !devices.length ? 1_000 : 15_000);
    document.addEventListener("visibilitychange", update);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", update); };
  }, [codeActive, devices.length]);

  const refreshDevices = useCallback(() => {
    if (mode !== "live" || request.current || actionRequest.current) return;
    const controller = new AbortController();
    request.current = controller;
    const timeout = window.setTimeout(() => controller.abort("timeout"), 12_000);
    return fetch("/api/devices", { cache: "no-store", signal: controller.signal }).then(async response => {
      const payload = await response.json().catch(() => ({})) as { devices?: DeviceRecord[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Device status is unavailable.");
      if (controller.signal.aborted || request.current !== controller) return;
      setDevices(payload.devices || []);
      setDeviceError(null);
      setNow(Date.now());
      if (payload.devices?.length) { setPairing(null); setStep(0); }
    }).catch((cause: unknown) => {
      if (controller.signal.aborted && controller.signal.reason !== "timeout") return;
      setDeviceError(controller.signal.aborted
        ? "The connection check timed out. Return this phone or laptop to Wi-Fi with internet, then retry."
        : cause instanceof TypeError ? "This browser cannot reach the dashboard. Return this phone or laptop to Wi-Fi with internet, then retry."
        : cause instanceof Error ? cause.message : "Device status is unavailable. Return this phone or laptop to Wi-Fi with internet, then retry.");
    }).finally(() => {
      window.clearTimeout(timeout);
      if (request.current === controller) { request.current = null; setLoading(false); setCheckingConnection(false); }
    });
  }, [mode]);

  const loadDevices = useCallback((showLoading = false) => {
    if (mode !== "live" || request.current || actionRequest.current) return;
    setCheckingConnection(true);
    if (showLoading) setLoading(true);
    return refreshDevices();
  }, [mode, refreshDevices]);

  const abortRequests = useCallback(() => {
    request.current?.abort("disposed");
    request.current = null;
    actionRequest.current?.abort("disposed");
    actionRequest.current = null;
  }, []);

  useEffect(() => {
    void refreshDevices();
    if (mode !== "live") return;
    const refresh = () => { if (!document.hidden) void loadDevices(); };
    const interval = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      abortRequests();
    };
  }, [abortRequests, loadDevices, mode, refreshDevices]);


  const createPairing = async () => {
    if (working || actionRequest.current) return;
    const controller = new AbortController();
    actionRequest.current = controller;
    request.current?.abort("action");
    request.current = null;
    setCheckingConnection(false);
    setWorking(true);
    setDeviceError(null);
    try {
      const response = await fetch("/api/devices/pairing", {
        signal: controller.signal,
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "My Quipus" }),
      });
      const payload = await response.json().catch(() => ({})) as { pairing?: { code: string; expiresAt: string }; error?: string };
      if (controller.signal.aborted || actionRequest.current !== controller) return;
      if (!response.ok || !payload.pairing) throw new Error(payload.error || "Pairing could not begin.");
      setPairing({ version: 1, code: payload.pairing.code, expiresAt: payload.pairing.expiresAt, step: 1 });
      setStep(1);
      setNow(Date.now());
      setDeviceNotice("Code ready. Next, open Wi-Fi setup on the recorder. Creating a code does not turn on its setup network.");
    } catch (cause) {
      if (controller.signal.aborted || actionRequest.current !== controller) return;
      setDeviceError(cause instanceof TypeError ? "Creating a code needs internet on this phone or laptop. Reconnect to your normal Wi-Fi, then retry." : cause instanceof Error ? cause.message : "Pairing could not begin.");
    } finally {
      if (actionRequest.current === controller) { actionRequest.current = null; setWorking(false); }
    }
  };

  const revokeDevice = async (deviceId: string) => {
    if (working || actionRequest.current) return;
    const controller = new AbortController();
    actionRequest.current = controller;
    request.current?.abort("action");
    request.current = null;
    setCheckingConnection(false);
    setWorking(true);
    setDeviceError(null);
    try {
      const response = await fetch(`/api/devices/${encodeURIComponent(deviceId)}`, {
        signal: controller.signal,
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "revoke" }),
      });
      const payload = await response.json().catch(() => ({})) as { revoked?: boolean; error?: string };
      if (controller.signal.aborted || actionRequest.current !== controller) return;
      if (!response.ok || !payload.revoked) throw new Error(payload.error || "Quipus could not be revoked.");
      setConfirmingRevoke(false);
      setDevices(current => current.filter(device => device.id !== deviceId));
      setPairing(null);
      setStep(0);
      setDeviceNotice("Access revoked. If the recorder is online, leave it powered on while it returns to setup. If it is offline, open Wi-Fi setup on the recorder to reconnect it.");
    } catch (cause) {
      if (controller.signal.aborted || actionRequest.current !== controller) return;
      setDeviceError(cause instanceof Error ? cause.message : "Quipus could not be revoked.");
    } finally {
      if (actionRequest.current === controller) { actionRequest.current = null; setWorking(false); }
    }
  };

  const primaryDevice = devices[0] || null;
  const lastSeen = useMemo(() => relativeLastSeen(primaryDevice?.last_seen_at || null, now), [primaryDevice?.last_seen_at, now]);
  const seconds = pairing ? pairingSecondsRemaining(pairing.expiresAt, now) : 0;
  const codeExpired = Boolean(pairing && seconds === 0);
  const countdown = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const goToStep = (next: PairingProgress["step"]) => { setStep(next); setDeviceNotice(null); };

  if (loading && !primaryDevice) return <section className={styles.deviceLoading} role="status"><p>Checking your Quipus…</p></section>;

  if (mode === "sample" || !primaryDevice) {
    if (mode === "sample") return <section className={styles.sampleSetup} aria-label="Device details">
      <span className={styles.kicker}>Device details</span><h2>Your Quipus</h2>
      <p>Sign in to connect your device.</p>
      <Link className={styles.pairingPrimary} href="/login?next=%2Fdashboard%2Fsettings">Sign in to pair a device</Link>
    </section>;

    return <section className={styles.pairingLayout} aria-label="Quipus pairing setup">
      <aside className={styles.pairingIntro}>
        <span className={styles.kicker}>PAIR YOUR QUIPUS</span><h2>Connect once. Keep recording.</h2>
        <p>The pairing code links your recorder to {accountEmail || "this workspace"}. Saved 2.4 GHz Wi-Fi connects it to the internet.</p>
        {pairing && <div className={styles.activePairingCode}>
          <span>ONE-TIME PAIRING CODE</span><strong>{pairing.code}</strong>
          <small>{codeExpired ? "Code expired. Create a new code to finish pairing." : `Expires in ${countdown}`}</small>
        </div>}
        {pairing && <button className={styles.secondaryAction} disabled={working} type="button" onClick={() => void createPairing()}>{working ? "Creating code…" : "Create new code"}</button>}
        <p className={styles.networkNote}>Connect with Bluetooth in Chrome on Windows or Android to keep this page online. Wi-Fi setup is also available for iPhone and other browsers.</p>
      </aside>
      <div className={styles.setupSteps}>
        <BluetoothRecorderSetup onConnected={() => { void loadDevices(); }} />
        <details className={styles.help}>
        <summary>Use Wi-Fi setup instead</summary>
        <ol className={styles.stepNavigation} aria-label="Pairing progress">
          {stepLabels.map((label, index) => <li key={label}>
            <button type="button" aria-current={step === index ? "step" : undefined} disabled={index > step || (index > 0 && !pairing)} onClick={() => goToStep(index as PairingProgress["step"])}><span>{index + 1}</span>{label}</button>
          </li>)}
        </ol>
        <div className={styles.stepPanel}>
          <span className={styles.kicker}>STEP {step + 1} OF 4</span>
          {step === 0 && <>
            <h3>Create your pairing code.</h3><p>Keep the recorder powered on. Your one-time code expires after ten minutes, and the setup resumes here if you leave this page.</p>
            <button className={styles.pairingPrimary} disabled={working} type="button" onClick={() => void createPairing()}>{working ? "Creating code…" : pairing && !codeExpired ? "Replace pairing code" : "Create pairing code"}</button>
            {pairing && !codeExpired && <button className={styles.secondaryAction} type="button" onClick={() => goToStep(1)}>Continue with this code</button>}
          </>}
          {step === 1 && <>
            <h3>Join the recorder’s Wi-Fi.</h3>
            <p>On the recorder, open <strong>Wi-Fi setup</strong>. On <strong>this phone or laptop</strong>, open Wi-Fi settings and join <strong>Quipus-XXXX</strong>. Older firmware names it <strong>Lantern-XXXX</strong>.</p>
            <p>The setup-network password is <strong>lanternsetup</strong>. Stay connected if your phone or laptop says this network has no internet, then return to this page.</p>
            <button className={styles.pairingPrimary} type="button" disabled={codeExpired} onClick={() => goToStep(2)}>I joined the recorder’s Wi-Fi</button>
            <details className={styles.help}><summary>Can’t find the setup network?</summary><p>Wake the recorder screen, open the main menu and choose Wi-Fi setup. Keep it close to this phone or laptop. On older touchscreen firmware, holding the screen for eight seconds resets saved pairing and Wi-Fi; use that only if normal Wi-Fi setup is unavailable.</p></details>
          </>}
          {step === 2 && <>
            <h3>Connect your recorder.</h3>
            <p>While <strong>this phone or laptop is still on Quipus-XXXX</strong>, open recorder setup below. Updated firmware fills in your pairing code. Enter the name and password of a <strong>2.4 GHz Wi-Fi network or hotspot</strong> with internet, then choose <strong>Save and connect</strong>.</p>
            <p>The setup page runs on your recorder. After saving, reconnect this phone or laptop to normal internet; setup returns to your Quipus dashboard. Saved Wi-Fi can be reused. On older firmware, enter the code shown here manually.</p>
            <a className={styles.pairingPrimary} href={recorderSetupUrl(codeActive ? pairing?.code : null)} target="_blank" rel="noreferrer" onClick={() => goToStep(3)}>Open recorder setup</a>
            <button className={styles.secondaryAction} type="button" disabled={codeExpired} onClick={() => goToStep(3)}>I saved the setup details</button>
            <details className={styles.help}><summary>Setup page won’t open?</summary><p>Check that this phone or laptop is joined to the recorder’s setup Wi-Fi. Enter http://192.168.4.1/ exactly, including http. If a VPN is intercepting the local connection, pause it while opening setup, then restore it afterwards.</p></details>
          </>}
          {step === 3 && <>
            <h3>Return to internet and verify.</h3>
            <p>Reconnect <strong>this phone or laptop</strong> to your normal Wi-Fi or mobile data. Keep the recorder powered on and within range of the saved Wi-Fi.</p>
            <p role="status">Waiting for the recorder to contact this workspace. This page switches to device health after the account receives a device update. A “paired” screen alone does not confirm that an upload has reached the dashboard.</p>
            <button className={styles.pairingPrimary} disabled={working || checkingConnection} type="button" onClick={() => void loadDevices()}>{checkingConnection ? "Checking…" : "Check connection now"}</button>
            <button className={styles.secondaryAction} type="button" onClick={() => goToStep(2)}>Review setup details</button>
          </>}
          {codeExpired && <div className={styles.deviceNotice} role="status"><strong>Your code has expired.</strong> If setup is already saved, keep waiting for the connection check. Otherwise create a new code and enter it on the recorder.</div>}
          {deviceNotice && <p className={styles.deviceNotice} role="status">{deviceNotice}</p>}
          {deviceError && <div className={styles.deviceError} role="alert"><p>{deviceError}</p><button className={styles.secondaryAction} type="button" disabled={checkingConnection} onClick={() => void loadDevices()}>{checkingConnection ? "Checking…" : "Retry connection check"}</button></div>}
        </div>
        </details>
      </div>
    </section>;
  }

  const connected = hasRecentHeartbeat(primaryDevice.last_seen_at, now)
    && primaryDevice.status === "online" && primaryDevice.network_type !== "offline";

  return <section className={styles.healthLayout} aria-label="Device details">
    <section className={styles.deviceDetails}>
      <header>
        <div><span className={styles.kicker}>Device details</span><h2>Your Quipus</h2></div>
        <span className={connected ? styles.onlineBadge : styles.attentionBadge} role="status">{connected ? "Connected" : "Offline"}</span>
      </header>
      {deviceError && <p className={styles.deviceError} role="alert">{deviceError}</p>}
      <dl>
        <div><dt>Device</dt><dd>{primaryDevice.name}</dd></div>
        <div><dt>Paired account</dt><dd>{accountEmail || "This workspace"}</dd></div>
        <div><dt>Last contact</dt><dd>{lastSeen}</dd></div>
      </dl>
      <div className={styles.deviceActions}>
        <button className={styles.pairingPrimary} type="button" onClick={() => setWifiSetupOpen(true)}>Change your Wi-Fi</button>
        <button className={styles.secondaryAction} type="button" disabled={checkingConnection} onClick={() => void loadDevices()}>{checkingConnection ? "Checking..." : "Refresh status"}</button>
      </div>
      <details className={styles.help}>
        <summary>Hardware and firmware details</summary>
        <dl>
          <div><dt>Firmware</dt><dd>{primaryDevice.firmware_version || "Not reported"}</dd></div>
          {firmwareUpdateLabel(primaryDevice.firmware_update, primaryDevice.firmware_version) && <div><dt>Wireless update</dt><dd>{firmwareUpdateLabel(primaryDevice.firmware_update, primaryDevice.firmware_version)}</dd></div>}
          <div><dt>Model</dt><dd>{primaryDevice.model || "ESP32-S3"}</dd></div>
          <div><dt>Free firmware memory</dt><dd>{heapLabel(primaryDevice.free_heap_bytes)}</dd></div>
        </dl>
      </details>
      {primaryDevice.last_error && <div className={styles.lastError}><strong>Last reported error</strong><p>{primaryDevice.last_error}</p></div>}
    </section>
    <Dialog open={wifiSetupOpen} onClose={() => setWifiSetupOpen(false)} className={styles.revokeDialog} aria-labelledby="device-wifi-title">
      <h2 id="device-wifi-title">Change your Wi-Fi</h2>
      <ol className={styles.wifiSteps}>
        <li>Open <strong>Wi-Fi setup</strong> on your Quipus.</li>
        <li>On <strong>this phone or laptop</strong>, join <strong>Quipus-XXXX</strong> in Wi-Fi settings. Older firmware uses <strong>Lantern-XXXX</strong>. The password is <strong>lanternsetup</strong>; stay connected even if there is no internet.</li>
        <li>Open setup below, enter your <strong>2.4 GHz Wi-Fi</strong> details and choose <strong>Save and connect</strong>.</li>
      </ol>
      <p>After saving, reconnect this phone or laptop to the internet and refresh the device status here. Your account pairing stays the same.</p>
      <div className={styles.dialogActions}>
        <button className={styles.secondaryAction} type="button" onClick={() => setWifiSetupOpen(false)}>Done</button>
        <a className={styles.pairingPrimary} href={setupAddress} target="_blank" rel="noreferrer">Open 192.168.4.1</a>
      </div>
    </Dialog>
    <footer className={styles.deviceDangerZone}><div><strong>Remove this Quipus</strong><p>Stops this recorder uploading to your account. Recordings already in your workspace stay here.</p></div><button type="button" disabled={working} onClick={() => setConfirmingRevoke(true)}>Revoke device</button></footer>
    {mode === "live" && <DeviceTransfer deviceId={primaryDevice.id} />}
    <Dialog open={confirmingRevoke} onClose={() => setConfirmingRevoke(false)} dismissDisabled={working}
      className={styles.revokeDialog} aria-labelledby="revoke-device-title">
      <h2 id="revoke-device-title">Remove {primaryDevice.name}?</h2><p>It will no longer upload to this account. To use it again, you will need a new pairing code. Recordings already uploaded remain in your workspace.</p>
      <p>If the recorder is offline, it learns about revocation when it next contacts Quipus.</p>
      {deviceError && <p className={styles.deviceError} role="alert">{deviceError}</p>}
      <div className={styles.dialogActions}><button className={styles.secondaryAction} type="button" disabled={working} onClick={() => setConfirmingRevoke(false)}>Keep device</button><button className={styles.dangerAction} type="button" disabled={working} onClick={() => void revokeDevice(primaryDevice.id)}>{working ? "Removing…" : "Confirm revoke"}</button></div>
    </Dialog>
  </section>;
}
