export type DeviceCommandContext =
  | "ready"
  | "wake"
  | "wake_word"
  | "wake_command"
  | "consent"
  | "consent_retry"
  | "action"
  | "report"
  | "recovery";
export type DeviceCommandIntent =
  | "wake_detected"
  | "status_report"
  | "wifi_setup"
  | "start_recording"
  | "stop_recording"
  | "consent_yes"
  | "consent_no"
  | "retry_recovery"
  | "cancel_recovery"
  | "unknown";

function normalizedCommand(value: string) {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase("en")
    .replace(/[\u2018\u2019]/gu, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function interpretDeviceCommand(
  transcript: string,
  context: DeviceCommandContext,
): DeviceCommandIntent {
  const command = normalizedCommand(transcript);
  if (!command) return "unknown";

  // Legacy addresses remain compatible with older firmware. The installed
  // offline model still wakes on Computer, not the new product name.
  const hasWakeAddress = /\b(?:computer|quipus|lantern|latern|ring)\b/iu.test(command);

  if (context === "recovery") {
    const recovery = command.replace(/^(?:computer|quipus|lantern|latern|ring) /u, "");
    if (/^(?:retry|try again|retry upload|retry the upload|retry uploading|resume upload|resume uploading|upload saved recordings|cuba lagi)$/u.test(recovery)) return "retry_recovery";
    if (/^(?:cancel|go back|back|return to ready|never mind|nevermind|batal)$/u.test(recovery)) return "cancel_recovery";
    if (/^(?:status report|daily report|daily briefing|laporan status|laporan hari ini)$/u.test(recovery)) return "status_report";
    if (/^(?:wi fi setup|wifi setup|set up wi fi|set up wifi|change wi fi|change wifi|network setup|internet setup|setup network)$/u.test(recovery)) return "wifi_setup";
    return "unknown";
  }

  if (context === "wake_word") {
    return hasWakeAddress ? "wake_detected" : "unknown";
  }

  if (context === "consent" || context === "consent_retry") {
    // Refusal takes precedence even if a long answer also contains "yes".
    if (
      /\b(?:no|nope|nah|not|never|cancel|stop|don't|dont|do not|cannot|can't|cant|won't|wont|didn't|didnt|disagree|decline|refuse|tak|tidak|jangan|belum|batal)\b/iu.test(command)
    ) {
      return "consent_no";
    }
    // A reported/quoted yes, question, condition or background conversation
    // cannot consent on behalf of the room. Match a complete short answer.
    if (transcript.includes("?") || /["\u201c\u201d]/u.test(transcript)) return "unknown";
    const answer = command
      .replace(/^(?:computer|quipus|lantern|latern|ring) /u, "")
      .replace(/ (?:please|thank you|thanks)$/u, "");
    if (
      /^(?:(?:yes|yeah|yep|yup|ya|okay|ok)(?: |$))+$/u.test(answer) ||
      /^(?:boleh|setuju|teruskan|go ahead|agreed)$/u.test(answer) ||
      /^(?:(?:yes|yeah|yep|yup|ya|okay|ok) )?(?:i|we|we all|everyone|everybody|all of us) (?:consent|agree|agreed|have agreed|has agreed)(?: to (?:recording|being recorded|the recording))?$/u.test(answer) ||
      /^(?:(?:yes|yeah|ya|okay|ok) )?(?:saya|kami|semua) setuju$/u.test(answer)
    ) {
      return "consent_yes";
    }
    return "unknown";
  }

  if (
    context === "wake" &&
    !hasWakeAddress
  ) {
    return "unknown";
  }

  if (
    /\b(?:status report|daily report|daily briefing|today's meetings|todays meetings|what happened today|ring status|laporan status|laporan hari ini|ring report)\b/iu.test(
      command,
    )
  ) {
    return "status_report";
  }
  if (/\b(?:wi fi setup|wifi setup|set up wi fi|set up wifi|change wi fi|change wifi|network setup|internet setup|setup network)\b/iu.test(command)) {
    return "wifi_setup";
  }
  if (
    /\b(?:start recording|start the recording|start meeting|record now|we're talking now|we are talking now|mula rakam|mulakan rakaman|mula meeting|mula mesyuarat|ring start)\b/iu.test(
      command,
    )
  ) {
    return "start_recording";
  }
  if (context === "wake_command") return "unknown";
  if (
    /\b(?:stop recording|stop the recording|meeting done|we're done|we are done|tamat rakaman|habis rakam|ring stop|lantern stop)\b/iu.test(
      command,
    )
  ) {
    return "stop_recording";
  }
  return "unknown";
}

export function commandReply(
  intent: DeviceCommandIntent,
  context: DeviceCommandContext = "ready",
) {
  switch (intent) {
    case "retry_recovery":
      return "Retrying the saved operation.";
    case "cancel_recovery":
      return "Returning to ready. Saved recordings are preserved.";
    case "wake_detected":
      return "I'm listening. Say your command.";
    case "start_recording":
      return context === "wake_command"
        ? "Start recording selected."
        : "Recording requires consent. Do you consent to being recorded? Say yes or no.";
    case "stop_recording":
      return "There is no active recording to stop.";
    case "consent_yes":
      return "Consent confirmed. Starting your recording.";
    case "consent_no":
      return context === "consent_retry"
        ? "Consent was not given. Recording has not started. Please start another session."
        : "Recording has not started. Please confirm again. Do you consent to being recorded?";
    case "unknown":
      if (context === "consent" || context === "consent_retry") {
        return "I did not hear a clear yes or no. Please confirm. Do you consent to being recorded?";
      }
      return context === "wake_command"
        ? "I did not catch that. Say start recording, status report, or Wi-Fi setup."
        : "I did not catch that. Say Computer, then start recording, status report, or Wi-Fi setup.";
    case "status_report":
      return "Preparing your status report.";
    case "wifi_setup":
      return "Opening Wi-Fi setup.";
  }
}
