import assert from "node:assert/strict";
import test from "node:test";

import type { MeetingExtraction } from "../lib/meeting-schema";
import { extractWithOpenAI } from "../lib/providers/openai-extraction";
import type { TranscriptSegment } from "../lib/types";

const transcript: TranscriptSegment[] = [
  { speaker: "Unknown speaker", text: "Kita start with a pilot in Bangsar dulu. Maybe Friday afternoon?", startSeconds: 10, endSeconds: 20 },
  { speaker: "Mr Chung", text: "Actually Thursday at one works. Confirmed, forty-five minutes. Send it to chung@example.com.", startSeconds: 22, endSeconds: 34 },
];
const context = {
  title: "Chung pilot discussion",
  outputLanguage: "English",
  referenceDate: "2026-09-06T10:00:00+08:00",
  timezone: "Asia/Kuala_Lumpur",
};
const options = { apiKey: "test-only-openai-key", model: "test-openai-model" };

function extractionFixture(): MeetingExtraction {
  return {
    insight: {
      meetingType: "Client conversation",
      intent: "Plan a pilot at the Bangsar branch.",
      interestLevel: "high",
      wants: "Start with a single branch.",
      concern: "Not stated.",
      promised: "Send the follow-up invitation after approval.",
      next: "Review the agreed follow-up meeting.",
      keyPoints: ["Start the pilot at the Bangsar branch."],
      commitments: [],
      detectedLanguage: "English and Bahasa Malaysia",
      executiveSummary: "Mr Chung agreed to review a Bangsar pilot on Thursday at 1pm.",
      dealStage: "evaluation",
      risks: [],
      openQuestions: ["Who owns the final pilot approval?"],
    },
    participants: [{
      name: "Mr Chung", company: null, role: null,
      email: "chung@example.com", phone: null,
    }],
    followUps: [{
      type: "schedule",
      description: "Pilot review with Mr Chung",
      dueAt: "2026-09-10T13:00:00+08:00",
      draft: null,
      schedule: {
        agreement: "agreed",
        startAt: "2026-09-10T13:00:00+08:00",
        durationMinutes: 45,
        attendees: ["chung@example.com"],
        location: null,
        evidence: "Actually Thursday at one works. Confirmed, forty-five minutes.",
      },
    }],
    evidence: [{
      category: "decision",
      statement: "Mr Chung confirmed Thursday at 1pm.",
      speaker: "Mr Chung",
      startSeconds: 22,
      endSeconds: 34,
      quote: "Actually Thursday at one works.",
      confidence: 0.98,
      importance: 5,
    }],
  };
}

function modelResponse(content: unknown) {
  return Response.json({
    output: [{
      type: "message",
      content: [{
        type: "output_text",
        text: typeof content === "string" ? content : JSON.stringify(content),
      }],
    }],
  });
}

test("OpenAI receives the conversation clock and a strict schedule schema", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async (url, init) => {
    calls += 1;
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-only-openai-key");
    assert.ok(init?.signal);
    const request = JSON.parse(String(init?.body));
    assert.equal(request.model, "test-openai-model");
    assert.equal(request.store, false);
    assert.equal(request.text.format.type, "json_schema");
    assert.equal(request.text.format.strict, true);
    const followUpSchema = request.text.format.schema.properties.followUps.items;
    assert.equal(followUpSchema.additionalProperties, false);
    assert.ok(followUpSchema.required.includes("schedule"));
    assert.equal(followUpSchema.properties.schedule.additionalProperties, false);
    assert.ok(followUpSchema.properties.schedule.required.includes("evidence"));
    assert.match(request.instructions, /Malaysian code-switching/u);
    assert.match(request.instructions, /untrusted data/u);
    assert.match(request.instructions, /later corrections/u);
    assert.match(request.instructions, /natural, concise English/u);
    assert.match(request.instructions, /atomic evidence/u);
    assert.deepEqual(JSON.parse(request.input), { context, transcript });
    return modelResponse(extractionFixture());
  };

  const result = await extractWithOpenAI(transcript, context, { ...options, fetchImpl });
  assert.equal(calls, 1);
  assert.deepEqual(result, { ...extractionFixture(), provider: "openai" });
});

test("missing OpenAI credentials fail before a request", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return modelResponse(extractionFixture());
  };
  await assert.rejects(
    () => extractWithOpenAI(transcript, context, { apiKey: null, fetchImpl }),
    /OpenAI is not configured/u,
  );
  assert.equal(calls, 0);
});

test("provider errors and malformed output fail without a fabricated recap", async () => {
  const responses = [
    () => new Response("Unavailable", { status: 503 }),
    () => modelResponse("not JSON"),
    () => modelResponse({ insight: {} }),
    () => Response.json({ output: [] }),
    () => { throw new Error("Network disconnected"); },
  ];
  for (const response of responses) {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return response();
    };
    await assert.rejects(
      () => extractWithOpenAI(transcript, context, { ...options, fetchImpl }),
    );
    assert.equal(calls, 1);
  }
});

test("model access errors fall back to an available extraction model", async () => {
  const models: string[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    models.push(request.model);
    if (models.length === 1) {
      return Response.json(
        { error: { type: "invalid_request_error", code: "model_not_found" } },
        { status: 403 },
      );
    }
    return modelResponse(extractionFixture());
  };

  const result = await extractWithOpenAI(transcript, context, {
    ...options,
    fetchImpl,
  });

  assert.deepEqual(models, ["test-openai-model", "gpt-5-mini"]);
  assert.equal(result.provider, "openai");
});

test("an unverified schedule is omitted without discarding the meeting recap", async () => {
  for (const patch of [
    { evidence: "Let's meet Monday at nine. Confirmed." },
    { evidence: null },
    { agreement: "tentative" as const },
  ]) {
    const fixture = extractionFixture();
    fixture.followUps[0]!.schedule = { ...fixture.followUps[0]!.schedule!, ...patch };
    const result = await extractWithOpenAI(transcript, context, {
      ...options,
      fetchImpl: async () => modelResponse(fixture),
    });
    assert.deepEqual(result.followUps, []);
    assert.match(result.warning || "", /unverified calendar follow-up/u);
  }
  const missingSchedule = extractionFixture();
  delete missingSchedule.followUps[0]!.schedule;
  const result = await extractWithOpenAI(transcript, context, {
    ...options,
    fetchImpl: async () => modelResponse(missingSchedule),
  });
  assert.deepEqual(result.followUps, []);
  assert.ok(result.insight.keyPoints.length > 0);
});

test("schedule evidence tolerates punctuation, case, and transcript segment breaks", async () => {
  const fixture = extractionFixture();
  fixture.followUps[0]!.schedule!.evidence =
    "maybe friday afternoon ACTUALLY thursday at one works";
  const result = await extractWithOpenAI(transcript, context, {
    ...options,
    fetchImpl: async () => modelResponse(fixture),
  });
  assert.equal(result.followUps[0]?.type, "schedule");
  assert.equal(result.warning, undefined);
});

test("a verified agreement may keep missing details for owner review", async () => {
  const fixture = extractionFixture();
  fixture.followUps[0]!.schedule!.attendees = [];
  fixture.followUps[0]!.schedule!.durationMinutes = null;
  fixture.followUps[0]!.schedule!.startAt = null;
  const result = await extractWithOpenAI(transcript, context, {
    ...options,
    fetchImpl: async () => modelResponse(fixture),
  });
  assert.deepEqual(result.followUps[0]?.schedule, fixture.followUps[0]?.schedule);
});

test("invalid extracted emails do not discard an otherwise valid meeting recap", async () => {
  const fixture = JSON.parse(JSON.stringify(extractionFixture()));
  fixture.participants[0].email = "chung at example dot com";
  fixture.followUps[0].schedule.attendees = [
    "chung at example dot com",
    "owner@example.com",
  ];

  const result = await extractWithOpenAI(transcript, context, {
    ...options,
    fetchImpl: async () => modelResponse(fixture),
  });

  assert.equal(result.participants[0]?.email, null);
  assert.deepEqual(result.followUps[0]?.schedule?.attendees, ["owner@example.com"]);
  assert.equal(result.followUps[0]?.type, "schedule");
});

test("an ordinary follow-up may have no schedule", async () => {
  const fixture = extractionFixture();
  fixture.followUps = [{
    type: "send_file", description: "Send the pilot quotation",
    dueAt: null, draft: null, schedule: null,
  }];
  const result = await extractWithOpenAI(transcript, context, {
    ...options,
    fetchImpl: async () => modelResponse(fixture),
  });
  assert.equal(result.followUps[0]?.type, "send_file");
  assert.equal(result.followUps[0]?.schedule, null);
});

test("unsupported evidence is removed and verified evidence inherits source coordinates", async () => {
  const fixture = extractionFixture();
  fixture.evidence.push({
    category: "budget",
    statement: "The budget is RM50,000.",
    speaker: "Mr Chung",
    startSeconds: 22,
    endSeconds: 34,
    quote: "The budget is RM50,000.",
    confidence: 0.9,
    importance: 4,
  });
  fixture.evidence[0]!.speaker = "Wrong speaker";
  fixture.evidence[0]!.startSeconds = 0;
  fixture.evidence[0]!.endSeconds = 1;
  const result = await extractWithOpenAI(transcript, context, {
    ...options,
    fetchImpl: async () => modelResponse(fixture),
  });
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0]?.speaker, "Mr Chung");
  assert.equal(result.evidence[0]?.startSeconds, 22);
  assert.equal(result.evidence[0]?.endSeconds, 34);
  assert.match(result.warning || "", /unsupported evidence item/u);
});


test("an uncertain offline capture clock clears dates even when the model returns confident times", async () => {
  const fixture = extractionFixture();
  fixture.insight.commitments = [{ ownerType: "user", description: "Send the quote", dueAt: "2026-10-20", status: "open" }];
  const result = await extractWithOpenAI(transcript, { ...context, referenceTimeUncertain: true }, { ...options, fetchImpl: async () => modelResponse(fixture) });
  assert.equal(result.followUps[0].dueAt, null);
  assert.equal(result.followUps[0].schedule?.startAt, null);
  assert.equal(result.insight.commitments[0].dueAt, null);
  assert.equal(result.followUps[0].description, fixture.followUps[0].description);
  assert.equal(result.followUps[0].schedule?.evidence, fixture.followUps[0].schedule?.evidence);
  assert.match(result.warning || "", /time is uncertain/i);
});
