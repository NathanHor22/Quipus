"""Exercise actual SD retention/serialization functions with real cJSON.
Filesystem and encrypted journal edges are fault-injected without a physical SD;
archive authentication and torn-journal recovery run in test-firmware-archive.py.
"""
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
source = (root / "hardware/lantern-firmware/main/lantern_sd.c").read_text()
names = ["invalidate_upload_count", "valid_id", "paths_for_stem", "stem_has_files", "add_session", "json_string", "read_session",
    "retention_clock_valid", "retention_fields", "retention_set_fields", "retain_verified_manifest",
    "write_manifest", "load_manifest", "activate_manifest", "manifest_name", "retention_metadata_name",
    "retention_persist", "retention_cleanup_record", "lantern_sd_capture_active", "lantern_sd_can_power_down",
    "lantern_sd_recording_ready", "lantern_sd_recording_confirm_uploaded_at", "lantern_sd_recording_confirm_uploaded",
    "lantern_sd_upload_pending_count", "lantern_sd_pending_count", "lantern_sd_retention_cleanup", "lantern_sd_has_private_material"]
bodies, declarations = [], []
for name in names:
    match = re.search(r"^(?:static )?[A-Za-z_][A-Za-z_0-9 *]*\b" + name + r"\([^;]*?\) \{", source, re.M)
    assert match, "Missing production storage function: " + name
    bodies.append(source[match.start():source.index("\n}", match.end()) + 2])
    declarations.append(source[match.start():match.end()-1].rstrip() + ";")
constants = "\n".join(line for line in source.splitlines() if line.startswith(("#define SD_RETENTION", "#define SD_CLOCK", "#define MANIFEST_JSON_BYTES")))
candidates = [Path(os.environ.get("IDF_PATH", root / ".tools/esp-idf")), root / ".tools/esp-idf"]
json_dir = next((p / "components/json/cJSON" for p in candidates if (p / "components/json/cJSON/cJSON.c").is_file()), None)
if not json_dir: raise RuntimeError("Set IDF_PATH to ESP-IDF for real cJSON")
with tempfile.TemporaryDirectory(prefix="quipus-retention-", ignore_cleanup_errors=True) as folder:
    build = Path(folder)
    (build / "retention_under_test.c").write_text("\n".join([constants, *declarations, *bodies]))
    binary = build / ("retention.exe" if os.name == "nt" else "retention")
    subprocess.run(compiler + ["-std=c11", "-O1", "-UNDEBUG", "-Wall", "-Wextra", "-Werror",
        "-I"+str(build), "-I"+str(json_dir), str(root / "hardware/lantern-firmware/tests/sd-host/sd_retention_test.c"),
        str(json_dir / "cJSON.c"), "-o", str(binary)], check=True, cwd=build)
    subprocess.run([str(binary)], check=True, cwd=build)
