"""Real DS-CNN host checks; public/generated audio, no device or network access.

Default requires the actual experimental firmware source files. --staged-root explicitly opts into the
isolated candidate; it never silently substitutes staging for missing firmware.
No TensorFlow/NumPy installation or temporary experiment tree is required for
ordinary production-path tests. Resolve existing IDF managed dependencies first.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import wave

ROOT=Path(__file__).resolve().parents[1]
HOST=ROOT/'hardware/lantern-firmware/tests/dscnn-host'
FIXTURES=HOST/'fixtures'
MAIN=ROOT/'hardware/lantern-firmware/main'
MODEL_SHA256='aeea436800704fce17b17292e4412630ad856e9d777c044c64ef748a880bd0ae'

def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def installed_tool(name):
    found=shutil.which(name)
    if found:return found
    suffix='.exe' if os.name=='nt' else ''
    base=Path.home()/'.espressif/tools'/name
    paths=sorted(list(base.glob('*/bin/'+name+suffix))+list(base.glob('*/'+name+suffix)))
    if not paths:raise RuntimeError(f'Install {name} or add it to PATH; this test never downloads tools')
    return str(paths[-1])

def run(command,log=None,timeout=120):
    result=subprocess.run([str(x) for x in command],cwd=ROOT,capture_output=True,text=True,timeout=timeout)
    if log:log.write_text(result.stdout+result.stderr,encoding='utf8')
    if result.returncode:
        raise RuntimeError(f'Command failed ({result.returncode}): '+str(command[0])+'\n'+'\n'.join((result.stdout+result.stderr).splitlines()[-45:]))
    return result.stdout.strip()

def load_sources(manifest):
    sources={}
    for item in manifest['sources']:
        path=(ROOT/item['path']).resolve()
        if not path.is_relative_to(ROOT) or digest(path)!=item['sha256']:
            raise RuntimeError('Public/generated fixture checksum or path mismatch: '+item['id'])
        if path.suffix=='.wav':
            with wave.open(str(path),'rb') as wav:
                assert (wav.getnchannels(),wav.getsampwidth(),wav.getframerate())==(1,2,16000)
                data=wav.readframes(wav.getnframes())
        else:data=path.read_bytes()
        assert len(data)%2==0
        values=list(struct.unpack('<'+'h'*(len(data)//2),data))
        assert len(values)<=16000
        sources[item['id']]=values+[0]*(16000-len(values))
    return sources

def raw_case(name,sources):
    # Recipes are waveform transformations, not a second frontend implementation.
    if name.startswith('selected_no_'):
        return sources['selected_no'][:15840 if name.endswith('crop15840') else 16000]
    if name in ('public_yes','public_no','public_up'):return list(sources[name])
    if name in ('public_yes_990','public_no_990','public_up_990'):return sources[name[:-4]][:15840]
    if '_gain_' in name:
        base,gain=name.split('_gain_');scale=float(gain.replace('_','.'))
        return [round(v*scale) for v in sources[base]]
    if name.startswith('public_yes_shift_'):
        shift=int(name.rsplit('_',1)[1]);return ([0]*shift+sources['public_yes'])[:16000]
    if name=='public_yes_polarity_inverted':return [max(-32768,min(32767,-v)) for v in sources['public_yes']]
    if name=='zero':return [0]*16000
    if name=='negative_only':return [-i for i in range(1,16001)]
    if name=='constant_positive':return [1000]*16000
    if name in ('sine_1000hz','sine_997hz'):
        frequency=1000 if name=='sine_1000hz' else 997
        return [round(6000*math.sin(2*math.pi*frequency*n/16000)) for n in range(16000)]
    if name=='small_noise':return list(sources['generated_noise'])
    if name=='public_yes_quiet_plus_noise':
        return [max(-32768,min(32767,round(v*.03)+n)) for v,n in zip(sources['public_yes'],sources['generated_noise'])]
    if name=='negative_dominant_peak':
        data=list(sources['generated_noise']);data[777]=-32768;data[500]=1000;return data
    if name in ('tail_peak_full16000','tail_peak_crop15840'):
        data=list(sources['generated_noise']);data[15920]=30000
        return data[:15840] if name.endswith('crop15840') else data
    if name.startswith('impulse_'):
        data=[0]*16000;data[int(name.split('_')[1])]=16000;return data
    raise RuntimeError('Unknown frozen raw-fixture recipe: '+name)

def main():
    if not __debug__:raise RuntimeError('Run tests without Python -O; assertions must remain enabled')
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--staged-root',type=Path,help='Explicit isolated candidate root containing frontend-port, inference-port and pinned; no production claim')
    parser.add_argument('--compiler',type=Path,help='Existing Zig compiler; no downloads')
    parser.add_argument('--build-dir',type=Path,help='Optional separate generated native build directory')
    parser.add_argument('--pipeline-only',action='store_true',help='Explicitly skip staged/production wrapper and controller checks; no integration claim')
    parser.add_argument('--policy-source',type=Path,help='Explicit alternate isolated policy source; requires --staged-root')
    parser.add_argument('--fixtures-only',action='store_true',help='Verify public sources, raw recipes and golden hashes without building')
    args=parser.parse_args()
    manifest=json.loads((FIXTURES/'manifest.json').read_text(encoding='utf8'))
    assert manifest['schema']==1 and len(manifest['cases'])==34
    sources=load_sources(manifest)
    mode='isolated-staging' if args.staged_root else 'experimental-source'
    if args.staged_root:
        stage=args.staged_root.resolve()
        frontend=stage/'frontend-port';backend=stage/'inference-port'
        model=stage/'pinned/benchmark/training/keyword_spotting/trained_models/kws_ref_model.tflite'
        policy=args.policy_source.resolve() if args.policy_source else stage/'policy-port/quipus_local_recognizer.c'
        adapter=stage/'device-adapter/quipus_local_inference_dscnn.cc'
    else:
        if args.policy_source:raise RuntimeError('--policy-source requires explicit --staged-root')
        frontend=backend=MAIN;model=MAIN/'assets/kws_ref_model.tflite';policy=MAIN/'quipus_local_recognizer_dscnn.c';adapter=MAIN/'quipus_local_inference_dscnn.cc'
    required=[frontend/'quipus_mfcc.c',frontend/'quipus_mfcc.h',frontend/'quipus_mfcc_tables.inc',backend/'quipus_dscnn.cc',backend/'quipus_dscnn.h',model]
    if not args.pipeline_only:required += [policy,adapter]
    missing=[str(p.relative_to(ROOT)) if p.is_relative_to(ROOT) else str(p) for p in required if not p.is_file()]
    if missing and not args.fixtures_only:
        raise RuntimeError('Selected source is missing (no automatic staging fallback): '+', '.join(missing))
    generated=(args.build_dir.resolve() if args.build_dir else ROOT/'.tmp-dscnn-host'/mode)
    generated.mkdir(parents=True,exist_ok=True)
    cases=[]
    for case in manifest['cases']:
        values=raw_case(case['recipe'],sources)
        assert len(values)==case['input_samples'],case['name']
        raw=struct.pack('<'+'h'*len(values),*values)
        assert hashlib.sha256(raw).hexdigest()==case['raw_sha256'],case['name']+' waveform differs from independent TF reference'
        path=generated/(case['name']+'.pcm');path.write_bytes(raw)
        if case['status']=='ok':
            for file,key,size in [('input.i8','input_sha256',490),('output.tf.i8','output_sha256',12)]:
                golden=FIXTURES/case['name']/file
                assert golden.stat().st_size==size and digest(golden)==case[key],case['name']+'/'+file
        cases.append((case,path))
    print(f'PASS: {len(cases)} reproducible public/generated waveforms and independent golden hashes',flush=True)
    if args.fixtures_only:return
    assert model.stat().st_size==53936 and digest(model)==MODEL_SHA256
    source_hashes={str(p):digest(p) for p in required}
    (generated/'results.json').write_text(json.dumps({'status':'in_progress','scope':mode})+'\n',encoding='utf8')
    runtime=ROOT/'hardware/lantern-firmware/managed_components/espressif__esp-tflite-micro'
    if not (runtime/'CMakeLists.txt').exists():raise RuntimeError('Resolve the pinned IDF managed dependency before native tests')
    zig=args.compiler.resolve() if args.compiler else ROOT/'.tools/zig/ziglang'/('zig.exe' if os.name=='nt' else 'zig')
    cmake,ninja=installed_tool('cmake'),installed_tool('ninja')
    driver=generated/'driver';driver.mkdir(exist_ok=True)
    wrapper='cmake_minimum_required(VERSION 3.24)\n'
    for key,value in [('QUIPUS_SOURCE_ROOT',ROOT),('QUIPUS_FRONTEND_DIR',frontend),('QUIPUS_BACKEND_DIR',backend)]:wrapper+=f'set({key} "{value.as_posix()}")\n'
    if zig.exists():wrapper+=f'set(QUIPUS_ZIG "{zig.as_posix()}")\n'
    if not args.pipeline_only:
        yes_bytes=(generated/'public_yes.pcm').read_bytes()
        no_bytes=(generated/'selected_no_full16000.pcm').read_bytes()
        if not args.staged_root:
            actual_yes=MAIN/'assets/micro_speech_self_test_yes.pcm';actual_no=MAIN/'assets/kws_self_test_no.pcm'
            if not actual_yes.is_file() or not actual_no.is_file():raise RuntimeError('Production startup PCM assets are missing')
            assert actual_yes.read_bytes()==yes_bytes and actual_no.read_bytes()==no_bytes,'Production startup PCM differs from pinned public fixtures'
        symbols=[]
        for symbol,data in [('_binary_kws_ref_model_tflite',model.read_bytes()),('_binary_micro_speech_self_test_yes_pcm',yes_bytes),('_binary_micro_speech_self_test_no_pcm',no_bytes),('_binary_kws_self_test_no_pcm',no_bytes)]:
            symbols.append('alignas(16) extern const unsigned char '+symbol+'_start[]={'+','.join(str(v) for v in data)+'};')
            symbols.append('asm(".globl '+symbol+'_end\\n.set '+symbol+'_end, '+symbol+'_start + '+str(len(data))+'\\n");')
        (generated/'models.cc').write_text('extern "C" {\n'+'\n'.join(symbols)+'\n}\n',encoding='utf8')
        for key,value in [('QUIPUS_WRAPPER',adapter),('QUIPUS_POLICY',policy),('QUIPUS_MODELS',generated/'models.cc')]:wrapper+=f'set({key} "{value.as_posix()}")\n'
    wrapper+=f'include("{(HOST/"native.cmake").as_posix()}")\n'
    (driver/'CMakeLists.txt').write_text(wrapper,encoding='utf8')
    configure=[cmake,'-S',driver,'-B',generated/'build','-G','Ninja','-DCMAKE_MAKE_PROGRAM='+ninja]
    if zig.exists():configure+=['-DCMAKE_C_COMPILER='+zig.as_posix(),'-DCMAKE_C_COMPILER_ARG1=cc','-DCMAKE_CXX_COMPILER='+zig.as_posix(),'-DCMAKE_CXX_COMPILER_ARG1=c++']
    run(configure,generated/'configure.log')
    run([cmake,'--build',generated/'build','--parallel','2'],generated/'build.log',timeout=600)
    executable=generated/'build'/('dscnn-host.exe' if os.name=='nt' else 'dscnn-host')
    print(run([executable,model,'--selftest']),flush=True)
    results=[]
    for case,raw in cases:
        rejected=case['status']!='ok';folder=FIXTURES/case['name']
        output=run([executable,model,'--case',raw,'reject' if rejected else 'ok',folder/'input.i8',folder/'output.tf.i8',case.get('expected_top','none')])
        results.append({'name':case['name'],'status':'pass','details':output})
    controller_output=[]
    if not args.pipeline_only:
        controller=generated/'build'/('dscnn-controller.exe' if os.name=='nt' else 'dscnn-controller')
        for failure in ('--allocation-failure','--vad-failure'):controller_output.append(run([controller,failure]))
        controller_output.append(run([controller,generated/'public_yes.pcm',generated/'selected_no_full16000.pcm',generated/'public_up.pcm',generated/'public_no.pcm']))
        for line in controller_output:print(line,flush=True)
    assert source_hashes=={str(p):digest(p) for p in required},'Candidate source changed during this run; rerun against a frozen source'
    report={'status':'pass','scope':mode,'device_acoustics_validated':False,'controller_host_checks_passed':not args.pipeline_only,'controller_output':controller_output,'model_sha256':digest(model),'source_sha256':{str(p.relative_to(ROOT)) if p.is_relative_to(ROOT) else str(p):digest(p) for p in required if p!=model},'fixture_manifest_sha256':digest(FIXTURES/'manifest.json'),'cases':results,'limits':['Reference kernels on host; ESP-NN target arena/timing require separate tests','Explicitly selected numerical NO fixture, not unbiased accuracy','Host controller uses synthetic activity; actual ESP-SR VAD/capture/field consent remain unvalidated']}
    (generated/'results.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
    print(f'PASS: {len(results)} actual frontend/backend cases; exact490-byte inputs, <=1LSB TF score difference, identical top labels and reset results')
    print('NOT VALIDATED: real ESP-SR activity, physical capture/playback, real-room consent accuracy or target latency.')
    print('Results: '+str(generated/'results.json'))

if __name__=='__main__':
    try:main()
    except (AssertionError,RuntimeError,subprocess.SubprocessError) as error:
        print('FAIL: '+str(error),file=sys.stderr);raise SystemExit(1)
