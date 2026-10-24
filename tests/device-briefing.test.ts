import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBootBriefing,
  buildStatusBriefing,
  localDateKey,
  ownerSpokenName,
  splitSpeechPages,
} from "../lib/device-briefing";
import { createOpenAISpeech } from "../lib/providers/openai-speech";

test("builds an owner-specific boot briefing with bounded battery", () => {
  assert.equal(ownerSpokenName("Nathan Hor", "nathan@example.com"), "Nathan Hor");
  assert.equal(ownerSpokenName(null, "nigel.tan@example.com"), "nigel tan");
  assert.equal(
    buildBootBriefing({ ownerName: "Nathan Hor", batteryLevel: 140 }),
    "Quipus ready, Nathan. Say Computer for a command, or tap or press to record.",
  );
});

test("builds a daily status report and asks to review specific approvals", () => {
  const speech = buildStatusBriefing({
    ownerName: "Nathan Hor",
    meetings: [
      {
        title: "Mr Chung \u00b7 Acme",
        keyPoints: ["They want a pricing proposal next week."],
        nextAction: "Send the deck.",
      },
    ],
    pendingApprovals: 1,
  });
  assert.match(speech, /Today you recorded 1 conversation\./);
  assert.match(speech, /Mr Chung, Acme/);
  assert.match(speech, /1 pending action item/);
  assert.match(speech, /Each invitation needs your approval before it is sent/);
});

test("full reports preserve all meetings, details, and final points across speech pages", () => {
  const meetings = Array.from({ length: 6 }, (_, meeting) => ({ title: `Client ${meeting}`,
    keyPoints: Array.from({ length: 8 }, (_, point) => `Point ${meeting}-${point}: ${"Discuss the complete proposal and its delivery timeline. ".repeat(4)}`),
    concern: `Concern ${meeting}`, promised: `Promise ${meeting}`, commitments: [`Commitment ${meeting}`] }));
  const speech = buildStatusBriefing({ ownerName: "Nathan", meetings, pendingApprovals: 2 });
  const pages = splitSpeechPages(speech);
  assert.ok(pages.length > 10);
  assert.ok(pages.every(page => page.length <= 650));
  assert.equal(pages.join(" "), speech);
  for (const [index, meeting] of meetings.entries()) {
    assert.ok(speech.includes(`Point ${index}-7:`));
    assert.ok(speech.includes(meeting.concern));
    assert.ok(speech.includes(meeting.promised));
  }
  assert.match(pages.at(-1)!, /Would you like to review them/);
});

test("speech rejects oversized input instead of silently cutting off a report", async () => {
  let fetched = false;
  await assert.rejects(createOpenAISpeech("a".repeat(4097), { apiKey: "test", fetchImpl: async () => {
    fetched = true; return new Response();
  } }));
  assert.equal(fetched, false);
});

test("uses the owner timezone for the status-report day", () => {
  assert.equal(localDateKey("2026-09-13T16:30:00.000Z", "Asia/Kuala_Lumpur"), "2026-09-14");
});

test("OpenAI speech requests streamable 24 kHz PCM without exposing its key", async () => {
  let request: Request | undefined;
  const response = await createOpenAISpeech("Lantern online.", {
    apiKey: "test-secret-key",
    fetchImpl: async (input, init) => {
      request = new Request(input, init);
      return new Response(new Uint8Array([0, 0, 1, 0]), {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      });
    },
  });
  assert.equal(request?.url, "https://api.openai.com/v1/audio/speech");
  assert.equal(request?.headers.get("authorization"), "Bearer test-secret-key");
  const body = JSON.parse(await request!.text()) as Record<string, unknown>;
  assert.equal(body.model, "gpt-4o-mini-tts-2025-12-15");
  assert.equal(body.voice, "marin");
  assert.equal(body.response_format, "pcm");
  assert.equal(body.stream_format, "audio");
  assert.equal(body.speed, 1.02);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0, 0, 1, 0]);
});

test("unavailable speech fails explicitly without switching voice or using Chat Completions", async () => {
  const requests: Request[] = [];
  await assert.rejects(createOpenAISpeech("Status report.", {
    apiKey: "test-secret-key",
    fetchImpl: async (input, init) => {
      requests.push(new Request(input, init));
      return Response.json({ error: { code: "model_not_found", message: "private-provider-detail" } }, { status: 403 });
    },
  }), error => error instanceof Error && /No alternate voice was used/.test(error.message) && !error.message.includes("private-provider-detail"));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.openai.com/v1/audio/speech");
  const request = await requests[0].json();
  assert.equal(request.voice, "marin");
  assert.equal(request.model, "gpt-4o-mini-tts-2025-12-15");
});

test("conflicting voice/model overrides are rejected before any provider request", async () => {
  let calls = 0;
  for (const override of [{ voice: "alloy" }, { model: "tts-1" }]) {
    await assert.rejects(createOpenAISpeech("Quipus ready.", { ...override, apiKey: "test",
      fetchImpl: async () => { calls++; return new Response(); },
    }), /shared Quipus voice profile/);
  }
  assert.equal(calls, 0);
});
