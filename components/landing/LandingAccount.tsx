import "server-only";

import { getAuthenticatedLanternUser } from "@/lib/supabase/session";
import { LandingAccountMenu } from "./LandingAccountMenu";

/** Keep the public city shell independent from the request's verified identity. */
export async function LandingAccount() {
  const user = await getAuthenticatedLanternUser();
  return <LandingAccountMenu account={user ? {
    displayName: user.displayName,
    email: user.email,
  } : null} />;
}
