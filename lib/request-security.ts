/** Pure browser boundary; device and worker endpoints authenticate separately. */
export function browserMutationError(request: Request): { error: string; status: number } | null {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return null;
  const site = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  if (site === "cross-site") return { error: "Cross-site requests are not allowed.", status: 403 };
  if (!origin) {
    return request.headers.has("cookie")
      ? { error: "A same-origin request is required.", status: 403 }
      : null;
  }
  try {
    if (origin === "null" || new URL(origin).origin !== new URL(request.url).origin) {
      return { error: "Cross-site requests are not allowed.", status: 403 };
    }
  } catch { return { error: "Invalid request origin.", status: 403 }; }
  return null;
}

/** Only explicit machine-authenticated routes bypass browser origin checks. */
export function isMachineAuthenticatedPath(path: string): boolean {
  return path.startsWith("/api/device/v1/") ||
    path === "/api/internal/process-recordings" || path === "/api/internal/recording-retention" ||
    /^\/api\/internal\/voice-build\/[a-z_]{1,48}$/u.test(path);
}
