import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";

import { devicePairingFailure } from "../lib/device-pairing-errors";
import { InvalidPairingCodeError, normalizePairingCode } from "../lib/lantern-device-auth";

test("another owner's pairing is a conflict with no account details", () => {
  for (const brand of ["Lantern", "Quipus"]) {
    const failure = devicePairingFailure(
      new Error(brand + " hardware is already paired to another owner"),
    );
    assert.equal(failure.status, 409);
    assert.equal(failure.code, "DEVICE_OWNERSHIP_CONFLICT");
    assert.match(failure.error, /Transfer it from that account/u);
    assert.doesNotMatch(failure.error, /credential|user_id|@/u);
  }
});

test("an existing active pairing explains the revoke action", () => {
  const failure = devicePairingFailure({
    code: "P0001",
    message: "Quipus hardware is already paired; revoke it before pairing again.",
  });
  assert.equal(failure.status, 409);
  assert.equal(failure.code, "DEVICE_ALREADY_PAIRED");
  assert.match(failure.error, /Revoke it in its dashboard/u);
});

test("invalid pairing alphabets and lengths return a validation failure", () => {
  for (const code of ["SHORT", "ABCDE01234", "ABCDEIO234", "ABCDE/2345"]) {
    let error: unknown;
    try { normalizePairingCode(code); } catch (caught) { error = caught; }
    assert.ok(error instanceof InvalidPairingCodeError);
    assert.equal(devicePairingFailure(error).status, 400);
    assert.equal(devicePairingFailure(error).code, "PAIRING_CODE_INVALID");
  }
  assert.equal(normalizePairingCode("abcde-23456"), "ABCDE23456");
});

test("malformed claim payloads are distinct from infrastructure failures", () => {
  const parsed = z.object({ hardwareId: z.string() }).safeParse({});
  assert.equal(parsed.success, false);
  if (!parsed.success) {
    assert.equal(devicePairingFailure(parsed.error).status, 400);
    assert.equal(devicePairingFailure(parsed.error).code, "PAIRING_DETAILS_INVALID");
  }
});

test("missing claim database schema is unavailable and does not expose SQL", () => {
  const failure = devicePairingFailure({
    code: "PGRST202",
    message: "Could not find the function public.claim_lantern_pairing",
  });
  assert.equal(failure.status, 503);
  assert.equal(failure.code, "LANTERN_SCHEMA_OUTDATED");
  assert.doesNotMatch(failure.error, /public\.|claim_lantern_pairing/u);
});

test("unexpected errors retain a generic response and cannot masquerade as conflicts", () => {
  for (const error of [
    new Error("Connection failed for private-user@example.com with credential abc"),
    new Error("Unexpected prefix: Lantern hardware is already paired to another owner"),
    null,
  ]) {
    assert.deepEqual(devicePairingFailure(error), {
      status: 500,
      code: "PAIRING_FAILED",
      error: "Quipus could not be paired.",
    });
  }
});


test("pending private reset is actionable without exposing its account", () => {
  const failure = devicePairingFailure(new Error("Quipus device reset is pending"));
  assert.equal(failure.status, 409);
  assert.equal(failure.code, "DEVICE_RESET_PENDING");
  assert.match(failure.error, /Keep it powered on/u);
});
