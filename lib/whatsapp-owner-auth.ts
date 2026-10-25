import { requireAuthenticatedSession } from "./api-security";
import { WHATSAPP_COMING_SOON, whatsappEnabled } from "./features";
import { whatsappNoStoreJson } from "./whatsapp-relay";

/** The linked-device relay currently belongs to one configured prototype owner. */
export async function requireWhatsAppOwner() {
  if (!whatsappEnabled()) return whatsappNoStoreJson({ error: WHATSAPP_COMING_SOON }, 403);
  const authError = await requireAuthenticatedSession();
  if (authError) return authError;
  if (!process.env.WHATSAPP_OWNER_USER_ID) return whatsappNoStoreJson({ error: "WhatsApp account setup is required." }, 403);
  const { getAuthenticatedLanternUser } = await import("./supabase/session");
  const user = await getAuthenticatedLanternUser();
  return user?.id === process.env.WHATSAPP_OWNER_USER_ID ? null : whatsappNoStoreJson({ error: "WhatsApp is not connected for this account." }, 403);
}
