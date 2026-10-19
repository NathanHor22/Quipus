import { z } from "zod";

const inputSchema = z.object({ completed: z.literal(true) }).strict();
const metadataKey = "quipus_workspace_introduction_completed_at";

type IntroductionSession = {
  auth: {
    getUser(): Promise<{
      data: { user: { user_metadata?: Record<string, unknown> } | null };
      error: unknown;
    }>;
    updateUser(attributes: { data: Record<string, string> }): Promise<{ error: unknown }>;
  };
};

function json(body: Record<string, unknown>, status: number) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store, max-age=0" },
  });
}

/** Save a UX preference for the cookie-authenticated account, never a supplied user ID. */
export async function introductionResponse(
  request: Request,
  getSession: () => Promise<IntroductionSession | null>,
  now: () => Date = () => new Date(),
) {
  if (
    request.headers.get("origin") !== new URL(request.url).origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  ) {
    return json({ error: "Invalid request origin." }, 403);
  }

  try {
    const session = await getSession();
    if (!session) return json({ error: "Sign in to save your introduction." }, 401);
    const { data: { user }, error: authError } = await session.auth.getUser();
    if (authError || !user) return json({ error: "Sign in to save your introduction." }, 401);

    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return json({ error: "Send a valid introduction preference." }, 400);
    }
    if (!inputSchema.safeParse(input).success) {
      return json({ error: "Send a valid introduction preference." }, 400);
    }

    const existing = user.user_metadata?.[metadataKey];
    if (
      typeof existing === "string" && Number.isFinite(Date.parse(existing)) &&
      new Date(existing).toISOString() === existing
    ) {
      return json({ completedAt: existing }, 200);
    }

    const completedAt = now().toISOString();
    const { error } = await session.auth.updateUser({ data: { [metadataKey]: completedAt } });
    if (error) return json({ error: "Your introduction preference could not be saved. Try again." }, 503);
    return json({ completedAt }, 200);
  } catch {
    return json({ error: "Your introduction preference could not be saved. Try again." }, 503);
  }
}
