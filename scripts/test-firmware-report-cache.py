"""Exercise the production SD report cache and archive with actual AES-GCM/cJSON.

No ESP32, card, recording, credentials or network access. Files stay in an isolated
host temporary directory; every cache fixture is deleted after the test process.
"""
from pathlib import Path
import os
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
main = root / "hardware/lantern-firmware/main"
stubs = root / "hardware/lantern-firmware/tests/archive-host/stubs"
idf = Path(os.environ.get("IDF_PATH", root / ".tools/esp-idf"))
mbed = idf / "components/mbedtls/mbedtls"
json_dir = idf / "components/json/cJSON"
zig = root / ".tools/zig/ziglang" / ("zig.exe" if os.name == "nt" else "zig")
compiler = [str(zig), "cc"] if zig.is_file() else [os.environ.get("CC", "cc")]
sources = ["aes.c", "gcm.c", "cipher.c", "cipher_wrap.c", "md.c", "sha256.c", "platform_util.c", "platform.c", "constant_time.c"]
with tempfile.TemporaryDirectory(prefix="quipus-report-cache-") as folder:
    build = Path(folder)
    program = build / ("report-cache.exe" if os.name == "nt" else "report-cache")
    command = compiler + ["-std=c11", "-O1", "-UNDEBUG", "-Wall", "-Wextra", "-Werror", '-DMBEDTLS_CONFIG_FILE="archive_test_config.h"',
        "-I" + str(stubs), "-I" + str(main),
        "-Dfsync=quipus_test_fsync", "-include", str(root / "hardware/lantern-firmware/tests/report-cache-host/cache_test_io.h"), "-I" + str(mbed / "include"),
        "-I" + str(mbed / "library"), "-I" + str(json_dir),
        str(root / "hardware/lantern-firmware/tests/report-cache-host/report_cache_test.c"),
        str(main / "quipus_report_cache.c"), str(main / "quipus_archive.c"), str(json_dir / "cJSON.c")]
    command += [str(mbed / "library" / source) for source in sources]
    if os.name == "nt":
        command += ["-include", "io.h"]
    else:
        command += ["-D_DEFAULT_SOURCE", "-lm"]
    command += ["-o", str(program)]
    subprocess.run(command, check=True, cwd=build)
    subprocess.run([str(program)], check=True, cwd=build)
