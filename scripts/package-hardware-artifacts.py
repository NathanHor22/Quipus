"""Package verified local Android/ESP32 outputs without credentials or flashing."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
import re
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FIRMWARE_VERSION = re.search(
    r'#define LANTERN_FIRMWARE_VERSION "([^"]+)"',
    (ROOT / "hardware/lantern-firmware/main/lantern_board.h").read_text(),
).group(1)
PROFILES = {"original": "build", "touchscreen": "build-v2", "phone-usb": "build-phone"}
WAVESHARE_PROFILE = {"waveshare": "build-waveshare"}
EXPECTED_IMAGES = {
    "bootloader/bootloader.bin", "partition_table/partition-table.bin",
    "ota_data_initial.bin", "lantern.bin", "srmodels/srmodels.bin",
}


def package(output: Path, profile: str | None = None) -> Path:
    """Package selected outputs and retain their exact generated flash offsets."""
    entries: dict[str, bytes] = {}
    profiles: dict[str, object] = {}
    selected = PROFILES if profile is None else {profile: (PROFILES | WAVESHARE_PROFILE)[profile]}
    for name, folder in selected.items():
        build = ROOT / "hardware/lantern-firmware" / folder
        if name == "waveshare":
            config = json.loads((build / "config/sdkconfig.json").read_text())
            if not config.get("LANTERN_BOARD_WAVESHARE_LCD_154"):
                raise ValueError("Waveshare package requires a Waveshare board build")
            backend = config["LANTERN_API_BASE_URL"]
            origin = urlsplit(backend)
            if (origin.scheme != "https" or not origin.hostname or origin.path or
                    origin.query or origin.fragment or origin.username or origin.password):
                raise ValueError("Backend must be an HTTPS origin without credentials, path or trailing slash")
        metadata = json.loads((build / "flasher_args.json").read_text())
        images = metadata["flash_files"]
        if set(images.values()) != EXPECTED_IMAGES:
            raise ValueError(f"Unexpected flash image set for {name}; inspect before packaging")
        arguments = list(metadata["write_flash_args"])
        for offset, relative in sorted(images.items(), key=lambda item: int(item[0], 16)):
            image = PurePosixPath(relative)
            if image.is_absolute() or ".." in image.parts:
                raise ValueError("Flash path must remain within its build profile")
            entries[f"firmware/{name}/{relative}"] = (build / relative).read_bytes()
            arguments.extend([offset, relative])
        entries[f"firmware/{name}/flash_args"] = (" ".join(arguments) + "\n").encode()
        profiles[name] = {
            "chip": metadata["extra_esptool_args"]["chip"],
            "flashSettings": metadata["flash_settings"], "images": images,
            "phoneUsbAudio": name == "phone-usb",
        }
        if name == "waveshare":
            profiles[name]["apiBaseUrl"] = backend
            profiles[name]["bluetoothSetup"] = bool(config.get("QUIPUS_BLE_SETUP"))
    if profile is None or profile == "phone-usb":
        apk = ROOT / "mobile/android/app/build/outputs/apk/debug/app-debug.apk"
        entries["android/quipus-usb-microphone-debug.apk"] = apk.read_bytes()
        entries["android/README.md"] = (ROOT / "mobile/android/README.md").read_bytes()
    entries["README.txt"] = b"""QUIPUS LOCAL HARDWARE HANDOFF

Compiled artifacts only. No device was flashed and production was not changed.
Complete the documented backend upgrade and archive-key configuration before
installing the new firmware. Dedicated Railway processing remains optional and
must not be enabled before the worker is configured and healthy.

Firmware profiles:
  original: existing original ESP32-S3 board, USB phone audio disabled.
  touchscreen: LCDWiki ES3C28P/ES3N28P, SD recording, USB phone audio disabled.
  phone-usb: same touchscreen board, Android USB microphone enabled; console UART.
Do not install a profile on a different board or combine images across profiles.

Each firmware folder has the exact generated flash_args and five required binary
images. Preserve relative paths. Flash manually with ESP-IDF/esptool only after
selecting the correct connected board and serial port. This bundle does not
contain an auto-flash command, environment keys, SD keys or an NVS backup.

Android: Android 11+ phone with USB host/OTG and USB-C data cable. Install the debug
APK for prototype testing, then grant mic and USB permissions in its visible app.
Both tracks start only after meeting consent on Quipus. No phone internet access.
The debug signing certificate is for prototypes; protect a production signing key
separately. No actual phone/board/cable acceptance test has been performed here.

Validate: 90-second dual recording, locked-screen capture, cable removal with
onboard recording continuing, stop/tail preservation, offline queue, reconnect,
full two-source replay/transcript, USB power draw, and multi-hour stability.
Arrival-based audio synchronization is estimated, not sample-accurate.

manifest.json contains SHA-256 and byte counts for every payload file.
"""
    if profile == "waveshare":
        entries["WAVESHARE.md"] = (ROOT / "hardware/lantern-firmware/WAVESHARE.md").read_bytes()
        entries["BLUETOOTH.md"] = (ROOT / "docs/bluetooth-setup.md").read_bytes()
        entries["README.txt"] = f"""QUIPUS - WAVESHARE ESP32-S3-LCD-1.54 (NON-TOUCH)

ESP-IDF 5.2.3 build. USB-powered default; battery percentage disabled.
Firmware version: {FIRMWARE_VERSION}
Backend and pairing dashboard: {backend}/dashboard/devices
Bluetooth setup: Chrome on Windows or Android; enter the PIN shown on the recorder
if the operating system requests it. The recorder still uploads over 2.4 GHz Wi-Fi.
Only install on the Waveshare ESP32-S3-LCD-1.54, 16 MB flash / 8 MB PSRAM.
All five required images are included, including the Computer wake-word model.
See WAVESHARE.md for controls and microSD requirements; BLUETOOTH.md covers setup.
Hold screen facing you with the three buttons ABOVE the display:
  LEFT (PLUS): tap for consent/start/stop; hold 1.2 s when ready for a report.
  MIDDLE (PWR): tap for volume DOWN; hold 2 s when ready for shutdown.
  RIGHT (BOOT): tap for volume UP. Do not hold it while powering on normally.
Volume changes in 10-point steps, 0=mute, 100=maximum, default=80 after restart.
Hold LEFT + RIGHT for 3 s to reset setup; pending private recordings block reset.

Install esptool 4.12.0 into your Python environment:
  python -m pip install esptool==4.12.0
From this extracted package, change directory:
  cd firmware/waveshare
Then flash (replace COM5 with your board's serial port):
  python -m esptool --chip esp32s3 --port COM5 --baud 460800 --before default_reset --after hard_reset write_flash @flash_args
In PowerShell quote the final argument as "@flash_args".
If auto-reset fails, hold BOOT while reconnecting USB, release BOOT, then replace
"--before default_reset" with "--before no_reset" in the command above.

Full flashing replaces the factory application. No credentials, SD keys or NVS
backup are included. Packaging does not flash a recorder or certify its hardware.
See WAVESHARE.md for observed checks and complete the remaining physical tests.
manifest.json records the backend URL, SHA-256 checksum and byte count of each payload file.
""".encode("utf-8")
    manifest = {
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "firmwareVersion": FIRMWARE_VERSION,
        "sourceCommit": os.environ.get("GITHUB_SHA"),
        "purpose": "local-build-handoff-no-flash-no-deploy",
        "firmwareProfiles": profiles,
        "files": {name: {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
                  for name, data in sorted(entries.items())},
    }
    entries["manifest.json"] = (json.dumps(manifest, indent=2) + "\n").encode()
    output.mkdir(parents=True, exist_ok=True)
    stem = "quipus-waveshare-lcd-154" if profile == "waveshare" else (
        f"quipus-{profile}" if profile else "quipus-hardware-local")
    target = output / f"{stem}.zip"
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(entries.items()):
            archive.writestr(name, data)
    # Verify the artifact that will be handed off, rather than just input files.
    with zipfile.ZipFile(target) as archive:
        if archive.testzip() is not None:
            raise ValueError("ZIP integrity check failed")
        for name, details in manifest["files"].items():
            data = archive.read(name)
            if len(data) != details["bytes"] or hashlib.sha256(data).hexdigest() != details["sha256"]:
                raise ValueError(f"Packaged hash verification failed: {name}")
    (output / f"{stem}.sha256").write_text(
        f"{hashlib.sha256(target.read_bytes()).hexdigest()}  {target.name}\n", encoding="ascii")
    manifest_name = f"{stem}-manifest.json" if profile else "hardware-manifest.json"
    (output / manifest_name).write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Verified {len(entries)} files: {target.relative_to(ROOT)} ({target.stat().st_size} bytes)")
    return target


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "output/quipus-upgrade/hardware")
    parser.add_argument("--profile", choices=[*PROFILES, *WAVESHARE_PROFILE],
                        help="Package one board; default retains the existing three-board Android bundle")
    args = parser.parse_args()
    package(args.output.resolve(), args.profile)
