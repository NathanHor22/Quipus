"""Compile real storage reset paths and non-BLE compatibility without hardware."""
from pathlib import Path
import argparse
import os
import subprocess

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--compiler", help="Path to Zig; otherwise use installed Zig or CC.")
args = parser.parse_args()
zig = Path(args.compiler) if args.compiler else root / ".tools/zig/ziglang" / ("zig.exe" if os.name == "nt" else "zig")
compiler = [str(zig), "cc"] if zig.is_file() else [os.environ.get("CC", "cc")]
source = root / "hardware/lantern-firmware/main"
test = root / "hardware/lantern-firmware/tests/storage-host"
output = root / ".tmp-storage-host"
output.mkdir(exist_ok=True)
for name, production, define in [
    ("storage-reset", ["lantern_storage.c", "quipus_setup_password.c"], "0"),
    ("bluetooth-disabled", ["lantern_bluetooth.c"], "1"),
]:
    binary = output / (name + (".exe" if os.name == "nt" else ""))
    subprocess.run(compiler + [
        "-std=c11", "-O1", "-Wall", "-Wextra", "-Werror",
        "-DTEST_BLE_DISABLED=" + define, "-I" + str(test / "stubs"), "-I" + str(source),
        str(test / "storage_reset_test.c"), *[str(source / file) for file in production],
        "-o", str(binary),
    ], check=True, cwd=root)
    subprocess.run([str(binary)], check=True, cwd=root)
