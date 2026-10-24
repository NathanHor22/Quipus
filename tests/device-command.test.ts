import assert from "node:assert/strict";
import test from "node:test";

import { commandReply, interpretDeviceCommand } from "../lib/device-command";
import { devicePrompt } from "../lib/device-prompts";

test("recognises ready-state voice commands in English and Malaysian phrasing", () => {
  assert.equal(
    interpretDeviceCommand("Ring, we're talking now. Start recording.", "ready"),
    "start_recording",
  );
  assert.equal(
    interpretDeviceCommand("Lantern, mula rakam meeting sekarang", "ready"),
    "start_recording",
  );
  assert.equal(
    interpretDeviceCommand("Ring status report for today", "ready"),
    "status_report",
  );
  assert.equal(
    interpretDeviceCommand("Lantern, laporan hari ini", "ready"),
    "status_report",
  );
  assert.equal(
    interpretDeviceCommand("Ring, we're done. Stop recording.", "ready"),
    "stop_recording",
  );
});

test("cloud wake recognition requires Lantern or Ring before acting", () => {
  assert.equal(
    interpretDeviceCommand("Lantern, start recording", "wake"),
    "start_recording",
  );
  assert.equal(
    interpretDeviceCommand("Latern, mula rakam meeting sekarang", "wake"),
    "start_recording",
  );
  assert.equal(
    interpretDeviceCommand("Ring status report", "wake"),
    "status_report",
  );
  assert.equal(interpretDeviceCommand("start recording", "wake"), "unknown");
  assert.equal(
    interpretDeviceCommand("we should start recording the call", "wake"),
    "unknown",
  );
});

test("wake word and following command are verified as separate states", () => {
  assert.equal(interpretDeviceCommand("Lantern", "wake_word"), "wake_detected");
  assert.equal(interpretDeviceCommand("Latern", "wake_word"), "wake_detected");
  assert.equal(interpretDeviceCommand("start recording", "wake_word"), "unknown");
  assert.equal(
    interpretDeviceCommand("start recording", "wake_command"),
    "start_recording",
  );
  assert.equal(commandReply("wake_detected"), "I'm listening. Say your command.");
});

test("wake command mode accepts only safe idle commands", () => {
  assert.equal(interpretDeviceCommand("start recording", "wake_command"), "start_recording");
  assert.equal(interpretDeviceCommand("status report", "wake_command"), "status_report");
  assert.equal(interpretDeviceCommand("Wi-Fi setup", "wake_command"), "wifi_setup");
  assert.equal(interpretDeviceCommand("stop recording", "wake_command"), "unknown");
  assert.equal(commandReply("start_recording", "wake_command"), "Start recording selected.");
});

test("the old oath no longer triggers a report", () => {
  assert.equal(
    interpretDeviceCommand(
      "In brightest day, in blackest night, no evil shall escape my sight. Beware my power, Green Lantern's light.",
      "ready",
    ),
    "unknown",
  );
});

test("consent is explicit and a negative answer wins", () => {
  assert.equal(interpretDeviceCommand("Yes, saya setuju", "consent"), "consent_yes");
  assert.equal(interpretDeviceCommand("No, jangan record", "consent"), "consent_no");
  assert.equal(interpretDeviceCommand("Maybe later", "consent"), "unknown");
  assert.match(commandReply("start_recording"), /consent/iu);
  assert.match(commandReply("consent_no", "consent"), /confirm again/iu);
  assert.match(commandReply("consent_no", "consent_retry"), /Consent was not given/iu);
  assert.match(commandReply("consent_yes", "consent_retry"), /Starting your recording/iu);
});

test("device prompts describe the actual recording and upload states", () => {
  assert.equal(
    devicePrompt("consent_success"),
    "Consent confirmed. Starting your recording.",
  );
  assert.equal(
    devicePrompt("recording_uploading"),
    "Recording stopped. Uploading now. Keep Quipus powered on.",
  );
  assert.equal(
    devicePrompt("upload_complete"),
    "Recording uploaded. Session complete.",
  );
  assert.match(devicePrompt("session_error"), /Tap or press to retry/iu);
  assert.match(devicePrompt("upload_error"), /keep Quipus powered on/iu);
  assert.match(devicePrompt("processing_pending"), /summary is still processing/iu);
  assert.equal(devicePrompt("wake_retry"), "I did not catch that. Please try again.");
  assert.equal(
    devicePrompt("wake_failure"),
    "No command heard. Returning to ready.",
  );
});


test("recording consent accepts complete affirmative English and Malaysian answers", () => {
  for (const context of ["consent", "consent_retry"] as const) {
    for (const answer of ["Yes", "YES!", "yes yes yes", "yeah", "yup", "yes please", "we consent", "Yes, we all agree", "I consent to being recorded", "Everyone has agreed", "ya", "boleh", "saya setuju", "Yes, saya setuju", "Ya, semua setuju", "Computer, yes"]) {
      assert.equal(interpretDeviceCommand(answer, context), "consent_yes", answer);
    }
  }
});

test("recording consent never lets repeated yes override an English or Malaysian refusal", () => {
  for (const context of ["consent", "consent_retry"] as const) {
    for (const answer of ["yes yes yes no yes", "not okay", "we have not agreed", "I never consent", "I didn't say yes", "yes but don't record", "we disagree", "yes tapi tak setuju", "tidak", "jangan", "belum", "batal"]) {
      assert.equal(interpretDeviceCommand(answer, context), "consent_no", answer);
    }
  }
});

test("reported yes, prompt echoes, questions and conditional answers cannot approve recording", () => {
  for (const context of ["consent", "consent_retry"] as const) {
    for (const answer of ["she said yes", "I heard yes", 'She said "yes"', '"yes"', "Did I say yes?", "Yes?", "Yes if the client agrees", "yes but change something first", "say yes to continue", "Does everyone agree", "maybe", " "]) {
      assert.equal(interpretDeviceCommand(answer, context), "unknown", answer);
    }
    assert.equal(interpretDeviceCommand("Has everyone agreed to being recorded? Say yes or no.", context), "consent_no");
  }
});


test("error recovery only accepts retry, cancel, report or network controls", () => {
  for (const text of ["retry", "Computer, retry upload", "try again", "resume upload", "cuba lagi"]) assert.equal(interpretDeviceCommand(text, "recovery"), "retry_recovery");
  for (const text of ["cancel", "go back", "return to ready", "batal"]) assert.equal(interpretDeviceCommand(text, "recovery"), "cancel_recovery");
  assert.equal(interpretDeviceCommand("status report", "recovery"), "status_report");
  assert.equal(interpretDeviceCommand("wifi setup", "recovery"), "wifi_setup");
  for (const text of ["start recording", "stop recording", "yes", "no", "send that email", "approve everything", "retry and start recording", ""]) assert.equal(interpretDeviceCommand(text, "recovery"), "unknown", text);
});
