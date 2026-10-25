/**
 * Release flags shared by server routes and client components.
 * NEXT_PUBLIC_ values are inlined into the browser bundle at build time, so
 * changing one requires a redeploy.
 */

/** WhatsApp delivery is shown as "coming soon" until explicitly enabled. */
export function whatsappEnabled(): boolean {
  return process.env.NEXT_PUBLIC_WHATSAPP_ENABLED === "true";
}

export const WHATSAPP_COMING_SOON = "WhatsApp delivery is coming soon.";
