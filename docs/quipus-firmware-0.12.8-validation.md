# Quipus 0.12.8 experimental DS-CNN validation

Status: **0.12.8 experimental is installed and running, but the labelled offline consent usability test failed: a fresh YES did not start recording. Target numerical self-tests passed; field consent reliability has not passed.** The user authorized an experimental board trial with the known-working 0.12.7 rollback preserved. This record does not claim that start-session consent is fixed or that the candidate is ready for distribution.

The 0.12.7 screen and voice were confirmed working by the user; its remaining reported problem was start-session consent. Its rollback package is `hardware/backups/quipus-waveshare-0.12.7-known-working`. Known image identity is 3,303,904 bytes, SHA256 `5009bbc016647f81e4079547ec1b50e260b00224f89fa5ec0545beb8886afc3d`. Existing pairing, archive keys and protected SD recordings must remain intact. This trial does not authorize their erasure.

## Completed target build and verified installation

The full experimental Waveshare build passed. Its application is 3,269,152 bytes, SHA256 `81ee2ef4f8ed9c26efd04476c67c753ea36b9f8a40ac4f71dffeeebd8dda67cf`, with 20.8% of the application slot free. The Windows dependency-path limit was resolved by using the short workspace junction `build-kws` pointing to `build-waveshare-offline-test`; the remaining 104 objects resumed with the same build flags. This is a build-path repair, not a change to the model or admission policy.

The exact experimental package and manifest are preserved at `hardware/backups/quipus-waveshare-0.12.8-experimental`. The known-working 0.12.7 backup remains available with `restore.py` and `restore-from-rom.py`; its stable application binary SHA256 is unchanged. The app-only update on COM5 verified the intended board MAC and passed esptool hash verification. The observed boot ran the experimental application normally. This is an installation and startup pass, not a labelled live consent result.

## Build boundary

`CONFIG_QUIPUS_EXPERIMENTAL_OFFLINE_DSCNN` is default OFF and depends on the Waveshare profile. The experimental configuration selects the separate `quipus_local_recognizer_dscnn.c` and DS-CNN frontend/backend/inference wrapper; it must not overwrite the legacy implementation. Its version is `0.12.8-quipus-experimental`; normal configuration retains 0.12.7. The original button-board and touchscreen paths, original model assets and Computer WakeNet model remain available.

This is a 12-label keyword model, not a language model or arbitrary speech transcriber. The labels are down, go, left, no, off, on, right, stop, up, yes, silence and unknown. NO is index 3; YES is index 9. The adapter maps the remaining command labels to unknown for the existing YES/NO interface. It must never reinterpret a GO prediction as NO to make a fixture pass. Online consent remains cloud-primary; an experimental local score cannot override a connected refusal or failed request. Navigation YES cannot grant recording permission: consent still requires its own fresh response.

## Pinned assets and reference frontend

- `main/assets/kws_ref_model.tflite`: 53,936 bytes, SHA256 `aeea436800704fce17b17292e4412630ad856e9d777c044c64ef748a880bd0ae`, unchanged from MLCommons Tiny commit `0c6a99052cf4bee500cfa47424b8bebde1f69965`, Apache 2.0.
- `main/assets/kws_self_test_no.pcm`: 32,000 bytes, SHA256 `a0375cb5062ef60e7eee88dca932c189f1ac2325b57d77c217b4b5d8432fb61d`, public Speech Commands contributor `0362539c`, CC BY 4.0. Its original 12,288 samples are padded with 3,712 zeros; no gain or speech editing is applied.
- `kws_ref_model.SOURCE.json`, `kws.APACHE-2.0.txt`, `kws_self_test_no.SOURCE.json` and `kws_self_test_no.ATTRIBUTION.txt` preserve URLs, hashes, attribution, changes and all fetched NO candidate scores.

The model requires its own MFCC frontend; it cannot use the previous micro_speech PCAN features. The reference uses 16 kHz input, 480-sample periodic Hann windows at 320-sample steps, 512-point FFT magnitudes, 40 mel bands from 20 to 4,000 Hz, log(mel+1e-6), and 10 MFCC coefficients for each of 49 frames. It follows the pinned positive-maximum normalization and NumPy truncating/modular INT8 conversion. Empty, digital-zero or negative-only inputs cannot be normalized into affirmative evidence. Exact input scale is approximately 0.584702909, zero point 83; output probability is `(signed_score+128)/256`.

The rolling adapter reconstructs exactly 15,840 acquired samples, then applies the upstream zero pad to 16,000 samples; normalization occurs before that pad. It owns no I2S peripheral and allocates no per-window workspace. Target interpreter arena budget is 64 KiB, with separate rolling PCM and MFCC workspace. The target wrapper workspace is 103,632 bytes. Actual startup arena use, observed heap/stack headroom and public-input processing times are recorded below; later runs still require their own measurements. Host reference-kernel allocation is not a target timing or ESP-NN memory measurement.

## Observed experimental target startup

The passive log `.tmp-local-recognizer/new-model/experimental-boot.log` records these actual target results:

- SD mounted at 59,654 MiB, with 24 protected entries, zero queued entries and secure=1. The existing 0.12.7 rollback remains unchanged; no erase or account reset was part of this update.
- Model initialization took 7,510 microseconds. The fixed wrapper workspace is 103,632 bytes; ESP-NN target arena usage was 35,500 of 65,536 bytes. These replace the earlier unmeasured target budget with observed values for this boot.
- Public YES numerical self-test passed all 41 contexts in 1,469 ms; selected public NO passed all 41 contexts in 1,364 ms. Total numerical startup testing took 2,853 ms. The main face completed startup at 4,756 ms and Computer WakeNet was active.
- Observed free internal heap was approximately 123 KB and free PSRAM approximately 5.62 MB. Main task stack headroom was 7,608 bytes. PCM headroom was 5,356 bytes at idle and 3,996 bytes after a prompt; button-task headroom was 10,200 bytes at idle and 7,448 bytes while active.

These are bounded observations from one startup, not minimum memory guarantees or endurance results. The numerical tests bypass the microphone, user accent and room acoustics. Their timings describe processing of the known five-second padded public inputs; they do not remove the live capture duration or establish end-to-end command latency. The later labelled offline NO/YES exchange failed to start recording after YES, as recorded below; these startup checks therefore cannot be used to claim a working consent flow.

## What the host evidence establishes

The independent raw reference used real TensorFlow 2.20 CPU APIs, single-threaded with oneDNN disabled, executing the unchanged pinned upstream preprocessing function. This does not claim bitwise identity with the historical TensorFlow 2.3.1 training environment.

The isolated C frontend matched all 14,700 quantized input bytes across the original 30 valid fixtures, with two safe rejections. Small floating-point differences near synthetic spectral nulls were retained and reported; they did not change those quantized bytes. Native TFLM versus TensorFlow reference outputs differed by one INT8 LSB on one retained gain case, with the same top label. Model scores are not calibrated field accuracy.

The permanent host runner is `python scripts/test-firmware-dscnn.py`. It explicitly targets the actual experimental firmware source and sets the experimental symbol only for that host executable. It never silently falls back to staging. Its compact fixtures preserve public attribution and the independently generated golden input/output hashes; TensorFlow is not required to run the host checks. Until actual experimental files are all present, default mode must fail rather than report production integration success. An explicit `--staged-root` can test isolated candidate files.

Both the frozen staged run and the actual experimental main-source run passed 34 raw waveform cases and 81 API/label/mapping/error checks. The default host command compiled the actual main frontend, backend, experimental wrapper and v2A controller, passing 15 full-response cases and 75 checks, plus allocation/VAD initialization failure checks. Its exact source hashes and output are saved in `.tmp-dscnn-host/experimental-source/results.json`; the source-race guard passed. This host-only result does not select the experimental backend in a normal firmware build. Selected NO, YES followed by late NO, NO followed by YES, and YES followed by a quiet late NO did not authorize recording. Missing activity, the retained GO-misclassified NO, UP, tone/noise and invalid input did not become YES. Caller PCM was unchanged and no response-time heap allocation occurred. These controller checks use synthetic host activity, not ESP-SR VAD or a physical microphone. Positive YES was recorded as an observation while the separate policy/gain study was still in progress; it must not be described as a universal acceptance contract.

## Labelled live result: NO handled, subsequent YES rejected

The user explicitly reported saying **NO, then YES** in the fresh recording-consent exchange. The first response produced nine trusted NO windows, peak 255. The second response produced six trusted YES windows, peak 255, with no trusted NO or possible-NO vote. **Recording did not start.** The board returned to healthy idle. This is a failed usability result for the installed experimental flow, not a successful end-to-end consent test.

The metadata in `.tmp-firmware-face/offline-voice-153632.log` identifies the second rejection in the separate activity-admission gate: background RMS 15 (upper bound 25), 26 ambiguous frames, 36 unexplained frames and `response_truncated=1`. A late unvoiced 20 ms frame at 4,940 ms had RMS 39, while the last raw-VAD speech ended at 2,460 ms. Thus the keyword path contained strong YES evidence, while the conservative activity checks still withheld approval. The metadata does not establish what caused that late acoustic activity; it must not be described as a proven spoken refusal, echo or hardware fault. No raw private microphone PCM was saved for this investigation.

The installed 0.12.8 main source is unchanged after this observation. An isolated v3 proposal removing the energy gate was rejected: it could approve a YES accompanying the retained original NO that this model misclassifies as GO. That known refusal cannot be made safe merely by treating GO as harmless unknown. A separate v4 proposal preserving the 12-label identity and vetoing other known words is under isolated review; it has not been established as a fix or installed. No further model/policy success is claimed here.

This single labelled exchange supports the specific observed NO/YES outcomes and gate diagnosis. It does not measure general accuracy, accent coverage, near-end activity detection or multi-speaker consent safety. Both usability and conservative refusal handling must be demonstrated before broadening acceptance.

## Known limitations and retained failures

The original pinned micro_speech public NO is classified as GO with probability 0.9140625 by the DS-CNN. It remains in the tests with that actual class. A replacement startup NO was explicitly selected from ten distinct public speakers: all ten source files and complete scores are retained in the isolated experiment and the asset source metadata. Both full/990 ms variants of the selected sample produce NO 0.99609375 in TensorFlow and native TFLM. This is a model-specific numerical initialization check, not an unbiased accuracy benchmark or consent authorization.

The experimental v2A attribution rule may group multiple nearby activity fragments inside a trusted YES context. That improves fragmented-word acceptance but can also attribute nearby unknown activity to YES. Two original synthetic negative-policy expectations remain failed in the isolated v2A contract test; they are not deleted or relabelled as successes. A keyword classifier alone cannot establish semantic consent, especially a missed or overlapping refusal. No field reliability, accent coverage, playback-echo immunity or multi-speaker consent claim follows from the host tests.

## Subsequent experimental proposal

A separate [0.12.9 experimental keyword trial](quipus-firmware-0.12.9-validation.md) records the reviewed v4 contract and its retained failures. That later proposal does not change this 0.12.8 failed live result or retroactively establish consent reliability.

## Remaining target evidence

The exact image identity, verified app-only installation, startup numerical tests, WakeNet availability, observed memory/stack headroom and secure SD state are now recorded above. The observed NO-then-YES exchange failed usability and requires a separately reviewed repair. Before reporting a working offline flow, verify physical microphone/output and pairing behavior and collect clearly labelled user outcomes for navigation YES followed by fresh consent NO, NO followed by YES, ordinary YES, quiet/late NO and ambiguous/overlapping speech. Unknown must remain non-authorizing. Do not infer human ground truth from a model score or an unlabelled trace. Record short measured processing times separately from capture duration. A clean boot and one successful exchange do not establish endurance or distribution readiness.
