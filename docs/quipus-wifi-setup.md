# Quipus Wi-Fi setup repair ? 21 October 2026

The LCDWIKI ES3C28P on COM10 now runs 0.9.1-quipus. The application alone
was flashed at 0x20000 and esptool verified its hash. NVS, partitions,
bootloader, wake models and SD recordings were preserved. A private pre-update
settings/application backup remains in ignored hardware/backups/es3c28p.

## Changes

- Persistent bounded reconnection/pairing supervision after late Wi-Fi recovery.
- Separate Wi-Fi-connected and account-paired states.
- Offline white/navy/red portal with explicit pairing, network changes and errors.
- Matching compact device setup screen; setup AP alone no longer shows connected
  signal bars. Connected unpaired setup says PAIR QUIPUS.
- Bounded 2048-byte request headers, four HTTP sessions, 1 KiB page-response chunks
  and no-store/connection-close response headers.
- Full URL-encoded form reads and strict field parsing without silent truncation.
- Paired devices can change Wi-Fi without replacing ownership through a local form.

The exact cause of the earlier empty-response page was not proven. Header/socket
pressure was addressed and the updated endpoint was tested on the physical board.

## Verification

- V2 firmware compiled successfully; 58% application-partition space remains.
- Portable C recovery/form tests passed with warnings treated as errors.
- Browser portal checks passed at desktop, 390px and 320px, including keyboard,
  reduced motion, disconnected/connected, pairing, error and success states.
- Actual board GET / returned HTTP200 and 16046 bytes for minimal and browser-sized
  requests. GET /status returned HTTP200, Wi-Fi connected and account not paired.
- Diagnostic laptop Wi-Fi was restored and its temporary WPA2 profile was removed.
- Evidence and screenshots: output/wifi-setup/.
- No real pairing code or Wi-Fi password was submitted by the automated HTTP tests.

## User setup

On the same phone/laptop used for the browser, join Quipus-1C39 and open
http://192.168.4.1/ . Stay connected if the OS reports no internet.
The existing prototype setup-network password remains lanternsetup.
If Wi-Fi is connected but the account is unpaired, enter a new 10-character code
from the signed-in Quipus dashboard's device setup. Existing Wi-Fi can be reused.
Only the person's own dashboard should generate the code; never paste keys into chat.

The original and USB-phone profiles were not flashed in this repair.
