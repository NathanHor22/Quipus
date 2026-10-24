import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { loadRoute } from "./helpers/route-harness";

// Exercise the actual route, real classifier and real PCM response helper.
// External auth/transcription edges are stubs; every unintended speech/report
// call is counted and rejected. No API keys or external connections are used.
const stateKey = Symbol.for("quipus.consent.route.test");
const state = {
  authorized: true,
  configured: true,
  text: "yes",
  transcriptions: 0,
  expectedTimeoutMs: 20_000,
  unexpected: [] as string[],
  allowReports: false,
  reportQueries: [] as Record<string, unknown>[],
  speechPages: 0,
  turnEvents: [] as string[],
};
Reflect.set(globalThis, stateKey, state);
const cleanups: Array<() => void> = [];
after(() => {
  Reflect.deleteProperty(globalThis, stateKey);
  cleanups.forEach((cleanup) => cleanup());
});
const statePrelude = 'const state=globalThis[Symbol.for("quipus.consent.route.test")];';
const mocked: Record<string, string> = {
  "@/lib/report-turn": 'export const claimReportTurn=async()=>{state.turnEvents.push("claim");return true;};',
  "@/lib/supabase/server": "export const getServerSupabase=()=>state.configured ? {} : null;",
  "@/lib/lantern-device-auth":
    'export const authenticateLantern=async()=>state.authorized ? { id:"device",userId:"owner",state:"ready",stateVersion:1 } : null;',
  "@/lib/providers/openai-transcription":
    'export const transcribeWithOpenAI=async(audio, options)=>{state.transcriptions++;state.turnEvents.push("transcribe");if(options.modelId!=="whisper-1")throw Error("Command model changed");if(options.timeoutMs!==state.expectedTimeoutMs)throw Error("Command timeout changed");return {text:state.text};};',
};
for (const [module, names] of Object.entries({
  "@/lib/device-briefing-service": ["loadDeviceBriefing"],
  "@/lib/device-dialogue": ["answerVoicePrompt", "createVoicePrompt"],
  "@/lib/providers/openai-speech": ["createOpenAISpeech"],
})) {
  mocked[module] = names
    .map(
      (name) =>
        `export const ${name}=()=>{state.unexpected.push("${name}");throw Error("Unexpected consent side effect");};`,
    )
    .join("\n");
}
mocked["@/lib/device-report-session"] =
  'export const prepareReportQuery=async(client,device,input)=>{if(!state.allowReports){state.unexpected.push("prepareReportQuery");throw Error("Unexpected report");}state.reportQueries.push(input);return {reportId:"11111111-1111-4111-8111-111111111111",page:0,intent:input.conversational && /^(?:I.m done|stop the report)$/i.test(input.text) ? "report_stop" : "report_answer"};};';
mocked["@/lib/device-speech-response"] =
  'export const deviceSpeechPage=async(client,device,input)=>{if(!state.allowReports){state.unexpected.push("deviceSpeechPage");throw Error("Unexpected report speech");}state.speechPages++;return new Response(new Uint8Array([1,0]),{headers:{"content-type":"audio/pcm","x-lantern-command":input.intent,...(input.interactionId?{"x-quipus-interaction-id":input.interactionId}:{})}});};';
let POST: (request: Request) => Promise<Response>;
let BRIEFING_POST: typeof POST;
async function compileRoute(entryPoint: string) {
  const loaded = await loadRoute<{ POST: typeof POST }>(entryPoint, mocked, statePrelude);
  cleanups.push(loaded.cleanup);
  return loaded.module.POST;
}
before(async () => {
  POST = await compileRoute("app/api/device/v1/command/route.ts");
  BRIEFING_POST = await compileRoute("app/api/device/v1/briefing/route.ts");
});
function request(
  context: string,
  intentOnly: boolean,
  dispatch = false,
  extraHeaders: Record<string, string> = {},
) {
  return new Request("https://quipus.example/api/device/v1/command", {
    method: "POST",
    headers: {
      "content-type": "audio/wav",
      "x-lantern-command-context": context,
      "x-lantern-protocol": "3",
      ...(intentOnly ? { "x-quipus-consent-response": "intent-only" } : {}),
      ...(dispatch ? { "x-quipus-wake-response": "dispatch" } : {}),
      ...extraHeaders,
    },
    body: new Uint8Array(100),
  });
}

test("consent and retry routes classify YES, NO and uncertainty without any TTS or report call", async () => {
  for (const context of ["consent", "consent_retry"]) {
    for (const [text, expected] of [
      ["Yes, we consent", "consent_yes"],
      ["yes yes NO yes", "consent_no"],
      ["Maybe later", "unknown"],
    ]) {
      for (const intentOnly of [true, false]) {
        state.text = text;
        const response = await POST(request(context, intentOnly));
        assert.equal(response.status, intentOnly ? 204 : 200);
        assert.equal(response.headers.get("x-lantern-command"), expected);
        assert.match(response.headers.get("cache-control") || "", /private.*no-store/u);
        assert.equal((await response.arrayBuffer()).byteLength, intentOnly ? 0 : 11_520);
        assert.deepEqual(state.unexpected, []);
      }
    }
  }
  assert.equal(state.transcriptions, 12);
});

test("intent-only consent still requires device authentication before transcription", async () => {
  state.authorized = false;
  const before = state.transcriptions;
  try {
    const response = await POST(request("consent", true));
    assert.equal(response.status, 403);
    assert.equal(state.transcriptions, before);
    assert.equal(response.headers.get("x-lantern-command"), null);
    assert.deepEqual(state.unexpected, []);
  } finally {
    state.authorized = true;
  }
});

test("non-consent wake verification retains its existing transcription deadline", async () => {
  state.expectedTimeoutMs = 45_000;
  state.text = "Background conversation";
  try {
    const response = await POST(request("wake_word", true));
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("x-lantern-command"), "unknown");
    assert.deepEqual(state.unexpected, []);
  } finally {
    state.expectedTimeoutMs = 20_000;
  }
});

test("plain wake commands dispatch without report queries or speech generation", async () => {
  state.expectedTimeoutMs = 20_000;
  const beforeQueries = state.reportQueries.length,
    beforePages = state.speechPages;
  for (const [text, intent] of [
    ["start recording", "start_recording"],
    ["status report", "status_report"],
    ["give me my status report", "status_report"],
    ["wifi setup", "wifi_setup"],
  ]) {
    state.text = text;
    const response = await POST(request("wake_command", false, true));
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("x-lantern-command"), intent);
    assert.equal((await response.arrayBuffer()).byteLength, 0);
    assert.match(response.headers.get("cache-control") || "", /private.*no-store/u);
  }
  assert.equal(state.reportQueries.length, beforeQueries);
  assert.equal(state.speechPages, beforePages);
  assert.deepEqual(state.unexpected, []);
});

test("advanced report selectors keep their complete protocol3 path and playback context", async () => {
  state.expectedTimeoutMs = 20_000;
  state.allowReports = true;
  const contextId = "22222222-2222-4222-8222-222222222222",
    playbackId = "33333333-3333-4333-8333-333333333333";
  try {
    for (const text of [
      "yesterday's status report",
      "full status report",
      "only the third meeting",
      "the meeting at two pm",
      "what did Nigel ask for?",
    ]) {
      state.text = text;
      const before = state.reportQueries.length;
      const response = await POST(
        request("wake_command", false, true, {
          "x-quipus-context-id": contextId,
          "x-quipus-playback-id": playbackId,
          "x-quipus-playback-page": "2",
        }),
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-lantern-command"), "report_answer");
      assert.equal(state.reportQueries.length, before + 1);
      assert.deepEqual(state.reportQueries.at(-1), {
        text,
        contextId,
        playbackId,
        playbackPage: 2,
      });
      assert.equal((await response.arrayBuffer()).byteLength, 2);
    }
    state.expectedTimeoutMs = 45_000;
    state.text = "status report";
    const legacy = await POST(request("wake_command", false));
    assert.equal(legacy.status, 200);
    assert.equal(legacy.headers.get("x-lantern-command"), "report_answer");
    assert.deepEqual(state.unexpected, []);
  } finally {
    state.allowReports = false;
    state.expectedTimeoutMs = 20_000;
  }
});

test("unknown wake dispatch remains204unknown rather than starting a capture", async () => {
  state.text = "Weather tomorrow";
  const response = await POST(request("wake_command", false, true));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("x-lantern-command"), "unknown");
  assert.deepEqual(state.unexpected, []);
});

test("recovery returns restricted decisions with no report, TTS or session side effects", async () => {
  const beforeQueries = state.reportQueries.length,
    beforePages = state.speechPages;
  for (const [text, intent] of [
    ["retry upload", "retry_recovery"],
    ["cancel", "cancel_recovery"],
    ["status report", "status_report"],
    ["wifi setup", "wifi_setup"],
    ["start recording", "unknown"],
    ["yes", "unknown"],
    ["send that email", "unknown"],
  ]) {
    state.text = text;
    const response = await POST(request("recovery", false));
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("x-lantern-command"), intent);
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  }
  assert.equal(state.reportQueries.length, beforeQueries);
  assert.equal(state.speechPages, beforePages);
  assert.deepEqual(state.unexpected, []);
});

test("conversation follow-ups forward separate spoken/next cursors and generation without action execution", async () => {
  const generation = "44444444-4444-4444-8444-444444444444";
  state.allowReports = true; state.expectedTimeoutMs = 45_000;
  try {
    for (const text of ["what did they ask me to bring?", "what about 12pm", "I'm done"]) {
      state.text = text;
      const response = await POST(request("report", false, false, {
        "x-quipus-report-mode": "conversation", "x-quipus-interaction-id": generation,
        "x-quipus-context-id": "22222222-2222-4222-8222-222222222222",
        "x-quipus-playback-id": "33333333-3333-4333-8333-333333333333",
        "x-quipus-playback-page": "3", "x-quipus-last-spoken-page": "2",
      }));
      assert.equal(response.status, text === "I'm done" ? 204 : 200);
      if (text === "I'm done") {
        assert.equal(response.headers.get("x-lantern-command"), "report_stop");
        assert.equal((await response.arrayBuffer()).byteLength, 0);
      }
      assert.equal(response.headers.get("x-quipus-interaction-id"), generation);
      assert.deepEqual(state.turnEvents.slice(-2), ["claim", "transcribe"]);
      assert.deepEqual(state.reportQueries.at(-1), {
        text, contextId: "22222222-2222-4222-8222-222222222222",
        playbackId: "33333333-3333-4333-8333-333333333333", playbackPage: 3,
        lastSpokenPage: 2, interactionId: generation, conversational: true, turnClaimed: true,
      });
      assert.deepEqual(state.unexpected, []);
    }
  } finally { state.allowReports = false; state.expectedTimeoutMs = 20_000; }
});

test("plain dispatch echoes the active generation without TTS", async () => {
  state.text = "status report";
  const generation = "44444444-4444-4444-8444-444444444444";
  const response = await POST(request("wake_command", false, true, { "x-quipus-interaction-id": generation, "x-quipus-report-mode": "conversation" }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("x-quipus-interaction-id"), generation);
  assert.deepEqual(state.unexpected, []);
});

test("initial briefing opts into meeting selection only for newly negotiated conversation mode", async () => {
  const generation = "44444444-4444-4444-8444-444444444444";
  state.allowReports = true;
  try {
    for (const conversation of [true, false]) {
      const response = await BRIEFING_POST(new Request("https://quipus.example/api/device/v1/briefing", {
        method: "POST", headers: { "content-type": "application/json", "x-lantern-protocol": "3",
          ...(conversation ? { "x-quipus-report-mode": "conversation", "x-quipus-interaction-id": generation } : {}) },
        body: JSON.stringify({ kind: "status" }),
      }));
      assert.equal(response.status, 200);
      assert.deepEqual(state.reportQueries.at(-1), {
        text: conversation ? "status report" : "Today's status report",
        contextId: undefined, playbackId: undefined, playbackPage: undefined,
        ...(conversation ? { conversational: true, interactionId: generation } : {}),
      });
    }
    assert.deepEqual(state.unexpected, []);
  } finally { state.allowReports = false; }
});
