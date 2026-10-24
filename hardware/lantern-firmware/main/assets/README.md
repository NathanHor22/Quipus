# Quipus local speech assets

All clips use the same warm, confident female voice as online reports.
Profile: `quipus-marin-v1`; voice: `marin`; model: `gpt-4o-mini-tts-2025-12-15`.

Generated from original Quipus interface text through the configured OpenAI speech service. These are generated audio clips, not a local voice-generation model.

Storage:24kHz mono IMA ADPCM4-bit, initial predictor/index0, high nibble first. The bounded decoder outputs at most1024 signed16-bit PCM samples per512-byte block and resets for each clip. No network or runtime synthesis is required.

Reproduction: scripts/generate-quipus-voice-assets.py then scripts/install-quipus-voice-assets.py. The endpoint is disabled without an ephemeral deployment-only token. Never put API keys on the board.

Only quiet synthesis margins are trimmed, with100ms leading and160ms trailing protection. Each generated catalog is checked against exact text/profile and encoded/decoded hashes before installation.

Consent clips only ask the question. Playback, intent selection, buttons and silence cannot approve consent.

## `consent_request.adpcm`

Does everyone consent to recording? Say yes or no.

3.98seconds; 47760bytes; decoded SNR 27.15dB.
SHA256 `52ab923f592a308219df9271e3ac26a773c3604e59b87cc05a50346510298d58`.

## `error_help.adpcm`

Something went wrong. Say Computer to try again.

4.04seconds; 48480bytes; decoded SNR 26.22dB.
SHA256 `92be9fb186ad52d338888b6462e3fccb21dc3b17c9cf63eb07965bdb497b69c5`.

## `recording_uploading.adpcm`

Uploading. Please keep Quipus on.

2.64seconds; 31680bytes; decoded SNR 29.23dB.
SHA256 `5da97beacf96f09bce8deb2ce71e36f882b1944dc9da93fc03b398c68a5fdba1`.

## `recording_uploaded.adpcm`

Your recording is uploaded.

2.18seconds; 26160bytes; decoded SNR 31.4dB.
SHA256 `1680295047e340185b4014af272656c957cc8a8319f31fb899722ea731936ebc`.

## `recording_saved_offline.adpcm`

Saved safely. I'll upload when connected.

2.8seconds; 33600bytes; decoded SNR 24.8dB.
SHA256 `21e4d508fdb02bc3612e7bf90d5e1de26cfd51db922941e1a9d4e9679c663efe`.

## `listening.adpcm`

I'm listening. Recording, or status report?

3.3seconds; 39600bytes; decoded SNR 28.14dB.
SHA256 `1952710c0ee064ee284b0255ef5447587ce77a4710a5972039c34deca82f98b4`.

## `command_retry.adpcm`

Please say start recording, or status report.

3.56seconds; 42720bytes; decoded SNR 24.52dB.
SHA256 `6bac77841a9400b9f1ad7854401829d2133500321bab30ad5943fd3be188afa5`.

## `command_unclear.adpcm`

I didn't catch that. Say Computer to try again.

3.48seconds; 41760bytes; decoded SNR 29.49dB.
SHA256 `904268f52e2788d8b396f6ecac58c14ccc60ab8eeb19d592b7679774a6c9fdd9`.

## `voice_unavailable.adpcm`

Voice recognition is unavailable. Please try again.

3.26seconds; 39120bytes; decoded SNR 27.14dB.
SHA256 `7c4c47559e63aa3adbf3aa461378ac79348c19e576ca249a11dafec36919ae2b`.

## `sd_failure.adpcm`

I can't save this recording. Please check the SD card.

3.56seconds; 42720bytes; decoded SNR 26.41dB.
SHA256 `ccbd804467320193dcbe0f18c9d3b6d5835e55a27ea54a3fd192da72449ec885`.

## `connection_lost_recording.adpcm`

Connection lost. I'm still recording.

2.46seconds; 29520bytes; decoded SNR 25.46dB.
SHA256 `4d98a837bb365cb70cb5470325a0fd34e4b1e847d2d0507e326f8b1af0d5340d`.

## `upload_delayed.adpcm`

Your recording is safe. I'll retry uploading.

3.46seconds; 41520bytes; decoded SNR 28.6dB.
SHA256 `e4db66c5ce7fb31f9e471ba70f47a9630edee0649e0f97c80d951e328a82649f`.

## `consent_retry.adpcm`

Not confirmed. Does everyone consent? Say yes or no.

4.38seconds; 52560bytes; decoded SNR 28.1dB.
SHA256 `a3cd74024f5bb437d783aefe12fd1cf2b20ccfcc3a622326a38a306098713a7f`.

## `consent_refused.adpcm`

Okay. I won't record. Say Computer when ready.

3.82seconds; 45840bytes; decoded SNR 28.64dB.
SHA256 `32364aa6be0e2f8217118f7e0ddc8f3018266e7746d7b139784f26d5b78426e3`.

## `meeting_processing.adpcm`

That meeting is still processing. Try another meeting.

3.68seconds; 44160bytes; decoded SNR 27.88dB.
SHA256 `bb10ce6eaf4f0e3ab683129e539e36a121b78bad4160ad2e2bdecafeeb63bbcc`.

## `report_done.adpcm`

Okay. Say Computer when you need me.

3.18seconds; 38160bytes; decoded SNR 30.43dB.
SHA256 `27c372c37c3b44fb49ab273c5fee44fd9bd2da99ce9abcca3f11b1f189c099fd`.

## `network_required.adpcm`

Please connect to Wi-Fi for this request.

2.62seconds; 31440bytes; decoded SNR 25.11dB.
SHA256 `84dfd623bd8af27801a0169144bfc453a0398227c90bf83f3921b28d127a3de4`.

## `recovery_listening.adpcm`

Say retry, status report, Wi-Fi setup, or cancel.

5.0seconds; 60000bytes; decoded SNR 27.68dB.
SHA256 `67155e8b964f7488f6b151187875f8e551ab96c0fc7afd66115d3b2a9ef44bbd`.

## `short_recording_skipped.adpcm`

No speech detected. That short recording was skipped.

3.62seconds; 43440bytes; decoded SNR 26.15dB.
SHA256 `00fd1641028ae164570ff4d51cbab874c1132f9c1306847385d68292c2071ac3`.

## `offline_record_choice.adpcm`

Offline mode. Start a recording? Say yes or no.

4.0seconds; 48000bytes; decoded SNR 25.42dB.
SHA256 `4587e5a19e13d9f8c7c7f1d446226b5a1239aeaf760f25613ce4ae07e363385a`.

## `offline_report_choice.adpcm`

Would you like a status report? Say yes or no.

3.24seconds; 38880bytes; decoded SNR 25.01dB.
SHA256 `345247fd3a7731a8cd235b759395206da35002f0d4fb7ab4fbabac82b8d5508e`.

## `recording_started.adpcm`

Recording now.

1.14seconds; 13680bytes; decoded SNR 34.59dB.
SHA256 `26f071d8f7dcedea316a6790fc9c7fd241f7f59be621156c2aa6b93bef173086`.

## `report_offline.adpcm`

Connect to Wi-Fi for a new report. Your recordings are safe.

4.16seconds; 49920bytes; decoded SNR 30.71dB.
SHA256 `6016c8bd00773084f3c0608217477751f726dc905cf2b3f53b910438e9bb0e23`.

## `cached_report.adpcm`

Here is your last saved report. Follow-ups need a connection.

3.66seconds; 43920bytes; decoded SNR 28.18dB.
SHA256 `6c8eb03e039bf6b06e8a9af7b65735897d5b8a55e9b786cb83057784560d1d6c`.

## `no_cached_report.adpcm`

No report is saved yet. Connect to Wi-Fi for a new report.

4.24seconds; 50880bytes; decoded SNR 28.39dB.
SHA256 `3c96349ac9f002b1fbc63b6fdd3c9281832dc3ca374b6dbdd18fa96fc33b5137`.
