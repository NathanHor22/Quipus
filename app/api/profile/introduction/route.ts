import { createSessionSupabase } from "@/lib/supabase/session";
import { introductionResponse } from "./introduction-response";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  return introductionResponse(request, createSessionSupabase);
}
