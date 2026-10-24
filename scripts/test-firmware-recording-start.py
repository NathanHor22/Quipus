"""Fault-inject real consent acceptance and local cleanup at blocking boundaries."""
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
source = (root / "hardware/lantern-firmware/main/app_main.c").read_text()
bodies, declarations = [], []
for name in ["accept_recording_consent", "stop_local_capture"]:
    match = re.search(r"^static [A-Za-z_][A-Za-z_0-9 *]*\b" + name + r"\([^;]*?\) \{", source, re.M)
    if not match:
        raise RuntimeError("Missing production recording function: " + name)
    end = source.index("\n}", match.end()) + 2
    bodies.append(source[match.start():end])
    declarations.append(source[match.start():match.end() - 1].rstrip() + ";")
with tempfile.TemporaryDirectory(prefix="quipus-start-host-") as folder:
    build = Path(folder)
    prompt_header = (root / "hardware/lantern-firmware/main/quipus_local_prompts.h").read_text()
    (build / "prompt_enum_under_test.h").write_text(re.search(r"typedef enum \{[^}]*\} quipus_prompt_t;", prompt_header).group())
    (build / "recording_start_under_test.c").write_text("\n".join([*declarations, *bodies]))
    binary = build / ("recording-start.exe" if os.name == "nt" else "recording-start")
    subprocess.run(compiler + ["-std=c11", "-O1", "-UNDEBUG", "-Wall", "-Wextra", "-Werror",
        "-I" + str(build), str(root / "hardware/lantern-firmware/tests/recording_start_test.c"),
        "-o", str(binary)], check=True, cwd=build)
    subprocess.run([str(binary)], check=True, cwd=build)
