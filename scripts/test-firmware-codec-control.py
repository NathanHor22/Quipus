"""Test the real Waveshare codec control with IDF I2C fault injection, without hardware."""
from pathlib import Path
import argparse
import os
import subprocess

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--compiler", help="Path to Zig; otherwise use installed Zig or CC.")
args = parser.parse_args()
zig = Path(args.compiler) if args.compiler else (
    root / ".tools/zig/ziglang" / ("zig.exe" if os.name == "nt" else "zig")
)
compiler = [str(zig), "cc"] if zig.is_file() else [os.environ.get("CC", "cc")]
source = root / "hardware/lantern-firmware/main"
test = root / "hardware/lantern-firmware/tests/codec-control-host"
codec = root / "hardware/lantern-firmware/managed_components/espressif__esp_codec_dev"
if not (codec / "interface/audio_codec_ctrl_if.h").is_file():
    parser.error("Resolve firmware ESP-IDF components first; the test uses the real codec interface.")
build = root / ".tmp-codec-control-host"
build.mkdir(exist_ok=True)
# ESP-IDF profiles can use different tick rates; a 2 ms delay must never become zero.
for tick_hz in (1000, 100):
    binary = build / (f"codec-control-{tick_hz}" + (".exe" if os.name == "nt" else ""))
    subprocess.run(compiler + [
        "-std=c11", "-O1", "-Wall", "-Wextra", "-Werror",
        f"-DTEST_TICK_HZ={tick_hz}",
        "-I" + str(test / "stubs"), "-I" + str(source),
        "-I" + str(codec / "include"), "-I" + str(codec / "interface"),
        str(test / "codec_control_test.c"), str(source / "quipus_codec_control.c"),
        str(codec / "esp_codec_dev_if.c"), "-o", str(binary),
    ], check=True, cwd=root)
    subprocess.run([str(binary)], check=True, cwd=root)
print("Codec transport passed at 1000 Hz and 100 Hz; electrical stability needs board tests.")
