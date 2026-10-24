"""Exercise production error voice dispatch and wake policy across board profiles."""
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
for name in ["sync_idle_wake_listener", "restore_recovery_error", "capture_recovery_command"]:
    match = re.search(r"^static [A-Za-z_][A-Za-z_0-9 *]*\b" + name + r"\([^;]*?\) \{", source, re.M)
    if not match:
        raise RuntimeError("Missing production recovery function: " + name)
    end = source.index("\n}", match.end()) + 2
    bodies.append(source[match.start():end])
    declarations.append(source[match.start():match.end() - 1].rstrip() + ";")
telemetry_match = re.search(r"^static void telemetry_task\([^;]*?\) \{", source, re.M)
telemetry = source[telemetry_match.start():source.index("\n}", telemetry_match.end()) + 2]
auto_start = telemetry.find("if (s_state == LOCAL_ERROR && LANTERN_HAS_SD_CARD &&")
if auto_start < 0:
    raise RuntimeError("Production automatic error recovery gate changed")
opening = telemetry.index("{", auto_start)
depth, end = 1, opening + 1
while depth:
    depth += (telemetry[end] == "{") - (telemetry[end] == "}")
    end += 1
bodies.append("static void tested_automatic_recovery(void) {\nlantern_network_status_t display_network;\nlantern_network_get_status(&display_network);\n" + telemetry[auto_start:end] + "\n}")
enums = re.findall(r"typedef enum \{[^}]*\} (?:local_state_t|ui_view_t|recovery_action_t);", source)
if len(enums) != 3:
    raise RuntimeError("Production state enum layout changed")
with tempfile.TemporaryDirectory(prefix="quipus-recovery-host-") as folder:
    build = Path(folder)
    prompt_header = (root / "hardware/lantern-firmware/main/quipus_local_prompts.h").read_text()
    prompt_enum = re.search(r"typedef enum \{[^}]*\} quipus_prompt_t;", prompt_header).group()
    (build / "prompt_enum_under_test.h").write_text(prompt_enum)
    (build / "recovery_types_under_test.h").write_text("\n".join(enums))
    (build / "recovery_under_test.c").write_text("\n".join([*declarations, *bodies]))
    for name, sd_card, touchscreen in [("waveshare", 1, 0), ("original", 0, 0), ("v2-touch", 1, 1)]:
        binary = build / (name + (".exe" if os.name == "nt" else ""))
        subprocess.run(compiler + ["-std=c11", "-O1", "-UNDEBUG", "-Wall", "-Wextra", "-Werror",
            "-DTEST_SD_CARD=" + str(sd_card), "-DTEST_TOUCHSCREEN=" + str(touchscreen),
            "-I" + str(build), str(root / "hardware/lantern-firmware/tests/recovery_command_test.c"),
            "-o", str(binary)], check=True, cwd=build)
        subprocess.run([str(binary)], check=True, cwd=build)
