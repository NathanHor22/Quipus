# Preserve the known-working backend unless this bench-only option is explicit.
set(quipus_local_requires)
set(quipus_local_models)
set(quipus_local_sources "quipus_local_inference.cc" "quipus_local_recognizer.c")
if(CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154)
  list(APPEND quipus_local_requires espressif__esp-tflite-micro)
  if(CONFIG_QUIPUS_EXPERIMENTAL_OFFLINE_DSCNN)
    set(quipus_local_sources
      "quipus_local_inference_dscnn.cc"
      "quipus_local_recognizer_dscnn.c"
      "quipus_dscnn.cc"
      "quipus_mfcc.c")
    list(APPEND quipus_local_models
      "assets/kws_ref_model.tflite"
      "assets/micro_speech_self_test_yes.pcm"
      "assets/kws_self_test_no.pcm")
  else()
    list(APPEND quipus_local_models
      "assets/micro_speech_yes_no.tflite"
      "assets/micro_speech_preprocessor.tflite"
      "assets/micro_speech_self_test_yes.pcm"
      "assets/micro_speech_self_test_no.pcm")
  endif()
endif()

idf_component_register(
  SRCS
    "app_main.c"
    "freertos_compat.c"
    "lantern_agora.c"
    "lantern_audio.c"
    "quipus_barge_in.c"
    "lantern_board.c"
    "lantern_board_io.c"
    "quipus_codec_control.c"
    "lantern_display.c"
    "lantern_network.c"
    "lantern_bluetooth.c"
    "quipus_ble_transfer.c"
    "quipus_local_prompts.c"
    "quipus_adpcm.c"
    ${quipus_local_sources}
    "quipus_network_policy.c"
    "quipus_setup_form.c"
    "quipus_setup_password.c"
    "quipus_phone_audio.c"
    "quipus_archive.c"
    "quipus_report_cache.c"
    "quipus_usb_protocol.c"
    "lantern_sd.c"
    "lantern_storage.c"
    "lantern_transcript.c"
    "lantern_wake.c"
  EMBED_FILES
    ${quipus_local_models}
    "assets/consent_request.adpcm"
    "assets/error_help.adpcm"
    "assets/recording_uploading.adpcm"
    "assets/recording_uploaded.adpcm"
    "assets/recording_saved_offline.adpcm"
    "assets/listening.adpcm"
    "assets/command_retry.adpcm"
    "assets/command_unclear.adpcm"
    "assets/voice_unavailable.adpcm"
    "assets/sd_failure.adpcm"
    "assets/connection_lost_recording.adpcm"
    "assets/upload_delayed.adpcm"
    "assets/consent_retry.adpcm"
    "assets/consent_refused.adpcm"
    "assets/meeting_processing.adpcm"
    "assets/report_done.adpcm"
    "assets/network_required.adpcm"
    "assets/recovery_listening.adpcm"
    "assets/short_recording_skipped.adpcm"
    "assets/offline_record_choice.adpcm"
    "assets/offline_report_choice.adpcm"
    "assets/recording_started.adpcm"
    "assets/report_offline.adpcm"
    "assets/cached_report.adpcm"
    "assets/no_cached_report.adpcm"
  INCLUDE_DIRS "."
  REQUIRES
    ${quipus_local_requires}
    agora_iot_sdk
    bt
    app_update
    bootloader_support
    driver
    esp_adc
    esp_event
    esp_http_client
    esp_http_server
    esp_lcd
    esp_netif
    esp_timer
    fatfs
    esp_wifi
    espressif__esp-sr
    espressif__esp_codec_dev
    json
    mbedtls
    nvs_flash
    sdmmc
)

target_link_libraries(${COMPONENT_LIB} INTERFACE "-u xTaskCreateRestrictedPinnedToCore")

if(CONFIG_QUIPUS_EXPERIMENTAL_OFFLINE_DSCNN)
  set_source_files_properties(quipus_mfcc.c PROPERTIES
    COMPILE_OPTIONS "-ffp-contract=off;-fno-fast-math")
endif()
