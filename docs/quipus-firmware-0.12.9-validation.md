# Quipus 0.12.9 experimental offline keyword trial

Status: **experimental build, app-only installation and on-device numerical startup tests passed; labelled live consent remains pending.** This is an explicitly approved bench experiment, not a distributed-pilot or reliable consent release. The default firmware remains 0.12.7; the DS-CNN flag stays default OFF. The known-working 0.12.7 rollback and original legacy firmware remain available.

## Why another trial is needed

The installed 0.12.8 exchange failed usability: the user said NO, then YES; its keyword path found both responses, but later unvoiced activity rejected the fresh YES and recording never started. [The 0.12.8 record](quipus-firmware-0.12.8-validation.md) preserves that failure and its startup evidence. Its successful numerical self-tests did not establish a working live consent flow.

The separate v3 proposal removed an energy veto and falsely approved a YES accompanying a public NO that the model calls GO. It was rejected without promotion. Version 0.12.9 uses the reviewed v4 experiment, with the pinned DS-CNN model, frontend and raw 12-label identities retained.

## Explicit experimental contract

Every model context in the complete fresh five-second consent capture is inspected. YES still needs at least two speech-supported trusted windows (score at least 200, margin at least 32). Trusted NO takes priority, and a NO score of at least 128 prevents YES even without raw-VAD speech support. No button, previous menu answer, majority vote or early YES can grant consent.

The backend separately exposes the strongest other trained word: down, go, left, off, on, right, stop or up. A score of at least 128 prevents affirmative admission as lexical ambiguity. A GO prediction stays GO and yields UNKNOWN unless an actual trusted NO takes priority; it is never relabelled NO. The original four-class mapping is unchanged. These auxiliary values clear before every frame/error and at turn reset, and publish only after a valid model output and mapping. Focused host getter tests passed 196 checks.

Initial background verification and raw-VAD capture-edge uncertainty still apply. Later energy, DC and speech-region measurements remain diagnostics and no longer independently veto a recognized YES. This change avoids treating every unvoiced energy fluctuation as unfinished speech, but changes the earlier conservative contract: unknown speech can coexist with recognized YES. **A genuine refusal misclassified as unknown can still be missed.** This is keyword recognition, not proof that every person agreed. Online consent remains cloud-primary; the experimental local path cannot override it.

## Evidence and remaining failures

The actual main-source host suite passed 34 raw waveform cases, 81 API checks, 15 controller response cases/75 checks and initialization-failure checks. Its synthetic host activity is not ESP-SR VAD or a microphone test. The separate v4 model/policy study retained these complete results:

| Public synthetic study | Total cases | NO-bearing cases returning YES |
|---|---:|---:|
| Full-length clips | 899 | 0 |
| Activity-trimmed compact clips | 600 | 2 |

Both remaining false approvals are explicitly retained: `no_02` at gains 0.01 and 0.003, following full-gain YES with the NO starting at 1,920 ms and no compact gap. They are not described as inaudible or removed as outliers. Neither study produced a false YES for a NO-bearing input at gains of at least 0.03; NO-only inputs did not become YES. These selected public/generated tests do not measure general accuracy, speaker diversity or real overlapping refusals. The original public NO misclassified as GO now blocks an accompanying YES as UNKNOWN.

Ten original energy/region-policy expectations still fail across nine scenarios under the new explicit keyword contract. Late unvoiced activity, nearby unrecognized activity, DC drift, region overflow and a separate unknown spoken region can accompany recognized YES. Those failures remain recorded, rather than rewritten as passes. The full results, source hashes and retained failures are in `.tmp-local-recognizer/new-model/policy-port/v4/`; getter lifecycle evidence is in `.tmp-local-recognizer/new-model/v4-backend-check/result.json`. The normal host suite passing does not erase these additional known limitations.

## Completed build and preserved package

The experimental build passed with 19 incremental objects. Application size is 3,270,192 bytes, SHA256 `6ad4b7273611ad03fd6cebe03c513075686671e1874e285d0cdfdd28d15ebe3e`, with approximately 20.8% of the application slot free. The package at `hardware/backups/quipus-waveshare-0.12.9-experimental` contains `manifest.json`, `lantern.bin` and the actual-source `host-results.json`. The auxiliary getter implementation also passed the 196-check host lifecycle test and Xtensa compilation. Host checks alone do not prove live consent behavior.

The guarded app-only update completed on MAC `28:84:85:91:c4:4c`; esptool verified the written application hash. Normal boot, the 240x240 display, mounted SD, pairing, 24 protected entries and an empty upload queue were observed. YES and NO public fixtures each passed all 41 contexts in 1,469 ms and 1,364 ms; the total numerical startup test took 2,853 ms. Bring-up completed at 4,723 ms with Computer WakeNet active. Observed internal free memory remained at least 109,863 bytes and the idle PCM task had 5,356 bytes of unused stack. These are runtime-health measurements, not a labelled microphone result. The boot log and its hash are retained in the 0.12.9 package. The failed 0.12.8 exchange and working 0.12.7 rollback remain distinct historical facts.

## Live acceptance still pending

The exact experimental application SHA256/size is recorded above. Verify the app-only installation and actual startup health before testing. Preserve pairing, archive keys, SD recordings and the exact 0.12.7 rollback. Then obtain clearly labelled fresh NO and YES responses, correction sequences, quiet/late NO and ambiguous speech outcomes. Do not infer human ground truth from a score or invent private audio to reproduce a trace. A passing startup or one successful interaction is insufficient for endurance or release readiness.
