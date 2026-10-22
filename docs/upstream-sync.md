# Waveshare integration

This product repository is `NathanHor22/Quipus`. Waveshare support is integrated
from `jinchuntan/quipus` at `1d92ce5adae448ac998be768ee0601a2e798a7ed`,
which retains the common ancestor `d36b54dfc480876063b45c23f697d04a35697930`.
The co-founder contribution includes the board profile, codecs, Bluetooth setup,
three-button controls, volume and firmware packaging.

Integrated firmware `0.10.3-quipus` also retains the local `0.9.6` wake recovery,
checked control-task stacks, PSRAM upload buffers, setup-stack and account-pairing
repairs. Original Zhengchen, touchscreen ES3C28P and Waveshare remain distinct
build profiles with shared application/session rules.

## Deployment

All integrated profiles target `https://quipus-sales-rep-assistant.vercel.app`.
The firmware, dashboard pairing code and backend must use the same deployment.
Saved sdkconfig files override defaults: inspect the compiled manifest, not only
the defaults file. Google and provider credentials remain server-side.

Bluetooth provisions an unpaired Waveshare recorder using authenticated encrypted
GATT. Chrome on Windows/Android supports the web setup; iPhone browsers use the
local Wi-Fi setup fallback. Bluetooth is not phone-microphone transport.

## Data and reset

SD faults stop the recording display and retain recoverable encrypted audio.
Finalized recordings may wait for upload across a safe shutdown. Account reset
and ownership transfer still protect unsynced recordings; never erase archive
keys or format a card to resolve a connection error. Clearing settings also
clears Bluetooth trust so a new owner must pair again.

The `supabase/setup/quipus-fresh-project.sql` bundle is for a new empty project.
Do not apply it to an existing Quipus database for this hardware integration.

## Validation

Compile the original, V2 and Waveshare profiles and run native board, PCM, volume,
Bluetooth, wake, network, archive and SD-fault tests. Application validation covers
Bluetooth cancellation and exact-device account verification.

Build and host checks do not prove physical voice recognition or SD reliability.
Before distribution, verify fresh pairing, consent/no-consent, repeated wake
cycles, a recording over five minutes with matching replay duration, offline
recording/restart/upload, interrupted upload, SD faults and safe power-off.

## Future collaboration

Use a feature branch and pull request to combine co-founder updates from the
shared history. Preserve tested firmware artifacts and source hashes for each
board. Never replace the complete firmware folder with another board's version.
