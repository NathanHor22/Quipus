export type AuthEnforcementMode = "disabled" | "enabled" | "misconfigured";

type AuthEnvironment = {
  nodeEnv?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

/**
 * Authentication is optional only for an unconfigured local development server.
 * A production deployment, or any environment with either public Supabase value
 * present, fails closed until both values are configured.
 */
export function authEnforcementMode({
  nodeEnv,
  supabaseUrl,
  supabaseAnonKey,
}: AuthEnvironment): AuthEnforcementMode {
  const hasUrl = Boolean(supabaseUrl?.trim());
  const hasAnonKey = Boolean(supabaseAnonKey?.trim());

  if (hasUrl && hasAnonKey) return "enabled";
  if (nodeEnv === "production" || hasUrl || hasAnonKey) return "misconfigured";
  return "disabled";
}

/** Prevent OAuth callbacks from becoming open redirects. */
export function sanitizeAuthReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//"))
    return "/dashboard";

  try {
    const parsed = new URL(value, "https://lantern.invalid");
    if (parsed.origin !== "https://lantern.invalid") return "/dashboard";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/dashboard";
  }
}

/** Public content never needs a session lookup; authenticated APIs stay protected. */
export function isPublicContentPath(pathname: string): boolean {
  return ["/", "/demo", "/privacy", "/terms", "/landing/city-buildings.json"].includes(pathname);
}

export function isPublicAuthPath(pathname: string): boolean {
  return (
    isPublicContentPath(pathname) ||
    pathname === "/login" ||
    pathname === "/auth/callback" ||
    pathname === "/api/auth/logout"
  );
}

/** Routes that authenticate the physical device instead of a browser user. */
export function isLanternDevicePath(pathname: string): boolean {
  return (
    pathname === "/api/device/v1/claim" ||
    pathname === "/api/device/v1/briefing" ||
    pathname === "/api/device/v1/command" ||
    pathname === "/api/device/v1/heartbeat" ||
    pathname === "/api/device/v1/restart" ||
    pathname === "/api/device/v1/reports" ||
    pathname === "/api/device/v1/speak" ||
    pathname === "/api/device/v1/sessions" ||
    /^\/api\/device\/v1\/sessions\/[0-9a-f-]{36}\/(?:events|transcript|audio|upload|complete)$/iu.test(
      pathname,
    )
  );
}
