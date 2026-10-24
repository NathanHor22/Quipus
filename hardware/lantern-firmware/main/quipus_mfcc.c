/* Bounded reference implementation of pinned MLCommons Tiny MFCC preprocessing.
 * Original implementation for Quipus. No TensorFlow/runtime dependency here.
 * The generated coefficient include records the actual TensorFlow provenance.
 */
#include "quipus_mfcc.h"

#include <math.h>
#include <limits.h>
#include <string.h>

#include "quipus_mfcc_tables.inc"

_Static_assert(sizeof(float) == 4, "golden contract requires float32");
_Static_assert(QUIPUS_MFCC_FFT_LENGTH == 512, "tables require 512-point FFT");
_Static_assert(QUIPUS_MFCC_FRAMES ==
               1 + (QUIPUS_MFCC_SAMPLES - QUIPUS_MFCC_FRAME_LENGTH) /
                       QUIPUS_MFCC_FRAME_STEP, "frame count mismatch");

static void clear_outputs(float *mfcc, int8_t *quantized) {
    if (mfcc) memset(mfcc, 0, QUIPUS_MFCC_FEATURES * sizeof(*mfcc));
    if (quantized) memset(quantized, 83, QUIPUS_MFCC_FEATURES);
}

quipus_mfcc_status_t quipus_mfcc_quantize(float feature, int8_t *quantized) {
    if (!quantized) return QUIPUS_MFCC_INVALID_ARGUMENT;
    if (!isfinite(feature)) return QUIPUS_MFCC_NONFINITE_RESULT;
    /* Deliberately no rounding, clipping or saturation: upstream NumPy uses
     * array(features / scale + zero_point, dtype=int8). Compute in float32. */
    const float transformed = feature / 0.584702908992767334f + 83.0f;
    if (!isfinite(transformed) || transformed < -2147483648.0f ||
        transformed >= 2147483648.0f)
        return QUIPUS_MFCC_QUANTIZATION_OVERFLOW;
    const int32_t integral = (int32_t)transformed;
    int32_t wrapped = integral % 256;
    if (wrapped < -128) wrapped += 256;
    if (wrapped > 127) wrapped -= 256;
    *quantized = (int8_t)wrapped;
    return QUIPUS_MFCC_OK;
}

/* In-place radix-2 decimation-in-time FFT. Fixed read-only twiddles are
 * cos(-2*pi*k/512),sin(-2*pi*k/512), k=0..255. No sin/cos in the hot path. */
static void fft512(float *real, float *imag) {
    unsigned j = 0;
    for (unsigned i = 1; i < QUIPUS_MFCC_FFT_LENGTH; ++i) {
        unsigned bit = QUIPUS_MFCC_FFT_LENGTH >> 1;
        while (j & bit) { j ^= bit; bit >>= 1; }
        j ^= bit;
        if (i < j) {
            float tmp = real[i]; real[i] = real[j]; real[j] = tmp;
            tmp = imag[i]; imag[i] = imag[j]; imag[j] = tmp;
        }
    }
    for (unsigned length = 2; length <= QUIPUS_MFCC_FFT_LENGTH; length <<= 1) {
        const unsigned half = length >> 1;
        const unsigned twiddle_step = QUIPUS_MFCC_FFT_LENGTH / length;
        for (unsigned block = 0; block < QUIPUS_MFCC_FFT_LENGTH; block += length) {
            for (unsigned k = 0; k < half; ++k) {
                const unsigned twiddle = k * twiddle_step;
                const unsigned upper = block + k;
                const unsigned lower = upper + half;
                const float wr = k_fft_twiddle_real[twiddle];
                const float wi = k_fft_twiddle_imag[twiddle];
                const float tr = wr * real[lower] - wi * imag[lower];
                const float ti = wr * imag[lower] + wi * real[lower];
                const float ar = real[upper], ai = imag[upper];
                real[lower] = ar - tr; imag[lower] = ai - ti;
                real[upper] = ar + tr; imag[upper] = ai + ti;
            }
        }
    }
}

quipus_mfcc_status_t quipus_mfcc_compute(
    quipus_mfcc_workspace_t *workspace, const int16_t *pcm, size_t samples,
    float *mfcc_out, int8_t *quantized_out) {
    return quipus_mfcc_compute_traced(workspace, pcm, samples, mfcc_out,
                                    quantized_out, NULL, NULL);
}

quipus_mfcc_status_t quipus_mfcc_compute_traced(
    quipus_mfcc_workspace_t *workspace, const int16_t *pcm, size_t samples,
    float *mfcc_out, int8_t *quantized_out, quipus_mfcc_trace_fn trace,
    void *trace_context) {
    clear_outputs(mfcc_out, quantized_out);
    if (!workspace || !pcm || !samples || samples > QUIPUS_MFCC_SAMPLES ||
        (!mfcc_out && !quantized_out))
        return QUIPUS_MFCC_INVALID_ARGUMENT;
    int16_t positive_peak = 0;
    for (size_t i = 0; i < samples; ++i)
        if (pcm[i] > positive_peak) positive_peak = pcm[i];
    if (positive_peak <= 0) return QUIPUS_MFCC_NO_POSITIVE_PEAK;
    const float maximum = (float)positive_peak;
    for (size_t frame = 0; frame < QUIPUS_MFCC_FRAMES; ++frame) {
        const size_t start = frame * QUIPUS_MFCC_FRAME_STEP;
        for (size_t i = 0; i < QUIPUS_MFCC_FRAME_LENGTH; ++i) {
            const size_t index = start + i;
            const float normalized = index < samples ? (float)pcm[index] / maximum : 0.0f;
            workspace->fft_real[i] = normalized * k_hann[i];
        }
        memset(workspace->fft_real + QUIPUS_MFCC_FRAME_LENGTH, 0,
               (QUIPUS_MFCC_FFT_LENGTH - QUIPUS_MFCC_FRAME_LENGTH) * sizeof(float));
        memset(workspace->fft_imag, 0, sizeof(workspace->fft_imag));
        if (trace) trace(trace_context, QUIPUS_MFCC_STAGE_WINDOW, frame,
                         workspace->fft_real, QUIPUS_MFCC_FRAME_LENGTH);
        fft512(workspace->fft_real, workspace->fft_imag);
        for (size_t bin = 0; bin < QUIPUS_MFCC_SPECTRUM_BINS; ++bin) {
            const float re = workspace->fft_real[bin], im = workspace->fft_imag[bin];
            workspace->magnitude[bin] = sqrtf(re * re + im * im);
        }
        if (trace) trace(trace_context, QUIPUS_MFCC_STAGE_MAGNITUDE, frame,
                         workspace->magnitude, QUIPUS_MFCC_SPECTRUM_BINS);
        for (size_t mel = 0; mel < QUIPUS_MFCC_MEL_BINS; ++mel) {
            float sum = 0.0f;
            const unsigned first = k_mel_offsets[mel], last = k_mel_offsets[mel + 1];
            for (unsigned entry = first; entry < last; ++entry)
                sum += workspace->magnitude[k_mel_indices[entry]] * k_mel_weights[entry];
            workspace->mel[mel] = sum;
        }
        if (trace) trace(trace_context, QUIPUS_MFCC_STAGE_MEL, frame,
                         workspace->mel, QUIPUS_MFCC_MEL_BINS);
        for (size_t mel = 0; mel < QUIPUS_MFCC_MEL_BINS; ++mel)
            workspace->mel[mel] = logf(workspace->mel[mel] + 1.0e-6f);
        if (trace) trace(trace_context, QUIPUS_MFCC_STAGE_LOG_MEL, frame,
                         workspace->mel, QUIPUS_MFCC_MEL_BINS);
        /* The first ten TF HTK-scaled DCT-II coefficients. Accumulate into
         * the dead first ten real FFT cells; no additional frame allocation. */
        for (size_t coefficient = 0; coefficient < QUIPUS_MFCC_COEFFICIENTS; ++coefficient) {
            float sum = 0.0f;
            for (size_t mel = 0; mel < QUIPUS_MFCC_MEL_BINS; ++mel)
                sum += workspace->mel[mel] * k_dct[coefficient][mel];
            if (!isfinite(sum)) {
                clear_outputs(mfcc_out, quantized_out);
                return QUIPUS_MFCC_NONFINITE_RESULT;
            }
            const size_t feature = frame * QUIPUS_MFCC_COEFFICIENTS + coefficient;
            workspace->fft_real[coefficient] = sum;
            if (mfcc_out) mfcc_out[feature] = sum;
            if (quantized_out) {
                const quipus_mfcc_status_t status = quipus_mfcc_quantize(sum, quantized_out + feature);
                if (status != QUIPUS_MFCC_OK) {
                    clear_outputs(mfcc_out, quantized_out);
                    return status;
                }
            }
        }
        if (trace) trace(trace_context, QUIPUS_MFCC_STAGE_MFCC, frame,
                         workspace->fft_real, QUIPUS_MFCC_COEFFICIENTS);
    }
    return QUIPUS_MFCC_OK;
}
