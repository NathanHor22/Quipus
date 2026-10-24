"use client";
import { useEffect, useState } from "react";
import { whatsappEnabled } from "@/lib/features";
import styles from "./workspace.module.css";
import deliveryStyles from "./delivery.module.css";

type Delivery = { id: string; phone: string; state: string; last_error?: string | null };
type DeliveryState = { available: boolean; enabled: boolean; phone?: string; deliveries: Delivery[] };

async function readDelivery(signal?: AbortSignal): Promise<DeliveryState> {
  const response = await fetch("/api/whatsapp/delivery", { cache: "no-store", signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Connection unavailable.");
  return data;
}

function ComingSoon() {
  return <span className={styles.connectionState}><i className={styles.neutralDot} />Coming soon</span>;
}

export function WhatsAppDelivery({ sample = false }: { sample?: boolean }) {
  if (!whatsappEnabled()) {
    return <section className={styles.settingsCard}>
      <h2>Reports on WhatsApp</h2>
      <ComingSoon />
      <p>Receive each completed meeting report, full transcript, and original WAV on WhatsApp. Client sharing will always require a separate approval.</p>
    </section>;
  }
  return <WhatsAppDeliverySession key={String(sample)} sample={sample} />;
}

function WhatsAppDeliverySession({ sample }: { sample: boolean }) {
  const [state, setState] = useState<DeliveryState>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const refresh = async () => {
    try {
      setState(await readDelivery());
    } catch (error) { setError(error instanceof Error ? error.message : "Connection unavailable."); }
  };
  useEffect(() => {
    if (sample) return;
    const controller = new AbortController();
    void readDelivery(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState(data);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Connection unavailable.");
      });
    return () => controller.abort();
  }, [sample]);
  const perform = async (body: Record<string, unknown>, pair = false) => {
    setBusy(true); setError("");
    try {
      const response = await fetch(pair ? "/api/whatsapp/pair" : "/api/whatsapp/delivery", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, approved: true }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (pair) setCode(data.code);
      else await refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save."); }
    finally { setBusy(false); }
  };
  return <section className={styles.settingsCard}>
    <h2>Reports on WhatsApp</h2>
    <p>Receive each completed meeting report, full transcript, and original WAV. Client sharing always requires a separate approval.</p>
    {sample ? <p>Available in your connected workspace.</p> : state && !state.available ? <p>WhatsApp delivery is awaiting setup for your account.</p> : <>
      <p>{state?.phone ? `Your number: +${state.phone}` : "Loading connection…"}</p>
      <button className={styles.secondaryButton} disabled={busy || !state?.available} onClick={() => void perform({ action: "configure", enabled: !state?.enabled })}>
        {state?.enabled ? "Turn off automatic reports" : "Send my future reports to WhatsApp"}
      </button>
      <button className={styles.secondaryButton} disabled={busy || !state?.available} onClick={() => void perform({}, true)}>Get WhatsApp pairing code</button>
      {code && <p>On your phone, open WhatsApp → Linked devices → Link a device → Link with phone number. Enter <strong>{code}</strong>.</p>}
      <button className={styles.secondaryButton} disabled={busy} onClick={() => { setError(""); void refresh(); }}>Refresh delivery status</button>
      {state?.deliveries.map(item => <div key={item.id}><p>+{item.phone} · {item.state === "sent" ? "Delivered" : item.state}</p>{item.last_error && <p>{item.last_error}</p>}{item.state === "failed" && <button disabled={busy} onClick={() => void perform({ action: "retry", id: item.id })}>Retry delivery</button>}</div>)}
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

export function ShareMeetingWhatsApp(props: { meetingId: string; title: string; sample: boolean }) {
  if (!whatsappEnabled()) {
    return <section className={deliveryStyles.panel}>
      <button className={styles.secondaryButton} disabled>Share with client on WhatsApp · Coming soon</button>
    </section>;
  }
  return <ShareMeetingWhatsAppForm {...props} />;
}

function ShareMeetingWhatsAppForm({ meetingId, title, sample }: { meetingId: string; title: string; sample: boolean }) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const share = async () => {
    if (!approved || busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/whatsapp/delivery", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "share", meetingId, phone, approved: true }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setMessage("Approved sharing is queued. Check delivery status in Settings."); setOpen(false); setApproved(false);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Sharing failed."); }
    finally { setBusy(false); }
  };
  return <section className={deliveryStyles.panel}>
    <button className={styles.secondaryButton} disabled={sample} onClick={() => { setOpen(!open); setApproved(false); }}>Share with client on WhatsApp</button>
    {open && <div className={deliveryStyles.form}>
      <h3>Share “{title}”</h3>
      <p>This sends the complete meeting report, full transcript, and original audio recording to the number below.</p>
      <label>Client WhatsApp number, including country code <input type="tel" value={phone} placeholder="+60…" onChange={e => { setPhone(e.target.value); setApproved(false); }} /></label>
      <label className={deliveryStyles.consent}><input type="checkbox" checked={approved} disabled={busy} onChange={e => setApproved(e.target.checked)} />I approve sharing the report, transcript, and audio with {phone || "this client"}.</label>
      <button className={styles.primaryButton} disabled={busy || !approved || !phone} onClick={() => void share()}>{busy ? "Queuing…" : "Approve and share"}</button>
      <button className={styles.secondaryButton} disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
    </div>}
    {message && <p role="status">{message}</p>}
  </section>;
}
