"""Run actual READY redraw and background-sync gate against heartbeat timing."""
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
def body(name):
    match = re.search(r"^static [A-Za-z_][A-Za-z_0-9 *]*\b" + name + r"\([^;]*?\) \{", source, re.M)
    if not match:
        raise RuntimeError("Missing production function: " + name)
    return source[match.start():source.index("\n}", match.end()) + 2]
telemetry = body("telemetry_task")
initializer = re.search(r"quipus_sync_input_t sync_input = \{.*?^\s*\};", telemetry, re.M | re.S)
call = re.search(r"if \((quipus_sync_due\(.*?\))\) \{", telemetry, re.S)
if not initializer or not call:
    raise RuntimeError("Production background sync gate changed; review test extraction")
with tempfile.TemporaryDirectory(prefix="quipus-sync-host-") as folder:
    build = Path(folder)
    generated = body("show_ready") + "\n" + body("retry_pending_summary") + "\nstatic bool production_sync_due(void) {\n" + initializer.group(0) + "\nreturn " + call.group(1) + ";\n}\n"
    (build / "sync_under_test.c").write_text(generated)
    for sd in [1, 0]:
        binary = build / (f"sync-test-{sd}.exe" if os.name == "nt" else f"sync-test-{sd}")
        subprocess.run(compiler + ["-std=c11", "-O1", "-UNDEBUG", "-Wall", "-Wextra", "-Werror",
            f"-DLANTERN_HAS_SD_CARD={sd}", "-I" + str(build), "-I" + str(root / "hardware/lantern-firmware/main"),
            str(root / "hardware/lantern-firmware/tests/sync_policy_test.c"), "-o", str(binary)],
            check=True, cwd=build)
        subprocess.run([str(binary)], check=True, cwd=build)
