"""Compile/run portable Wi-Fi recovery and provisioning tests."""
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
output = root / ".tmp-network-policy"
output.mkdir(exist_ok=True)
source = root / "hardware/lantern-firmware/main"
binary = output / ("network_policy_test" + (".exe" if os.name == "nt" else ""))
subprocess.run(compiler + [
    "-std=c11", "-O1", "-Wall", "-Wextra", "-Werror",
    "-I", str(source), str(source / "quipus_network_policy.c"),
    str(source / "quipus_setup_form.c"),
    str(root / "hardware/lantern-firmware/tests/network_policy_test.c"),
    "-o", str(binary),
], check=True, cwd=root)
subprocess.run([str(binary)], check=True, cwd=root)
