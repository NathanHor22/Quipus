"""Host-only checks for the production reset SD purge and authenticated protocol.

No serial port or physical SD card is used. Production function bodies are
compiled verbatim with filesystem/network/NVS fault fixtures.
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
source = root / "hardware/lantern-firmware/main"

def extract(text, name):
    match = re.search(r"^(?:static )?[A-Za-z_][A-Za-z_0-9 *]*\b" + name + r"\([^;]*?\) \{", text, re.M)
    assert match, "Missing production reset function: " + name
    return text[match.start():text.index("\n}", match.end()) + 2]

with tempfile.TemporaryDirectory(prefix="quipus-factory-reset-") as folder:
    build = Path(folder)
    sd = (source / "lantern_sd.c").read_text()
    (build / "reset_sd_under_test.c").write_text("\n".join(extract(sd, name) for name in [
        "factory_reset_card_ready", "factory_reset_private_extension", "factory_reset_file_name", "lantern_sd_factory_reset_step"
    ]))
    binary = build / ("factory-reset-sd.exe" if os.name == "nt" else "factory-reset-sd")
    subprocess.run(compiler + ["-std=c11", "-O1", "-Wall", "-Wextra", "-Werror", "-I" + str(build),
        str(root / "hardware/lantern-firmware/tests/factory_reset_sd_test.c"), "-o", str(binary)], check=True, cwd=build)
    subprocess.run([str(binary)], check=True, cwd=build)

    network = (source / "lantern_network.c").read_text()
    (build / "reset_network_under_test.c").write_text("\n".join(extract(network, name) for name in [
        "lantern_network_factory_reset_pending", "factory_reset_error", "request_factory_reset", "recover_rejected_credential", "lantern_network_retry_rejected_credential", "continue_factory_reset_locked", "lantern_network_continue_factory_reset", "lantern_network_save_setup", "pairing_conflict_message"
    ]))
    json_dir = root / ".tools/esp-idf/components/json/cJSON"
    assert (json_dir / "cJSON.c").is_file(), "Real cJSON is required for reset protocol validation"
    binary = build / ("factory-reset-protocol.exe" if os.name == "nt" else "factory-reset-protocol")
    subprocess.run(compiler + ["-std=c11", "-O1", "-Wall", "-Wextra", "-Werror", "-I" + str(build),
        "-I" + str(source), "-I" + str(root / "hardware/lantern-firmware/tests/storage-host/stubs"),
        "-I" + str(json_dir), str(root / "hardware/lantern-firmware/tests/factory_reset_protocol_test.c"),
        str(json_dir / "cJSON.c"), "-o", str(binary)], check=True, cwd=build)
    subprocess.run([str(binary)], check=True, cwd=build)
