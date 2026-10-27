import { z } from "zod";

import { InvalidPairingCodeError } from "@/lib/lantern-device-auth";
import {
  isLanternSchemaOutdated,
  LANTERN_SCHEMA_OUTDATED,
} from "@/lib/supabase/lantern-schema";

interface PairingFailure {
  status: 400 | 409 | 500 | 503;
  code: string;
  error: string;
}

/** Public pairing failures never include database details or another owner's identity. */
export function devicePairingFailure(error: unknown): PairingFailure {
  if (error instanceof InvalidPairingCodeError) {
    return {
      status: 400,
      code: "PAIRING_CODE_INVALID",
      error: error.message,
    };
  }
  if (error instanceof z.ZodError) {
    return {
      status: 400,
      code: "PAIRING_DETAILS_INVALID",
      error: "Quipus claim details are invalid.",
    };
  }

  const message =
    error && typeof error === "object" && "message" in error &&
    typeof error.message === "string"
      ? error.message
      : "";
  // Match the known RPC and qualified-query fallback failures exactly. Other
  // database errors stay private rather than being mistaken for user actions.
  if (message === "Quipus device reset is pending") {
    return {
      status: 409,
      code: "DEVICE_RESET_PENDING",
      error: "This Quipus is still clearing its previous account. Keep it powered on until setup returns.",
    };
  }
  if (/^(?:Lantern|Quipus) hardware is already paired to another owner\.?$/iu.test(message)) {
    return {
      status: 409,
      code: "DEVICE_OWNERSHIP_CONFLICT",
      error: "This Quipus belongs to another account. Transfer it from that account before pairing.",
    };
  }
  if (/^(?:Lantern|Quipus) hardware is already paired; revoke it before pairing again\.?$/iu.test(message)) {
    return {
      status: 409,
      code: "DEVICE_ALREADY_PAIRED",
      error: "This Quipus is already paired. Revoke it in its dashboard before pairing again.",
    };
  }
  if (isLanternSchemaOutdated(error)) {
    return {
      status: 503,
      code: LANTERN_SCHEMA_OUTDATED,
      error: "Quipus pairing is unavailable until its device database is updated.",
    };
  }
  return {
    status: 500,
    code: "PAIRING_FAILED",
    error: "Quipus could not be paired.",
  };
}
