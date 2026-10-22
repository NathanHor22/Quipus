import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { lanternStateSchema, type LanternState } from "@/lib/lantern-state";

const PAIRING_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const PAIRING_CODE_LENGTH = 10;

export interface ParsedDeviceAuthorization {
  deviceId: string;
  secret: string;
}

export function hashLanternSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function createPairingCode(bytes = randomBytes(PAIRING_CODE_LENGTH)) {
  let code = "";
  for (let index = 0; index < PAIRING_CODE_LENGTH; index++) {
    code += PAIRING_ALPHABET[bytes[index] % PAIRING_ALPHABET.length];
  }
  return code;
}

export class InvalidPairingCodeError extends Error {
  constructor() {
    super("Enter the 10-character Quipus pairing code.");
    this.name = "InvalidPairingCodeError";
  }
}

export function normalizePairingCode(value: string): string {
  const normalized = value.toUpperCase().replace(/[\s-]+/gu, "");
  if (
    normalized.length !== PAIRING_CODE_LENGTH ||
    [...normalized].some((character) => !PAIRING_ALPHABET.includes(character))
  ) {
    throw new InvalidPairingCodeError();
  }
  return normalized;
}

export function createDeviceSecret() {
  return randomBytes(32).toString("base64url");
}

export function parseDeviceAuthorization(
  authorization: string | null | undefined,
): ParsedDeviceAuthorization | null {
  if (!authorization) return null;
  const match = authorization.match(
    /^Device ([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{40,80})$/iu,
  );
  return match ? { deviceId: match[1].toLowerCase(), secret: match[2] } : null;
}

export function matchesLanternSecret(secret: string, expectedHash: string) {
  const actual = Buffer.from(hashLanternSecret(secret), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export interface AuthenticatedLantern {
  id: string;
  userId: string;
  name: string;
  state: LanternState;
  stateVersion: number;
}

export async function authenticateLantern(
  request: Request,
  client: SupabaseClient,
): Promise<AuthenticatedLantern | null> {
  const authorization = parseDeviceAuthorization(
    request.headers.get("authorization"),
  );
  if (!authorization) return null;
  const { data, error } = await client
    .from("devices")
    .select("id,user_id,name,credential_hash,revoked_at,device_state,state_version")
    .eq("id", authorization.deviceId)
    .maybeSingle();
  if (
    error ||
    !data?.credential_hash ||
    data.revoked_at ||
    !matchesLanternSecret(authorization.secret, data.credential_hash)
  ) {
    return null;
  }
  const parsedState = lanternStateSchema.safeParse(data.device_state);
  if (!parsedState.success) return null;
  return {
    id: data.id,
    userId: data.user_id,
    name: data.name,
    state: parsedState.data,
    stateVersion: Number(data.state_version || 0),
  };
}
