#include "quipus_network_policy.h"

unsigned quipus_network_next(quipus_network_policy_t *policy,
                            const quipus_network_input_t *input,
                            uint64_t now_ms) {
  if (!policy || !input || input->connection_busy)
    return QUIPUS_NETWORK_NONE;
  if (!policy->initialized) {
    policy->initialized = true;
    policy->disconnected_at_ms = now_ms;
    // The Wi-Fi START event makes the first connection attempt.
    policy->connect_after_ms = now_ms + 3000;
    policy->reconnect_delay_ms = 3000;
  }
  if (input->wifi_connected) {
    policy->was_connected = true;
    policy->tried_remembered = false;
    policy->reconnect_delay_ms = 3000;
    unsigned actions = QUIPUS_NETWORK_NONE;
    if (!input->paired && !input->portal_active)
      actions |= QUIPUS_NETWORK_OPEN_PORTAL;
    if (!input->paired && input->has_pairing_code &&
        now_ms >= policy->claim_after_ms) {
      policy->claim_after_ms = now_ms + 15000;
      actions |= QUIPUS_NETWORK_CLAIM;
    }
    if (input->paired && input->portal_active && !input->portal_manual)
      actions |= QUIPUS_NETWORK_CLOSE_PORTAL;
    return actions;
  }
  if (policy->was_connected) {
    policy->was_connected = false;
    policy->disconnected_at_ms = now_ms;
    policy->connect_after_ms = now_ms + 3000;
    policy->reconnect_delay_ms = 3000;
  }
  if (!input->has_saved_wifi)
    return input->portal_active ? QUIPUS_NETWORK_NONE
                                : QUIPUS_NETWORK_OPEN_PORTAL;
  if (!policy->tried_remembered &&
      now_ms - policy->disconnected_at_ms >= 15000) {
    policy->tried_remembered = true;
    return QUIPUS_NETWORK_TRY_REMEMBERED;
  }
  unsigned actions = QUIPUS_NETWORK_NONE;
  if (policy->tried_remembered && !input->portal_active)
    actions |= QUIPUS_NETWORK_OPEN_PORTAL;
  if (now_ms >= policy->connect_after_ms) {
    actions |= QUIPUS_NETWORK_CONNECT;
    policy->connect_after_ms = now_ms + policy->reconnect_delay_ms;
    if (policy->reconnect_delay_ms < 30000) {
      policy->reconnect_delay_ms *= 2;
      if (policy->reconnect_delay_ms > 30000)
        policy->reconnect_delay_ms = 30000;
    }
  }
  return actions;
}
