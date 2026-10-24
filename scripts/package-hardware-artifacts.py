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
import wave

ROOT = Path(__file__).resolve().parents[1]


def firmware_versions_from_header(header: str) -> dict[str, str]:
    """Read the explicit build branches, never the first textual define."""
    definition = r'^#define[ \t]+LANTERN_FIRMWARE_VERSION[ \t]+"([^"\r\n]+)"[ \t]*$'
    conditional = re.search(
        r'^#if[ \t]+CONFIG_QUIPUS_EXPERIMENTAL_OFFLINE_DSCNN[ \t]*\r?\n'
        r'(?P<experimental>.*?)^#else[ \t]*\r?\n'
        r'(?P<stable>.*?)^#endif[ \t]*(?:\r?\n|$)', header, re.M | re.S)
    if conditional:
        versions = {}
        for branch in ("stable", "experimental"):
            matches = re.findall(definition, conditional.group(branch), re.M)
            if len(matches) != 1:
                raise ValueError("Expected one firmware version in each explicit build branch")
            versions[branch] = matches[0]
        if versions["stable"] == versions["experimental"]:
            raise ValueError("Stable and experimental firmware versions must differ")
        return versions
    # Historical single-version headers remain readable; ambiguous conditional
    # headers fail closed instead of accidentally selecting another branch.
    matches = re.findall(definition, header, re.M)
    if len(matches) != 1:
        raise ValueError("Firmware version branches are missing or ambiguous")
    return {"stable": matches[0]}


FIRMWARE_VERSIONS = firmware_versions_from_header(
    (ROOT / "hardware/lantern-firmware/main/lantern_board.h").read_text())
FIRMWARE_VERSION = FIRMWARE_VERSIONS["stable"]


def firmware_version_for_build(config: dict[str, object], application: bytes) -> str:
    """Bind the manifest version to generated configuration and exact image."""
    experimental = config.get("QUIPUS_EXPERIMENTAL_OFFLINE_DSCNN", False)
    if not isinstance(experimental, bool):
        raise ValueError("Experimental recognizer build flag must be a JSON boolean")
    if experimental and config.get("LANTERN_BOARD_WAVESHARE_LCD_154") is not True:
        raise ValueError("Experimental recognizer requires an explicit Waveshare build")
    branch = "experimental" if experimental else "stable"
    version = FIRMWARE_VERSIONS.get(branch)
    if version is None:
        raise ValueError("No firmware version is declared for the selected build configuration")
    if version.encode("ascii") + b"\0" not in application:
        raise ValueError("Waveshare application does not contain the current firmware version for its build configuration")
    return version


PROFILES = {"original": "build", "touchscreen": "build-v2", "phone-usb": "build-phone"}
WAVESHARE_PROFILE = {"waveshare": "build-waveshare"}
EXPECTED_IMAGES = {
    "bootloader/bootloader.bin", "partition_table/partition-table.bin",
    "ota_data_initial.bin", "lantern.bin", "srmodels/srmodels.bin",
}


def waveshare_voice_metadata(application: bytes, firmware_version: str = FIRMWARE_VERSION) -> dict[str, object]:
    """Refuse stale images or a handoff whose public manifests differ from flash."""
    if firmware_version.encode("ascii") + b"\0" not in application:
        raise ValueError("Waveshare application does not contain the current firmware version; rebuild before packaging")
    shared = json.loads((ROOT / "lib/quipus-voice-profile.json").read_text())
    catalog = json.loads((ROOT / "lib/quipus-prompt-text.json").read_text())["prompts"]
    manifest = json.loads((ROOT / "hardware/lantern-firmware/main/assets/prompts.json").read_text())
    if manifest["profile"] != shared or len(manifest["prompts"]) != len(catalog):
        raise ValueError("Installed local voice profile/catalog differs from the shared server profile")
    if shared["version"].encode("ascii") not in application:
        raise ValueError("Waveshare application is missing the current voice profile version")
    asset_root = ROOT / "hardware/lantern-firmware/main/assets"
    for item, expected in zip(manifest["prompts"], catalog):
        if any(item.get(field) != value for field, value in expected.items()):
            raise ValueError("Installed local voice text/catalog differs from the shared catalog")
        name = item["file"]
        if PurePosixPath(name).name != name or not name.endswith(".adpcm"):
            raise ValueError("Unexpected local voice asset path")
        encoded = (asset_root / name).read_bytes()
        if (not encoded or len(encoded) != item["bytes"] or
                hashlib.sha256(encoded).hexdigest() != item["sha256"] or encoded not in application):
            raise ValueError("Waveshare application is missing a current, verified local voice asset: " + name)
    provenance = (asset_root / "micro_speech_yes_no.SOURCE.txt").read_text()
    models = {}
    for name, label in [("micro_speech_yes_no.tflite", "SHA256"),
                        ("micro_speech_preprocessor.tflite", "Preprocessor SHA256")]:
        match = re.search(r"^" + re.escape(label) + r": ([a-f0-9]{64})$", provenance, re.M)
        if not match:
            raise ValueError("Missing pinned local model provenance: " + name)
        data = (asset_root / name).read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        if digest != match.group(1) or data not in application:
            raise ValueError("Waveshare application is missing the exact pinned local model: " + name)
        models[name] = {"bytes": len(data), "sha256": digest}
    self_tests = json.loads((asset_root / "micro_speech_self_test.SOURCE.json").read_text())
    if len(self_tests) != 2 or {item.get("label") for item in self_tests} != {"yes", "no"}:
        raise ValueError("Expected exactly two public YES/NO self-test provenance entries")
    fixtures = {}
    for item in self_tests:
        label = item["label"]
        if (item.get("sample_rate") != 16000 or item.get("format") != "mono signed16 little-endian" or
                item.get("pcm_bytes") != 32000 or item.get("source") !=
                f"hardware/lantern-firmware/tests/local-recognizer-host/fixtures/{label}.wav"):
            raise ValueError("Invalid public self-test format/provenance")
        pcm = (asset_root / f"micro_speech_self_test_{label}.pcm").read_bytes()
        if (len(pcm) != item["pcm_bytes"] or hashlib.sha256(pcm).hexdigest() != item["pcm_sha256"] or
                pcm not in application):
            raise ValueError("Waveshare application is missing an exact public self-test fixture: " + label)
        wav_path = ROOT / item["source"]
        if hashlib.sha256(wav_path.read_bytes()).hexdigest() != item["source_sha256"]:
            raise ValueError("Public self-test source WAV digest differs from provenance: " + label)
        with wave.open(str(wav_path), "rb") as audio:
            if (audio.getframerate() != 16000 or audio.getnchannels() != 1 or
                    audio.getsampwidth() != 2 or audio.getnframes() != 16000 or
                    audio.readframes(16000) != pcm):
                raise ValueError("Public self-test PCM differs from its pinned source WAV: " + label)
        fixtures[label] = {"bytes": len(pcm), "sha256": item["pcm_sha256"],
                           "sourceSha256": item["source_sha256"], "upstreamCommit": item["upstream_commit"]}
    return {"voiceProfileVersion": shared["version"], "speechModel": shared["model"],
            "speechVoice": shared["voice"], "speechApiRetiresAt": "2027-01-06",
            "localRecognition": {"kind": "stock-micro-speech-evaluation", "labels": ["silence", "unknown", "yes", "no"],
                                 "models": models, "experimental": True,
                                 "consentAuthorityWhenConnected": "cloud-full-utterance",
                                 "startupSelfTest": {"required": True, "publicFixtures": fixtures},
                                 "acousticAccuracyValidated": False},
            "offlineCapabilities": ["Computer wake", "already-authorized encrypted SD recording",
                                    "last complete saved report replay"],
            "offlineExperimentalCapabilities": ["binary intent menu", "separate fresh spoken consent"]}


def package(output: Path, profile: str | None = None) -> Path:
    """Package selected outputs and retain their exact generated flash offsets."""
    entries: dict[str, bytes] = {}
    profiles: dict[str, object] = {}
    firmware_version = FIRMWARE_VERSION
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
            application = entries[f"firmware/{name}/lantern.bin"]
            firmware_version = firmware_version_for_build(config, application)
            if config.get("QUIPUS_EXPERIMENTAL_OFFLINE_DSCNN", False):
                # Its version may be validated, but the existing public ZIP
                # whitelist/provenance describes stock micro_speech only.
                raise ValueError("Experimental DS-CNN ZIP packaging needs its own model/provenance whitelist; use the reviewed app-only bench flow")
            profiles[name]["apiBaseUrl"] = backend
            profiles[name]["bluetoothSetup"] = bool(config.get("QUIPUS_BLE_SETUP"))
            profiles[name].update(waveshare_voice_metadata(application, firmware_version))
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
        for target, relative in {
            "OFFLINE-VOICE.md": "docs/quipus-offline-voice-pilot.md",
            "LOCAL-RECOGNITION.md": "docs/quipus-local-recognition.md",
            "voice/quipus-voice-profile.json": "lib/quipus-voice-profile.json",
            "voice/quipus-prompt-text.json": "lib/quipus-prompt-text.json",
            "voice/prompts.json": "hardware/lantern-firmware/main/assets/prompts.json",
            "voice/README.md": "hardware/lantern-firmware/main/assets/README.md",
            "models/micro_speech_yes_no.tflite": "hardware/lantern-firmware/main/assets/micro_speech_yes_no.tflite",
            "models/micro_speech_preprocessor.tflite": "hardware/lantern-firmware/main/assets/micro_speech_preprocessor.tflite",
            "models/micro_speech_yes_no.SOURCE.txt": "hardware/lantern-firmware/main/assets/micro_speech_yes_no.SOURCE.txt",
            "models/micro_speech.APACHE-2.0.txt": "hardware/lantern-firmware/main/assets/micro_speech.APACHE-2.0.txt",
            "models/micro_speech_self_test_yes.pcm": "hardware/lantern-firmware/main/assets/micro_speech_self_test_yes.pcm",
            "models/micro_speech_self_test_no.pcm": "hardware/lantern-firmware/main/assets/micro_speech_self_test_no.pcm",
            "models/micro_speech_self_test.SOURCE.json": "hardware/lantern-firmware/main/assets/micro_speech_self_test.SOURCE.json",
        }.items():
            entries[target] = (ROOT / relative).read_bytes()
        voice = profiles["waveshare"]
        entries["backend/020_offline_archive_control_slot.sql"] = (
            ROOT / "supabase/migrations/020_offline_archive_control_slot.sql"
        ).read_bytes()
        entries["backend/quipus-recording-calendar-upgrade.sql"] = (
            ROOT / "supabase/setup/quipus-recording-calendar-upgrade.sql"
        ).read_bytes()
        entries["README.txt"] = f"""QUIPUS - WAVESHARE ESP32-S3-LCD-1.54 (NON-TOUCH)

ESP-IDF 5.2.3 build. USB-powered default; battery percentage disabled.
Firmware version: {firmware_version}
Backend and pairing dashboard: {backend}/dashboard/devices
Bluetooth setup: Chrome on Windows or Android; enter the PIN shown on the recorder
if the operating system requests it. The recorder still uploads over 2.4 GHz Wi-Fi.
Only install on the Waveshare ESP32-S3-LCD-1.54, 16 MB flash / 8 MB PSRAM.
All five required images are included, including the Computer wake-word model.
See WAVESHARE.md for controls and microSD requirements; BLUETOOTH.md covers setup.
Hold screen facing you with the three buttons ABOVE the display:
  LEFT (PLUS): volume DOWN; hold to repeat.
  MIDDLE (PWR): tap to request/stop a session; hold 2 s to save and shut down.
  RIGHT (BOOT): volume UP; hold to repeat. Do not hold it while powering on normally.
The warm face keeps its mouth open during recording and moves with voice playback.
Uploading/saved/verified-upload speech is local; success requires cloud verification.
Apply backend/020_offline_archive_control_slot.sql after migrations 001-019 if not
already installed. On schema 020 apply backend/quipus-recording-calendar-upgrade.sql
(021+022), then deploy the matching source. Do not rerun an installed migration.
Do not run the fresh-project setup bundle over an existing project.
All 25 local clips and online reports use {voice['speechVoice']} with the exact
shared profile {voice['voiceProfileVersion']}. Local 24 kHz ADPCM clips are embedded;
there is no offline speech-synthesis engine and no alternate-actor fallback.
Connected commands and consent use cloud recognition as the primary authority;
the experimental local model cannot veto or approve a connected consent decision.
Status reports use Computer, then an online command or the experimental offline menu.
Consent is asked before an SD archive or recording begins. Consent is VOICE ONLY:
buttons and touch cannot approve. First NO repeats the question; second NO
returns to the main screen, without rebooting. Silence, uncertainty and failed
recognition never start recording. A recognized offline YES can authorize only
its current consent question, not a prior menu. Outer buttons remain volume.
Volume changes in 10-point steps, 0=mute, 100=maximum, default=80 after restart.
A compact VOL percentage appears for 1.5 seconds only after the volume changes.
USB-only builds show USB instead of a guessed battery percentage or charging time.
Read-only command/report failures return to idle and release the saved-upload queue.
Under-five-second digital silence is skipped only after successful no-speech
transcription and an owner-bound server proof. Quiet/varying or uncertain audio stays.
A verified skip uses a neutral spoken cue rather than claiming a dashboard meeting.
Calendar X hides an entry with Undo; it does not delete its audio or Google event.
Hold LEFT + RIGHT for 3 s to open Wi-Fi setup without clearing pairing/SD.
Press MIDDLE to return to the main face. Factory reset is not a button shortcut.
Computer is detected locally, once per interaction, including when offline.
EXPERIMENTAL OFFLINE RECOGNITION - NOT READY FOR DISTRIBUTED PILOTS.
The real board passed both public reference YES/NO integration self-tests, but a
user's live spoken YES was rejected. Reference success is not acoustic acceptance.
Offline Computer offers a stock YES/NO menu: YES selects recording, then a separate
consent question captures a fresh full 5 s response. NO offers a saved status report.
The bundled evaluation model knows YES/NO/UNKNOWN/SILENCE, not arbitrary phrases.
Initial pairing/key provisioning and a usable SD card are required. After consent,
SD-backed capture starts locally; importing/uploading happens after Stop.
Online exact commands and fresh report retrieval still need Internet. Offline can
only replay the last completely saved owner-bound report; it cannot answer new
queries or approve actions. Two encrypted 8 MiB slots preserve the previous report
through an interrupted/oversized/corrupt replacement. These disposable report
files do not replace recorded meetings or block account/key reset.
Plain online status asks which meeting; ask a time/person/date, repeat, or I'm done.
OFFLINE-VOICE.md and LOCAL-RECOGNITION.md describe exact limits and uncompleted
acoustic acceptance. Model binaries/provenance/Apache 2.0 license are in models/;
the exact shared voice/text/audio manifests are in voice/. Two public reference
PCM fixtures plus their source/PCM digests are included for startup self-testing.
These are internal inference inputs, never alternate spoken interface voices.
Models/fixtures are embedded already; do not flash them over the WakeNet image.
Current online speech model: {voice['speechModel']}; retirement 2027-01-06.
Migrate online TTS before then; the Realtime replacement is a different protocol.
Embedded local prompts remain usable without synthesis service access.
Verified encrypted audio is retained locally 24 h after first verified delivery.
Unverified files never expire automatically. Unknown/invalid time preserves files.
Waveshare report speech drains before a fresh reply window opens. Silence returns
to idle; two consecutive unclear replies exit. Meaningful questions remain unlimited.
Automatic mid-speech voice interruption is disabled on this board pending acoustic
calibration. Middle-button interruption exits the report; it cannot approve consent.

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
        "firmwareVersion": firmware_version,
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
