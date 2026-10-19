# Quipus SD archive and recovery contract

Version 1 keeps original 16 kHz mono PCM16 audio while storing encrypted bytes on
removable SD. It uses Mbed TLS AES-256-GCM and HMAC-SHA256 rather than a custom
cipher. `quipus_archive.c` owns the format; `lantern_sd.c` owns SD/mount/queue;
network code sees a seekable logical WAV reader, not encryption internals.

Each eight-character FAT-compatible stem has `.qpm` metadata, `.qpa` onboard PCM,
and optional `.qpb` phone PCM. `.tmp`/`.qpt` are interrupted/active writes; `.qpx`
metadata is quarantined rather than discarded if recovery cannot authenticate it.
Existing `.wav` files are preserved and block transfer, avoiding unowned imports.

The 144-byte QPA1 header is little-endian: magic at 0, version at 4, source 0/1 at
8, sample rate at 12, 36-byte session UUID at 16, owner UUID at 52, device UUID at
88, random 8-byte nonce prefix at 124, reserved zero bytes through 143.
The file key is HMAC-SHA256(masterKey, header). Each record contains uint32 length,
up to 4096 ciphertext bytes, and a 16-byte GCM tag. IV = prefix || uint32 index;
AAD = header || uint32 index || uint32 length. Source/session/owner mismatches
and failed tags never produce upload bytes. Complete blocks have fixed physical
size, enabling bounded seeks without downloading/decrypting the entire file.

The logical WAV has a synthesized canonical 44-byte header followed by exactly
the authenticated PCM. Finalized expected length lives in authenticated metadata,
so a completed recording cannot silently shrink during recovery. A power loss
before Stop is explicitly a recovered prefix, never a claim of a complete meeting.

QPM1 journal records contain magic (4), JSON length (uint32), random 12-byte IV,
encrypted JSON and 16-byte tag. AES-GCM uses the master key and authenticates the
first eight header bytes. Read selects the last fully authenticated entry. An
incomplete final journal append is truncated to the prior authenticated boundary
before a new append; a complete bad tag is quarantined, never overwritten.
Metadata binds owner/device, session/event IDs, capture time/uncertainty, monotonic
order, track sizes, timing, and upload/checksum progress. The key is never on SD.

Key provisioning requires one authenticated online connection. Server backup
must commit before local encrypted recording is enabled. Local NVS keys survive
Wi-Fi/pairing reset; NVS is never automatically erased after an init error.
Trusted NVS markers bind pending recordings to this device even if its card is
removed or swapped. Confirmed deletion is journaled before removing either track,
so a power interruption between removals resumes safely. Changing ownership while
private files or unverified markers remain is blocked. A verified transfer
releases the old cloud device identity, then removes the old local key/pairing.

Normal Stop drains onboard/phone queues, finalizes both tracks and checkpoints
metadata. Connection loss retains the full archives. Reconnect processes one
pending meeting at a time; uploads resume through server-confirmed offsets.
Every event identity is persisted before a request that could commit remotely.
The current firmware serializes saved-file sync and new capture because SD
selection is shared; the screen explicitly shows synchronization. Concurrent
capture plus sync requires independent reader handles and is not claimed here.
Only verified main AND phone checksums authorise local deletion. Phone first
clock anchor is journaled before its first PCM write. Recovery corrects sample
count and marks approximate timing; it does not invent measured drift.

Run `python scripts/test-firmware-archive.py` with a local C compiler and the SDK
Mbed TLS source to execute the actual C format/tamper/recovery tests. Physical
SD timing, power interruption, phone disconnect and multi-hour soak tests remain
required before a production release. Application encryption does not replace
production flash protection against physical extraction of the whole recorder.
