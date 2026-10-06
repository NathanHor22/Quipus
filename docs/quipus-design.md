# Quipus by Fovea

The supplied illustrated logo is the primary identity on login and onboarding.
Use its compact emblem alongside the Quipus wordmark in the header. The wordmark
keeps its serif character; headings, controls and reading surfaces use the
installed system sans-serif stack. No font download is required. The full logo
and emblem are raster assets in `public/quipus-logo.png` and
`public/quipus-emblem.png`; the `public/quipus-*.svg` compatibility assets wrap
the supplied raster logo.

Light is the default theme: warm ivory `#F5F3ED`, white reading surfaces
`#FFFFFF`, raised surfaces `#F0EEE8`, navy text and primary actions `#0B2239`,
slate supporting text, and soft navy-grey dividers. Navigation and panels use
frosted glass with 2–3 px corners, fine borders, restrained shadows and small
crimson edge strokes. Navy rectangular buttons frame primary actions; bordered
glass buttons frame secondary actions, including Reset sample and Back.
Use navy for action emphasis and reserve crimson for the logo, selection
markers and decorative geometry. Optional dark mode uses navy backgrounds,
ivory text and light slate supporting text. Both themes have explicit button,
overlay and semantic status tokens. Completion uses blue, approvals use crimson,
processing uses slate, and failures use red, alongside explicit state text.

The ambient geometry has five reds: burgundy `#751B2B`, signature crimson
`#B72D36`, vermilion `#D94349`, muted rose `#DB777C`, and pale blush `#EEC1C3`.
Folded polygon fragments can show several faces, using the darker reds most
often. Ten fragments drift through the open margins, reduced to four on small
screens. Small points form triangular connections, stretch and separate as
the fragments move. Pale
fragments sit further back. Reading panels use translucent white over blurred
geometry; dialogs use stronger glazing to keep overlapping text readable. One background layer
persists across tabs, with fewer fragments on small screens.

Main headings assemble from geometry without moving their final layout:
points appear during the first 150 ms; lines connect while letters briefly
scramble; the correct text settles by about 700 ms; the lines disconnect and
fade by 840 ms. The welcome greeting and main page headings use this reveal.
Controls, names, dates, transcript text and status updates stay
immediately readable. Data refreshes do not restart the reveal. Page/tab
transitions last 140 ms and never block controls.

Decorative motion has no visible toggle. Operating system reduced-motion
preferences disable these effects: headings appear immediately
and polygons become static accents. Background motion pauses while the page
is hidden.

Top navigation: Home, Conversations, Calendar, Devices. Profile/settings and
sign-out sit under the named account. Public samples stay separate from live
account data and cannot send real invitations. Calendar recordings open in a
popup with the same four report tabs; the Conversations tab provides a complete
meeting page. The supplied logo sits above one centred sign-in panel.

Home is a compact daily briefing: a personal greeting and date, follow-ups
awaiting approval and the next meeting, then conversation history. History uses
compact rows grouped by date, with search and date filtering close to the list.
Search and date filters persist across the main navigation tabs and returning
from a report restores the originating page and scroll position. Navigation
closes the selected meeting. Conversation pages have four accessible detail
tabs: Summary, Actions, Transcript and Audio. Summary opens first; Actions
contains existing approvals, commitments and follow-up controls. Contact and
company details stay accessible in a slim side column. Switching detail tabs
preserves transcript search, playback position and speed by keeping the replay
mounted. Arrow Left/Right, Home and End select and focus detail tabs. Copy stays
direct: “Keep every conversation moving”, “Review follow-up”, “Approve & send
invitation”, and “Preparing your report”.

## Setup and recovery

First-time setup asks for optional Calendar access, guides device pairing, then
verifies the first original-audio upload. Skip/collapse choices and unexpired
pairing codes are scoped to the signed-in account. Pairing separates the device's
temporary setup Wi-Fi from the saved 2.4 GHz network and waits for a real device
heartbeat. Unknown or stale health data is labelled explicitly.

Upload progress uses bytes only when the backend provides them. Transcript and
report processing use named stages, never invented percentages. Original audio
remains playable while processing runs or fails; failed recordings can retry
without deleting the WAV. Duration uses original WAV metadata when available;
unconfirmed placeholder recordings do not claim an invented length.

Every invitation entry point opens the same review form. Only its final approval
creates the event. A persistent confirmation names the reviewed recipients/time
and provides View calendar event. It remains visible until dismissed or the
workspace changes. Client history is matched by saved contact ID; public research
is labelled unverified and cannot silently establish a person's identity.

## Existing hardware voice script

The following records existing hardware behaviour.

- Boot: “Quipus ready, [first name]. Say Computer for a command, or tap or press to record.”
- Recording consent: “Do you consent to being recorded? Say yes or no.”
- Stop: “Recording stopped. Uploading now. Keep Quipus powered on.”
- Confirmed upload: “Recording uploaded. Session complete.”
- Processing pending: explicitly say the summary is still processing.
- Report playback: show “Tap to interrupt” or “Press to interrupt.” After the
  interruption and chime, listen for the requested date/meeting/detail level.
- Unknown battery telemetry says “Not measured”; it is never presented as 100%.

“Computer” remains the actual installed wake model. The Quipus name does not
imply a working Quipus wake model. Voice consent is permission to record, not
identity authentication. Invitation/email approvals are separate exchanges.

## Compatibility

The deployment URL, Google OAuth callbacks, `lantern_*` database tables,
`X-Lantern-*` device headers, environment keys, firmware source directory and
`roxanne` NVS namespace remain intact. Website screens say Quipus. Existing
firmware may advertise Quipus-XXXX or Lantern-XXXX depending on its version.
The prototype setup password remains unchanged. Existing accounts, paired
devices, SD files, recordings and action history are retained.

Historical engineering/release documents are evidence of earlier versions.
The custom PCB remains a draft; rebranding does not resolve its outstanding
electrical, acoustic-orientation or fabrication checks.
