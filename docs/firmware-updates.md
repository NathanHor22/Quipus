# Wireless firmware updates

Waveshare recorders running **0.13.0 or later** update over Wi-Fi. A board on
older firmware needs one USB flash with `flash-waveshare.ps1` first; that writes
the rollback-capable bootloader and a signed app.

## How it works

1. **Publish.** A release is a signed app image in the private Supabase
   `firmware` bucket, plus a `firmware_releases` row (model, version, SHA-256,
   size, status, rollout). Rollout is either selected recorders
   (`firmware_release_devices`) or every recorder of that model.
2. **Offer.** On each heartbeat from a `ready` (or microphone-fault `error`)
   recorder, the server offers the newest active release that is strictly newer
   than what it runs, targeted to it, not one it rolled back, and not one that
   failed three times. The offer carries a 15-minute signed download link.
   Recorders with a pending transfer get no offer.
3. **Install.** The recorder waits until it is idle for two minutes, on USB or
   charge (or at least 40% battery), not recording, and with no unsent
   recordings. It downloads into the spare app slot and rejects the image unless
   the size and SHA-256 match the offer, the link starts with the trusted
   firmware prefix, and the app signature verifies against the key that signed
   the running firmware. Then it restarts.
4. **Trial.** The new image boots on trial. It keeps itself only after a
   heartbeat reaches Quipus. If it crashes, hangs or restarts before that, the
   bootloader returns to the previous firmware, which reports `rolled_back`, and
   that release is never offered to that recorder again.

The heartbeat body carries `update: { state, targetVersion, error }` once per
event (`installed`, `failed` or `rolled_back`). History lives in
`device_firmware_updates`; the dashboard shows the latest entry per recorder.

## Signing key

`sign-firmware.ps1` signs `lantern.bin` with an RSA-3072 key kept at
`%USERPROFILE%\.quipus\firmware-signing-key.pem`, readable only by your Windows
account. It is never committed, uploaded or used by CI. No eFuses are burned: a
recorder trusts whichever key signed the firmware it is running.

**Back the key up offline** (for example in a password manager). Without it,
recorders can only be updated over USB, and a USB flash signed with a new key
makes that recorder trust the new key instead.

## Releasing

```powershell
cd hardware\lantern-firmware
.\build-waveshare.ps1 -Version 0.13.1-quipus
.\sign-firmware.ps1 -Build build-v0.13.1
cd ..\..
node --env-file=.env.local scripts/publish-firmware.mjs publish `
  --file hardware/lantern-firmware/build-v0.13.1/lantern.signed.bin `
  --version 0.13.1-quipus --hardware-id esp32s3:80456b35b7dc --activate
node --env-file=.env.local scripts/publish-firmware.mjs status
```

`.env.local` needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
The script never prints either, nor any signed link. Start with one recorder,
check `status`, then publish to the rest (`--hardware-id` repeats) or `--all`.
`pause --version …` stops a rollout; recorders that already installed it keep it.

Versions are `MAJOR.MINOR.PATCH` with an optional suffix and must increase.
Deploy the backend and apply migration 023 before publishing a release. The
heartbeat schema is strict, and update reports only work against a backend
that understands them; 0.13.0 sends none until it has installed an update.

## Proving rollback on the bench

```powershell
.\build-waveshare.ps1 -Version 0.13.2-quipus -BenchRollback
.\sign-firmware.ps1 -Build build-v0.13.2b
```

Publish it to one bench recorder only. It installs, restarts while still on
trial, and the bootloader returns to the previous version, which reports
`rolled_back`. Never publish a bench image to owners.

## Not covered

The wake-word model partition, the bootloader and the partition table change
only over USB. The app slot is 4,128,768 bytes; 0.13.0 uses about 3.35 MB.
