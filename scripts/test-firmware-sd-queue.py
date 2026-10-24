"""Compile the production SD queue selector with filesystem/manifest edge fixtures.

The cloud allows one open session per device. An older uploaded-but-uncompleted
session must be selected before a newer offline recording can be imported.
Archive encryption and manifest-authentication behavior remain independently
covered by the existing archive/SD tests; this harness checks queue selection and
its immediate identity/active-writer guards without touching a physical card.
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
bodies = []
for name in ["invalidate_upload_count", "retain_verified_manifest", "retention_metadata_name", "quarantine_manifest", "lantern_sd_upload_pending_count", "lantern_sd_pending_count", "lantern_sd_next_pending"]:
    match = re.search(r"^(?:static )?[A-Za-z_][A-Za-z_0-9 *]*\b" + name + r"\([^;]*?\) \{", source, re.M)
    assert match, "Missing production SD queue function: " + name
    bodies.append(source[match.start():source.index("\n}", match.end()) + 2])
body = "\n".join(bodies)
normalizer = re.search(r"^static esp_err_t normalize_recovered_phone_timing\([^;]*?\) \{", source, re.M)
assert normalizer, "Missing production phone-timing normalizer"
normalizer_body = source[normalizer.start():source.index("\n}", normalizer.end()) + 2]
json_candidates = [Path(os.environ.get("IDF_PATH", root / ".tools/esp-idf")), root / ".tools/esp-idf"]
json_dir = next((folder / "components/json/cJSON" for folder in json_candidates
                 if (folder / "components/json/cJSON/cJSON.c").is_file()), None)
if json_dir is None:
    raise RuntimeError("Set IDF_PATH to ESP-IDF: the real cJSON source is required for allocation-fault tests")
with tempfile.TemporaryDirectory(prefix="quipus-sd-queue-") as folder:
    build = Path(folder)
    (build / "sd_queue_under_test.c").write_text(body)
    binary = build / ("sd-queue.exe" if os.name == "nt" else "sd-queue")
    subprocess.run(compiler + ["-std=c11", "-O1", "-UNDEBUG", "-Wall", "-Wextra", "-Werror", "-I" + str(build),
        str(root / "hardware/lantern-firmware/tests/sd-host/sd_queue_test.c"), "-o", str(binary)], check=True, cwd=build)
    subprocess.run([str(binary)], check=True, cwd=build)
    (build / "sd_phone_timing_under_test.c").write_text(normalizer_body)
    timing_binary = build / ("sd-phone-timing.exe" if os.name == "nt" else "sd-phone-timing")
    subprocess.run(compiler + ["-std=c11", "-O1", "-UNDEBUG", "-Wall", "-Wextra", "-Werror",
        "-I" + str(build), "-I" + str(json_dir),
        str(root / "hardware/lantern-firmware/tests/sd-host/sd_phone_timing_test.c"),
        str(json_dir / "cJSON.c"), "-o", str(timing_binary)], check=True, cwd=build)
    subprocess.run([str(timing_binary)], check=True, cwd=build)
