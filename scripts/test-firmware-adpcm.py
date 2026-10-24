"""Compare the actual bounded C decoder with Python3.11 audioop golden PCM/state.

Requires Python<=3.12 with audioop; no packages, hardware or network access.
"""
from pathlib import Path
import audioop
import math
import os
import random
import struct
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
main = root / "hardware/lantern-firmware/main"
zig = root / ".tools/zig/ziglang" / ("zig.exe" if os.name == "nt" else "zig")
compiler = [str(zig), "cc"] if zig.is_file() else [os.environ.get("CC", "cc")]
rng = random.Random(20261024)
with tempfile.TemporaryDirectory(prefix="quipus-adpcm-") as folder:
    build = Path(folder)
    binary = build / ("adpcm.exe" if os.name == "nt" else "adpcm")
    subprocess.run(compiler + ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-I" + str(main),
        str(root / "hardware/lantern-firmware/tests/adpcm-host/adpcm_test.c"),
        str(main / "quipus_adpcm.c"), "-o", str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
    waveforms = [[0] * 2048, [32767, -32768] * 2048,
        [int(30000 * math.sin(i * .061)) for i in range(6000)],
        [rng.randrange(-32768, 32768) for _ in range(10000)]]
    encoded = [audioop.lin2adpcm(struct.pack("<" + "h" * len(pcm), *pcm), 2, None)[0] for pcm in waveforms]
    encoded += [bytes(range(256)) * 4, bytes([0x77]) * 2000, bytes([0xFF]) * 2000, rng.randbytes(10000)]
    checked = 0
    for data in encoded:
        for initial in [(0,0), (32767,88), (-32768,88), (73,12)]:
            for chunk in [1,7,511,512]:
                (build / "input.adpcm").write_bytes(data)
                result = subprocess.run([str(binary), str(build / "input.adpcm"), str(build / "output.pcm"),
                    str(initial[0]), str(initial[1]), str(chunk), "0"], check=True, capture_output=True, text=True)
                expected, state = audioop.adpcm2lin(data, 2, initial)
                assert (build / "output.pcm").read_bytes() == expected
                assert tuple(map(int, result.stdout.split())) == state
                checked += 1
    # Reset each independently encoded clip, rather than carrying old predictor.
    data = rng.randbytes(2048); (build / "input.adpcm").write_bytes(data)
    result = subprocess.run([str(binary), str(build / "input.adpcm"), str(build / "output.pcm"), "32767", "88", "512", "1"], check=True, capture_output=True, text=True)
    expected = b""; state = None
    for start in range(0, len(data), 512):
        pcm, state = audioop.adpcm2lin(data[start:start+512], 2, None); expected += pcm
    assert (build / "output.pcm").read_bytes() == expected
    assert tuple(map(int, result.stdout.split())) == state
    print(f"ADPCM production decoder matches Python audioop in every sample/final state: {checked + 1} golden/random/chunked/clipping/reset cases.")
