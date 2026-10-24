# Quipus hands free firmware plan

Review copy: [Quipus hands free firmware plan](https://chatgpt.com/space/page_1e97fed8a74881919e10708bb905a03f)

24 October 2026 · Current firmware baseline: 0.10.9 · Planning only.

Quipus should work as a hands-free meeting assistant: hear “Computer” once, acknowledge immediately, guide recording or a conversation about saved meetings, and reliably return to idle. The screen should show a large friendly face and one short status caption. Every actionable warning should be spoken.

This plan consolidates the agreed next iteration for the Waveshare three-button prototype and the backend support it needs. The working upload flow remains the baseline. It separates verified behavior, reported faults and proposed changes so implementation does not mistake a plan for a finished feature.

## Current behavior and unresolved issues

| Area | Current state | Work still needed |
| --- | --- | --- |
| Upload and transcript | The database import conflict was repaired. The user confirmed full replay and transcript in the dashboard. | Repeat the check with a fresh multi-minute recording and under interrupted connectivity. |
| Wake after a session | The source has a return-to-idle routine, but the user reports “Computer” stops responding after recording/upload. | Reproduce and trace the audio/wake lifecycle; the cause is not established. |
| Wake acknowledgement | A detection opens a short command capture, with a chime. | Add the immediate local spoken acknowledgement and prevent duplicate activation. |
| Screen | Warm face and speech-driven mouth exist; headings and detail text can repeat. | Enlarge the face, remove QUIPUS and large state headings, and use one bottom caption. |
| Warnings | Some speech exists, but technical messages such as SD FILES NEED REVIEW still appear. | Speak actionable problems and remove diagnostic messages from normal screens. |
| Local retention | Verified local recordings are deleted immediately. | Retain for 24 hours after verified upload, independently of the upload queue. |
| Reports | Time, person, date, ordinal, full/quick/actions selection and follow-up windows exist. | Replace the rigid sequence with an ongoing conversation, add “I’m done,” and fix repeat/resume positions. |
| Spoken interruption | The middle button can interrupt playback. | Implement and acoustically validate voice interruption with echo handling. |
| Offline behavior | WakeNet runs locally, but current application gating requires pairing and Wi-Fi. Commands and spoken consent use the cloud. | Allow an appropriate local wake/acknowledgement path and provide a genuinely offline recovery strategy. |

The last observed upload-candidate count was zero. Fifteen protected recovery entries remained. That is not proof of fifteen unuploaded WAV files: orphan markers and quarantined metadata can contribute to that protection count. Preserve the evidence until separately assessed; it must not replace the normal idle screen.

## Agreed product rules

- The working wake word stays **Computer**. Keep WakeNet; do not reintroduce MultiNet.
- One accepted wake starts one interaction and produces one acknowledgement.
- Voice is the main interface. Physical controls remain a fallback and retain their current mapping.
- Recording consent remains voice-only: a clear YES starts recording; the first NO repeats the question; a second NO returns to idle. Silence, uncertain recognition and button presses never approve consent.
- Keep the entire recording. A short RAM buffer must never replace an SD-backed meeting.
- Preserve recordings through failed uploads, retries, power cycles and account-security checks.
- Every exit that can safely continue returns through one shared idle transition.
- Sending a client message, email or invitation remains a separate approved action. Asking for a report, interrupting speech or saying “I’m done” cannot authorize a send.
- Older board profiles and their saved demo firmware remain supported through separate hardware profiles.

## Wake and return to idle

The intended interaction is:

1. In idle, feed microphone audio to the local Computer detector.
2. On one accepted detection, latch the interaction and suspend further wake triggers.
3. Play a locally stored prompt: **“I’m listening. Start a recording session, or status report?”**
4. Finish playback, discard its residual microphone/echo frames, then open the command window.
5. Interpret the user’s command once. A recording request enters spoken consent; a report request opens conversational report mode.
6. If nothing clear is heard, ask once more, then return to idle. An initial command window of approximately five seconds is the proposed starting point.
7. After completion, cancellation, consent refusal, timeout or a recoverable failure, release capture/playback resources and restore the eligible wake listener.

The shared idle transition must cancel obsolete work, settle the speaker and microphone, clear the consumed wake event, restore monitoring, and show the idle face. Instrument actual microphone frames and detector state; a READY label alone is not acceptance.

Trace the reported missed wake before choosing a fix. Microphone restoration, playback draining, state transitions and connectivity gating are investigation points, not established diagnoses. The local detector should not silently disappear merely because cloud connectivity is unavailable; Quipus should be able to acknowledge locally and explain its available options.

## Minimal screen

| State | Face | Single bottom caption |
| --- | --- | --- |
| Idle | Large relaxed face with two dot eyes and a soft smile | Ready · Say Computer |
| Listening | Attentive face; speech animation while Quipus talks | Listening |
| Consent | Speaking, then listening | Say yes or no |
| Recording | Mouth open and still | Recording · 02:14 |
| Uploading | Face remains visible | Uploading · 42% |
| Report | Mouth follows actual speech playback | Status report |

Remove the QUIPUS heading, oversized state headings, duplicate upload text and technical recovery notices. Keep connection/battery indicators compact, and show battery information only when the hardware readings are valid.

Use one caption renderer for all states. Update progress at a bounded rate. Face animation should follow real PCM playback; recording holds the mouth open. A completion cue finishes and the device returns directly to the idle face.

Keep the current controls: left volume down, right volume up, middle tap start/stop, middle hold for safe shutdown. Buttons cannot approve recording consent. Stop-recording by middle button remains the established behavior; conversational “I’m done” exits report mode.

## Spoken warnings and recovery

Every user-facing error or warning is spoken. The screen retains the face and normal status; technical details remain in diagnostics. Each message should explain what happened, whether audio is safe when that is known, and the next step.

| Situation | Example spoken response |
| --- | --- |
| Wi-Fi lost during an already-authorized SD recording | “Connection lost. I’m still recording and saving locally.” |
| Upload fails after a successful local save | “Your recording is saved safely. Upload is delayed; I’ll retry automatically.” |
| Command unclear | “I didn’t catch that. Start recording, or status report?” |
| Recording cannot be saved | “I can’t save this recording. Please check the SD card.” |
| A requested meeting is still processing | “That meeting is still processing. Would you like another meeting?” |

Store essential prompts on the device so a cloud outage cannot silence them. Deduplicate announcements by issue and interaction; ordinary retry attempts must not repeat the warning. A new critical failure or explicit user request can trigger an updated explanation.

A failure that makes recording unsafe must be announced immediately and must never be presented as successful capture. Report speech and noncritical announcements must not talk over consent or an urgent storage warning.

Fully offline spoken recovery remains a missing capability. Evaluate a small local recognizer for the minimum necessary commands and consent responses, respecting the decision to avoid MultiNet. Until it passes real hardware tests, online recognition remains a requirement for those commands; never substitute button approval or assume that hearing Computer proves consent.

## SD retention and cleanup

Treat the SD card as a temporary persistent recording cache: recordings survive power-off.

| Recording state | Required behavior |
| --- | --- |
| Not uploaded, interrupted or unverified | Retain locally; the 24-hour deletion rule does not apply. |
| Complete upload verified by the backend | Leave the upload queue, retain the encrypted local copy, and record the first verified-upload time. |
| Less than 24 hours since verified upload | Keep the local copy without reuploading or repeating the completion announcement. |
| At least 24 hours since verified upload | Delete the local copy when the device is powered on, idle and has trustworthy time. |

The timer starts at verified upload, not the meeting’s start or end. For example, a Monday recording uploaded on Wednesday remains locally until Thursday. Dashboard retention is a separate policy.

Persist first_verified_at and delete_after in the authenticated archive journal. Retry, reboot and reconnect must not restart the timer or accidentally shorten it. If verification or time is uncertain, preserve the file.

Separate unverified upload work, verified retained copies, and protected recovery evidence. The present .qpm candidate count cannot be reused unchanged for every retained verified file; otherwise a 24-hour cache would be treated as an upload backlog.

Cleanup should process a small bounded amount of work while idle. Preserve journal consistency through interrupted deletion, enforce the existing owner/device/key binding, and never erase unverified or foreign-owner material to clear a warning. Migrate existing metadata conservatively and assess the fifteen protected entries separately.

## Conversational status reports

A plain “status report” should ask which meeting the user wants. Start a whole-day rundown only when explicitly requested.

| User says | Required behavior |
| --- | --- |
| “Only the meeting from 3 pm.” | Select that meeting in the user’s timezone and read its important points, decisions and next steps. |
| “What did they ask me to bring?” | Answer from the selected meeting and its context. |
| “What about my meeting at 12 pm?” | Switch directly without restarting the day’s report. |
| “Yesterday at 2 pm.” | Select from that day, preserving the user’s timezone. |
| “The third meeting.” | Use the stable ordered meeting selection for that conversation. |
| “Give me the full breakdown.” | Expand the selected meeting. |
| “Just the actions.” | Read the relevant actions without executing them. |
| “Repeat that.” | Repeat the last spoken section, not the next section. |
| “Continue.” | Resume from the appropriate saved position. |
| “I’m done,” “that’s all,” or “stop the report.” | Stop playback and report work, close report mode and return to idle. |

The user should not repeat Computer for each follow-up. Keep track of the selected day, meeting, person and relevant recent questions. Ask one short clarification when a time or person matches multiple meetings. Say when information was not captured; do not fill gaps with guesses.

Remove the rigid, user-visible eight-turn sequence. Keep conversation state bounded and expire it safely. A proposed inactivity timeout is about 30 seconds after playback ends; the user can finish sooner by saying “I’m done.” No repeated “still there?” prompts.

Store separate last-spoken and next-to-play positions. Current repeat behavior can use the advanced cursor, and interrupted playback can repeat the already-heard beginning of a page. Track position explicitly so switching meetings, resuming and requesting a repeat do different things.

## Spoken interruption and audio ownership

When the user speaks during a report, Quipus should pause its speaker locally and capture the request. The backend can then select a meeting, answer a follow-up or interpret the exit. Avoid waiting for a complete cloud round trip while the old report keeps playing.

First validate the microphone/speaker echo-reference and cancellation path at realistic volumes. Quipus must not interrupt itself, treat its own words as consent, or interpret report audio as a user command. This is additional audio work; the current button-interrupt path is not proof of voice interruption.

Cancel queued PCM and obsolete synthesis/network results when the user interrupts or switches meetings. Use an interaction generation identifier so a late response cannot resume an abandoned report. “I’m done” must also cancel pending speech and restore idle reliably.

Retain physical interruption as a fallback, while the main acceptance target remains hands-free. If the current board cannot meet the acoustic test, report that constraint before claiming the feature works.

## Implementation phases

| Phase | Work | Completion gate |
| --- | --- | --- |
| 1 Restore reliable wake lifecycle | Reproduce the missed wake, add safe diagnostics and consolidate return-to-idle handling. | Repeated recording/upload, consent refusal, report and error exits accept Computer exactly once afterward. |
| 2 Simplify the interface and speech | Larger face, one bottom caption, local listening acknowledgement, actionable audio warnings and deduplication. Establish offline wake behavior and the local-command feasibility work. | No duplicate text or announcements; essential warnings speak during network failure. |
| 3 Separate retention from upload | Durable verified-upload timestamps, 24-hour cache, separate work/recovery counts and bounded cleanup. Assess retained recovery evidence. | Unverified audio never ages out; verified copies survive reboot and expire only under the agreed rule. |
| 4 Make reports conversational | Meeting/day/person context, natural exits, clarification, last-spoken/resume positions and bounded dialogue. | Time switching, pronouns, repeat, continue and I’m done work without unintended actions. |
| 5 Add spoken interruption | Echo-safe monitoring, immediate playback pause, cancellation of stale work and reliable voice exit. | Interruptions work at tested volumes without self-triggering or replaying abandoned speech. |
| 6 Validate and release | Cross-profile checks, real recordings, reconnect/power tests, performance measurements and an extended session run. | Full replay/transcript match, responsive controls, stable memory and reliable return to idle. |

Keep responsibilities separate: audio capture/playback, wake/turn handling, conversation state, UI rendering, upload queue and retention cleanup. Prefer small modules and one owner for each transition over scattered flags and duplicate handlers.

Use bounded buffers and streamed audio rather than holding a full recording or day’s report in ESP32 memory. Serialize upload work, keep retention cleanup out of active recording, and measure slow stages before changing buffer sizes or network settings. Cache queue summaries where safe, refresh them on state changes, and avoid full-card scans or full-screen redraws on every tick. Diagnostic counters must be bounded and must not record private meeting audio.

## Acceptance checklist

- [ ] Twenty consecutive online wake interactions produce one acknowledgement each, with no button needed to restore listening.
- [ ] Computer works after boot, verified upload, a pending upload, NO/NO consent, report exit, silence, recoverable failure and reconnect.
- [ ] Record missed wakes, false activations and acknowledgement latency in quiet and noisy conditions at documented distances. Tune gain, clipping, noise handling and thresholds together.
- [ ] One wake leads to one command; Quipus does not hear its own acknowledgement, report or warning as user speech.
- [ ] Consent remains voice-only. NO/NO returns to idle; NO/YES starts only after YES; silence and button presses cannot approve.
- [ ] A fresh multi-minute recording has matching beginning/end markers, full replay duration and transcript in the correct dashboard account.
- [ ] Upload loss resumes safely without duplication or substitution with the short RAM tail.
- [ ] “Uploading” and “uploaded” are spoken once at the correct stage. Success requires verification.
- [ ] Verified files remain before 24 hours and expire afterward; unverified files remain beyond 24 hours. Cover reboot, invalid clock, card changes and interrupted cleanup.
- [ ] Recovery entries remain protected without technical text taking over the idle face.
- [ ] Time/person/day selection, ambiguous requests, repeat, continue and I’m done work across multiple meetings.
- [ ] Spoken interruption works at low and high tested volumes; a late server response cannot restart speech after exit.
- [ ] Several hours of repeated use show no steadily growing buffers, lost recordings or permanently disabled wake listener.
- [ ] Older hardware profiles compile and their recording-buffer protections remain intact.

## Other unfinished work

| Item | Remaining work |
| --- | --- |
| Protected recovery entries | Assess the fifteen retained entries internally. Do not assume they are complete WAVs or delete them simply to remove a notice. |
| Battery and charging | The Waveshare battery-installed option is disabled. Verify the installed battery and charger signals, calibrate readings, then enable percentage and a defensible charging estimate. Measure power use in recording, idle, Wi-Fi and speech modes before claiming multi-day battery life. |
| Physical Wi-Fi access | The non-touch board still needs a practical local setup fallback that preserves pairing and recordings, especially when cloud voice recognition is unavailable. |
| Personalized startup speech | The older personalized briefing was replaced by a chime on Waveshare. Any restored greeting must be short and must not delay ready/listening. |
| Phone microphone support | Android USB microphone support is not implemented for this Waveshare profile. The app/USB transport and phone/board power arrangement require separate integration and physical testing. iOS transport and app distribution also need their own implementation plan. |
| Bluetooth | Current BLE capability is setup/provisioning, not meeting-audio transfer. |
| Extended operation | Five-minute and multi-hour physical acceptance remain required on the next image; the earlier successful upload confirmation does not establish endurance. |

The next step is implementation after this plan is reviewed. This planning task does not flash the board, change recording files, apply database changes, deploy services or alter the working firmware.


## Implementation status: 0.11.0

The approved core changes are implemented in source and installed on the
three-button Waveshare board. See [the verification record](quipus-firmware-0.11.0-validation.md)
for checks, observed hardware behavior and remaining physical acceptance.
The earlier sections preserve the agreed baseline/plan; they are not a claim
that every acoustic, endurance, battery or offline-recognition target passed.
