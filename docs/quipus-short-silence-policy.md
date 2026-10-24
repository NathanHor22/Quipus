# Short accidental recording policy

A recording is never deleted just because it is short or transcription is empty.

The first policy, `digital-constant-v1`, only accepts a completely flat digital
signal (zero or a constant DC offset within +/-128 in signed 16-bit PCM), in a
fully validated 16 kHz mono WAV strictly shorter than 5.000 seconds. Every
expected original track must independently qualify. Hash verification precedes
inspection; byte/sample counts come from the actual file, not the rounded device
duration. Header errors, truncation, clipping, a single varying sample, normal
microphone hiss, quiet speech, an incomplete phone track, provider failures or
any prior transcript/meeting evidence preserve the original recording.

Even digitally flat candidates must exhaust successful transcription fallbacks
with an explicit no-speech result. Recognized text, including a one-word "yes",
prevents discard. This conservative subset deliberately retains noisy accidental
captures. It is not a calibrated room VAD; a broader policy needs measured
false-deletion performance on real quiet speech before enabling it.

Migration 021 stores an authoritative, service-only decision binding the owner,
device, session, audio event, recording, verified source hashes, actual sample
counts and no-speech response count. In the same transaction it finishes only
that archived processing job as `discarded_silence` and queues exact owned object
paths for deletion. It creates no meeting, transcript, follow-up or notification.
The target-specific cleanup uses the existing storage-first lease and path-change
checks; failed cleanup stays retryable. The normal 90-day retention policy for
other recordings is unchanged. Neither the migration nor this policy sweeps old
recordings or alters an active device session.

The completion API reports `discarded: true`,
`discardReason: "short_digital_silence"`, `processingQueued: false` and no meeting.
`archiveVerified: true` after raw cleanup requires the private identity-bound
proof; a queue acknowledgement or public metadata cannot substitute for it.
Firmware may keep its normal local verified-archive retention interval and must
avoid announcing that an intentionally skipped capture is a new dashboard report.

Code can be deployed before migration 021: normal uploads never query the new
proof table. A qualifying candidate whose decision RPC is unavailable remains
archived and retries at five-minute intervals, without becoming a failed meeting.
Apply migration 021 to enable decisions and cleanup. No existing audio is deleted
by installing the migration alone.
