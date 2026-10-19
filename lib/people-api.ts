import "server-only";
import { NextResponse } from "next/server";
import { browserMutationError } from "./request-security";
import { enforceUserRateLimit } from "./server-rate-limit";
import { z } from "zod";
import { loadOwnedPerson } from "./people-repository";
import { getAuthenticatedLanternUser } from "./supabase/session";
import { getServerSupabase } from "./supabase/server";

export async function ownedPersonContext(request: Request, id: string) {
  const boundary = browserMutationError(request);
  if (boundary) return { response: peopleJson({ error: boundary.error }, boundary.status) };
  if (!z.string().uuid().safeParse(id).success)
    return { response: peopleJson({ error: "Invalid person." }, 400) };
  const user = await getAuthenticatedLanternUser();
  if (!user) return { response: peopleJson({ error: "Sign in to continue." }, 401) };
  const limited = await enforceUserRateLimit(
    user.id,
    "people:" + request.method,
    request.method === "GET" ? 90 : 15,
    300,
  );
  if (limited) return { response: limited };
  const client = getServerSupabase();
  if (!client) return { response: peopleJson({ error: "Person storage is unavailable." }, 503) };
  let contact;
  try {
    contact = await loadOwnedPerson(client, user.id, id);
  } catch {
    return { response: peopleJson({ error: "Person details could not be loaded." }, 503) };
  }
  if (!contact) return { response: peopleJson({ error: "Person not found." }, 404) };
  return { client, userId: user.id, contact };
}

export function peopleJson(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
