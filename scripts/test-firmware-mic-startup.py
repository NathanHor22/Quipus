"""Run actual startup-only ADC validation/recovery with bounded I2S/codec faults."""
from pathlib import Path
import os
import re
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
source = (root / "hardware/lantern-firmware/main/lantern_board_io.c").read_text()
zig = root / ".tools/zig/ziglang" / ("zig.exe" if os.name == "nt" else "zig")
compiler = [str(zig), "cc"] if zig.is_file() else [os.environ.get("CC", "cc")]
bodies=[]
for name in ["microphone_startup_pcm", "validate_microphone_startup"]:
    match=re.search(r"^static [A-Za-z_][A-Za-z_0-9 *]*\b"+name+r"\([^;]*?\) \{",source,re.M)
    if not match:
        raise RuntimeError("Missing actual ADC startup function "+name)
    bodies.append(source[match.start():source.index("\n}",match.end())+2])
with tempfile.TemporaryDirectory(prefix="quipus-mic-startup-") as folder:
    build=Path(folder)
    (build/"mic_startup_under_test.c").write_text("\n".join(bodies))
    for ticks in (1000,100):
        binary=build/("mic-startup-"+str(ticks)+(".exe" if os.name=="nt" else ""))
        subprocess.run(compiler+["-std=c11","-O1","-UNDEBUG","-Wall","-Wextra","-Werror",
            "-DTEST_TICK_HZ="+str(ticks),"-I"+str(build),
            str(root/"hardware/lantern-firmware/tests/mic_startup_test.c"),"-o",str(binary)],check=True,cwd=build)
        subprocess.run([str(binary)],check=True,cwd=build)

# Exercise the actual failure branch and stable fault loop for every input profile.
controller=(root/"hardware/lantern-firmware/main/app_main.c").read_text()
match=re.search(r"^static void audio_startup_fault\([^;]*?\) \{",controller,re.M)
if not match:
    raise RuntimeError("Missing stable audio startup fault handler")
fault=controller[match.start():controller.index("\n}",match.end())+2]
branch=re.search(r"  esp_err_t audio_result = lantern_audio_init\(\);\n  if \(audio_result != ESP_OK\) \{\n    audio_startup_fault\(audio_result\);\n    return;\n  \}",controller)
if not branch:
    raise RuntimeError("Review actual audio admission branch: it must enter stable fault handling")
with tempfile.TemporaryDirectory(prefix="quipus-audio-boot-fault-") as folder:
    build=Path(folder)
    power_match=re.search(r"^static void power_off_safely\([^;]*?\) \{",controller,re.M)
    power=controller[power_match.start():controller.index("\n}",power_match.end())+2]
    (build/"audio_fault_under_test.c").write_text("#if TEST_WAVE\n"+power+"\n#endif\n"+fault+"\nstatic void actual_audio_boot_branch(void) {\n"+branch.group()+"\n++normal_startups;\n}\n")
    for wave,touch in ((1,0),(0,0),(0,1)):
        binary=build/(f"audio-fault-{wave}-{touch}"+(".exe" if os.name=="nt" else ""))
        # The harness longjmps out of production handlers that never return, so
        # locals in those abandoned frames are never read again.
        subprocess.run(compiler+["-std=c11","-O1","-UNDEBUG","-Wall","-Wextra","-Werror","-Wno-unknown-warning-option","-Wno-clobbered",
            f"-DTEST_WAVE={wave}",f"-DTEST_TOUCH={touch}","-I"+str(build),
            "-I"+str(root/"hardware/lantern-firmware/main"),
            str(root/"hardware/lantern-firmware/tests/audio_startup_fault_test.c"),"-o",str(binary)],check=True,cwd=build)
        subprocess.run([str(binary)],check=True,cwd=build)
