import { meetingTitleHandlers } from "@/lib/meeting-title-api";
import { getAuthenticatedLanternUser } from "@/lib/supabase/session";
import { getServerSupabase } from "@/lib/supabase/server";
import { enforceUserRateLimit } from "@/lib/server-rate-limit";
import { extractConversationInsights } from "@/lib/providers/meeting-extraction";

export const runtime = "nodejs";
export const maxDuration = 120;
export const { PATCH, POST } = meetingTitleHandlers({
  user: getAuthenticatedLanternUser,
  client: getServerSupabase,
  limit: (userId, method) => enforceUserRateLimit(userId, `meeting-title:${method}`, method === "POST" ? 3 : 30, 300),
  extract: extractConversationInsights,
});
