cmake_minimum_required(VERSION 3.24)
project(quipus_dscnn_host LANGUAGES C CXX)
set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_BUILD_TYPE Release)
set(IDF_VERSION_MAJOR 5)
set(IDF_VERSION_MINOR 2)
set(CONFIG_ESP_TFLITE_MICRO_USE_ESP_NN OFF)
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
# Build the resolved/pinned real managed kernels; no downloaded host substitute.
add_subdirectory("${QUIPUS_SOURCE_ROOT}/hardware/lantern-firmware/managed_components/espressif__esp-tflite-micro" runtime)
target_compile_options(tflm PRIVATE -UESP_NN -Wno-error -Wno-unused-parameter -Wno-unknown-warning-option)
add_executable(dscnn-host "${QUIPUS_FRONTEND_DIR}/quipus_mfcc.c"
  "${QUIPUS_BACKEND_DIR}/quipus_dscnn.cc"
  "${CMAKE_CURRENT_LIST_DIR}/pipeline_test.cc")
target_include_directories(dscnn-host PRIVATE "${QUIPUS_FRONTEND_DIR}" "${QUIPUS_BACKEND_DIR}")
target_compile_options(dscnn-host PRIVATE -UNDEBUG -Wall -Wextra -Werror -Wno-unused-parameter -ffp-contract=off -fno-fast-math)
target_link_libraries(dscnn-host PRIVATE tflm)
if(QUIPUS_WRAPPER AND QUIPUS_POLICY)
  add_executable(dscnn-controller "${QUIPUS_POLICY}" "${QUIPUS_WRAPPER}"
    "${QUIPUS_FRONTEND_DIR}/quipus_mfcc.c" "${QUIPUS_BACKEND_DIR}/quipus_dscnn.cc"
    "${CMAKE_CURRENT_LIST_DIR}/controller_test.cc" "${QUIPUS_MODELS}")
  target_include_directories(dscnn-controller BEFORE PRIVATE "${CMAKE_CURRENT_LIST_DIR}"
    "${QUIPUS_SOURCE_ROOT}/hardware/lantern-firmware/main"
    "${QUIPUS_FRONTEND_DIR}" "${QUIPUS_BACKEND_DIR}")
  # Isolated candidate logging stub discards kTag; this is not a firmware warning waiver.
  set_source_files_properties("${QUIPUS_WRAPPER}" PROPERTIES COMPILE_OPTIONS "-Wno-unused-const-variable")
  target_compile_definitions(dscnn-controller PRIVATE CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154=1 CONFIG_QUIPUS_EXPERIMENTAL_OFFLINE_DSCNN=1)
  target_compile_options(dscnn-controller PRIVATE -UNDEBUG -Wall -Wextra -Werror -Wno-unused-parameter -ffp-contract=off -fno-fast-math)
  target_link_libraries(dscnn-controller PRIVATE tflm)
endif()
