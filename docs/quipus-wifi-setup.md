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
- Evidence and screenshots: docs/images/wifi-setup/.
- No real pairing code or Wi-Fi password was submitted by the automated HTTP tests.

## User setup

On the same phone/laptop used for the browser, join Quipus-1C39 and open
http://192.168.4.1/ . Stay connected if the OS reports no internet.
The existing prototype setup-network password remains lanternsetup.
If Wi-Fi is connected but the account is unpaired, enter a new 10-character code
from the signed-in Quipus dashboard's device setup. Existing Wi-Fi can be reused.
Only the person's own dashboard should generate the code; never paste keys into chat.

The original and USB-phone profiles were not flashed in this repair.


## Session and settings-save repair (0.9.4)

Physical tests found two distinct failures:

- Wi-Fi had a valid IP, but account pairing was absent. The claim endpoint
  rejected the stored code as expired. A restart cannot renew that code.
- A full POST /configure reproducibly overflowed the 4096-byte httpd task stack,
  rebooting before returning the saved page. GETs and invalid forms worked,
  which hid the save-only failure.

The ES3C28P now runs 0.9.4-quipus, flashed application-only at 0x20000 with
esptool hash verification. Wi-Fi profiles, archive identity and SD data were
preserved; no factory erase was performed.

The setup task now has an 8192-byte stack, released when setup stops. Wi-Fi
persistence no longer copies the full device configuration: its compiled stack
frame fell from 1360 to 688 bytes. The fixed path returned HTTP 200 with the
complete 1732-byte saved page, rebooted and rejoined saved Wi-Fi. That physical
save regression ran on 0.9.3; 0.9.4 adds matching dashboard-code alphabet
validation and removes invalid saved codes without cloud retries.

Setup has its own input state. Unpaired taps stay on pairing instructions
instead of activating stale Start Session controls. Sessions require pairing
before cloud/SD preparation. Actual pairing errors appear beside the setup URL.
Invalid/expired codes are discarded while Wi-Fi, the pending credential and
archive keys remain intact. Transient service failures retain bounded retries.

Verification:

- V2 compilation and application partition size checks passed.
- Portable C recovery/form tests passed, including invalid code characters and
  waiting for a fresh code without repeated claims.
- Native Wi-Fi persistence tests passed for first save, promotion, password
  replacement, eviction, count bounds, duplicates, read failures and bad input.
- Physical logs before the fix recorded a stack overflow in task httpd. The same
  full save after the fix returned the saved page without that panic.
- A diagnostic code excluded by the server alphabet exercised persistence; it
  could not link any account. Final firmware removes that invalid fixture.
- Diagnostic Wi-Fi profiles were removed and original laptop Wi-Fi restored.
  No real Wi-Fi password or pairing code was printed.

Pairing and a new recording still require the user's fresh dashboard code and
consent. A successful settings save alone does not verify either. Private
probe logs remain under the ignored .tmp-session-offline directory.


## Requested connection reset

At the user's request, saved application Wi-Fi/pairing entries and the Wi-Fi
driver's saved settings were cleared on COM10. The verified 0x9000 settings
partition was backed up privately first. Firmware, PHY calibration, other NVS
namespaces and SD recordings were preserved. Esptool verified the written hash.

The physical setup server then returned HTTP 200; its status reported
wifi_connected=false and paired=false. Quipus-1C39 remains available for setup.
The laptop's original network was restored after verification. This local reset
does not revoke or transfer the existing cloud-side device registration.


### Voice listening after setup or reconnect (firmware 0.9.5)

Idle voice listening is restored when returning from Wi-Fi or saved-meeting
screens and when a paired recorder reconnects to Wi-Fi. The current screen stays
in place during connectivity updates. Voice listening stays disabled in setup,
the Wi-Fi keyboard, saved-meeting views, recording, upload, and command playback.

From the Quipus logo or main menu, say **Computer**, wait for the listening screen
and chime, then say **status report** or **start recording**. During recording,
tap Stop and leave the recorder powered on until upload completes.

Serial health diagnostics include both the application state and the actual
WakeNet enabled/available flags. A pending wake detection survives an idle
connectivity refresh until the control task consumes it. Voice-response receive
headers use the same 4 KiB capacity as the other speech-streaming endpoints.

Run the portable wake regression tests with:

    python scripts/test-firmware-wake.py


### Save/upload stack protection (firmware 0.9.6)

The stop-to-upload path exhausted the former 8 KiB control-task stack. The direct
upload request workspace and phone timing scratch now use bounded, temporary
PSRAM allocations; every allocation is released on success and failure. Both
tasks that can own SD/HTTPS control work have a 12 KiB stack, and task creation is
checked before startup continues. Runtime diagnostics report minimum remaining
stack and the largest free internal-memory block for hardware verification.

A finalized SD archive remains available across reboot and is resumed using the
server-confirmed upload offset. No Wi-Fi/pairing reset or SD formatting is needed
for this update.
