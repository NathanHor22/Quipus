"""Exercise production consent, input monitoring and safe shutdown with hardware stubs."""
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
monitor = "input_monitor_task" if re.search(r"^static void input_monitor_task\(", source, re.M) else "report_interrupt_task"
for name in ["open_quick_consent", "begin_recording_session", "capture_spoken_consent", "sd_ready_for_recording", "start_spoken_consent", "handle_short_press", "cancel_pending_consent", "power_off_safely", monitor]:
    match = re.search(r"^static [A-Za-z_][A-Za-z_0-9 *]*\b" + name + r"\([^;]*?\) \{", source, re.M)
    if not match:
        raise RuntimeError("Missing production consent function: " + name)
    end = source.index("\n}", match.end()) + 2
    bodies.append(source[match.start():end])
    declarations.append(source[match.start():match.end() - 1].rstrip() + ";")
# The touchscreen routes non-ready states through the same production handler.
# Compile that actual entry guard; fail if an earlier statement could bypass it.
touch = re.search(r"^static void handle_touch_release\([^;]*?\) \{", source, re.M)
if not touch:
    raise RuntimeError("Missing production touchscreen entry")
touch_start = touch.end()
guard = re.match(r"\s*(if\s*\(s_state != LOCAL_READY\) \{.*?\n  \})", source[touch_start:], re.S)
if not guard:
    raise RuntimeError("Touchscreen non-ready guard changed; review consent dispatch")
bodies.append("static void tested_touch_consent_dispatch(void) {\n" + guard.group(1) + "\n}")
with tempfile.TemporaryDirectory(prefix="quipus-consent-host-") as folder:
    build = Path(folder)
    prompt_header = (root / "hardware/lantern-firmware/main/quipus_local_prompts.h").read_text()
    prompt_enum = re.search(r"typedef enum \{[^}]*\} quipus_prompt_t;", prompt_header).group()
    (build / "prompt_enum_under_test.h").write_text(prompt_enum)
    (build / "consent_under_test.c").write_text("\n".join([*declarations, *bodies, "#define tested_input_monitor " + monitor]))
    binary = build / ("consent-test.exe" if os.name == "nt" else "consent-test")
    subprocess.run(compiler + ["-std=c11", "-O1", "-UNDEBUG", "-Wall", "-Wextra", "-Werror",
        "-I" + str(build), "-I" + str(root / "hardware/lantern-firmware/main"),
        str(root / "hardware/lantern-firmware/tests/consent_controls_test.c"),
        "-o", str(binary)], check=True, cwd=build)
    subprocess.run([str(binary)], check=True, cwd=build)
