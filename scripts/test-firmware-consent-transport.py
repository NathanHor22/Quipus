"""Exercise production consent/dispatch/recovery HTTP decisions and capture windows."""
from pathlib import Path
import argparse
import os
import re
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--compiler", help="Path to Zig; otherwise use local Zig or CC.")
args = parser.parse_args()
zig = Path(args.compiler) if args.compiler else root / ".tools/zig/ziglang" / ("zig.exe" if os.name == "nt" else "zig")
compiler = [str(zig), "cc"] if zig.is_file() else [os.environ.get("CC", "cc")]
network = (root / "hardware/lantern-firmware/main/lantern_network.c").read_text()
controller = (root / "hardware/lantern-firmware/main/app_main.c").read_text()
audio = (root / "hardware/lantern-firmware/main/lantern_audio.c").read_text()


def function(source, name):
    match = re.search(r"^(?:static )?[A-Za-z_][A-Za-z_0-9 *]*\b" + name + r"\([^;]*?\) \{", source, re.M)
    if not match:
        raise RuntimeError("Missing production function: " + name)
    end = source.index("\n}", match.end()) + 2
    return source[match.start():end]


def typedef(source, name):
    match = re.search(r"typedef struct \{[^{}]*\} " + name + ";", source, re.S)
    if not match:
        raise RuntimeError("Missing production response type: " + name)
    return match.group()


constants = []
for source, name in [(network, "RESPONSE_CAPACITY"), (controller, "VOICE_ACTIVITY_LEVEL"),
                     (controller, "VOICE_SILENCE_MS"), (controller, "VOICE_MIN_CAPTURE_MS")]:
    match = re.search(r"^#define " + name + r" [^\n]+", source, re.M)
    if not match:
        raise RuntimeError("Missing production constant: " + name)
    constants.append(match.group())

with tempfile.TemporaryDirectory(prefix="quipus-consent-transport-") as folder:
    build = Path(folder)
    (build / "consent_transport_types.h").write_text("\n".join([
        *constants, typedef(network, "response_buffer_t"), typedef(network, "audio_response_t")]))
    (build / "consent_transport_under_test.c").write_text("\n".join([
        *(function(network, name) for name in ["audio_http_event", "wav_u16", "wav_u32",
                                              "lantern_network_run_voice_command"]),
        function(audio, "lantern_audio_set_recording").replace("lantern_audio_set_recording(", "production_audio_set_recording(", 1),
        function(controller, "capture_utterance"),
        function(controller, "capture_short_utterance")]))
    binary = build / ("consent-transport-test.exe" if os.name == "nt" else "consent-transport-test")
    subprocess.run(compiler + ["-std=c11", "-O1", "-UNDEBUG", "-Wall", "-Wextra", "-Werror",
        "-I" + str(build),
        str(root / "hardware/lantern-firmware/tests/consent_transport_test.c"),
        "-o", str(binary)], check=True, cwd=build)
    subprocess.run([str(binary)], check=True, cwd=build)
