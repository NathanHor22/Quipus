export type WorkspaceSetupStep = "checking" | "pair" | "record" | "calendar" | "complete";

export type SetupPreferences = {
  version: 1;
  calendarSkipped: boolean;
  collapsed: boolean;
};

export type PairingProgress = {
  version: 1;
  code: string;
  expiresAt: string;
  step: 0 | 1 | 2 | 3;
};

const emptyPreferences: SetupPreferences = {
  version: 1,
  calendarSkipped: false,
  collapsed: false,
};

function accountKey(email: string) {
  return encodeURIComponent(email.trim().toLowerCase());
}

export function setupStorageKey(email: string) {
  return `quipus:setup:${accountKey(email)}`;
}

export function pairingStorageKey(email: string) {
  return `quipus:pairing:${accountKey(email)}`;
}

export function readSetupPreferences(raw: string | null): SetupPreferences {
  try {
    const value: unknown = JSON.parse(raw || "null");
    if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1)
      return { ...emptyPreferences };
    return {
      version: 1,
      calendarSkipped: "calendarSkipped" in value && value.calendarSkipped === true,
      collapsed: "collapsed" in value && value.collapsed === true,
    };
  } catch {
    return { ...emptyPreferences };
  }
}

/** Stored preferences never certify pairing, uploads or Calendar access. */
export function workspaceSetupStep({
  devicePaired,
  hasRecording,
  calendarConnected,
  calendarSkipped,
}: {
  devicePaired: boolean | undefined;
  hasRecording: boolean;
  calendarConnected: boolean | undefined;
  calendarSkipped: boolean;
}): WorkspaceSetupStep {
  if (calendarConnected === undefined && !calendarSkipped) return "checking";
  if (calendarConnected === false && !calendarSkipped) return "calendar";
  if (devicePaired === undefined) return "checking";
  if (!devicePaired) return "pair";
  if (!hasRecording) return "record";
  return "complete";
}

/** Pairing codes are short-lived; expired or malformed browser state is discarded. */
export function readPairingProgress(raw: string | null, now = Date.now()): PairingProgress | null {
  try {
    const value: unknown = JSON.parse(raw || "null");
    if (!value || typeof value !== "object") return null;
    const entry = value as Record<string, unknown>;
    if (entry.version !== 1 || typeof entry.code !== "string" ||
        !/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/.test(entry.code) ||
        typeof entry.expiresAt !== "string" || !Number.isInteger(entry.step) ||
        Number(entry.step) < 0 || Number(entry.step) > 3) return null;
    const expiry = Date.parse(entry.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= now) return null;
    return { version: 1, code: entry.code, expiresAt: entry.expiresAt, step: entry.step as PairingProgress["step"] };
  } catch {
    return null;
  }
}

export function pairingSecondsRemaining(expiresAt: string, now = Date.now()) {
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry) ? Math.max(0, Math.ceil((expiry - now) / 1_000)) : 0;
}

/** An old `online` flag is not evidence of a current connection. */
export function hasRecentHeartbeat(lastSeenAt: string | null, now = Date.now(), maxAgeMs = 120_000) {
  if (!lastSeenAt) return false;
  const seen = Date.parse(lastSeenAt);
  return Number.isFinite(seen) && seen <= now + 30_000 && now - seen <= maxAgeMs;
}
