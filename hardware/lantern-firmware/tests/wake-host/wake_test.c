#include "lantern_wake.h"
#include "esp_heap_caps.h"
#include "esp_wn_iface.h"
#include "esp_wn_models.h"
#include "model_path.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CHECK(condition) do { if (!(condition)) { \
  fprintf(stderr, "check failed at line %d: %s\n", __LINE__, #condition); \
  exit(1); } } while (0)

static const char *scenario;
static srmodel_list_t models;
static model_iface_data_t model;
static unsigned detect_calls, destroy_calls, deinit_calls;
static bool cancel_during_detect;
static int16_t last_frame[4];
static const int16_t trigger[4] = {1001, 1002, 1003, 1004};
static const int16_t ordinary[4] = {11, 12, 13, 14};

static int matches(const char *value) { return !strcmp(scenario, value); }

void *heap_caps_malloc(size_t size, unsigned caps) {
  CHECK(caps == (MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT));
  CHECK(size == sizeof(last_frame));
  return matches("allocation-failed") ? NULL : malloc(size);
}

srmodel_list_t *esp_srmodel_init(const char *partition) {
  CHECK(!strcmp(partition, "model"));
  return matches("missing-models") ? NULL : &models;
}

char *esp_srmodel_filter(srmodel_list_t *input, const char *prefix, const char *match) {
  CHECK(input == &models);
  CHECK(!strcmp(prefix, ESP_WN_PREFIX));
  CHECK(!strcmp(match, "computer"));
  return matches("missing-name") ? NULL : "wn9_computer";
}

void esp_srmodel_deinit(srmodel_list_t *input) {
  CHECK(input == &models);
  deinit_calls++;
}

static model_iface_data_t *create(const char *name, int mode) {
  CHECK(!strcmp(name, "wn9_computer"));
  CHECK(mode == DET_MODE_90);
  return matches("create-failed") ? NULL : &model;
}

static void destroy(model_iface_data_t *input) {
  CHECK(input == &model);
  destroy_calls++;
}

static int frame_size(model_iface_data_t *input) {
  CHECK(input == &model);
  return matches("bad-frame") ? 0 : 4;
}

static int sample_rate(model_iface_data_t *input) {
  CHECK(input == &model);
  return matches("bad-rate") ? 8000 : 16000;
}

static int channels(model_iface_data_t *input) {
  CHECK(input == &model);
  return matches("bad-channels") ? 2 : 1;
}

static wakenet_state_t detect(model_iface_data_t *input, int16_t *samples) {
  CHECK(input == &model);
  memcpy(last_frame, samples, sizeof(last_frame));
  detect_calls++;
  if (cancel_during_detect) {
    cancel_during_detect = false;
    lantern_wake_set_enabled(false);
    lantern_wake_set_enabled(true);
  }
  return !memcmp(samples, trigger, sizeof(trigger))
    ? WAKENET_DETECTED : WAKENET_NO_DETECT;
}

static const esp_wn_iface_t iface = {
  .create = create, .destroy = destroy, .get_samp_chunksize = frame_size,
  .get_samp_rate = sample_rate, .get_channel_num = channels, .detect = detect,
};

const esp_wn_iface_t *esp_wn_handle_from_name(const char *name) {
  CHECK(!strcmp(name, "wn9_computer"));
  return matches("missing-interface") ? NULL : &iface;
}

static void failed_init(void) {
  esp_err_t expected = matches("missing-models") || matches("missing-name")
    ? ESP_ERR_NOT_FOUND : matches("missing-interface") ? ESP_FAIL :
      matches("create-failed") || matches("allocation-failed")
        ? ESP_ERR_NO_MEM : ESP_ERR_INVALID_SIZE;
  CHECK(lantern_wake_init() == expected);
  CHECK(!lantern_wake_is_available());
  CHECK(!lantern_wake_is_enabled());
  lantern_wake_set_enabled(true);
  CHECK(!lantern_wake_is_enabled());
  lantern_wake_feed(trigger, 4);
  CHECK(detect_calls == 0);
  CHECK(!lantern_wake_take_detection());
  CHECK(deinit_calls == (matches("missing-models") ? 0U : 1U));
  unsigned expected_destroy = matches("bad-frame") || matches("bad-rate") ||
    matches("bad-channels") || matches("allocation-failed") ? 1U : 0U;
  CHECK(destroy_calls == expected_destroy);
}

static void normal_operation(void) {
  CHECK(lantern_wake_init() == ESP_OK);
  CHECK(lantern_wake_is_available());
  CHECK(!lantern_wake_is_enabled());
  lantern_wake_feed(trigger, 4);
  CHECK(detect_calls == 0);
  CHECK(!lantern_wake_take_detection());

  lantern_wake_set_enabled(true);
  CHECK(lantern_wake_is_enabled());
  lantern_wake_feed(NULL, 0);
  lantern_wake_feed(ordinary, 0);
  CHECK(detect_calls == 0);
  lantern_wake_feed(ordinary, 2);
  CHECK(detect_calls == 0);
  // Repeated idle-policy synchronization must retain a partial audio frame.
  lantern_wake_set_enabled(true);
  lantern_wake_feed(ordinary + 2, 2);
  CHECK(detect_calls == 1);
  CHECK(!memcmp(last_frame, ordinary, sizeof(last_frame)));
  CHECK(!lantern_wake_take_detection());

  int16_t two_triggers[8];
  memcpy(two_triggers, trigger, sizeof(trigger));
  memcpy(two_triggers + 4, trigger, sizeof(trigger));
  lantern_wake_feed(two_triggers, 8);
  CHECK(detect_calls == 2);
  CHECK(!lantern_wake_is_enabled());
  // A heartbeat or reconnect can sync idle policy before the control task
  // consumes its event. That sync must neither erase it nor re-enable capture.
  for (unsigned attempt = 0; attempt < 100; attempt++) {
    lantern_wake_set_enabled(true);
    CHECK(!lantern_wake_is_enabled());
    lantern_wake_feed(trigger, 4);
  }
  CHECK(detect_calls == 2);
  CHECK(lantern_wake_take_detection());
  CHECK(!lantern_wake_take_detection());
  CHECK(!lantern_wake_is_enabled());

  lantern_wake_set_enabled(true);
  CHECK(lantern_wake_is_enabled());
  lantern_wake_feed(trigger, 4);
  CHECK(detect_calls == 3);
  // Explicitly leaving idle cancels an outstanding event, unlike an idle sync.
  lantern_wake_set_enabled(false);
  CHECK(!lantern_wake_take_detection());
  CHECK(!lantern_wake_is_enabled());

  // Partial audio from a previous command session must not complete a frame
  // after disable/enable. The next complete frame contains only fresh samples.
  lantern_wake_set_enabled(true);
  lantern_wake_feed(trigger, 2);
  lantern_wake_set_enabled(false);
  lantern_wake_set_enabled(true);
  lantern_wake_feed(ordinary, 2);
  CHECK(detect_calls == 3);
  lantern_wake_feed(ordinary + 2, 2);
  CHECK(detect_calls == 4);
  CHECK(!memcmp(last_frame, ordinary, sizeof(last_frame)));
  for (unsigned cycle = 0; cycle < 50; cycle++) {
    lantern_wake_feed(trigger, 4);
    CHECK(!lantern_wake_is_enabled());
    CHECK(lantern_wake_take_detection());
    CHECK(!lantern_wake_take_detection());
    lantern_wake_set_enabled(true);
    CHECK(lantern_wake_is_enabled());
  }
  CHECK(detect_calls == 54);
  // Cancellation while the model runs must discard that generation's result.
  cancel_during_detect = true;
  lantern_wake_feed(trigger, 4);
  CHECK(!lantern_wake_take_detection());
  CHECK(lantern_wake_is_enabled());
  lantern_wake_feed(trigger, 4);
  CHECK(lantern_wake_take_detection());
  lantern_wake_diagnostics_t diagnostics;
  lantern_wake_get_diagnostics(&diagnostics);
  CHECK(diagnostics.frames == detect_calls);
  CHECK(diagnostics.activations == 53);
  CHECK(diagnostics.consumed == 52);
}

int main(int argc, char **argv) {
  CHECK(argc == 2);
  scenario = argv[1];
  if (matches("normal")) normal_operation();
  else failed_init();
  printf("PASS: WakeNet wrapper %s\n", scenario);
  return 0;
}
