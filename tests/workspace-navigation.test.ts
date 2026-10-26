import test from "node:test";
import assert from "node:assert/strict";
import { isWorkspaceHref, primaryWorkspaceView, resolveWorkspaceRoute, sampleWorkspacePath } from "../lib/workspace-navigation";

test("direct live detail routes do not leave stale initial detail or view after switching home", () => {
  assert.deepEqual(resolveWorkspaceRoute("/dashboard/conversations/meeting%3A123", new URLSearchParams(), "live"), { view: "conversations", detailId: "meeting:123" });
  assert.deepEqual(resolveWorkspaceRoute("/dashboard", new URLSearchParams(), "live", "device"), { view: "overview", detailId: null });
  assert.deepEqual(resolveWorkspaceRoute("/dashboard/conversations", new URLSearchParams(), "live", "calendar"), { view: "people", detailId: null });
  assert.deepEqual(resolveWorkspaceRoute("/dashboard/conversations/%ZZ", new URLSearchParams(), "live"), { view: "people", detailId: null });
});

test("sample route state remains query based and cannot become a live conversation from its pathname", () => {
  assert.deepEqual(resolveWorkspaceRoute("/demo", new URLSearchParams("mode=sample&view=calendar"), "sample"), { view: "overview", detailId: null });
  assert.deepEqual(resolveWorkspaceRoute("/demo", new URLSearchParams("view=overview&conversation=sample%3A1"), "sample"), { view: "conversations", detailId: "sample:1" });
  assert.deepEqual(resolveWorkspaceRoute("/dashboard/conversations/private", new URLSearchParams("mode=sample"), "sample"), { view: "overview", detailId: null });
});

test("native workspace switches exclude authentication, external, other-mode and unrelated routes", () => {
  assert.equal(isWorkspaceHref("/dashboard/calendar?month=2026-10", "live"), true);
  assert.equal(isWorkspaceHref("/dashboard/conversations/meeting%3A123?tab=Audio", "live"), true);
  assert.equal(isWorkspaceHref("/demo?mode=sample&view=calendar", "sample"), true);
  for (const href of ["//example.com", "https://example.com", "/login", "/api/auth/logout", "/privacy", "/dashboard/settings/other", "/?mode=sample"]) assert.equal(isWorkspaceHref(href, "live"), false, href);
  assert.equal(isWorkspaceHref("/dashboard", "sample"), false);
  assert.equal(isWorkspaceHref("/demo?view=calendar", "live"), false);
  assert.equal(isWorkspaceHref("/demo/?view=calendar", "sample"), true);
  assert.equal(isWorkspaceHref("/?mode=sample&view=calendar", "sample"), false);
  assert.equal(isWorkspaceHref("/demo/other", "sample"), false);
  assert.equal(sampleWorkspacePath, "/demo");
});


test("saved calendar and device links resolve to Home and Settings in both modes", () => {
  for (const [legacy, primary] of [["calendar", "overview"], ["device", "settings"], ["conversations", "people"]] as const) {
    assert.equal(primaryWorkspaceView(legacy), primary);
    const path = legacy === "device" ? "devices" : legacy;
    assert.deepEqual(resolveWorkspaceRoute(`/dashboard/${path}`, new URLSearchParams(), "live"), { view: primary, detailId: null });
    assert.deepEqual(resolveWorkspaceRoute("/demo", new URLSearchParams(`view=${legacy}`), "sample"), { view: primary, detailId: null });
  }
});
