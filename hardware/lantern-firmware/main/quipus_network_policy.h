#pragma once

#include <stdbool.h>
#include <stdint.h>

typedef struct {
  bool initialized;
  bool was_connected;
  bool tried_remembered;
  uint64_t disconnected_at_ms;
  uint64_t connect_after_ms;
  uint64_t claim_after_ms;
  uint32_t reconnect_delay_ms;
} quipus_network_policy_t;

typedef struct {
  bool wifi_connected;
  bool has_saved_wifi;
  bool paired;
  bool has_pairing_code;
  bool portal_active;
  bool portal_manual;
  bool connection_busy;
} quipus_network_input_t;

enum {
  QUIPUS_NETWORK_NONE = 0,
  QUIPUS_NETWORK_CONNECT = 1 << 0,
  QUIPUS_NETWORK_TRY_REMEMBERED = 1 << 1,
  QUIPUS_NETWORK_OPEN_PORTAL = 1 << 2,
  QUIPUS_NETWORK_CLAIM = 1 << 3,
  QUIPUS_NETWORK_CLOSE_PORTAL = 1 << 4,
};

// Pure policy: all radio, HTTP and storage work remains on the supervisor task.
// Millisecond deadlines are monotonic and do not depend on the wall clock.
unsigned quipus_network_next(quipus_network_policy_t *policy,
                            const quipus_network_input_t *input,
                            uint64_t now_ms);
