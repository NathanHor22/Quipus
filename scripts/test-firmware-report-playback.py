"""Run the actual report transport, generation, resume and trusted-clock functions."""
from pathlib import Path
import os
import re
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
source = (root / "hardware/lantern-firmware/main/lantern_network.c").read_text()
zig = root / ".tools/zig/ziglang" / ("zig.exe" if os.name == "nt" else "zig")
compiler = [str(zig), "cc"] if zig.is_file() else [os.environ.get("CC", "cc")]


def function(name):
    match = re.search(r"^(?:static )?[A-Za-z_][A-Za-z_0-9 *]*\b" + name + r"\([^;]*?\) \{", source, re.M)
    if not match:
        raise RuntimeError("Missing production function: " + name)
    end = source.index("\n}", match.end()) + 2
    return source[match.start():end]


def typedef(name):
    match = re.search(r"typedef struct \{[^{}]*\} " + name + ";", source, re.S)
    if not match:
        raise RuntimeError("Missing production type: " + name)
    return match.group()


with tempfile.TemporaryDirectory(prefix="quipus-report-playback-") as folder:
    build = Path(folder)
    constant = re.search(r"^#define RESPONSE_CAPACITY [^\n]+", source, re.M).group()
    prompts = (root / "hardware/lantern-firmware/main/quipus_local_prompts.h").read_text()
    (build / "prompt_enum_under_test.h").write_text(re.search(r"typedef enum \{[^}]*\} quipus_prompt_t;", prompts).group())
    (build / "esp_err.h").write_text("#pragma once\ntypedef int esp_err_t;\n")
    (build / "report_playback_types.h").write_text("\n".join([
        constant, typedef("response_buffer_t"), typedef("audio_response_t")]))
    (build / "report_playback_under_test.c").write_text("\n".join(function(name) for name in [
        "clock_synchronised", "lantern_network_trusted_time", "audio_http_event",
        "lantern_network_interrupt_report", "lantern_network_end_report",
        "abort_report_cache_download", "remember_report_position", "perform_audio_request", "play_briefing_page",
        "lantern_network_cancel_review", "lantern_network_play_briefing",
        "lantern_network_play_cached_report"]))
    binary = build / ("report-playback.exe" if os.name == "nt" else "report-playback")
    subprocess.run(compiler + ["-std=c11", "-O1", "-UNDEBUG", "-Wall", "-Wextra", "-Werror",
        "-I" + str(build), "-I" + str(root / "hardware/lantern-firmware/main"), str(root / "hardware/lantern-firmware/tests/report_playback_test.c"),
        "-o", str(binary)], check=True, cwd=build)
    subprocess.run([str(binary)], check=True, cwd=build)
