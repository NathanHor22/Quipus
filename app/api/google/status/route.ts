import { NextResponse } from "next/server";
import { requireAuthenticatedSession } from "@/lib/api-security";
import {
  checkGoogleConnection,
  readGoogleConnection,
  disconnectGoogle,
} from "@/lib/google-connection";
import { getServerSupabase, resolveWorkspaceUserId } from "@/lib/supabase/server";
import { browserMutationError } from "@/lib/request-security";
import { enforceUserRateLimit } from "@/lib/server-rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "cache-control": "no-store, max-age=0" };

async function context() {
  const client = getServerSupabase();
  const userId = client && (await resolveWorkspaceUserId(client));
  return client && userId ? { client, userId } : null;
}
export async function GET() {
  const authError = await requireAuthenticatedSession();
  if (authError) return authError;
  const owner = await context();
  if (!owner)
    return NextResponse.json(
      { error: "Sign in to check Google Calendar." },
      { status: 401, headers },
    );
  try {
    return NextResponse.json(await readGoogleConnection(owner.client, owner.userId), { headers });
  } catch {
    return NextResponse.json(
      { error: "Connection status is unavailable." },
      { status: 503, headers },
    );
  }
}
async function mutate(request: Request, disconnect: boolean) {
  const originError = browserMutationError(request);
  if (originError)
    return NextResponse.json({ error: originError.error }, { status: originError.status, headers });
  const authError = await requireAuthenticatedSession();
  if (authError) return authError;
  const owner = await context();
  if (!owner)
    return NextResponse.json({ error: "Authentication required." }, { status: 401, headers });
  const limited = await enforceUserRateLimit(owner.userId, "google-connection", 10, 300);
  if (limited) return limited;
  try {
    return NextResponse.json(
      disconnect
        ? await disconnectGoogle(owner.client, owner.userId)
        : await checkGoogleConnection(owner.client, owner.userId),
      { headers },
    );
  } catch {
    return NextResponse.json(
      { error: "Google connection could not be updated." },
      { status: 503, headers },
    );
  }
}
export async function POST(request: Request) {
  return mutate(request, false);
}
export async function DELETE(request: Request) {
  return mutate(request, true);
}
