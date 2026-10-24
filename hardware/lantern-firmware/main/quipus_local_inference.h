#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"
#include "quipus_local_recognizer.h"
#ifdef __cplusplus
extern "C" {
#endif
#define QUIPUS_LOCAL_FRAME_SAMPLES 480U
#define QUIPUS_LOCAL_FRAME_STRIDE 320U
#define QUIPUS_LOCAL_FEATURE_FRAMES 49U
/* Private fixed-memory adapter; one serialized owner is enforced by recognizer. */
esp_err_t quipus_local_inference_init(void);
/* Startup only: public fixture PCM traverses the exact owned production path.
 * Availability must remain false and the owner gate held until this passes. */
typedef esp_err_t (*quipus_local_classify_fn)(const int16_t *, size_t, quipus_local_result_t *);
esp_err_t quipus_local_inference_self_test(quipus_local_classify_fn classify);
void quipus_local_inference_reset(void);
/* Activity evidence: a private copy protects caller PCM from the VAD API. */
esp_err_t quipus_local_inference_vad_frame(const int16_t *frame, bool *speech);
esp_err_t quipus_local_inference_frame(const int16_t *frame, bool classify,
                                     uint8_t probabilities[4]);
/* Experimental DS-CNN only: strongest OTHER trained word in the last valid
 * classified context (raw labels0,1,2,4,5,6,7,8). Does not modify map4 or turn
 * that word into NO. Score0/labelUINT8_MAX means no evidence; both clear before
 * every frame/error and at turn reset. Read only under the serialized owner.
 * The legacy backend/policy does not call or implement these accessors. */
uint8_t quipus_local_inference_other_word_score(void);
uint8_t quipus_local_inference_other_word_label(void);
#ifdef __cplusplus
}
#endif
