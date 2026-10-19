import { z } from "zod";
import { ownedPersonContext, peopleJson } from "@/lib/people-api";
import { refreshPersonResearch } from "@/lib/people-research";

export const dynamic = "force-dynamic";
const decisionSchema = z
  .object({ candidateId: z.string().uuid(), status: z.enum(["confirmed", "rejected"]) })
  .strict();
const noteSchema = z.object({ note: z.string().trim().max(4_000) }).strict();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await ownedPersonContext(request, (await params).id);
  if (context.response) return context.response;
  const { client, userId, contact } = context;
  const [candidates, note] = await Promise.all([
    client
      .from("contact_research_candidates")
      .select("id,url,title,snippet,status,observed_at")
      .eq("contact_id", contact.id)
      .eq("user_id", userId)
      .order("observed_at", { ascending: false })
      .limit(20),
    client
      .from("contact_private_notes")
      .select("body")
      .eq("contact_id", contact.id)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (candidates.error || note.error)
    return peopleJson(
      { error: "Person research is unavailable. Check the relationship migration." },
      503,
    );
  return peopleJson({ candidates: candidates.data, note: note.data?.body || "" });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await ownedPersonContext(request, (await params).id);
  if (context.response) return context.response;
  if (!process.env.EXA_API_KEY)
    return peopleJson({ error: "Professional research is not connected yet." }, 503);
  try {
    await refreshPersonResearch(context.client, context.userId, context.contact, true);
    return peopleJson({ accepted: true });
  } catch {
    return peopleJson({ error: "Research could not be refreshed. Please try later." }, 503);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await ownedPersonContext(request, (await params).id);
  if (context.response) return context.response;
  const { client, userId, contact } = context;
  const input = await request.json().catch(() => null);
  const decision = decisionSchema.safeParse(input);
  if (decision.success) {
    const { error } = await client.rpc("decide_contact_research", {
      p_user_id: userId,
      p_contact_id: contact.id,
      p_candidate_id: decision.data.candidateId,
      p_status: decision.data.status,
    });
    return error
      ? peopleJson({ error: "The profile decision could not be saved." }, 400)
      : peopleJson({ saved: true });
  }
  const note = noteSchema.safeParse(input);
  if (!note.success) return peopleJson({ error: "Invalid profile update." }, 400);
  const { error } = await client
    .from("contact_private_notes")
    .upsert(
      {
        user_id: userId,
        contact_id: contact.id,
        body: note.data.note,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "contact_id" },
    );
  return error
    ? peopleJson({ error: "Your private note could not be saved." }, 503)
    : peopleJson({ saved: true });
}
