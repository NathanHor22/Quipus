"""Fault-inject the production SD coordinator without mounting or formatting a card.

The selected function bodies and writer-state declarations are copied verbatim
from lantern_sd.c into an isolated host translation unit. Only the RTOS,
filesystem/codec edges are stubbed; encrypted-container behavior has its own
archive host tests. This keeps this test portable and avoids an ESP-IDF runtime.
"""
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
source = (root / "hardware/lantern-firmware/main/lantern_sd.c").read_text()
functions = ["recording_failed", "finish_file", "writer_task", "ensure_writer",
    "lantern_sd_recording_write", "lantern_sd_recording_finish",
    "lantern_sd_recording_abort", "lantern_sd_capture_active",
    "lantern_sd_recording_error", "lantern_sd_can_power_down",
    "lantern_sd_recording_ready"]
bodies, declarations = [], []
for name in functions:
    # Production definitions close at column zero; prototypes are excluded.
    match = re.search(r"^(?:static )?[A-Za-z_][A-Za-z_0-9 *]*\b" + re.escape(name) + r"\([^;]*?\) \{", source, re.M)
    if not match:
        raise RuntimeError("Missing production SD function: " + name)
    end = source.index("\n}", match.end()) + 2
    bodies.append(source[match.start():end])
    declarations.append(source[match.start():match.end() - 1].rstrip() + ";")
state = source[source.index("static volatile bool s_accepting"):source.index("static esp_err_t ensure_writer(void);")]
constants = "\n".join(line for line in source.splitlines() if line.startswith(("#define SD_WRITE_BUFFER_BYTES", "#define SD_WRITE_BLOCK_BYTES")))
with tempfile.TemporaryDirectory(prefix="quipus-sd-host-") as folder:
    build = Path(folder)
    (build / "sd_writer_under_test.c").write_text("\n".join([constants, state, *declarations, *bodies]))
    binary = build / ("sd-test.exe" if os.name == "nt" else "sd-test")
    subprocess.run(compiler + ["-std=c11", "-O1", "-UNDEBUG", "-Wall", "-Wextra", "-Werror",
        "-I" + str(build), str(root / "hardware/lantern-firmware/tests/sd-host/sd_writer_test.c"),
        "-o", str(binary)], check=True, cwd=build)
    subprocess.run([str(binary)], check=True, cwd=build)
