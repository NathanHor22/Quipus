# Audio fixture attribution

Speech Commands dataset: Google and public contributors via the AIY website.
Dataset announcement: https://research.google/blog/launching-the-speech-commands-dataset/
License: Creative Commons Attribution 4.0 International, https://creativecommons.org/licenses/by/4.0/

Public YES and the original public NO reuse the existing repository WAVs and their `local-recognizer-host/fixtures/SOURCE.json` pinned source URLs and SHA256 values. The new WAV copies are from the official public mini Speech Commands archive:
https://storage.googleapis.com/download.tensorflow.org/data/mini_speech_commands.zip

- `public_up.wav`: `mini_speech_commands/up/0132a06d_nohash_2.wav`; unchanged public source, SHA256 `ad7524a2d2f208e9f16e926b52b194e4e3033ee5e7c59c2f34deb062f665c2a9`.
- `selected_no.wav`: `mini_speech_commands/no/0362539c_nohash_3.wav`; unchanged public source, SHA256 `fb34ed2e2e8bc6b811c3cbb8c2928d2327ff52af88bb9fc15585b12a467cb504`.

The individual contributors are identified by the dataset speaker IDs; no additional identity is inferred. WAV originals are unchanged. Test variants apply explicitly recorded gain, polarity, shifts, truncation or zero padding; derived numerical feature tensors and expected outputs are labelled by exact recipes in the manifest. The selected NO is 12,288 samples zero-padded to 16,000, with a separate 15,840-sample crop. Selection is disclosed and all ten fetched candidate scores are retained in the manifest. This does not measure field accuracy.

`generated_noise.pcm` is project-generated deterministic PCG64 data, seed20261024, uniform signed integers[-25,25]; no recorded person is present. Other synthetic inputs are generated from the documented recipes. No private meeting recordings are used.
