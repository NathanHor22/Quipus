#include "quipus_dscnn.h"
#include <cstring>
#include <new>
#include "tensorflow/lite/micro/micro_interpreter.h"
#include "tensorflow/lite/micro/micro_mutable_op_resolver.h"
#include "tensorflow/lite/schema/schema_generated.h"

namespace {
constexpr size_t kModelBytes = 53936;
const char *const kLabels[12] = {
  "down", "go", "left", "no", "off", "on", "right", "stop", "up", "yes", "silence", "unknown"
};
#ifndef ESP_PLATFORM
alignas(16) uint8_t s_host_arena[QUIPUS_DSCNN_ARENA_BYTES];
#endif
uint8_t *s_arena;
alignas(tflite::MicroInterpreter) uint8_t s_object[sizeof(tflite::MicroInterpreter)];
tflite::MicroMutableOpResolver<6> s_ops;
tflite::MicroInterpreter *s_interpreter;
const uint8_t *s_model;
bool s_ops_ready;

bool register_ops() {
  if (s_ops_ready) return true;
  s_ops_ready = s_ops.AddConv2D() == kTfLiteOk &&
    s_ops.AddDepthwiseConv2D() == kTfLiteOk &&
    s_ops.AddAveragePool2D() == kTfLiteOk &&
    s_ops.AddReshape() == kTfLiteOk &&
    s_ops.AddFullyConnected() == kTfLiteOk &&
    s_ops.AddSoftmax() == kTfLiteOk;
  return s_ops_ready;
}
bool valid_tensors() {
  const auto *input = s_interpreter->input(0);
  const auto *output = s_interpreter->output(0);
  return input && output && input->type == kTfLiteInt8 &&
    input->bytes == QUIPUS_DSCNN_FEATURES && input->dims && input->dims->size == 4 &&
    input->dims->data[0] == 1 && input->dims->data[1] == 49 &&
    input->dims->data[2] == 10 && input->dims->data[3] == 1 &&
    input->params.scale == QUIPUS_DSCNN_INPUT_SCALE &&
    input->params.zero_point == QUIPUS_DSCNN_INPUT_ZERO_POINT &&
    output->type == kTfLiteInt8 && output->bytes == QUIPUS_DSCNN_CLASSES &&
    output->dims && output->dims->size == 2 &&
    output->dims->data[0] == 1 && output->dims->data[1] == 12 &&
    output->params.scale == 1.0f / 256.0f && output->params.zero_point == -128;
}
}

extern "C" void quipus_dscnn_close(void) {
  if (s_interpreter) s_interpreter->~MicroInterpreter();
  s_interpreter = nullptr;
  s_model = nullptr;
  if (s_arena) std::memset(s_arena, 0, QUIPUS_DSCNN_ARENA_BYTES);
  s_arena = nullptr;
  std::memset(s_object, 0, sizeof(s_object));
}
extern "C" quipus_dscnn_status_t quipus_dscnn_init(const uint8_t *bytes, size_t count) {
#ifndef ESP_PLATFORM
  return quipus_dscnn_init_with_arena(bytes, count, s_host_arena, sizeof(s_host_arena));
#else
  (void)bytes; (void)count;
  return QUIPUS_DSCNN_INVALID_ARGUMENT;
#endif
}
extern "C" quipus_dscnn_status_t quipus_dscnn_init_with_arena(
    const uint8_t *bytes, size_t count, uint8_t *arena, size_t arena_bytes) {
  if (!bytes || count != kModelBytes || (reinterpret_cast<uintptr_t>(bytes) & 3U) ||
      !arena || arena_bytes < QUIPUS_DSCNN_ARENA_BYTES || (reinterpret_cast<uintptr_t>(arena) & 15U))
    return QUIPUS_DSCNN_INVALID_ARGUMENT;
  const uintptr_t model_begin = reinterpret_cast<uintptr_t>(bytes);
  const uintptr_t arena_begin = reinterpret_cast<uintptr_t>(arena);
  if ((arena_begin >= model_begin && arena_begin - model_begin < count) ||
      (model_begin >= arena_begin && model_begin - arena_begin < QUIPUS_DSCNN_ARENA_BYTES))
    return QUIPUS_DSCNN_INVALID_ARGUMENT;
  if (s_interpreter && s_model == bytes && s_arena == arena) return QUIPUS_DSCNN_OK;
  quipus_dscnn_close();
  flatbuffers::Verifier verifier(bytes, count);
  if (!tflite::VerifyModelBuffer(verifier)) return QUIPUS_DSCNN_INVALID_MODEL;
  const auto *model = tflite::GetModel(bytes);
  if (model->version() != TFLITE_SCHEMA_VERSION || !model->subgraphs() ||
      model->subgraphs()->size() != 1 ||
      !model->subgraphs()->Get(0)->inputs() || !model->subgraphs()->Get(0)->outputs() ||
      model->subgraphs()->Get(0)->inputs()->size() != 1 ||
      model->subgraphs()->Get(0)->outputs()->size() != 1 || !register_ops())
    return QUIPUS_DSCNN_INVALID_MODEL;
  s_arena = arena;
  std::memset(s_arena, 0, QUIPUS_DSCNN_ARENA_BYTES);
  s_interpreter = new (s_object) tflite::MicroInterpreter(
      model, s_ops, s_arena, QUIPUS_DSCNN_ARENA_BYTES);
  if (s_interpreter->AllocateTensors() != kTfLiteOk) {
    quipus_dscnn_close();
    return QUIPUS_DSCNN_ALLOCATION_FAILED;
  }
  if (!valid_tensors()) {
    quipus_dscnn_close();
    return QUIPUS_DSCNN_INVALID_MODEL;
  }
  s_model = bytes;
  return quipus_dscnn_reset();
}
extern "C" quipus_dscnn_status_t quipus_dscnn_reset(void) {
  if (!s_interpreter) return QUIPUS_DSCNN_NOT_READY;
  if (s_interpreter->Reset() != kTfLiteOk) {
    quipus_dscnn_close();
    return QUIPUS_DSCNN_INVOKE_FAILED;
  }
  std::memset(s_interpreter->input(0)->data.int8, QUIPUS_DSCNN_INPUT_ZERO_POINT,
              QUIPUS_DSCNN_FEATURES);
  return QUIPUS_DSCNN_OK;
}
extern "C" quipus_dscnn_status_t quipus_dscnn_predict(const int8_t *features,
                                                        size_t count, int8_t scores[12]) {
  if (!features || !scores || count != QUIPUS_DSCNN_FEATURES) {
    if (scores) std::memset(scores, -128, QUIPUS_DSCNN_CLASSES);
    return QUIPUS_DSCNN_INVALID_ARGUMENT;
  }
  if (!s_interpreter) {
    std::memset(scores, -128, QUIPUS_DSCNN_CLASSES);
    return QUIPUS_DSCNN_NOT_READY;
  }
  /* TFLM reuses tensor memory; always refresh all490 input bytes per context. */
  std::memcpy(s_interpreter->input(0)->data.int8, features, count);
  if (s_interpreter->Invoke() != kTfLiteOk) {
    std::memset(scores, -128, QUIPUS_DSCNN_CLASSES);
    quipus_dscnn_close();
    return QUIPUS_DSCNN_INVOKE_FAILED;
  }
  std::memcpy(scores, s_interpreter->output(0)->data.int8, QUIPUS_DSCNN_CLASSES);
  return QUIPUS_DSCNN_OK;
}
extern "C" size_t quipus_dscnn_arena_used(void) {
  return s_interpreter ? s_interpreter->arena_used_bytes() : 0;
}
extern "C" const char *quipus_dscnn_label(unsigned index) {
  return index < QUIPUS_DSCNN_CLASSES ? kLabels[index] : nullptr;
}
extern "C" quipus_dscnn_status_t quipus_dscnn_map4(const int8_t scores[12], uint8_t mapped[4]) {
  if (mapped) std::memset(mapped, 0, 4);
  if (!scores || !mapped) return QUIPUS_DSCNN_INVALID_ARGUMENT;
  const unsigned silence = int(scores[QUIPUS_DSCNN_SILENCE]) + 128;
  const unsigned yes = int(scores[QUIPUS_DSCNN_YES]) + 128;
  const unsigned no = int(scores[QUIPUS_DSCNN_NO]) + 128;
  const unsigned known = silence + yes + no;
  if (known > 256U) return QUIPUS_DSCNN_INVALID_DISTRIBUTION;
  unsigned unknown = 0;
  for (unsigned i = 0; i < 12; ++i)
    if (i != QUIPUS_DSCNN_SILENCE && i != QUIPUS_DSCNN_YES && i != QUIPUS_DSCNN_NO)
      unknown += int(scores[i]) + 128;
  /* Twelve independently nearest-quantized probabilities can contribute at
   * most12 half-LSB rounding errors around total256. Reject impossible mass;
   * do not clamp gross corruption into a plausible affirmative distribution. */
  const unsigned total = known + unknown;
  if (total < 250U || total > 262U) return QUIPUS_DSCNN_INVALID_DISTRIBUTION;
  const unsigned available = 256U - known;
  if (unknown > available) unknown = available;
  if (unknown > 255U) unknown = 255U;
  mapped[0] = silence; mapped[1] = unknown; mapped[2] = yes; mapped[3] = no;
  return QUIPUS_DSCNN_OK;
}
