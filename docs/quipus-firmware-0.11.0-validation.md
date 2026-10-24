# Quipus firmware 0.11.0 verification

24 October 2026. Target: Waveshare ESP32-S3-LCD-1.54 non-touch,
MAC 28:84:85:91:C4:4C. User confirmed USB power only.

## Delivered

- Installed 0.11.0 application and Computer model, with esptool flash hash
  verification. Existing NVS, pairing, encryption keys and SD files preserved.
- Deployed conversational report support to
  https://quipus-sales-rep-assistant.vercel.app.
  Production build and complete Next.js TypeScript check passed. No new SQL.
- Older original and touchscreen board profiles compile separately. Their
  existing saved demo firmware is preserved; they were not flashed here.
- Preserved a 0.10.9 Waveshare rollback bundle before replacing the release ZIP.

## Behavior

Computer is a local, single-consumer WakeNet event. Idle redraws do not clear
pending detections, and Wi-Fi loss does not switch local wake recognition off.
The local listening question drains before a five-second command window;
unclear commands get one retry. Upload completion returns immediately to idle.

The screen shows a larger warm face and one bottom caption. Actual speaker PCM
moves the mouth; recording holds it open. Technical SD recovery entries stay
in logs. User-facing failures use local spoken guidance, with retry deduplication.
LEFT lowers volume, RIGHT raises it, MIDDLE starts/stops a session and a two-second
hold safely shuts down. Holding LEFT+RIGHT for three seconds opens Wi-Fi setup
without erasing pairing or recordings. MIDDLE returns from setup.

Consent stays voice-only. YES can start; first NO asks again, second NO returns
idle. Silence, uncertain recognition, buttons and touch cannot approve.

Verified SD archives leave the upload queue but stay encrypted locally for 24h
after first verified delivery. Unverified recordings never age out. A bounded
idle scan performs deletion only with authenticated receipt metadata, valid
lengths and a plausible clock. Invalid/rollback time or interrupted writes
preserve recovery evidence. Unknown-time verified files receive a fresh 24h
window only when time is later usable. Protection checks remain uncached;
operational queue counts use mutation-aware caching.

Plain status report asks which meeting. Users can select time/person/day, ask
follow-up questions, request actions/full detail, repeat, continue, or say
I'm done. Answers retrieve owner-scoped saved meeting facts and evidence.
Repeat plays one section without rewinding the unfinished cursor. Sending
anything still requires the existing separate action approval.

Report-only AEC/VAD can interrupt speaker playback locally, retain onset audio,
and cancel obsolete PCM generations. Buffers and spoken capture are bounded;
a 30s listening allowance uploads at most 8s of command PCM. The older profiles
retain their existing physical interruption fallback.

## Verification performed

- All 18 firmware host runners passed, including actual production-function
  consent, delivery, wake, report HTTP/playback, SD retention, encryption,
  journal, OOM, malformed metadata, cancellation and clock fault cases.
- Report transport/playback: 51 cases. Consent/command transport: 95 cases.
- All three hardware profiles built using ESP-IDF 5.2.3, Ninja -j2.
- Board pin/profile, setup-portal generation and fresh SQL bundle checks passed.
- Report backend: 75 focused tests, bounded strict TypeScript and ESLint passed;
  full remote Next.js build/typecheck passed.
- Physical boot: retained pairing; saved Wi-Fi reconnected; SD mounted secure;
  ES8311/ES7210, 512-sample echo listener and Computer model initialized.
  READY state had wake enabled and continuously increasing microphone-frame
  counts, no pending upload candidates, and no observed boot panic.
- Initial idle memory: about 5.63MB total free, 123KB internal free; buffers are
  allocated once, not per report audio frame. No multi-hour claim is made.

## Acceptance still requiring real use

A physical voice test is requested in the current task: Computer -> status report
-> I'm done during speech. Follow with two-NO consent, positive consent, a
multi-minute capture/stop/full replay/transcript, then another wake activation.
These results must be recorded rather than inferred from host tests.

Spoken barge-in sensitivity, self-echo rejection at several speaker volumes,
noisy-room wake accuracy, multi-hour endurance, real power-loss/reconnect and
elapsed 24h cleanup have not yet been physically certified on this image.

## Practical limits

- Internet is still required for command transcription, voice consent and report
  retrieval. Local wake/essential prompts work without it; no offline command
  model or MultiNet is introduced.
- Resume is section/page-level. An interrupted section can restart; exact
  sample-level resumption of regenerated TTS is not claimed.
- The clock latch is SNTP-based, not an authenticated time service. Authenticated
  archive metadata and rollback guards do not make NTP cryptographically trusted.
- USB-only hardware has no validated battery percentage, charging ETA or runtime
  estimate. Those indicators remain hidden until a battery is fitted/calibrated.
- Waveshare application: 3,922,960B in a 4,128,768B slot, 205,808B free (about 5%).
  Future large audio assets need flash-budget review; RAM figures are separate.
- The existing Android USB-microphone profile/app remains separate from this
  Waveshare console profile. Phone/cable/power acceptance and iOS integration
  are not claimed by this firmware update.
