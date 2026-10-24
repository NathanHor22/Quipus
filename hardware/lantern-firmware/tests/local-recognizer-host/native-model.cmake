cmake_minimum_required(VERSION 3.24)
project(quipus_native_model_test LANGUAGES C CXX)
set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_BUILD_TYPE Release)
set(IDF_VERSION_MAJOR 5)
set(IDF_VERSION_MINOR 2)
set(CONFIG_ESP_TFLITE_MICRO_USE_ESP_NN OFF)
set(quipus_main "${QUIPUS_SOURCE_ROOT}/hardware/lantern-firmware/main")
set(quipus_host "${QUIPUS_SOURCE_ROOT}/hardware/lantern-firmware/tests/local-recognizer-host")

if(QUIPUS_ZIG)
  set(CMAKE_AR "${QUIPUS_ZIG}")
  set(CMAKE_CXX_ARCHIVE_CREATE "<CMAKE_AR> ar qc <TARGET> <LINK_FLAGS> <OBJECTS>")
  set(CMAKE_CXX_ARCHIVE_FINISH "<CMAKE_AR> ranlib <TARGET>")
endif()

function(idf_component_register)
  cmake_parse_arguments(PARSE_ARGV 0 args "" "" "SRCS;INCLUDE_DIRS;REQUIRES;PRIV_REQUIRES")
  add_library(tflm STATIC ${args_SRCS})
  target_include_directories(tflm PUBLIC ${args_INCLUDE_DIRS} "${quipus_host}")
  target_compile_definitions(tflm PUBLIC TF_LITE_STATIC_MEMORY TF_LITE_DISABLE_X86_NEON)
  set(COMPONENT_LIB tflm PARENT_SCOPE)
endfunction()
# Real reference numerical kernels; replace only the ESP-IDF platform wrapper.
add_subdirectory("${QUIPUS_SOURCE_ROOT}/hardware/lantern-firmware/managed_components/espressif__esp-tflite-micro" runtime)
# The release adds ESP_NN and GCC-only warning flags. The native harness uses
# reference kernels, and does not promote unrelated upstream Clang warnings.
target_compile_options(tflm PRIVATE -UESP_NN -Wno-error -Wno-unused-parameter -Wno-unknown-warning-option)
add_executable(local-model "${quipus_main}/quipus_local_recognizer.c"
  "${quipus_main}/quipus_local_inference.cc" "${quipus_host}/native_model_test.cc"
  "${CMAKE_CURRENT_SOURCE_DIR}/models.cc")
target_include_directories(local-model PRIVATE "${quipus_main}" "${quipus_host}")
target_compile_definitions(local-model PRIVATE CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154=1)
target_compile_options(local-model PRIVATE -UNDEBUG)
target_link_libraries(local-model PRIVATE tflm)
