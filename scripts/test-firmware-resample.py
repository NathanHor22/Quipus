"""Compile/run portable 24 to 16 kHz playback resampler tests."""
from pathlib import Path
import argparse
import os
import subprocess

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--compiler", help="Path to Zig; otherwise use local Zig or CC.")
args = parser.parse_args()
zig = Path(args.compiler) if args.compiler else root / ".tools/zig/ziglang" / ("zig.exe" if os.name == "nt" else "zig")
compiler = [str(zig), "cc"] if zig.is_file() else [os.environ.get("CC", "cc")]
output = root / ".tmp-resample"
output.mkdir(exist_ok=True)
source = root / "hardware/lantern-firmware/main"
binary = output / ("resample_test" + (".exe" if os.name == "nt" else ""))
subprocess.run(compiler + [
    "-std=c11", "-O1", "-Wall", "-Wextra", "-Werror",
    "-I", str(source),
    str(root / "hardware/lantern-firmware/tests/resample_test.c"),
    "-lm", "-o", str(binary),
], check=True, cwd=root)
subprocess.run([str(binary)], check=True, cwd=root)
