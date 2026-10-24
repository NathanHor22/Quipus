"""Fault-inject actual board speaker diagnostics without firmware builds or hardware.

Extracts production function bodies verbatim; only GPIO/register transport is
mocked. Success proves bounded control behavior, not physical speaker audibility.
"""
from pathlib import Path
import argparse
import os
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT / "hardware/lantern-firmware/main"
HOST = ROOT / "hardware/lantern-firmware/tests/speaker-output-host"


def functions(source, name):
    found = []
    for match in re.finditer(r"^(?:static )?[A-Za-z_][A-Za-z_0-9 *]*\b" + re.escape(name)
                             + r"\([^;]*?\)\s*\{", source, re.M):
        opening = source.index("{", match.start())
        depth, index, quote, comment = 1, opening + 1, None, None
        while depth:
            char, pair = source[index], source[index:index + 2]
            if comment == "line":
                if char == "\n":
                    comment = None
            elif comment == "block":
                if pair == "*/":
                    comment = None
                    index += 1
            elif quote:
                if char == chr(92):
                    index += 1
                elif char == quote:
                    quote = None
            elif pair == "//":
                comment = "line"
                index += 1
            elif pair == "/*":
                comment = "block"
                index += 1
            elif char in ('"', "'"):
                quote = char
            elif char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
            index += 1
        found.append(source[match.start():index])
    if not found:
        raise RuntimeError("Missing production function: " + name)
    return found


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--compiler", help="Path to an existing Zig executable")
    parser.add_argument("--idf-path", type=Path, default=Path(os.environ.get("IDF_PATH", ROOT / ".tools/esp-idf")),
                        help="Existing pinned ESP-IDF checkout for actual S3 register headers")
    args = parser.parse_args()
    if not (args.idf_path / "components/soc/esp32s3/include/soc/i2s_reg.h").is_file():
        parser.error("Point --idf-path or IDF_PATH at the existing ESP-IDF checkout; no downloads are performed")
    zig = Path(args.compiler) if args.compiler else ROOT / ".tools/zig/ziglang" / ("zig.exe" if os.name == "nt" else "zig")
    compiler = [str(zig), "cc"] if zig.is_file() else [os.environ.get("CC", "cc")]
    source = (MAIN / "lantern_board_io.c").read_text(encoding="utf-8")
    enable = functions(source, "lantern_board_speaker_enable")
    probe = functions(source, "lantern_board_speaker_probe")
    prepare = functions(source, "lantern_board_speaker_prepare_output")
    assert len(enable) == len(probe) == len(prepare) == 2, "Review changed board-profile definitions"
    actual = "\n".join([
        "#if LANTERN_AUDIO_CODEC_ES8311", "#if LANTERN_AUDIO_ADC_ES7210",
        functions(source, "speaker_output_latch")[0],
        functions(source, "speaker_output_enabled")[0], "#endif",
        enable[0], probe[0], prepare[0], "#else", enable[1], probe[1], prepare[1], "#endif\n",
    ])
    with tempfile.TemporaryDirectory(prefix="quipus-speaker-output-") as folder:
        build = Path(folder)
        (build / "output_probe_under_test.c").write_text(actual, encoding="utf-8")
        diagnostic = functions(source, "lantern_board_speaker_startup_diagnostics")
        assert len(diagnostic) == 2
        (build / "startup_diagnostics_under_test.c").write_text(
            "#if LANTERN_AUDIO_CODEC_ES8311\n" + diagnostic[0]
            + "\n#else\n" + diagnostic[1] + "\n#endif\n", encoding="utf-8")
        for codec, adc in ((1, 1), (1, 0), (0, 0)):
            binary = build / (f"speaker-{codec}-{adc}" + (".exe" if os.name == "nt" else ""))
            subprocess.run(compiler + [
                "-std=c11", "-O1", "-UNDEBUG", "-Wall", "-Wextra", "-Werror",
                f"-DLANTERN_AUDIO_CODEC_ES8311={codec}", f"-DLANTERN_AUDIO_ADC_ES7210={adc}",
                "-I" + str(HOST), "-I" + str(MAIN), "-I" + str(build),
                str(HOST / "output_probe_test.c"), "-o", str(binary),
            ], check=True, cwd=build, timeout=60)
            subprocess.run([str(binary)], check=True, cwd=build, timeout=30)
            diagnostic_binary = build / (f"startup-{codec}-{adc}" + (".exe" if os.name == "nt" else ""))
            subprocess.run(compiler + [
                "-std=c11", "-O1", "-UNDEBUG", "-Wall", "-Wextra", "-Werror",
                f"-DLANTERN_AUDIO_CODEC_ES8311={codec}", f"-DLANTERN_AUDIO_ADC_ES7210={adc}",
                "-DCONFIG_IDF_TARGET_ESP32S3=1",
                "-I" + str(HOST), "-I" + str(MAIN), "-I" + str(build),
                "-I" + str(args.idf_path / "components/soc/esp32s3/include"),
                "-I" + str(args.idf_path / "components/esp_common/include"),
                str(HOST / "startup_diagnostics_test.c"), "-o", str(diagnostic_binary),
            ], check=True, cwd=build, timeout=60)
            subprocess.run([str(diagnostic_binary)], check=True, cwd=build, timeout=30)


if __name__ == "__main__":
    main()
