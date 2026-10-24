/* Isolated reference frontend; not production firmware. See README.md. */
#ifndef QUIPUS_MFCC_H
#define QUIPUS_MFCC_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

enum {
    QUIPUS_MFCC_SAMPLE_RATE = 16000,
    QUIPUS_MFCC_SAMPLES = 16000,
    QUIPUS_MFCC_FRAME_LENGTH = 480,
    QUIPUS_MFCC_FRAME_STEP = 320,
    QUIPUS_MFCC_FFT_LENGTH = 512,
    QUIPUS_MFCC_SPECTRUM_BINS = 257,
    QUIPUS_MFCC_MEL_BINS = 40,
    QUIPUS_MFCC_COEFFICIENTS = 10,
    QUIPUS_MFCC_FRAMES = 49,
    QUIPUS_MFCC_FEATURES = 490,
};

typedef enum {
    QUIPUS_MFCC_OK = 0,
    QUIPUS_MFCC_INVALID_ARGUMENT,
    QUIPUS_MFCC_NO_POSITIVE_PEAK,
    QUIPUS_MFCC_NONFINITE_RESULT,
    QUIPUS_MFCC_QUANTIZATION_OVERFLOW,
} quipus_mfcc_status_t;

typedef enum {
    QUIPUS_MFCC_STAGE_WINDOW,
    QUIPUS_MFCC_STAGE_MAGNITUDE,
    QUIPUS_MFCC_STAGE_MEL,
    QUIPUS_MFCC_STAGE_LOG_MEL,
    QUIPUS_MFCC_STAGE_MFCC,
    QUIPUS_MFCC_STAGE_COUNT,
} quipus_mfcc_stage_t;

/* Caller-owned and reusable, 5,284 bytes on float32 platforms. One active
 * computation per workspace. PCM, float output, INT8 output and workspace
 * must all be disjoint (outputs are cleared before PCM is read).
 * Tables live in read-only storage; no allocation occurs in this API. */
typedef struct {
    float fft_real[QUIPUS_MFCC_FFT_LENGTH];
    float fft_imag[QUIPUS_MFCC_FFT_LENGTH];
    float magnitude[QUIPUS_MFCC_SPECTRUM_BINS];
    float mel[QUIPUS_MFCC_MEL_BINS];
} quipus_mfcc_workspace_t;

/* Optional synchronous trace for public golden validation. Its data pointer
 * expires on return; NULL disables tracing without allocating any buffers. */
typedef void (*quipus_mfcc_trace_fn)(void *context, quipus_mfcc_stage_t stage,
                                   size_t frame, const float *values,
                                   size_t count);

/* Matches NumPy's finite in-range-to-int32 truncating INT8 cast, including
 * defined modular wrap outside INT8 range. Extreme/nonfinite values fail
 * instead of invoking undefined C float-to-int behavior. This is a model
 * compatibility operation, not an authorization or voice-activity gate. */
quipus_mfcc_status_t quipus_mfcc_quantize(float feature, int8_t *quantized);

/* Matches the pinned upstream positive-maximum normalization, then zero pads
 * clips shorter than 16,000 samples. Rejects empty/oversized clips, all-zero
 * and negative-only input. At least one output is required. Callers MUST NOT
 * run inference on an error. On failure valid output buffers are cleared.
 * The returned 490 features are frame-major [49,10], no extra channel stride.
 * Never enables recording or interprets speaker consent. */
quipus_mfcc_status_t quipus_mfcc_compute(
    quipus_mfcc_workspace_t *workspace, const int16_t *pcm, size_t samples,
    float *mfcc_out, int8_t *quantized_out);

quipus_mfcc_status_t quipus_mfcc_compute_traced(
    quipus_mfcc_workspace_t *workspace, const int16_t *pcm, size_t samples,
    float *mfcc_out, int8_t *quantized_out, quipus_mfcc_trace_fn trace,
    void *trace_context);

#ifdef __cplusplus
}
#endif
#endif
