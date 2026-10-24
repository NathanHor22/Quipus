"""Exercise actual per-session delivery announcement and completion guards."""
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
network = (root / "hardware/lantern-firmware/main/lantern_network.h").read_text()
display = (root / "hardware/lantern-firmware/main/lantern_display.h").read_text()
bodies = []
for name in ["clear_active_session", "announce_upload_started", "announce_upload_verified", "session_complete", "saved_for_later"]:
    match = re.search(r"^static [A-Za-z_][A-Za-z_0-9 *]*\b" + name + r"\([^;]*?\) \{", source, re.M)
    if not match:
        raise RuntimeError("Missing production delivery function: " + name)
    bodies.append(source[match.start():source.index("\n}", match.end()) + 2])
types = []
for text, pattern in [(source, r"typedef enum \{[^}]*\} local_state_t;"),
                      (source, r"typedef enum \{[^}]*\} recovery_action_t;"),
                      (network, r"typedef struct \{[^}]*\} lantern_cloud_session_t;"),
                      (display, r"typedef enum \{[^}]*\} lantern_screen_t;")]:
    match = re.search(pattern, text)
    if not match:
        raise RuntimeError("Production delivery types changed")
    types.append(match.group())
prompt_header = (root / "hardware/lantern-firmware/main/quipus_local_prompts.h").read_text()
types.append(re.search(r"typedef enum \{[^}]*\} quipus_prompt_t;", prompt_header).group())
with tempfile.TemporaryDirectory(prefix="quipus-delivery-host-") as folder:
    build = Path(folder)
    (build / "delivery_types.h").write_text("\n".join(types))
    (build / "delivery_under_test.c").write_text("\n".join(bodies))
    binary = build / ("delivery-test.exe" if os.name == "nt" else "delivery-test")
    subprocess.run(compiler + ["-std=c11", "-O1", "-UNDEBUG", "-Wall", "-Wextra", "-Werror",
        "-I" + str(build), "-I" + str(root / "hardware/lantern-firmware/main"),
        str(root / "hardware/lantern-firmware/tests/delivery_announcements_test.c"),
        "-o", str(binary)], check=True, cwd=build)
    subprocess.run([str(binary)], check=True, cwd=build)
