import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Meeting } from "./types";
import { browserMutationError } from "./request-security";

const referenceSchema = z
  .string()
  .min(1)
  .max(160)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const inputSchema = z.object({ hidden: z.boolean() }).strict();
const uuid = z.string().uuid();
export class CalendarVisibilityError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function setRecordingCalendarVisibility(
  client: SupabaseClient,
  userId: string,
  reference: string,
  hidden: boolean,
) {
  const query = client
    .from("meetings")
    .select("id,client_reference,source,status")
    .eq("user_id", userId);
  const meeting = await (
    uuid.safeParse(reference).success
      ? query.eq("id", reference)
      : query.eq("client_reference", reference)
  ).maybeSingle();
  if (meeting.error) throw new CalendarVisibilityError("The recording could not be checked.", 503);
  let canonical = meeting.data?.client_reference || meeting.data?.id;
  if (meeting.data && (meeting.data.source === "calendar" || meeting.data.status === "upcoming"))
    throw new CalendarVisibilityError("Only recorded conversations can be hidden here.", 400);
  if (
    !canonical &&
    reference.startsWith("hardware:") &&
    uuid.safeParse(reference.slice(9)).success
  ) {
    const session = await client
      .from("lantern_sessions")
      .select("id")
      .eq("user_id", userId)
      .eq("id", reference.slice(9))
      .maybeSingle();
    if (session.error)
      throw new CalendarVisibilityError("The recording could not be checked.", 503);
    if (session.data) canonical = `hardware:${session.data.id}`;
  }
  if (!canonical) throw new CalendarVisibilityError("Recording not found.", 404);
  const saved = await client.from("calendar_recording_preferences").upsert(
    {
      user_id: userId,
      conversation_reference: canonical,
      hidden,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,conversation_reference" },
  );
  if (saved.error)
    throw new CalendarVisibilityError(
      "Calendar visibility could not be saved. Check that database migration 022 is installed.",
      503,
    );
  return { id: canonical as string, hidden, persisted: true as const };
}

export async function withCalendarVisibility(
  client: SupabaseClient,
  userId: string,
  meetings: Meeting[],
): Promise<Meeting[]> {
  const hidden = new Set<string>();
  for (let start = 0; start < meetings.length; start += 200) {
    const result = await client
      .from("calendar_recording_preferences")
      .select("conversation_reference")
      .eq("user_id", userId)
      .eq("hidden", true)
      .in(
        "conversation_reference",
        meetings.slice(start, start + 200).map((meeting) => meeting.id),
      );
    // Existing deployments stay usable until the new preference table is added.
    if (result.error && ["42P01", "PGRST205"].includes(result.error.code)) return meetings;
    if (result.error) throw new Error("Calendar visibility could not be loaded.");
    for (const row of result.data || []) hidden.add(row.conversation_reference);
  }
  return meetings.map((meeting) => ({ ...meeting, calendarHidden: hidden.has(meeting.id) }));
}

type Dependencies = {
  user: () => Promise<{ id: string } | null>;
  client: () => SupabaseClient | null;
  limit: (userId: string) => Promise<Response | null>;
};
export function calendarVisibilityHandler(dependencies: Dependencies) {
  return async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const json = (body: unknown, status = 200) =>
      Response.json(body, {
        status,
        headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
      });
    const boundary = browserMutationError(request);
    if (boundary) return json({ error: boundary.error }, boundary.status);
    const user = await dependencies.user();
    if (!user) return json({ error: "Sign in to continue." }, 401);
    const input = inputSchema.safeParse(await request.json().catch(() => null));
    const reference = referenceSchema.safeParse((await context.params).id);
    if (!input.success || !reference.success || reference.data.startsWith("sample:"))
      return json({ error: "Invalid recording visibility update." }, 400);
    const limited = await dependencies.limit(user.id);
    if (limited) return limited;
    const client = dependencies.client();
    if (!client) return json({ error: "Calendar visibility is unavailable." }, 503);
    try {
      return json(
        await setRecordingCalendarVisibility(client, user.id, reference.data, input.data.hidden),
      );
    } catch (error) {
      return json(
        {
          error:
            error instanceof CalendarVisibilityError
              ? error.message
              : "Calendar visibility could not be saved.",
        },
        error instanceof CalendarVisibilityError ? error.status : 503,
      );
    }
  };
}
