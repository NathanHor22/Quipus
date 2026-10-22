"""Run board selection and PCM regressions with a native C compiler, no ESP SDK."""
import argparse
import os
from pathlib import Path
import shlex
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
source = root / "hardware/lantern-firmware/main"
tests = source.parent / "tests"
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--compiler", default=os.environ.get("CC", "cc"))
args = parser.parse_args()
compiler = shlex.split(args.compiler)

with tempfile.TemporaryDirectory(prefix="quipus-board-tests-") as temporary:
    build = Path(temporary)
    (build / "driver").mkdir()
    (build / "esp_adc").mkdir()
    (build / "driver/gpio.h").write_text(
        "#pragma once\ntypedef enum { GPIO_NUM_NC = -1,\n" +
        ",\n".join(f"GPIO_NUM_{pin} = {pin}" for pin in range(49)) +
        "\n} gpio_num_t;\n", encoding="utf-8")
    (build / "esp_adc/adc_oneshot.h").write_text(
        "#pragma once\n" + "\n".join(
            f"#define ADC_CHANNEL_{channel} {channel}" for channel in range(10)),
        encoding="utf-8")
    flags = ["-std=c11", "-O1", "-UNDEBUG", "-Wall", "-Wextra", "-Werror",
             "-I", str(build), "-I", str(source)]

    def run(name, files):
        binary = build / (name + (".exe" if os.name == "nt" else ""))
        subprocess.run(compiler + flags + [str(path) for path in files] +
                       ["-o", str(binary)], check=True)
        subprocess.run([str(binary)], check=True)

    run("pcm", [tests / "pcm_channel_test.c"])
    run("volume-controls", [tests / "volume_controls_test.c"])
    run("ble-setup", [tests / "ble_setup_test.c", source / "quipus_ble_transfer.c",
                       source / "quipus_setup_form.c"])
    profiles = ["ZHENGCHEN_M1307", "ES3C28P", "WAVESHARE_LCD_154"]
    for profile in profiles:
        variants = [False, True] if profile == "WAVESHARE_LCD_154" else [False]
        for battery in variants:
            config = f"#define CONFIG_LANTERN_BOARD_{profile} 1\n"
            if battery:
                config += "#define CONFIG_LANTERN_WAVESHARE_BATTERY_INSTALLED 1\n"
            (build / "sdkconfig.h").write_text(config, encoding="utf-8")
            run(profile.lower(), [source / "lantern_board.c",
                                  tests / "board_profile_test.c"])
