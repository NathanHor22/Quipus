"""Exercise actual Wave report audio gates with no DSP symbols available."""
from pathlib import Path
import os
import re
import subprocess
import tempfile
root=Path(__file__).resolve().parents[1]
source=(root / "hardware/lantern-firmware/main/lantern_audio.c").read_text()
zig=root / ".tools/zig/ziglang" / ("zig.exe" if os.name=="nt" else "zig")
compiler=[str(zig),"cc"] if zig.is_file() else [os.environ.get("CC","cc")]
def function(name):
    match=re.search(r"^(?:static )?[A-Za-z_][A-Za-z_0-9 *]*\b"+name+r"\([^;]*?\) \{",source,re.M)
    if not match: raise RuntimeError("Missing production audio function: "+name)
    return source[match.start():source.index("\n}",match.end())+2]
# Actual microphone/playback/init paths must use the tested policy boundary,
# not call the experimental detector directly beside it.
for name,call in [("microphone_task","report_listener_feed(converted, samples)"),
                  ("pcm_playback_task","report_listener_reference(reference, sample_count)"),
                  ("lantern_audio_init","report_listener_init()")]:
    body=function(name)
    assert body.count(call)==1 and "quipus_barge_in_" not in body,name+" bypassed report audio admission policy"
with tempfile.TemporaryDirectory(prefix="quipus-audio-admission-") as folder:
    build=Path(folder)
    (build / "audio_admission_under_test.c").write_text("\n".join(function(name) for name in [
        "report_listener_init","report_listener_reference","report_listener_feed",
        "lantern_audio_set_report_listening","lantern_audio_reset_report_listening",
        "lantern_audio_take_speech_interrupt","lantern_audio_capture_interruption"]))
    for wave in [1,0]:
        binary=build / ("audio-admission-"+str(wave)+(".exe" if os.name=="nt" else ""))
        subprocess.run(compiler+["-std=c11","-O1","-UNDEBUG","-Wall","-Wextra","-Werror",
            "-DCONFIG_LANTERN_BOARD_WAVESHARE_LCD_154="+str(wave),"-I"+str(build),
            str(root / "hardware/lantern-firmware/tests/audio_admission_test.c"),"-o",str(binary)],check=True,cwd=build)
        subprocess.run([str(binary)],check=True,cwd=build)
