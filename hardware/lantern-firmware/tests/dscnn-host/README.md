# DS-CNN host validation

Run from the repository root:

```powershell
python scripts/test-firmware-dscnn.py
```

The default builds the actual experimental firmware frontend, backend, inference wrapper and `quipus_local_recognizer_dscnn.c` controller with `CONFIG_QUIPUS_EXPERIMENTAL_OFFLINE_DSCNN=1` for this host executable only. This does not select the experimental backend in a normal firmware build: its Kconfig option remains default OFF. Missing experimental firmware source is an error: the runner never silently selects an experimental implementation. During the isolated evaluation only, use an explicit candidate path:

```powershell
python scripts/test-firmware-dscnn.py --staged-root .tmp-local-recognizer/new-model
python scripts/test-firmware-dscnn.py --fixtures-only
```

Required tools are Python 3.11, CMake, Ninja, a C/C++ compiler (the existing repository Zig is supported), and the firmware's already resolved/pinned `espressif/esp-tflite-micro` managed dependency. Tests do not install software, download data, open USB/serial ports, build firmware, flash a device, or contact a server. TensorFlow and NumPy are not required to run these checks.

The generated native build and concise machine-readable result go under `.tmp-dscnn-host/`. Full compiler output is saved there and only the tail is printed on failure. `--build-dir` can select a separate generated build directory.

The harness compiles actual `quipus_mfcc.c` and `quipus_dscnn.cc` with the real managed reference kernels. It checks 34 frozen raw-audio variants, 32 valid and two safe rejections. For every valid input, all 490 quantized frontend bytes must equal the independently generated TensorFlow golden; model output must retain the same top class and differ by no more than one signed INT8 LSB from TensorFlow 2.20 BUILTIN_REF. That one-LSB bound records the known reference-runtime rounding difference on `public_no_gain_0_3`; it does not permit a class change. Reset must reproduce the complete native output vector exactly.

API tests cover label order, all 12 output classes, unchanged YES/NO probability during four-class mapping, quantization mass validation, absent initialization, malformed model, wrong feature/input lengths, NULL arguments, empty/all-zero/nonpositive audio, nonfinite quantization, cleared failure outputs, reset and arena bounds. Raw recipes cover public YES/NO/UP, gains, alignment shifts, polarity, deterministic quiet noise, quiet speech plus noise, spectral tones, DC, negative peaks, impulse boundaries and a positive peak in the unused final 160 samples.

The actual wrapper/controller also runs 15 five-second response cases: selected NO, the retained GO-misclassified NO, UP, YES then late NO, NO then YES, quiet late NO, quiet NO, absent activity, silence, negative-only input, tone/noise, reset and non-authorizing navigation. Initialization allocation and VAD failures run in separate processes and must leave approval unavailable. Positive YES is retained as an observation until the separate gain/policy study establishes its acceptance contract. No heap allocations or changes to caller PCM are allowed during a response. Synthetic activity is clearly identified in the host shim; it does not emulate ESP-SR VAD. The runner records exact candidate source hashes and fails if they change during the test. Production mode also verifies its real startup PCM assets match the public fixture bytes.

This runner does **not** prove physical audio, ESP-NN target timing, real ESP-SR VAD or field consent accuracy. It must not be used alone to enable recording. Labelled acoustic testing remains necessary. Neither the test harness nor this README supplies a replacement admission policy. `--pipeline-only` explicitly skips wrapper/controller checks and reports that limited scope. An alternate isolated policy may be selected with `--policy-source`, only when `--staged-root` is also present.

## Provenance and retained failures

`fixtures/manifest.json` records every waveform recipe/hash, original source URLs or archive member, source commit, TensorFlow environment, expected feature/output hashes and the complete additional-NO selection results. Only compact raw sources and INT8 golden data are retained here; no training corpus, TensorFlow environment, staged executable, model duplicate or giant stage-tensor tree is copied into the tests.

The goldens were generated with the unchanged `get_preprocess_audio_func` AST from MLCommons Tiny commit `0c6a99052cf4bee500cfa47424b8bebde1f69965`, using real TensorFlow 2.20 CPU operations, single-threaded, oneDNN disabled, with exactly the pinned positive-maximum normalization and NumPy truncating/modular INT8 cast. The isolated reference manifest SHA256 is retained. That environment is not claimed bitwise identical to the upstream historical TensorFlow 2.3.1 training environment.

- Source/model: [MLCommons Tiny pinned keyword-spotting training files](https://github.com/mlcommons/tiny/tree/0c6a99052cf4bee500cfa47424b8bebde1f69965/benchmark/training/keyword_spotting), Apache 2.0 repository license.
- Expected model: 53,936 bytes, SHA256 `aeea436800704fce17b17292e4412630ad856e9d777c044c64ef748a880bd0ae`.
- Public Speech Commands audio: Google and public AIY contributors, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), as stated in Google's [dataset announcement](https://research.google/blog/launching-the-speech-commands-dataset/). See `ATTRIBUTION.md` and fixture metadata for member paths and modifications.

The old pinned public `micro_speech` NO is classified as GO by this model. That failure is intentionally retained with its actual expected class; it is not removed, relabelled or forced to NO. The separate high-scoring NO startup sample is explicitly selected from ten fetched distinct speakers, with all ten scores retained. It is a numerical self-test fixture, not an unbiased accuracy benchmark. A passing host run must not be described as reliable offline consent.
