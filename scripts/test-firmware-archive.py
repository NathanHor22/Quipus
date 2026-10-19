"""Compile and execute the actual archive C implementation with host-only ESP shims."""
from pathlib import Path
import os
import subprocess
import importlib.util
import wave

root = Path(__file__).resolve().parents[1]
test = root / "hardware/lantern-firmware/tests/archive-host"
mbed = root / ".tools/esp-idf/components/mbedtls/mbedtls"
build = root / ".tools/archive-host"
build.mkdir(parents=True, exist_ok=True)
zig = root / ".tools/zig/ziglang" / ("zig.exe" if os.name == "nt" else "zig")
compiler = [str(zig), "cc"] if zig.exists() else [os.environ.get("CC", "cc")]
program = build / ("archive-test.exe" if os.name == "nt" else "archive-test")
sources = ["aes.c", "gcm.c", "cipher.c", "cipher_wrap.c", "md.c", "sha256.c", "platform_util.c", "platform.c", "constant_time.c"]
command = compiler + ["-std=c11", "-O1", "-g", '-DMBEDTLS_CONFIG_FILE="archive_test_config.h"',
    "-I" + str(test / "stubs"), "-I" + str(root / "hardware/lantern-firmware/main"),
    "-I" + str(mbed / "include"), "-I" + str(mbed / "library"),
    str(test / "archive_test.c"), str(root / "hardware/lantern-firmware/main/quipus_archive.c")]
command += [str(mbed / "library" / source) for source in sources]
if os.name == "nt":
    command += ["-Dfsync=_commit", "-include", "io.h"]
command += ["-o", str(program)]
subprocess.run(command, check=True, cwd=build)
subprocess.run([str(program)], check=True, cwd=build, env={**os.environ, "QUIPUS_ARCHIVE_TEST_KEEP": "1"})
# Verify C-produced containers independently with Python cryptography/OpenSSL.
spec = importlib.util.spec_from_file_location("quipus_recovery", root / "scripts/recover-sd-recording.py")
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)
key_file, output, archive = build / "fixture.key", build / "fixture.wav", build / "archive-test.qpa"
try:
    key_file.write_text(bytes(range(32)).hex(), encoding="ascii")
    if output.exists():
        output.unlink()
    samples, complete = recovery.recover(archive, output, key_file)
    assert samples == 5000 and complete
    with wave.open(str(output), "rb") as audio:
        assert audio.getframerate() == 16000
        assert audio.readframes(5000) == bytes((index * 13 + 7) % 256 for index in range(10000))
    print("Independent Python/OpenSSL recovery matches every original PCM byte.")
finally:
    for fixture in (key_file, output, archive):
        if fixture.exists():
            fixture.unlink()

