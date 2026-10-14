import assert from "node:assert/strict";
import test from "node:test";

import {
  authEnforcementMode,
  isLanternDevicePath,
  isPublicAuthPath,
  isPublicContentPath,
  sanitizeAuthReturnTo,
} from "../lib/auth-policy";

test("auth can be omitted only in unconfigured local development", () => {
  assert.equal(authEnforcementMode({ nodeEnv: "development" }), "disabled");
  assert.equal(authEnforcementMode({ nodeEnv: "test" }), "disabled");
  assert.equal(authEnforcementMode({ nodeEnv: "production" }), "misconfigured");
});

test("auth fails closed for partial Supabase public configuration", () => {
  assert.equal(
    authEnforcementMode({
      nodeEnv: "development",
      supabaseUrl: "https://project.supabase.co",
    }),
    "misconfigured",
  );
  assert.equal(
    authEnforcementMode({ nodeEnv: "development", supabaseAnonKey: "key" }),
    "misconfigured",
  );
});

test("auth is enabled when both Supabase public values exist", () => {
  assert.equal(
    authEnforcementMode({
      nodeEnv: "development",
      supabaseUrl: "https://project.supabase.co",
      supabaseAnonKey: "key",
    }),
    "enabled",
  );
});

test("OAuth return path accepts only same-origin relative paths", () => {
  assert.equal(sanitizeAuthReturnTo("/people?view=active#top"), "/people?view=active#top");
  assert.equal(sanitizeAuthReturnTo("https://attacker.invalid"), "/dashboard");
  assert.equal(sanitizeAuthReturnTo("//attacker.invalid/path"), "/dashboard");
  assert.equal(sanitizeAuthReturnTo(undefined), "/dashboard");
});

test("homepage, legal pages, login, auth callback and logout are public", () => {
  assert.equal(isPublicAuthPath("/"), true);
  assert.equal(isPublicAuthPath("/demo"), true);
  assert.equal(isPublicAuthPath("/login"), true);
  assert.equal(isPublicAuthPath("/privacy"), true);
  assert.equal(isPublicAuthPath("/terms"), true);
  assert.equal(isPublicAuthPath("/auth/callback"), true);
  assert.equal(isPublicAuthPath("/api/auth/logout"), true);
  assert.equal(isPublicAuthPath("/api/agora/token"), false);
  assert.equal(isPublicAuthPath("/api/google/callback"), false);
});

test("only explicit Lantern routes bypass browser cookies for device authentication", () => {
  assert.equal(isLanternDevicePath("/api/device/v1/claim"), true);
  assert.equal(isLanternDevicePath("/api/device/v1/briefing"), true);
  assert.equal(isLanternDevicePath("/api/device/v1/command"), true);
  assert.equal(isLanternDevicePath("/api/device/v1/reports"), true);
  assert.equal(isLanternDevicePath("/api/device/v1/heartbeat"), true);
  assert.equal(isLanternDevicePath("/api/device/v1/restart"), true);
  assert.equal(isLanternDevicePath("/api/device/v1/speak"), true);
  assert.equal(isLanternDevicePath("/api/device/v1/sessions"), true);
  assert.equal(
    isLanternDevicePath(
      "/api/device/v1/sessions/11111111-1111-4111-8111-111111111111/events",
    ),
    true,
  );
  for (const endpoint of ["transcript", "audio", "complete"]) {
    assert.equal(
      isLanternDevicePath(
        `/api/device/v1/sessions/11111111-1111-4111-8111-111111111111/${endpoint}`,
      ),
      true,
    );
  }
  assert.equal(isLanternDevicePath("/api/device/v1/admin"), false);
  assert.equal(isLanternDevicePath("/api/device/v1/briefing/extra"), false);
  assert.equal(isLanternDevicePath("/api/device/v1/command/extra"), false);
  assert.equal(isLanternDevicePath("/api/device/v1/speak/extra"), false);
  assert.equal(isLanternDevicePath("/api/devices/pairing"), false);
  assert.equal(
    isLanternDevicePath(
      "/api/device/v1/sessions/11111111-1111-4111-8111-111111111111/audio/extra",
    ),
    false,
  );
});


test("public content bypass is exact and cannot include private dashboards or API paths", () => {
  for (const path of ["/", "/demo", "/privacy", "/terms"]) assert.equal(isPublicContentPath(path), true, path);
  for (const path of ["/demo/private", "/dashboard", "/api/meetings", "/api/processing/file.glb", "/login", "/auth/callback", "/api/auth/logout"]) assert.equal(isPublicContentPath(path), false, path);
});
