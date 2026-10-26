import type { SupabaseClient } from "@supabase/supabase-js";
import { isPlaceholderMeetingTitle } from "./meeting-title";

type MeetingWrite = {
  user_id: string;
  client_reference: string;
  title: string;
  start_at: string;
  end_at: string;
  status: string;
  source: string;
  recording_id: string;
};
type SavedTitle = { id: string; title: string };

/** Retried processing never writes over a meaningful title, including concurrent user edits. */
export async function saveMeetingWithProtectedTitle(
  client: SupabaseClient,
  value: MeetingWrite,
  promotePlaceholder = false,
): Promise<SavedTitle> {
  const lookup = () => client.from("meetings").select("id,title")
    .eq("user_id", value.user_id).eq("client_reference", value.client_reference).maybeSingle();
  let current = await lookup();
  if (current.error) throw new Error("Could not check the existing meeting title.");
  if (!current.data) {
    const inserted = await client.from("meetings").insert(value).select("id,title").single();
    if (!inserted.error && inserted.data) return inserted.data as SavedTitle;
    // Another worker may have won the owner/reference unique constraint.
    if (inserted.error?.code !== "23505") throw new Error("Could not create the meeting.");
    current = await lookup();
    if (current.error || !current.data) throw new Error("Could not check the concurrent meeting.");
  }
  const { title: generatedTitle, ...metadata } = value;
  const updated = await client.from("meetings").update(metadata)
    .eq("id", current.data.id).eq("user_id", value.user_id).select("id,title").single();
  if (updated.error || !updated.data) throw new Error("Could not update the meeting.");
  let saved = updated.data as SavedTitle;
  if (promotePlaceholder && isPlaceholderMeetingTitle(saved.title) && !isPlaceholderMeetingTitle(generatedTitle)) {
    const promoted = await client.from("meetings").update({ title: generatedTitle })
      .eq("id", saved.id).eq("user_id", value.user_id).eq("title", saved.title)
      .select("id,title").maybeSingle();
    if (promoted.error) throw new Error("Could not update the meeting title.");
    if (promoted.data) saved = promoted.data as SavedTitle;
    else {
      const latest = await lookup();
      if (latest.error || !latest.data) throw new Error("Could not check the current meeting title.");
      saved = latest.data as SavedTitle;
    }
  }
  return saved;
}
