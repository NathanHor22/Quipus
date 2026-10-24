#include "quipus_local_inference.h"
#include "sdkconfig.h"

#if CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
#include <cstring>
#include <cstdlib>
#include <new>
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_vad.h"
#include "tensorflow/lite/micro/micro_interpreter.h"
#include "tensorflow/lite/micro/micro_mutable_op_resolver.h"
#include "tensorflow/lite/schema/schema_generated.h"

extern const unsigned char model_start[] asm("_binary_micro_speech_yes_no_tflite_start");
extern const unsigned char frontend_start[] asm("_binary_micro_speech_preprocessor_tflite_start");
extern const unsigned char yes_pcm_start[] asm("_binary_micro_speech_self_test_yes_pcm_start");
extern const unsigned char yes_pcm_end[] asm("_binary_micro_speech_self_test_yes_pcm_end");
extern const unsigned char no_pcm_start[] asm("_binary_micro_speech_self_test_no_pcm_start");
extern const unsigned char no_pcm_end[] asm("_binary_micro_speech_self_test_no_pcm_end");

namespace {
constexpr size_t kClassifierArena = 30U * 1024U;
constexpr size_t kFrontendArena = 16U * 1024U;
constexpr size_t kFeatures = 40U;
constexpr size_t kInputFeatures = QUIPUS_LOCAL_FEATURE_FRAMES * kFeatures;
const char *kTag = "quipus_local";
tflite::MicroMutableOpResolver<4> s_classifier_ops;
tflite::MicroMutableOpResolver<18> s_frontend_ops;
alignas(tflite::MicroInterpreter) unsigned char s_classifier_object[sizeof(tflite::MicroInterpreter)];
alignas(tflite::MicroInterpreter) unsigned char s_frontend_object[sizeof(tflite::MicroInterpreter)];
tflite::MicroInterpreter *s_classifier, *s_frontend;
uint8_t *s_arena;
int8_t *s_features;
bool s_attempted, s_ready;
size_t s_frames;
vad_handle_t s_vad;
int16_t s_vad_frame[QUIPUS_LOCAL_FRAME_STRIDE];

bool register_ops() {
  if (s_classifier_ops.AddDepthwiseConv2D() != kTfLiteOk ||
      s_classifier_ops.AddFullyConnected() != kTfLiteOk ||
      s_classifier_ops.AddSoftmax() != kTfLiteOk ||
      s_classifier_ops.AddReshape() != kTfLiteOk) return false;
#define OP(name) if (s_frontend_ops.Add##name() != kTfLiteOk) return false
  OP(Reshape); OP(Cast); OP(StridedSlice); OP(Concatenation); OP(Mul); OP(Add);
  OP(Div); OP(Minimum); OP(Maximum); OP(Window); OP(FftAutoScale); OP(Rfft);
  OP(Energy); OP(FilterBank); OP(FilterBankSquareRoot);
  OP(FilterBankSpectralSubtraction); OP(PCAN); OP(FilterBankLog);
#undef OP
  return true;
}

bool valid_tensors() {
  const auto *input = s_classifier->input(0), *output = s_classifier->output(0);
  const auto *frame = s_frontend->input(0), *feature = s_frontend->output(0);
  return input && output && frame && feature && input->type == kTfLiteInt8 &&
    input->bytes == kInputFeatures && output->type == kTfLiteInt8 && output->bytes == 4 &&
    output->params.zero_point == -128 && output->params.scale == 1.0f / 256.0f &&
    frame->type == kTfLiteInt16 && frame->bytes == QUIPUS_LOCAL_FRAME_SAMPLES * sizeof(int16_t) &&
    feature->type == kTfLiteInt8 && feature->bytes == kFeatures;
}
}

extern "C" esp_err_t quipus_local_inference_init(void) {
  if (s_ready) return ESP_OK;
  if (s_attempted) return ESP_FAIL;
  s_attempted = true;
  const auto *model = tflite::GetModel(model_start), *frontend = tflite::GetModel(frontend_start);
  if (model->version() != TFLITE_SCHEMA_VERSION || frontend->version() != TFLITE_SCHEMA_VERSION || !register_ops())
    return ESP_ERR_NOT_SUPPORTED;
  s_arena = static_cast<uint8_t *>(heap_caps_aligned_alloc(16,
      kClassifierArena + kFrontendArena + kInputFeatures, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
  if (!s_arena) return ESP_ERR_NO_MEM;
  s_features = reinterpret_cast<int8_t *>(s_arena + kClassifierArena + kFrontendArena);
  s_classifier = new (s_classifier_object) tflite::MicroInterpreter(
      model, s_classifier_ops, s_arena, kClassifierArena);
  s_frontend = new (s_frontend_object) tflite::MicroInterpreter(
      frontend, s_frontend_ops, s_arena + kClassifierArena, kFrontendArena);
  if (s_classifier->AllocateTensors() != kTfLiteOk || s_frontend->AllocateTensors() != kTfLiteOk || !valid_tensors()) {
    s_classifier->~MicroInterpreter(); s_frontend->~MicroInterpreter();
    s_classifier = s_frontend = nullptr;
    free(s_arena); s_arena = nullptr; s_features = nullptr;
    return ESP_FAIL;
  }
  // Create once; missing activity evidence makes live admission UNKNOWN,
  // while the numeric self-test independently verifies the classifier.
  s_vad = vad_create(VAD_MODE_0);
  ESP_LOGI(kTag, "activity VAD %s; mode=0 frame_ms=20",
      s_vad ? "available" : "unavailable");
  s_ready = true;
  quipus_local_inference_reset();
  if (!s_ready) return ESP_FAIL;
  ESP_LOGI(kTag, "local YES/NO evaluation model ready; fixed workspace=%u bytes; acoustic validation required",
      static_cast<unsigned>(kClassifierArena + kFrontendArena + kInputFeatures));
  return ESP_OK;
}

extern "C" esp_err_t quipus_local_inference_self_test(quipus_local_classify_fn classify) {
  constexpr size_t fixture_bytes = QUIPUS_LOCAL_SAMPLE_RATE * sizeof(int16_t);
  if (!s_ready || !classify || static_cast<size_t>(yes_pcm_end - yes_pcm_start) != fixture_bytes ||
      static_cast<size_t>(no_pcm_end - no_pcm_start) != fixture_bytes) return ESP_FAIL;
  auto *samples = static_cast<int16_t *>(heap_caps_aligned_alloc(16,
      QUIPUS_LOCAL_MAX_SAMPLES * sizeof(int16_t), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
  if (!samples) return ESP_ERR_NO_MEM;
  esp_err_t status = ESP_OK;
  for (unsigned word = 0; word < 2; ++word) {
    std::memset(samples, 0, QUIPUS_LOCAL_MAX_SAMPLES * sizeof(int16_t));
    std::memcpy(samples + QUIPUS_LOCAL_SAMPLE_RATE,
                word ? no_pcm_start : yes_pcm_start, fixture_bytes);
    quipus_local_result_t result = {};
    auto expected = word ? QUIPUS_LOCAL_NO : QUIPUS_LOCAL_YES;
    esp_err_t tested = classify(samples, QUIPUS_LOCAL_MAX_SAMPLES, &result);
    bool passed = tested == ESP_OK && result.intent == expected && result.windows == 41;
    ESP_LOGI(kTag, "public fixture self-test %s: decision=%d confidence=%u windows=%u outcome=%s",
        word ? "NO" : "YES", result.intent, result.confidence, result.windows, passed ? "PASS" : "FAIL");
    if (!passed) status = ESP_FAIL;
  }
  volatile int16_t *clear = samples;
  for (size_t i = 0; i < QUIPUS_LOCAL_MAX_SAMPLES; ++i) clear[i] = 0;
  free(samples);
  quipus_local_inference_reset();
  return status;
}

extern "C" void quipus_local_inference_reset(void) {
  s_frames = 0;
  if (s_vad) vad_reset_trigger(s_vad);
  std::memset(s_vad_frame, 0, sizeof(s_vad_frame));
  if (!s_ready) return;
  /* Reset persistent spectral-subtraction noise estimates as well as tensors;
   * a fresh consent turn must not inherit the preceding utterance. */
  if (s_frontend->Reset() != kTfLiteOk || s_classifier->Reset() != kTfLiteOk) {
    s_ready = false;
    return;
  }
  std::memset(s_features, 0, kInputFeatures);
  std::memset(s_classifier->input(0)->data.int8, 0, kInputFeatures);
  std::memset(s_frontend->input(0)->data.i16, 0, QUIPUS_LOCAL_FRAME_SAMPLES * sizeof(int16_t));
}

extern "C" esp_err_t quipus_local_inference_vad_frame(const int16_t *frame, bool *speech) {
  if (!speech || !frame) return ESP_ERR_INVALID_ARG;
  *speech = false;
  if (!s_ready || !s_vad) return ESP_ERR_NOT_SUPPORTED;
  std::memcpy(s_vad_frame, frame, sizeof(s_vad_frame));
  *speech = vad_process(s_vad, s_vad_frame, QUIPUS_LOCAL_SAMPLE_RATE, 20) == VAD_SPEECH;
  std::memset(s_vad_frame, 0, sizeof(s_vad_frame));
  return ESP_OK;
}

extern "C" esp_err_t quipus_local_inference_frame(const int16_t *frame, bool classify,
                                                 uint8_t probabilities[4]) {
  if (!s_ready || !frame || !probabilities) return ESP_ERR_INVALID_STATE;
  std::memcpy(s_frontend->input(0)->data.i16, frame, QUIPUS_LOCAL_FRAME_SAMPLES * sizeof(int16_t));
  if (s_frontend->Invoke() != kTfLiteOk) return ESP_FAIL;
  /* TFLM may reuse input storage after its last consumer. Keep rolling
   * features separate, and refresh the full input before every invocation. */
  auto *features = s_features;
  std::memmove(features, features + kFeatures, kInputFeatures - kFeatures);
  std::memcpy(features + kInputFeatures - kFeatures, s_frontend->output(0)->data.int8, kFeatures);
  ++s_frames;
  if (!classify) return ESP_OK;
  if (s_frames < QUIPUS_LOCAL_FEATURE_FRAMES) return ESP_ERR_INVALID_STATE;
  std::memcpy(s_classifier->input(0)->data.int8, features, kInputFeatures);
  if (s_classifier->Invoke() != kTfLiteOk) return ESP_FAIL;
  for (unsigned i = 0; i < 4; ++i)
    probabilities[i] = static_cast<uint8_t>(static_cast<int>(s_classifier->output(0)->data.int8[i]) + 128);
  return ESP_OK;
}
#else
extern "C" esp_err_t quipus_local_inference_init(void) { return ESP_ERR_NOT_SUPPORTED; }
extern "C" esp_err_t quipus_local_inference_self_test(quipus_local_classify_fn) { return ESP_ERR_NOT_SUPPORTED; }
extern "C" void quipus_local_inference_reset(void) {}
extern "C" esp_err_t quipus_local_inference_vad_frame(const int16_t *, bool *speech) {
  if (speech) *speech = false;
  return ESP_ERR_NOT_SUPPORTED;
}
extern "C" esp_err_t quipus_local_inference_frame(const int16_t *, bool, uint8_t[4]) {
  return ESP_ERR_NOT_SUPPORTED;
}
#endif
