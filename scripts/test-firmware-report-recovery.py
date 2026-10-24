"""Exercise actual report receipt repair and read-only failure return to idle."""
from pathlib import Path
import os
import re
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
main = root / "hardware/lantern-firmware/main"
source = (main / "app_main.c").read_text()
network = (main / "lantern_network.h").read_text()
display = (main / "lantern_display.h").read_text()
prompts = (main / "quipus_local_prompts.h").read_text()
zig = root / ".tools/zig/ziglang" / ("zig.exe" if os.name == "nt" else "zig")
compiler = [str(zig), "cc"] if zig.is_file() else [os.environ.get("CC", "cc")]
bodies, declarations = [], []
for name in ["stop_local_capture", "show_error", "show_ready", "reconcile_report_capture_receipt", "play_status_report"]:
    match = re.search(r"^static [A-Za-z_][A-Za-z_0-9 *]*\b" + name + r"\([^;]*?\) \{", source, re.M)
    if not match:
        raise RuntimeError("Missing production controller function: " + name)
    bodies.append(source[match.start():source.index("\n}", match.end()) + 2])
    declarations.append(source[match.start():match.end()-1].rstrip() + ";")
types = [re.search(r"^#define LANTERN_REPORT_INTERRUPTED [^\n]+", network, re.M).group()]
for text, pattern in [(source, r"typedef enum \{[^}]*\} local_state_t;"),
                      (source, r"typedef enum \{[^}]*\} recovery_action_t;"),
                      (network, r"typedef struct \{[^}]*\} lantern_cloud_session_t;"),
                      (network, r"typedef struct \{[^}]*\} lantern_network_status_t;"),
                      (display, r"typedef enum \{[^}]*\} lantern_screen_t;"),
                      (display, r"typedef enum \{[^}]*\} lantern_connectivity_t;"),
                      (prompts, r"typedef enum \{[^}]*\} quipus_prompt_t;")]:
    match = re.search(pattern, text)
    if not match:
        raise RuntimeError("Missing controller fixture type: " + pattern)
    types.append(match.group())
# Connectivity must precede the actual network status struct using it.
types.insert(3, types.pop(6))
with tempfile.TemporaryDirectory(prefix="quipus-report-recovery-") as folder:
    build = Path(folder)
    (build / "report_recovery_types.h").write_text("\n".join([*types, *declarations]))
    (build / "report_recovery_under_test.c").write_text("\n".join(bodies))
    for sd in [1, 0]:
        binary = build / ("report-recovery-" + str(sd) + (".exe" if os.name == "nt" else ""))
        subprocess.run(compiler + ["-std=c11", "-O1", "-UNDEBUG", "-Wall", "-Wextra", "-Werror",
            "-DTEST_SD_CARD=" + str(sd), "-I" + str(build),
            str(root / "hardware/lantern-firmware/tests/report_recovery_test.c"), "-o", str(binary)], check=True, cwd=build)
        subprocess.run([str(binary)], check=True, cwd=build)
