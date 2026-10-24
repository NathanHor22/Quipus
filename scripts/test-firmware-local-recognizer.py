"""Bounded production local recognizer checks.

Default: injected backend policy regression, not measured model accuracy.
--native-model: actual managed numerical kernels and pinned public WAV fixtures.
Neither mode opens a serial port, builds firmware, or validates device acoustics.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT / "hardware/lantern-firmware/main"
HOST = ROOT / "hardware/lantern-firmware/tests/local-recognizer-host"
ASSET_HASHES = {
    "micro_speech_yes_no.tflite": "09e5e2a9dfb2d8ed78802bf18ce297bff54281a66ca18e0c23d69ca14f822a83",
    "micro_speech_preprocessor.tflite": "278949d197166fb8b580c0bdc94e902fb709fec0569dcf5766816b28285440e5",
    "micro_speech_self_test_yes.pcm": "7b243fbf84bd2c8197a63969f225a6a6473547383a49f2d660adc1cd4e4dcaa5",
    "micro_speech_self_test_no.pcm": "9940d53ba4877c8cedc68cc44fb1018fc4f0ebaf8d8221d29608c977b3dc1803",
}


def write_changed(path, value):
    if not path.exists() or path.read_text() != value:
        path.write_text(value)


def installed_tool(name):
    found = shutil.which(name)
    if found:
        return found
    suffix = ".exe" if os.name == "nt" else ""
    tool_root = Path.home() / ".espressif/tools" / name
    candidates = sorted(list(tool_root.glob("*/bin/" + name + suffix)) + list(tool_root.glob("*/" + name + suffix)))
    if not candidates:
        raise RuntimeError(f"Install {name} or add it to PATH; no downloads are performed by this test")
    return str(candidates[-1])


def logged(command, log_path):
    with log_path.open("w") as output:
        result = subprocess.run(command, cwd=ROOT, stdout=output, stderr=subprocess.STDOUT, timeout=600)
    if result.returncode:
        print("\n".join(log_path.read_text(errors="replace").splitlines()[-50:]))
        raise subprocess.CalledProcessError(result.returncode, command)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--compiler", help="Path to the existing Zig executable")
    parser.add_argument("--native-model", action="store_true", help="Build and run actual reference numerical kernels")
    parser.add_argument("--characterize", action="store_true", help="Print a diagnostic gain/DC/timing sweep; not field accuracy")
    parser.add_argument("--unknown-pcm", action="append", default=[], help="Additional 16 kHz mono signed 16-bit negative PCM fixture")
    args = parser.parse_args()
    zig = Path(args.compiler) if args.compiler else ROOT / ".tools/zig/ziglang" / ("zig.exe" if os.name == "nt" else "zig")
    compiler = [str(zig), "cc"] if zig.is_file() else [os.environ.get("CC", "cc")]
    for name, digest in ASSET_HASHES.items():
        assert hashlib.sha256((MAIN / "assets" / name).read_bytes()).hexdigest() == digest, name
    fixture_sources = json.loads((HOST / "fixtures/SOURCE.json").read_text())
    for fixture in fixture_sources:
        assert hashlib.sha256((HOST / "fixtures" / (fixture["label"] + ".wav")).read_bytes()).hexdigest() == fixture["sha256"]
    with tempfile.TemporaryDirectory(prefix="quipus-local-host-") as folder:
        trace = json.loads((HOST / "fixtures/target-tail-noise-20261024.json").read_text())
        assert len(trace["windows"]) == 41
        rows = ["{" + ",".join(str(w[k]) for k in ["end_ms", "rms", "voiced_ms"])
            + ",{" + ",".join(str(v) for v in w["scores"]) + "}}" for w in trace["windows"]]
        (Path(folder) / "target_tail_noise_fixture.h").write_text(
            "typedef struct {uint16_t end_ms,rms,voiced_ms;uint8_t scores[4];} target_window_t;\n"
            + "#define TARGET_TAIL_WINDOWS 41\nstatic const target_window_t target_tail_windows[]={"
            + ",".join(rows) + "};\n")
        binary = Path(folder) / ("local-test.exe" if os.name == "nt" else "local-test")
        subprocess.run(compiler + ["-std=c11", "-O1", "-UNDEBUG", "-Wall", "-Wextra", "-Werror",
            "-I" + str(HOST), "-I" + str(MAIN), "-I" + folder, str(HOST / "recognizer_test.c"), "-o", str(binary)],
            check=True, cwd=folder, timeout=60)
        subprocess.run([str(binary)], check=True, cwd=folder, timeout=30)
    if not args.native_model:
        if args.characterize:
            parser.error("--characterize requires --native-model")
        return
    runtime = ROOT / "hardware/lantern-firmware/managed_components/espressif__esp-tflite-micro"
    if not (runtime / "CMakeLists.txt").is_file():
        raise RuntimeError("Resolve the firmware's pinned IDF managed dependencies before --native-model")
    native = ROOT / ".tmp-local-recognizer/native"
    native.mkdir(parents=True, exist_ok=True)
    wrapper = 'cmake_minimum_required(VERSION 3.24)\nset(QUIPUS_SOURCE_ROOT "' + ROOT.as_posix() + '")\n'
    if zig.is_file():
        wrapper += 'set(QUIPUS_ZIG "' + zig.as_posix() + '")\n'
    wrapper += 'include("' + (HOST / "native-model.cmake").as_posix() + '")\n'
    write_changed(native / "CMakeLists.txt", wrapper)
    models = []
    for name in ASSET_HASHES:
        symbol = "_binary_" + name.replace(".", "_") + "_start"
        values = ",".join(str(value) for value in (MAIN / "assets" / name).read_bytes())
        models.append("alignas(16) extern const unsigned char " + symbol + "[]={" + values + "};")
        if name.endswith(".pcm"):
            end = symbol.removesuffix("_start") + "_end"
            size = (MAIN / "assets" / name).stat().st_size
            models.append('asm(".globl ' + end + r'\n.set ' + end + ', ' + symbol + ' + ' + str(size) + r'\n");')
    write_changed(native / "models.cc", "\n".join(models) + "\n")
    cmake, ninja = installed_tool("cmake"), installed_tool("ninja")
    configure = [cmake, "-S", str(native), "-B", str(native / "build"), "-G", "Ninja", "-DCMAKE_MAKE_PROGRAM=" + ninja]
    if zig.is_file():
        configure += ["-DCMAKE_C_COMPILER=" + str(zig), "-DCMAKE_C_COMPILER_ARG1=cc",
            "-DCMAKE_CXX_COMPILER=" + str(zig), "-DCMAKE_CXX_COMPILER_ARG1=c++"]
    logged(configure, native / "configure.log")
    logged([cmake, "--build", str(native / "build"), "--parallel", "2"], native / "build.log")
    binary = native / "build" / ("local-model.exe" if os.name == "nt" else "local-model")
    subprocess.run([str(binary), str(HOST / "fixtures/yes.wav"), str(HOST / "fixtures/no.wav")]
        + [str(Path(path).resolve()) for path in args.unknown_pcm]
        + (["--characterize"] if args.characterize else []), check=True, cwd=ROOT, timeout=60)


if __name__ == "__main__":
    main()
