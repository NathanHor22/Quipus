#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

typedef void (*lantern_audio_frame_callback_t)(const int16_t *samples,
                                               size_t count);

esp_err_t lantern_audio_init(void);
// 0 mutes speaker output; 100 retains the codec's configured maximum.
// The current value is kept until restart; capture gain is unchanged.
unsigned lantern_audio_volume(void);
unsigned lantern_audio_adjust_volume(int delta);
void lantern_audio_chime(unsigned count);
esp_err_t lantern_audio_pcm_begin(void);
esp_err_t lantern_audio_pcm_write(const void *data, size_t length);
void lantern_audio_pcm_end(void);
void lantern_audio_pcm_cancel(void);
void lantern_audio_set_recording(bool recording);
void lantern_audio_set_streaming(bool streaming);
void lantern_audio_set_frame_callback(lantern_audio_frame_callback_t callback);
void lantern_audio_set_monitor_callback(
    lantern_audio_frame_callback_t callback);
void lantern_audio_set_archive_callback(
    lantern_audio_frame_callback_t callback);
bool lantern_audio_is_recording(void);
bool lantern_audio_is_speaker_active(void);
uint32_t lantern_audio_level(void);
size_t lantern_audio_buffered_samples(void);
unsigned lantern_audio_buffered_seconds(void);
size_t lantern_audio_copy_samples(int16_t *destination, size_t offset,
                                  size_t capacity);
unsigned lantern_audio_play_latest(unsigned max_seconds);

// Idle-only privacy cleanup during verified ownership transfer.
void lantern_audio_clear_private_buffer(void);
