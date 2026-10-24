"""Exercise the actual report dialogue and fresh voice-window controllers."""
from pathlib import Path
import os
import re
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
main = root / "hardware/lantern-firmware/main"
source = (main / "app_main.c").read_text()
zig = root / ".tools/zig/ziglang" / ("zig.exe" if os.name == "nt" else "zig")
compiler = [str(zig), "cc"] if zig.is_file() else [os.environ.get("CC", "cc")]
bodies, declarations = [], []
for name in ["capture_utterance", "capture_short_utterance", "review_spoken_actions", "report_dialogue"]:
    match = re.search(r"^static [A-Za-z_][A-Za-z_0-9 *]*\b" + name + r"\([^;]*?\) \{", source, re.M)
    if not match:
        raise RuntimeError("Missing production dialogue function: " + name)
    bodies.append(source[match.start():source.index("\n}", match.end()) + 2])
    declarations.append(source[match.start():match.end() - 1].rstrip() + ";")
types = []
for text, pattern in [(source, r"typedef enum \{[^}]*\} local_state_t;"),
                      (source, r"typedef enum \{[^}]*\} recovery_action_t;"),
                      ((main / "lantern_display.h").read_text(), r"typedef enum \{[^}]*\} lantern_screen_t;"),
                      ((main / "quipus_local_prompts.h").read_text(), r"typedef enum \{[^}]*\} quipus_prompt_t;")]:
    match = re.search(pattern, text)
    if not match:
        raise RuntimeError("Missing production dialogue enum: " + pattern)
    types.append(match.group())
for name in ["VOICE_ACTIVITY_LEVEL", "VOICE_SILENCE_MS", "VOICE_MIN_CAPTURE_MS"]:
    types.append(re.search(r"^#define " + name + r" [^\n]+", source, re.M).group())
network = (main / "lantern_network.h").read_text()
types.append(re.search(r"^#define LANTERN_REPORT_INTERRUPTED [^\n]+", network, re.M).group())
with tempfile.TemporaryDirectory(prefix="quipus-report-dialogue-") as folder:
    build = Path(folder)
    (build / "report_dialogue_types.h").write_text("\n".join([*types, *declarations]))
    (build / "report_dialogue_under_test.c").write_text("\n".join(bodies))
    binary = build / ("report-dialogue.exe" if os.name == "nt" else "report-dialogue")
    subprocess.run(compiler + ["-std=c11", "-O1", "-UNDEBUG", "-Wall", "-Wextra", "-Werror",
        "-I" + str(build), str(root / "hardware/lantern-firmware/tests/report_dialogue_test.c"),
        "-o", str(binary)], check=True, cwd=build)
    subprocess.run([str(binary)], check=True, cwd=build)
