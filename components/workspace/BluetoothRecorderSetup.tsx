"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import {
  bluetoothAdapter, bluetoothMessage, chooseRecorder, isRecorderOnline,
  RecorderBluetoothConnection, type RecorderBluetoothStatus, type RecorderBluetoothDevice,
} from "@/lib/recorder-bluetooth";
import styles from "./lantern-device.module.css";

const subscribe = () => () => {};
type Stage = "idle" | "choosing" | "connecting" | "network" | "saving" | "verifying";

export function BluetoothRecorderSetup({ onConnected }: { onConnected: () => void }) {
  const supported = useSyncExternalStore(subscribe, () => Boolean(bluetoothAdapter()), () => false);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState("");
  const [status, setStatus] = useState<RecorderBluetoothStatus | null>(null);
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [openNetwork, setOpenNetwork] = useState(false);
  const [reuseSaved, setReuseSaved] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [recorderName, setRecorderName] = useState("");
  const connection = useRef<RecorderBluetoothConnection | null>(null);
  const pendingDevice = useRef<RecorderBluetoothDevice | null>(null);
  const active = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const listId = useId();

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      controller.current?.abort();
      connection.current?.close();
      pendingDevice.current?.gatt?.disconnect();
    };
  }, []);

  const scan = async (recorder: RecorderBluetoothConnection) => {
    setScanning(true);
    try {
      const next = await recorder.scan();
      if (!active.current || connection.current !== recorder) return;
      setStatus(next);
    } catch {
      // Wi-Fi names can always be entered manually, including hidden networks.
    } finally { if (active.current && connection.current === recorder) setScanning(false); }
  };

  const cancel = () => {
    ++generation.current;
    controller.current?.abort();
    controller.current = null;
    connection.current?.close();
    connection.current = null;
    pendingDevice.current?.gatt?.disconnect();
    pendingDevice.current = null;
    setPassword("");
    setReveal(false);
    setOpenNetwork(false);
    setReuseSaved(false);
    setSsid("");
    setStatus(null);
    setRecorderName("");
    setScanning(false);
    setError("");
    setStage("idle");
  };

  const connect = async () => {
    setError("");
    setStage("choosing");
    const attempt = ++generation.current;
    connection.current?.close();
    connection.current = null;
    setPassword("");
    setReveal(false);
    setOpenNetwork(false);
    setStatus(null);
    try {
      // Keep the chooser on the original user gesture; no API call precedes it.
      const device = await chooseRecorder();
      if (!active.current || attempt !== generation.current) { device.gatt?.disconnect(); return; }
      pendingDevice.current = device;
      setStage("connecting");
      const recorder = await RecorderBluetoothConnection.connect(device, location.origin);
      if (!active.current || attempt !== generation.current) { recorder.close(); return; }
      connection.current = recorder;
      pendingDevice.current = null;
      setRecorderName(recorder.device.name || "Quipus");
      const next = await recorder.readStatus();
      if (!active.current || attempt !== generation.current) return;
      setStatus(next);
      setReuseSaved(Boolean(next.savedSsid));
      setSsid(next.savedSsid);
      setStage("network");
      void scan(recorder);
    } catch (cause) {
      if (!active.current || attempt !== generation.current) return;
      connection.current?.close();
      pendingDevice.current?.gatt?.disconnect();
      pendingDevice.current = null;
      connection.current = null;
      setError(bluetoothMessage(cause));
      setStage("idle");
    }
  };

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const recorder = connection.current;
    if (!recorder || scanning || stage !== "network") return;
    setError("");
    setStage("saving");
    const startedAt = Date.now();
    const attempt = generation.current;
    const isCurrent = () => active.current && attempt === generation.current;
    const abort = new AbortController();
    controller.current = abort;
    const overallTimeout = window.setTimeout(() => { recorder.close(); abort.abort(); }, 120000);
    let submitted = false;
    try {
      const response = await fetch("/api/devices/pairing", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "My Quipus" }), signal: abort.signal,
      });
      const payload = await response.json().catch(() => ({})) as { pairing?: { code: string; expiresAt: string }; error?: string };
      if (!isCurrent()) return;
      abort.signal.throwIfAborted();
      if (!response.ok || !payload.pairing) throw new Error(payload.error || "Could not create a pairing code. Check your internet and try again.");
      if (!Number.isFinite(Date.parse(payload.pairing.expiresAt)) ||
          Date.parse(payload.pairing.expiresAt) < Date.now() + 30000)
        throw new Error("The pairing code expired. Please try again.");
      await recorder.save(ssid, openNetwork ? "" : password, payload.pairing.code, reuseSaved);
      submitted = true;
      if (!isCurrent()) return;
      abort.signal.throwIfAborted();
      setPassword("");
      setStage("verifying");
      recorder.close();
      // Verify this physical recorder in the signed-in account, not just any
      // existing device or a local Bluetooth success acknowledgement.
      while (!abort.signal.aborted) {
        const check = await fetch("/api/devices", { cache: "no-store", signal: abort.signal });
        const result = await check.json().catch(() => ({})) as { devices?: { hardware_id?: string; status?: string; last_seen_at?: string }[]; error?: string };
        if (!isCurrent()) return;
        abort.signal.throwIfAborted();
        if (check.status === 401) throw new Error("Sign in again, then check Devices. The recorder may already be connected.");
        if (check.ok && result.devices?.some(device => isRecorderOnline(device, recorder.info.hardwareId, startedAt))) {
          onConnected();
          return;
        }
        await new Promise<void>(resolve => {
          const finish = () => { window.clearTimeout(timer); abort.signal.removeEventListener("abort", finish); resolve(); };
          const timer = window.setTimeout(finish, 2000);
          abort.signal.addEventListener("abort", finish, { once: true });
        });
      }
      throw new Error("The recorder has not reached your account yet. Check its screen, Wi-Fi password and 2.4 GHz network, then retry.");
    } catch (cause) {
      if (!isCurrent()) return;
      setError(abort.signal.aborted
        ? "Connection verification timed out. Check the recorder screen and your 2.4 GHz Wi-Fi, then reconnect or check Devices."
        : submitted ? "Setup was sent, but this browser could not verify it. Check your internet and refresh Devices before pairing again."
        : bluetoothMessage(cause));
      setStage("idle");
    } finally {
      window.clearTimeout(overallTimeout);
      recorder.close();
      if (connection.current === recorder) connection.current = null;
      if (isCurrent()) setPassword("");
      if (controller.current === abort) controller.current = null;
    }
  };

  const busy = stage !== "idle" && stage !== "network";
  return <section className={styles.bluetoothSetup} aria-label="Bluetooth recorder setup" aria-busy={busy}>
    <span className={styles.kicker}>CONNECT NEARBY</span>
    <h3>Connect with Bluetooth.</h3>
    <p>Keep this page online. Choose your Quipus recorder, then send its Wi-Fi details here. Your account’s pairing code is filled in automatically.</p>
    {!supported && <p role="status">Use Chrome on Windows or Android for Bluetooth. On iPhone, or if Bluetooth is unavailable, use Wi-Fi setup below.</p>}
    {stage === "idle" && <button className={styles.pairingPrimary} type="button" disabled={!supported} onClick={() => void connect()}>Connect with Bluetooth</button>}
    {stage === "choosing" && <p role="status">Choose Quipus-BT in Chrome’s device chooser. Keep the recorder powered on and nearby.</p>}
    {stage === "connecting" && <p role="status">Connecting securely… If Windows or Android asks for a PIN, enter the six digits shown on the recorder’s screen.</p>}
    {stage === "network" && <form className={styles.bluetoothForm} onSubmit={event => void save(event)}>
      <p role="status">Bluetooth connected to {recorderName}.</p>
      {status?.savedSsid && <label className={styles.bluetoothChoice}><input type="checkbox" checked={reuseSaved} onChange={event => { setReuseSaved(event.target.checked); setPassword(""); }} />Use saved Wi-Fi: {status.savedSsid}</label>}
      {!reuseSaved && <>
        <label>2.4 GHz Wi-Fi name<input list={listId} value={ssid} autoComplete="off" maxLength={32} required onChange={event => setSsid(event.target.value)} /></label>
        <datalist id={listId}>{status?.networks.map(network => <option key={network.ssid} value={network.ssid}>{network.secured ? "Password protected" : "Open network"}</option>)}</datalist>
        <button className={styles.secondaryAction} type="button" disabled={scanning} onClick={() => { if (connection.current) void scan(connection.current); }}>{scanning ? "Finding nearby Wi-Fi…" : "Refresh Wi-Fi names"}</button>
        <label className={styles.bluetoothChoice}><input type="checkbox" checked={openNetwork} onChange={event => { setOpenNetwork(event.target.checked); setPassword(""); }} />This Wi-Fi has no password</label>
        {!openNetwork && <>
          <label>Wi-Fi password<input type={reveal ? "text" : "password"} value={password} autoComplete="off" minLength={8} maxLength={64} required onChange={event => setPassword(event.target.value)} /></label>
          <label className={styles.bluetoothChoice}><input type="checkbox" checked={reveal} onChange={event => setReveal(event.target.checked)} />Show password</label>
        </>}
      </>}
      <p>The recorder uses this Wi-Fi to upload recordings. Your phone or computer stays on its current internet connection.</p>
      <button className={styles.pairingPrimary} disabled={scanning} type="submit">Save and connect</button>
      <button className={styles.secondaryAction} type="button" onClick={cancel}>Choose another recorder</button>
    </form>}
    {stage === "saving" && <p role="status">Sending setup securely… Keep the recorder powered on.</p>}
    {stage === "verifying" && <p role="status">Setup saved. The recorder is restarting and joining Wi-Fi. Waiting for it to appear in your account…</p>}
    {busy && <button className={styles.secondaryAction} type="button" onClick={cancel}>Cancel setup</button>}
    {stage === "verifying" && <p>Leaving this check does not undo settings already sent to the recorder.</p>}
    {error && <p className={styles.deviceError} role="alert">{error}</p>}
    <details className={styles.help}><summary>Can’t find or connect to the recorder?</summary><p>Turn Bluetooth on and use Chrome on Windows or Android. Install Quipus firmware 0.10.0 or later, keep the recorder unpaired and powered on, and choose Quipus-BT in the device chooser. If your phone asks for location or nearby-device permission, allow it. If OS pairing fails repeatedly, remove the old Quipus Bluetooth entry in your device settings and try again. Wi-Fi setup below remains available.</p></details>
  </section>;
}
