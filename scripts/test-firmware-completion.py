"""Exercise actual completion receipt parsing and optional SD session metadata."""
from pathlib import Path
import os
import re
import subprocess
import tempfile
root = Path(__file__).resolve().parents[1]
main = root / "hardware/lantern-firmware/main"
network = (main / "lantern_network.c").read_text()
sd = (main / "lantern_sd.c").read_text()
header = (main / "lantern_network.h").read_text()
zig = root / ".tools/zig/ziglang" / ("zig.exe" if os.name == "nt" else "zig")
compiler = [str(zig), "cc"] if zig.is_file() else [os.environ.get("CC", "cc")]

def function(source, name):
    match = re.search(r"^(?:static )?[A-Za-z_][A-Za-z_0-9 *]*\b" + name + r"\([^;]*?\) \{", source, re.M)
    if not match: raise RuntimeError("Missing production receipt function: " + name)
    return source[match.start():source.index("\n}", match.end()) + 2]

def type_body(source, name):
    match = re.search(r"typedef struct \{[^{}]*\} " + name + ";", source, re.S)
    if not match: raise RuntimeError("Missing production receipt type: " + name)
    return match.group()

candidates = [Path(os.environ.get("IDF_PATH", root / ".tools/esp-idf")), root / ".tools/esp-idf"]
json_dir = next((p / "components/json/cJSON" for p in candidates if (p / "components/json/cJSON/cJSON.c").is_file()), None)
if not json_dir: raise RuntimeError("Set IDF_PATH to ESP-IDF for actual cJSON")
with tempfile.TemporaryDirectory(prefix="quipus-completion-") as folder:
    build = Path(folder)
    constant = re.search(r"^#define RESPONSE_CAPACITY [^\n]+", network, re.M).group()
    (build / "completion_types.h").write_text("\n".join([constant,
        type_body(network,"response_buffer_t"), type_body(header,"lantern_cloud_session_t"),
        type_body(header,"lantern_agora_transport_t")]))
    (build / "completion_under_test.c").write_text("\n".join([
        *(function(network,name) for name in ["copy_json_string","parse_session_response","lantern_network_complete_session"]),
        *(function(sd,name) for name in ["valid_id","add_session","json_string","read_session"])]))
    binary = build / ("completion.exe" if os.name == "nt" else "completion")
    subprocess.run(compiler + ["-std=c11","-O1","-UNDEBUG","-Wall","-Wextra","-Werror",
        "-I"+str(build),"-I"+str(json_dir),str(root / "hardware/lantern-firmware/tests/completion_receipt_test.c"),
        str(json_dir / "cJSON.c"),"-o",str(binary)],check=True,cwd=build)
    subprocess.run([str(binary)],check=True,cwd=build)
