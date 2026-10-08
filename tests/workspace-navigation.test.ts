import test from "node:test";
import assert from "node:assert/strict";
import { isWorkspaceHref, resolveWorkspaceRoute } from "../lib/workspace-navigation";

test("direct live detail routes do not leave stale initial detail or view after switching home", () => {
  assert.deepEqual(resolveWorkspaceRoute("/dashboard/conversations/meeting%3A123", new URLSearchParams(), "live"), { view: "conversations", detailId: "meeting:123" });
  assert.deepEqual(resolveWorkspaceRoute("/dashboard", new URLSearchParams(), "live", "device"), { view: "overview", detailId: null });
  assert.deepEqual(resolveWorkspaceRoute("/dashboard/conversations", new URLSearchParams(), "live", "calendar"), { view: "conversations", detailId: null });
  assert.deepEqual(resolveWorkspaceRoute("/dashboard/conversations/%ZZ", new URLSearchParams(), "live"), { view: "conversations", detailId: null });
});

test("sample route state remains query based and cannot become a live conversation from its pathname", () => {
  assert.deepEqual(resolveWorkspaceRoute("/", new URLSearchParams("mode=sample&view=calendar"), "sample"), { view: "calendar", detailId: null });
  assert.deepEqual(resolveWorkspaceRoute("/", new URLSearchParams("view=overview&conversation=sample%3A1"), "sample"), { view: "conversations", detailId: "sample:1" });
  assert.deepEqual(resolveWorkspaceRoute("/dashboard/conversations/private", new URLSearchParams("mode=sample"), "sample"), { view: "overview", detailId: null });
});

test("native workspace switches exclude authentication, external, other-mode and unrelated routes", () => {
  assert.equal(isWorkspaceHref("/dashboard/calendar?month=2026-10", "live"), true);
  assert.equal(isWorkspaceHref("/dashboard/conversations/meeting%3A123?tab=Audio", "live"), true);
  assert.equal(isWorkspaceHref("/?mode=sample&view=calendar", "sample"), true);
  for (const href of ["//example.com", "https://example.com", "/login", "/api/auth/logout", "/privacy", "/dashboard/settings/other", "/?mode=sample"]) assert.equal(isWorkspaceHref(href, "live"), false, href);
  assert.equal(isWorkspaceHref("/dashboard", "sample"), false);
});
