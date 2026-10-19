"""Compile/run portable USB protocol tests using an isolated native C compiler."""
from pathlib import Path
import argparse
import subprocess

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--compiler", default=str(root / ".tools/zig/ziglang/zig.exe"))
args = parser.parse_args()
compiler = Path(args.compiler)
if not compiler.is_file():
    raise SystemExit("Install Zig in .tools/zig/ziglang or pass --compiler pointing to it.")
output = root / ".tmp-phone-protocol"
output.mkdir(exist_ok=True)
source = root / "hardware/lantern-firmware/main"
binary = output / "phone_protocol_test.exe"
subprocess.run([
    str(compiler), "cc", "-std=c11", "-O1", "-Wall", "-Wextra", "-Werror",
    "-I", str(source), str(source / "quipus_usb_protocol.c"),
    str(root / "hardware/lantern-firmware/tests/phone_protocol_test.c"), "-o", str(binary),
], check=True, cwd=root)
subprocess.run([str(binary)], check=True, cwd=root)
