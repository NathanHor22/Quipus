"""Test actual Waveshare packaging with isolated synthetic flash images, never hardware."""
from pathlib import Path
import importlib.util
import json
import tempfile
import zipfile

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("quipus_hardware_package", root / "scripts/package-hardware-artifacts.py")
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)
profile = json.loads((root / "lib/quipus-voice-profile.json").read_text())
manifest = json.loads((root / "hardware/lantern-firmware/main/assets/prompts.json").read_text())


def rejects(action, message):
    try:
        action()
    except ValueError as error:
        assert message in str(error), str(error)
    else:
        raise AssertionError("Expected package rejection: " + message)


# Regression: the experimental #define intentionally appears first. Selecting
# the first textual match would mislabel every ordinary/stable package.
version_header = """#if CONFIG_QUIPUS_EXPERIMENTAL_OFFLINE_DSCNN
#define LANTERN_FIRMWARE_VERSION "0.12.8-quipus-experimental"
#else
#define LANTERN_FIRMWARE_VERSION "0.12.7-quipus"
#endif
"""
assert packager.firmware_versions_from_header(version_header) == {
    "stable": "0.12.7-quipus", "experimental": "0.12.8-quipus-experimental"}
assert packager.FIRMWARE_VERSION == packager.FIRMWARE_VERSIONS["stable"]
assert packager.firmware_versions_from_header(
    '#define LANTERN_FIRMWARE_VERSION "old-single-version"\n') == {"stable": "old-single-version"}
rejects(lambda: packager.firmware_versions_from_header(
    '#define LANTERN_FIRMWARE_VERSION "one"\n#define LANTERN_FIRMWARE_VERSION "two"\n'), "ambiguous")
stable = packager.FIRMWARE_VERSIONS["stable"]
experimental = packager.FIRMWARE_VERSIONS["experimental"]
assert packager.firmware_version_for_build({}, stable.encode() + b"\0") == stable
config = {"LANTERN_BOARD_WAVESHARE_LCD_154": True, "QUIPUS_EXPERIMENTAL_OFFLINE_DSCNN": False}
assert packager.firmware_version_for_build(config, stable.encode() + b"\0") == stable
rejects(lambda: packager.firmware_version_for_build(config, experimental.encode() + b"\0"), "build configuration")
config["QUIPUS_EXPERIMENTAL_OFFLINE_DSCNN"] = True
assert packager.firmware_version_for_build(config, experimental.encode() + b"\0") == experimental
rejects(lambda: packager.firmware_version_for_build(config, stable.encode() + b"\0"), "build configuration")
rejects(lambda: packager.firmware_version_for_build(config, experimental.encode() + b"-suffix\0"), "build configuration")
rejects(lambda: packager.firmware_version_for_build(
    {"QUIPUS_EXPERIMENTAL_OFFLINE_DSCNN": True}, experimental.encode() + b"\0"), "explicit Waveshare build")
rejects(lambda: packager.firmware_version_for_build(
    {"QUIPUS_EXPERIMENTAL_OFFLINE_DSCNN": "n"}, stable.encode() + b"\0"), "JSON boolean")


with tempfile.TemporaryDirectory(prefix="quipus-package-test-") as folder:
    fixture = Path(folder)
    paths = ["hardware/lantern-firmware/WAVESHARE.md", "docs/bluetooth-setup.md",
        "docs/quipus-offline-voice-pilot.md", "docs/quipus-local-recognition.md",
        "lib/quipus-voice-profile.json", "lib/quipus-prompt-text.json",
        "hardware/lantern-firmware/main/assets/prompts.json", "hardware/lantern-firmware/main/assets/README.md",
        "hardware/lantern-firmware/main/assets/micro_speech_yes_no.SOURCE.txt",
        "hardware/lantern-firmware/main/assets/micro_speech.APACHE-2.0.txt",
        "hardware/lantern-firmware/main/assets/micro_speech_yes_no.tflite",
        "hardware/lantern-firmware/main/assets/micro_speech_preprocessor.tflite",
        "hardware/lantern-firmware/main/assets/micro_speech_self_test_yes.pcm",
        "hardware/lantern-firmware/main/assets/micro_speech_self_test_no.pcm",
        "hardware/lantern-firmware/main/assets/micro_speech_self_test.SOURCE.json",
        "hardware/lantern-firmware/tests/local-recognizer-host/fixtures/yes.wav",
        "hardware/lantern-firmware/tests/local-recognizer-host/fixtures/no.wav",
        "supabase/migrations/020_offline_archive_control_slot.sql",
        "supabase/setup/quipus-recording-calendar-upgrade.sql"]
    paths += ["hardware/lantern-firmware/main/assets/" + i["file"] for i in manifest["prompts"]]
    for relative in paths:
        target = fixture / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes((root / relative).read_bytes())
    build = fixture / "hardware/lantern-firmware/build-waveshare"
    (build / "config").mkdir(parents=True)
    (build / "config/sdkconfig.json").write_text(json.dumps({"LANTERN_BOARD_WAVESHARE_LCD_154": True,
        "LANTERN_API_BASE_URL": "https://example.com", "QUIPUS_BLE_SETUP": True}))
    files = {hex(index * 0x10000): name for index, name in enumerate(sorted(packager.EXPECTED_IMAGES))}
    (build / "flasher_args.json").write_text(json.dumps({"flash_files": files, "write_flash_args": [],
        "extra_esptool_args": {"chip": "esp32s3"}, "flash_settings": {}}))
    application = packager.FIRMWARE_VERSION.encode() + b"\0" + profile["version"].encode() + b"\0"
    for item in manifest["prompts"]:
        application += (fixture / "hardware/lantern-firmware/main/assets" / item["file"]).read_bytes()
    for name in ["micro_speech_yes_no.tflite", "micro_speech_preprocessor.tflite",
                 "micro_speech_self_test_yes.pcm", "micro_speech_self_test_no.pcm"]:
        application += (fixture / "hardware/lantern-firmware/main/assets" / name).read_bytes()
    for name in files.values():
        target = build / name; target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(application if name == "lantern.bin" else b"SYNTHETIC TEST IMAGE - DO NOT FLASH")
    packager.ROOT = fixture
    output = fixture / "output"
    target = packager.package(output, "waveshare")
    with zipfile.ZipFile(target) as archive:
        payload = json.loads(archive.read("manifest.json"))
        info = payload["firmwareProfiles"]["waveshare"]
        assert payload["firmwareVersion"] == stable
        assert f"Firmware version: {stable}" in archive.read("README.txt").decode()
        assert info["voiceProfileVersion"] == profile["version"] and info["speechVoice"] == "marin"
        assert info["speechApiRetiresAt"] == "2027-01-06"
        assert info["localRecognition"]["labels"] == ["silence", "unknown", "yes", "no"]
        assert info["localRecognition"]["acousticAccuracyValidated"] is False
        assert info["localRecognition"]["experimental"] is True
        assert info["offlineExperimentalCapabilities"] == ["binary intent menu", "separate fresh spoken consent"]
        assert "separate fresh spoken consent" not in info["offlineCapabilities"]
        assert info["localRecognition"]["consentAuthorityWhenConnected"] == "cloud-full-utterance"
        reference = info["localRecognition"]["startupSelfTest"]
        assert reference["required"] is True and set(reference["publicFixtures"]) == {"yes", "no"}
        assert all(item["bytes"] == 32000 for item in reference["publicFixtures"].values())
        assert archive.read("voice/quipus-voice-profile.json") == (root / "lib/quipus-voice-profile.json").read_bytes()
        assert all(name in archive.namelist() for name in ["OFFLINE-VOICE.md", "LOCAL-RECOGNITION.md",
            "models/micro_speech.APACHE-2.0.txt", "models/micro_speech_yes_no.SOURCE.txt",
            "models/micro_speech_yes_no.tflite", "models/micro_speech_preprocessor.tflite",
            "models/micro_speech_self_test_yes.pcm", "models/micro_speech_self_test_no.pcm",
            "models/micro_speech_self_test.SOURCE.json"])
        readme = archive.read("README.txt").decode()
        assert "separate" in readme and "fresh" in readme and "YES/NO/UNKNOWN/SILENCE" in readme
        assert "Commands/consent/reports still require Internet" not in readme
        assert "NOT READY FOR DISTRIBUTED PILOTS" in readme and "live spoken YES was rejected" in readme
        assert "cloud recognition as the primary authority" in readme
        assert not any(name.endswith((".env", "nvs.bin")) or "backups/" in name for name in archive.namelist())
    # Config/image mismatches and unsupported experimental metadata must fail
    # before overwriting an existing package, even if the synthetic image also
    # contains every old stock-model asset.
    target_before = target.read_bytes()
    config_path = build / "config/sdkconfig.json"
    config_saved = config_path.read_bytes()
    config = json.loads(config_saved)
    config["QUIPUS_EXPERIMENTAL_OFFLINE_DSCNN"] = True
    config_path.write_text(json.dumps(config))
    rejects(lambda: packager.package(output, "waveshare"), "build configuration")
    (build / "lantern.bin").write_bytes(application.replace(stable.encode(), experimental.encode(), 1))
    rejects(lambda: packager.package(output, "waveshare"), "own model/provenance whitelist")
    assert target.read_bytes() == target_before
    config_path.write_bytes(config_saved)
    rejects(lambda: packager.package(output, "waveshare"), "build configuration")
    (build / "lantern.bin").write_bytes(application)
    (build / "lantern.bin").write_bytes(application.replace(packager.FIRMWARE_VERSION.encode(), b"0.0.0-old", 1))
    rejects(lambda: packager.package(output, "waveshare"), "current firmware version")
    cue = (fixture / "hardware/lantern-firmware/main/assets" / manifest["prompts"][0]["file"]).read_bytes()
    (build / "lantern.bin").write_bytes(application.replace(cue, b"", 1))
    rejects(lambda: packager.package(output, "waveshare"), "verified local voice asset")
    (build / "lantern.bin").write_bytes(application)
    installed = fixture / "hardware/lantern-firmware/main/assets/prompts.json"
    changed = json.loads(installed.read_text()); changed["profile"]["voice"] = "cedar"
    installed.write_text(json.dumps(changed))
    rejects(lambda: packager.package(output, "waveshare"), "voice profile/catalog")
    installed.write_text(json.dumps(manifest))
    changed = json.loads(installed.read_text()); changed["prompts"][0]["text"] = "Unapproved alternate prompt"
    installed.write_text(json.dumps(changed))
    rejects(lambda: packager.package(output, "waveshare"), "voice text/catalog")
    installed.write_text(json.dumps(manifest))
    reference = fixture / "hardware/lantern-firmware/main/assets/micro_speech_self_test_yes.pcm"
    pcm = reference.read_bytes()
    (build / "lantern.bin").write_bytes(application.replace(pcm, b"", 1))
    rejects(lambda: packager.package(output, "waveshare"), "exact public self-test fixture")
    (build / "lantern.bin").write_bytes(application)
    reference.write_bytes(bytes([pcm[0] ^ 1]) + pcm[1:])
    rejects(lambda: packager.package(output, "waveshare"), "exact public self-test fixture")
    reference.write_bytes(pcm)
    source_wav = fixture / "hardware/lantern-firmware/tests/local-recognizer-host/fixtures/yes.wav"
    wav = source_wav.read_bytes(); source_wav.write_bytes(wav[:-1] + bytes([wav[-1] ^ 1]))
    rejects(lambda: packager.package(output, "waveshare"), "source WAV digest")
    source_wav.write_bytes(wav)
    model = fixture / "hardware/lantern-firmware/main/assets/micro_speech_yes_no.tflite"
    data = model.read_bytes(); model.write_bytes(bytes([data[0] ^ 1]) + data[1:])
    rejects(lambda: packager.package(output, "waveshare"), "exact pinned local model")
print("PASS: config-aware stable/experimental image version binding; unsupported experimental ZIP leaves existing package unchanged; actual package payload/checksums/current profile, model licenses and truthful offline guide; stale image/missing cue/voice-text mismatch/tampered model/missing or tampered public self-test/source-WAV mismatch rejected.")
