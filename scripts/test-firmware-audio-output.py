"""Exercise actual speaker start/stop/chime output with bounded driver faults."""
from pathlib import Path
import os
import re
import subprocess
import tempfile

ROOT=Path(__file__).resolve().parents[1]
SOURCE=(ROOT/'hardware/lantern-firmware/main/lantern_audio.c').read_text()
ZIG=ROOT/'.tools/zig/ziglang'/('zig.exe' if os.name=='nt' else 'zig')
COMPILER=[str(ZIG),'cc'] if ZIG.is_file() else [os.environ.get('CC','cc')]

def function(name):
    match=re.search(r'^(?:static )?[A-Za-z_][A-Za-z_0-9 *]*\b'+name+r'\([^;]*?\) \{',SOURCE,re.M)
    if not match:
        raise RuntimeError('Missing production speaker function '+name)
    return SOURCE[match.start():SOURCE.index('\n}',match.end())+2]

# Retain both real sample widths/channel definitions and profile branches.
start=SOURCE.index('#if LANTERN_AUDIO_SHARED_BUS\ntypedef int16_t i2s_output_sample_t;')
end=SOURCE.index('\nstatic esp_err_t speaker_start_silent',start)
output_types=SOURCE[start:end]
actual='\n'.join([function('lantern_audio_volume'),function('speaker_sample'),output_types,
                  function('speaker_start_silent'),function('speaker_stop_silent'),
                  function('lantern_audio_chime'),function('pcm_playback_task')])
with tempfile.TemporaryDirectory(prefix='quipus-audio-output-') as folder:
    build=Path(folder)
    (build/'audio_output_under_test.c').write_text(actual)
    for wave,shared in ((1,1),(0,1),(0,0)):
        for ticks in (1000,100):
            binary=build/(f'audio-output-{wave}-{shared}-{ticks}'+('.exe' if os.name=='nt' else ''))
            subprocess.run(COMPILER+['-std=c11','-O1','-UNDEBUG','-Wall','-Wextra','-Werror','-Wframe-larger-than=1024',
                f'-DTEST_WAVE={wave}',f'-DTEST_SHARED={shared}',f'-DTEST_TICK_HZ={ticks}',
                '-I'+str(build),'-I'+str(ROOT/'hardware/lantern-firmware/main'),
                str(ROOT/'hardware/lantern-firmware/tests/audio-output-host/audio_output_test.c'),
                '-o',str(binary)],check=True,cwd=build)
            subprocess.run([str(binary)],check=True,cwd=build)
