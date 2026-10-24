# Conversational reports: protocol 3 additions

New firmware opts in with `X-Quipus-Report-Mode: conversation` on `/api/device/v1/command` and `/api/device/v1/briefing`. Older binaries omit it and keep the existing full-day report behavior. No database migration is required.

A plain status report opens a short meeting-selection question. A time, person or meeting number selects a stable day snapshot. Explicit whole-day reports remain available. Pronoun questions use the selected meeting; missing or ambiguous information produces a clarification instead of a guessed answer.

## Requests

| Header | Meaning |
| --- | --- |
| `X-Quipus-Context-Id` | Owner/device-scoped report context from the last response. |
| `X-Quipus-Playback-Id` | Current report playback ID. |
| `X-Quipus-Playback-Page` | Next unfinished zero-based page, including the currently interrupted page. Advance only after PCM fully drains. |
| `X-Quipus-Last-Spoken-Page` | Last fully drained zero-based page. Omit if none has finished. Keep this separate from the unfinished cursor. |
| `X-Quipus-Interaction-Id` | UUID for the active report turn and all of its page requests. Replace it for a new spoken command or initial status interaction; do not regenerate it per page. Discard old speech after cancelling or superseding a turn. |

The command context stays `report` for follow-up questions, without requiring another wake word. Keep the existing separate action context and approval token for any action review or send.

## Responses and cancellation

Existing `audio/pcm`, `X-Lantern-Command: report_answer`, context, playback and next-page headers remain compatible. In conversation mode only, a recognized exit returns **204**, `X-Lantern-Command: report_stop` and the generation echo, without server TTS; firmware plays its local completion prompt once. Older modes retain their spoken stop response. New responses echo the interaction UUID and conversation mode. The transport must discard PCM whose echoed generation differs from its current generation. Stop commands close the context and invalidate pending spoken approvals; nothing is sent.

The server claims a new report turn before transcription using an owner/device-scoped JSON compare-and-set. Final context writes require that turn to remain active, so abandoned retrieval work cannot overwrite a newer turn. It also verifies the current generation before and after starting TTS, cancelling the response body if the interaction was replaced. Firmware cancellation remains essential for PCM already in flight. This is not a distributed transactional cancellation lock.

Repeat uses the last fully drained page, including after the final page completes. A repeat response adds `X-Quipus-Playback-Mode: repeat` and suppresses continuation and review-token headers. Firmware keeps the original next cursor rather than rewinding it when this one-page repeat finishes. Continue uses the next unfinished page; it never intentionally replays a completed page. Explicit `continue my daily report` resumes the paused daily snapshot after a targeted answer.

Partial-page resume is page-granular: the interrupted page may restart. Millisecond offsets are not applied to freshly generated speech because TTS timing can differ. Exact sample-level resumption would require caching the identical PCM stream; it is not claimed here.

## Bounds and factual answers

Context lasts at most two hours and expires after fifteen minutes without server activity. Active page playback renews the inactivity expiry while retaining the absolute two-hour ceiling. Firmware applies the shorter user-facing inactivity timeout after playback. Only the latest four question texts are retained in context; the service keeps no unbounded chat log. Important meeting details stay in existing owner-scoped meeting records.

Follow-up answers retrieve the selected meeting's saved notes, commitments, actions and conversation evidence. Research-only material, another owner's evidence and low-confidence evidence are excluded. Supported topic selection includes what to bring, requests, decisions, concerns, people and next steps; other questions retrieve matching saved facts or explicitly say the detail was not captured. These are grounded saved-note answers, not an unrestricted generative chatbot.

Asking for a report, saying yes in report context or saying I'm done cannot send an invitation, email or client message. Action items may be reviewed through the separate existing approval flow.


## Precise meeting-time selection

Time selectors preserve minutes and AM/PM: for example `1:37 AM`, `1:37 a.m.`,
`1.37am` and spoken `one thirty-seven AM` refer to the same minute. A spoken clock
is parsed as a whole phrase rather than taking its final word as a new hour.
Invalid or conflicting times require clarification; no nearest-time fallback
is used. Matching ignores seconds but uses the profile's civil timezone and
the active report day. An omitted date keeps that report's day; it does not
silently search another date. A different day must be requested explicitly.

If an exact time/person target is missing from a context opened before an
upload finished, the service refreshes only that owned day once for that turn.
New exact matches are appended without changing previously presented meeting
numbers or the saved daily speech pages/resume cursor. Missing and ambiguous
selections return report_clarify, allowing the existing two-clarification idle
limit to apply. Initial selection prompts and valid reports remain report_answer.

A sparse operational time-selection trace contains only normalized minute,
report day, timezone and result counts; it contains no transcript, names or
recording identifiers. No new database migration or firmware is required.
