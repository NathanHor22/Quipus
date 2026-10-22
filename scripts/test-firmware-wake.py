"""Compile the actual wake wrapper with ESP/WakeNet stubs and test its lifecycle."""
from pathlib import Path
import argparse
import os
import subprocess

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--compiler", help="Path to Zig; otherwise use the installed Zig or CC.")
args = parser.parse_args()
zig = Path(args.compiler) if args.compiler else (
    root / ".tools/zig/ziglang" / ("zig.exe" if os.name == "nt" else "zig")
)
compiler = [str(zig), "cc"] if zig.is_file() else [os.environ.get("CC", "cc")]
test = root / "hardware/lantern-firmware/tests/wake-host"
build = root / ".tmp-wake-host"
build.mkdir(exist_ok=True)
binary = build / ("wake-test.exe" if os.name == "nt" else "wake-test")
subprocess.run(compiler + [
    "-std=c11", "-O1", "-Wall", "-Wextra", "-Werror",
    "-I" + str(test / "stubs"),
    "-I" + str(root / "hardware/lantern-firmware/main"),
    str(test / "wake_test.c"),
    str(root / "hardware/lantern-firmware/main/lantern_wake.c"),
    "-o", str(binary),
], check=True, cwd=root)
# Fresh processes isolate the production wrapper's static model state.
for scenario in [
    "normal", "missing-models", "missing-name", "missing-interface",
    "create-failed", "bad-frame", "bad-rate", "bad-channels", "allocation-failed",
]:
    subprocess.run([str(binary), scenario], check=True, cwd=root)
print("Wake listener lifecycle passed; acoustic model accuracy requires a physical voice test.")
