"""Exercise actual offline voice/consent and SD-first admission controllers."""
from pathlib import Path
import argparse
import os
import re
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--compiler")
args = parser.parse_args()
zig = Path(args.compiler) if args.compiler else root / ".tools/zig/ziglang" / ("zig.exe" if os.name == "nt" else "zig")
compiler = [str(zig), "cc"] if zig.is_file() else [os.environ.get("CC", "cc")]
main = root / "hardware/lantern-firmware/main"
source = (main / "app_main.c").read_text()
names = ["open_quick_consent", "begin_recording_session", "local_voice_ready",
 "classify_local_yes_no", "capture_consent_response", "cancel_pending_consent",
 "accept_recording_consent", "capture_spoken_consent", "start_spoken_consent",
 "ask_local_choice", "capture_offline_wake_menu", "capture_wake_command", "stop_local_capture"]
bodies, declarations = [], []
for name in names:
    match = re.search(r"^static [A-Za-z_][A-Za-z_0-9 *]*\b" + name + r"\([^;]*?\) \{", source, re.M)
    if not match:
        raise RuntimeError("Missing actual offline controller " + name)
    end = source.index("\n}", match.end()) + 2
    bodies.append(source[match.start():end])
    declarations.append(source[match.start():match.end() - 1].rstrip() + ";")
with tempfile.TemporaryDirectory(prefix="quipus-offline-voice-") as folder:
    build = Path(folder)
    (build / "esp_err.h").write_text("#pragma once\ntypedef int esp_err_t;\n")
    prompts = (main / "quipus_local_prompts.h").read_text()
    (build / "prompt_enum_under_test.h").write_text(re.search(r"typedef enum \{[^}]*\} quipus_prompt_t;", prompts).group())
    (build / "offline_voice_under_test.c").write_text("\n".join([*declarations, *bodies]))
    for sd in (1, 0):
        binary = build / ("offline-voice-" + str(sd) + (".exe" if os.name == "nt" else ""))
        subprocess.run(compiler + ["-std=c11", "-O1", "-UNDEBUG", "-Wall", "-Wextra", "-Werror",
            "-DTEST_SD_CARD=" + str(sd), "-I" + str(build), "-I" + str(main),
            str(root / "hardware/lantern-firmware/tests/offline_voice_test.c"), "-o", str(binary)], check=True, cwd=build)
        subprocess.run([str(binary)], check=True, cwd=build)
