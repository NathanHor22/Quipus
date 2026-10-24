"""Compile actual display rendering and speech mailbox code for all board sizes."""
from pathlib import Path
import argparse
import os
import re
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--compiler", help="Path to Zig; otherwise use local Zig or CC.")
parser.add_argument("--frames", type=Path, help="Optional folder for actual-renderer PPM previews.")
args = parser.parse_args()
zig = Path(args.compiler) if args.compiler else root / ".tools/zig/ziglang" / ("zig.exe" if os.name == "nt" else "zig")
compiler = [str(zig), "cc"] if zig.is_file() else [os.environ.get("CC", "cc")]
source = (root / "hardware/lantern-firmware/main/lantern_display.c").read_text()
header = (root / "hardware/lantern-firmware/main/lantern_display.h").read_text()


def function(name):
    match = re.search(r"^(?:static )?[A-Za-z_][A-Za-z_0-9 *]*\b" + name + r"\([^;]*?\) \{", source, re.M)
    if not match:
        raise RuntimeError("Missing production display function: " + name)
    end = source.index("\n}", match.end()) + 2
    return source[match.start():end]


types = re.findall(r"typedef enum \{.*?\} lantern_[a-z_]+;", header, re.S)
start = source.index("typedef struct {")
end = source.index("} display_update_t;", start) + len("} display_update_t;")
types.append(source[start:end])
start = source.index("static display_update_t s_requested = {")
end = source.index("\n};", start) + len("\n};")
types.append(source[start:end])
bodies = []
for name in ["rgb565", "pixel", "fill", "rect", "outline_rect", "ring", "quipus_mark",
             "glyph", "text_width", "draw_text", "centered_text", "wrapped_text"]:
    body = function(name)
    if name == "pixel":
        body = body.replace("pixel(", "production_pixel(", 1) + "\n" + \
            "static void pixel(int x,int y,uint16_t color) { if(x<0||y<0||x>=LANTERN_DISPLAY_WIDTH||y>=LANTERN_DISPLAY_HEIGHT) ++clipped; production_pixel(x,y,color); }"
    bodies.append(body)
bodies.append("#if CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154")
for name in ["volume_feedback_remaining", "warm_face_visible", "warm_face_animating", "warm_face_eyes", "warm_face_mouth",
             "warm_face_caption", "draw_face_caption", "centered_wrapped_text"]:
    bodies.append(function(name))
bodies.append("#endif")
for name in ["draw_status_bar", "lantern_display_set_volume", "lantern_display_set_status", "lantern_display_set_speech_level", "render_screen"]:
    bodies.append(function(name))
bodies.append("#if CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154\n" + function("display_task") + "\n#endif")

with tempfile.TemporaryDirectory(prefix="quipus-display-host-") as folder:
    build = Path(folder)
    (build / "display_types.h").write_text("\n".join(types))
    (build / "display_under_test.c").write_text("\n".join(bodies))
    for profile, wave, height, battery in [("waveshare", 1, 240, 0), ("waveshare-battery", 1, 240, 1),
                                           ("original", 0, 240, 0), ("touch", 0, 320, 1)]:
        binary = build / (profile + (".exe" if os.name == "nt" else ""))
        subprocess.run(compiler + ["-std=c11", "-O1", "-UNDEBUG", "-Wall", "-Wextra", "-Werror",
            "-DCONFIG_LANTERN_BOARD_WAVESHARE_LCD_154=" + str(wave),
            "-DLANTERN_DISPLAY_HEIGHT=" + str(height), "-DLANTERN_BATTERY_INSTALLED=" + str(battery), "-I" + str(build),
            str(root / "hardware/lantern-firmware/tests/display_renderer_test.c"),
            "-o", str(binary)], check=True, cwd=build)
        command = [str(binary)]
        if args.frames:
            frames = args.frames.resolve() / profile
            frames.mkdir(parents=True, exist_ok=True)
            command.append(str(frames))
        subprocess.run(command, check=True, cwd=build)
