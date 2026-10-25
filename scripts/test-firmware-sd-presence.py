"""Exercise the actual microSD insert/remove poll with the card and driver stubbed."""
from pathlib import Path
import os
import re
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
zig = root / ".tools/zig/ziglang" / ("zig.exe" if os.name == "nt" else "zig")
compiler = [str(zig), "cc"] if zig.is_file() else [os.environ.get("CC", "cc")]
source = (root / "hardware/lantern-firmware/main/lantern_sd.c").read_text()
match = re.search(r"^lantern_sd_change_t lantern_sd_poll\(void\) \{", source, re.M)
if not match:
    raise RuntimeError("Missing production SD function: lantern_sd_poll")
body = source[match.start():source.index("\n}", match.end()) + 2]
with tempfile.TemporaryDirectory(prefix="quipus-sd-presence-") as folder:
    build = Path(folder)
    (build / "sd_presence_under_test.c").write_text(body)
    binary = build / ("sd-presence.exe" if os.name == "nt" else "sd-presence")
    subprocess.run(compiler + ["-std=c11", "-O1", "-UNDEBUG", "-Wall", "-Wextra", "-Werror",
        "-I" + str(build), str(root / "hardware/lantern-firmware/tests/sd-presence-host/sd_presence_test.c"),
        "-o", str(binary)], check=True, cwd=build)
    subprocess.run([str(binary)], check=True, cwd=build)
