"""Test the actual bounded echo-listener code with AEC/VAD/allocator edge fixtures.
This validates control/data ownership, not real acoustic echo suppression.
"""
from pathlib import Path
import argparse
import os
import subprocess
import tempfile
root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(); parser.add_argument("--compiler"); args=parser.parse_args()
zig=Path(args.compiler) if args.compiler else root/".tools/zig/ziglang"/("zig.exe" if os.name=="nt" else "zig")
compiler=[str(zig),"cc"] if zig.is_file() else [os.environ.get("CC","cc")]
fixture=root/"hardware/lantern-firmware/tests/barge-host"
with tempfile.TemporaryDirectory(prefix="quipus-barge-host-",ignore_cleanup_errors=True) as folder:
 build=Path(folder)
 for original,output in [("quipus_barge_in.c","barge_under_test.c"),("quipus_barge_in.h","quipus_barge_in.h")]:
  (build/output).write_bytes((root/"hardware/lantern-firmware/main"/original).read_bytes())
 for wave in [1,0]:
  binary=build/(f"barge-{wave}.exe" if os.name=="nt" else f"barge-{wave}")
  subprocess.run(compiler+["-std=c11","-O1","-fno-inline","-finstrument-functions","-UNDEBUG","-Wall","-Wextra","-Werror",f"-DCONFIG_LANTERN_BOARD_WAVESHARE_LCD_154={wave}","-I"+str(build),"-I"+str(fixture/"stubs"),str(fixture/"barge_test.c"),"-o",str(binary)],check=True,cwd=build)
  subprocess.run([str(binary)],check=True,cwd=build)
