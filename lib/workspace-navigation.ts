import type { WorkspaceMode } from "./workspace/model";
import type { WorkspaceView } from "../components/workspace/Workspace";

export const workspaceViewPaths: Record<WorkspaceView, string> = {
  overview: "/dashboard", conversations: "/dashboard/conversations", calendar: "/dashboard/calendar",
  people: "/dashboard/people", device: "/dashboard/devices", settings: "/dashboard/settings",
};

const validViews = Object.keys(workspaceViewPaths) as WorkspaceView[];

/** The URL is authoritative after native history changes, including direct detail entry. */
export function resolveWorkspaceRoute(
  pathname: string, search: URLSearchParams, mode: WorkspaceMode,
  fallback: WorkspaceView = "overview",
): { view: WorkspaceView; detailId: string | null } {
  if (mode === "sample") {
    const detailId = search.get("conversation");
    const requested = search.get("view") as WorkspaceView;
    return { view: detailId ? "conversations" : validViews.includes(requested) ? requested : fallback, detailId };
  }
  const path = pathname.replace(/\/$/u, "") || "/";
  const detailPrefix = workspaceViewPaths.conversations + "/";
  if (path.startsWith(detailPrefix)) {
    const encoded = path.slice(detailPrefix.length);
    let detailId: string | null = null;
    try { if (encoded && !encoded.includes("/")) detailId = decodeURIComponent(encoded); }
    catch { /* Invalid URL encoding cannot crash the workspace. */ }
    return { view: "conversations", detailId };
  }
  const match = validViews.find(view => workspaceViewPaths[view] === path);
  return { view: match || fallback, detailId: null };
}

/** Only the mounted workspace's own same-mode URLs may be switched locally. */
export function isWorkspaceHref(href: string, mode: WorkspaceMode): boolean {
  if (!href.startsWith("/") || href.startsWith("//")) return false;
  const url = new URL(href, "https://quipus.invalid");
  if (mode === "sample") return url.pathname === "/";
  const path = url.pathname.replace(/\/$/u, "");
  return Object.values(workspaceViewPaths).includes(path)
    || /^\/dashboard\/conversations\/[^/]+$/u.test(path);
}
