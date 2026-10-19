import type { SupabaseClient } from "@supabase/supabase-js";
import type { Contact } from "./types";

/** Service-role clients bypass RLS, so owner filtering is mandatory here. */
export async function loadOwnedPerson(
  client: SupabaseClient,
  userId: string,
  contactId: string,
): Promise<Contact | null> {
  const result = await client
    .from("contacts")
    .select("id,name,company,role,email,phone")
    .eq("id", contactId)
    .eq("user_id", userId)
    .maybeSingle();
  if (result.error) throw new Error("Person details could not be loaded.");
  return result.data as Contact | null;
}
