"""Package verified local Android/ESP32 outputs without credentials or flashing."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path, PurePosixPath
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PROFILES = {"original": "build", "touchscreen": "build-v2", "phone-usb": "build-phone"}
EXPECTED_IMAGES = {
    "bootloader/bootloader.bin", "partition_table/partition-table.bin",
    "ota_data_initial.bin", "lantern.bin", "srmodels/srmodels.bin",
}


def package(output: Path) -> Path:
    """Require all profile outputs and retain their exact generated flash offsets."""
    entries: dict[str, bytes] = {}
    profiles: dict[str, object] = {}
    for name, folder in PROFILES.items():
        build = ROOT / "hardware/lantern-firmware" / folder
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
    manifest = {
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "purpose": "local-build-handoff-no-flash-no-deploy",
        "firmwareProfiles": profiles,
        "files": {name: {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
                  for name, data in sorted(entries.items())},
    }
    entries["manifest.json"] = (json.dumps(manifest, indent=2) + "\n").encode()
    output.mkdir(parents=True, exist_ok=True)
    target = output / "quipus-hardware-local.zip"
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
    (output / "quipus-hardware-local.sha256").write_text(
        f"{hashlib.sha256(target.read_bytes()).hexdigest()}  {target.name}\n", encoding="ascii")
    (output / "hardware-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Verified {len(entries)} files: {target.relative_to(ROOT)} ({target.stat().st_size} bytes)")
    return target


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "output/quipus-upgrade/hardware")
    package(parser.parse_args().output.resolve())
