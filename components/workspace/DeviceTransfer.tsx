"use client";
import { useEffect, useState } from "react";
import styles from "./lantern-device.module.css";
export function DeviceTransfer({ deviceId }: { deviceId: string }) {
  const [status, setStatus] = useState<"pending" | "completed" | "cancelled" | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const endpoint = "/api/devices/" + encodeURIComponent(deviceId) + "/transfer";
  useEffect(() => {
    const controller = new AbortController();
    async function refresh() {
      try {
        const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const result = await response.json();
        if (!controller.signal.aborted) setStatus(result.transfer?.status ?? null);
      } catch {
        /* Existing device health remains available during polling failures. */
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [endpoint]);
  async function change(cancel: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(endpoint, { method: cancel ? "DELETE" : "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Transfer could not be updated.");
      setStatus(cancel ? "cancelled" : "pending");
      setMessage(
        cancel
          ? "Transfer cancelled."
          : "Keep Quipus online. It will release pairing only after all local recordings are safely uploaded and cleared.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={styles.connectionCard}>
      <h3>Transfer to another account</h3>
      <p>
        Your uploaded meetings stay in this account. Quipus must finish uploading and clear its
        local private data before another person can pair it.
      </p>
      {status === "completed" ? (
        <p role="status">Transfer complete. Pair the recorder from its new account.</p>
      ) : (
        <button
          type="button"
          className={styles.secondaryAction}
          disabled={busy}
          onClick={() => void change(status === "pending")}
        >
          {status === "pending" ? "Cancel transfer" : "Prepare device for transfer"}
        </button>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
