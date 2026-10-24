import { calendarVisibilityHandler } from "@/lib/recording-calendar-visibility";
import { getAuthenticatedLanternUser } from "@/lib/supabase/session";
import { getServerSupabase } from "@/lib/supabase/server";
import { enforceUserRateLimit } from "@/lib/server-rate-limit";

export const runtime = "nodejs";
export const PATCH = calendarVisibilityHandler({
  user: getAuthenticatedLanternUser,
  client: getServerSupabase,
  limit: (userId) => enforceUserRateLimit(userId, "calendar-visibility", 60, 300),
});
