"""Verify the installed ADPCM catalog and actual production playback against audioop.

No provider/network/hardware access. Source PCM is optional in CI; --require-sources
also independently re-encodes all original synthesis clips and recomputes SNR.
"""
from pathlib import Path
import argparse
import audioop
import hashlib
import json
import math
import os
import random
import re
import struct
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--compiler", help="Zig path; otherwise local Zig or CC.")
parser.add_argument("--sources", type=Path, default=root / ".tmp-firmware-face/marin-assets")
parser.add_argument("--require-sources", action="store_true", help="Require all25 original synthesis references for independent SNR checks.")
args = parser.parse_args()
zig = Path(args.compiler) if args.compiler else root / ".tools/zig/ziglang" / ("zig.exe" if os.name == "nt" else "zig")
compiler = [str(zig), "cc"] if zig.is_file() else [os.environ.get("CC", "cc")]
main = root / "hardware/lantern-firmware/main"
manifest = json.loads((main / "assets/prompts.json").read_text())
assets = manifest["prompts"]
profile = json.loads((root / "lib/quipus-voice-profile.json").read_text())
catalog = json.loads((root / "lib/quipus-prompt-text.json").read_text())["prompts"]
source = (main / "quipus_local_prompts.c").read_text()
header = (main / "quipus_local_prompts.h").read_text()
cmake = (main / "CMakeLists.txt").read_text()
readme = (main / "assets/README.md").read_text()
assert manifest["profile"] == profile and len(assets) == len(catalog) == 25
assert sum(item["bytes"] for item in assets) <= 1_600_000, "Local voice exceeds flash budget"
assert all(len({i[field] for i in assets}) == 25 for field in ("file", "enum", "symbol"))
enum = re.search(r"typedef enum \{[^}]*\} quipus_prompt_t;", header).group()
assert set(re.findall(r"\bQUIPUS_PROMPT_[A-Z_]+\b", enum)) == {i["enum"] for i in assets} | {"QUIPUS_PROMPT_COUNT"}
assert set(re.findall(r'"assets/([^"/]+\.adpcm)"', cmake)) == {i["file"] for i in assets}
assert "quipus_adpcm.c" in cmake
expected_symbols = {"_binary_" + item["file"].replace(".", "_") + "_" + suffix for item in assets for suffix in ("start", "end")}
assert set(re.findall(r'asm\("([^"]+)"\)', source)) == expected_symbols
assert profile["version"] in (main / "quipus_voice_profile.h").read_text()
assert profile["voice"] in readme and profile["model"] in readme

oracles = []
source_checks = 0
for item, expected in zip(assets, catalog):
    assert all(item.get(k) == value for k, value in expected.items())
    assert item["codec"] == "ima-adpcm4" and item["sample_rate"] == profile["sampleRate"] == 24000
    assert Path(item["file"]).name == item["file"] and item["file"].endswith(".adpcm")
    encoded = (main / "assets" / item["file"]).read_bytes()
    assert 0 < len(encoded) <= 100000 and len(encoded) == item["bytes"]
    assert hashlib.sha256(encoded).hexdigest() == item["sha256"] and item["sha256"] in readme
    decoded, _ = audioop.adpcm2lin(encoded, 2, None)
    assert hashlib.sha256(decoded).hexdigest() == item["decoded_sha256"]
    assert len(decoded) == item["samples"] * 2 == len(encoded) * 4
    assert round(item["samples"] / 24000, 3) == item["seconds"] and .3 < item["seconds"] < 7
    assert max(abs(v[0]) for v in struct.iter_unpack("<h", decoded)) == item["peak"] < 32767
    assert item["peak"] >= 1000 and audioop.rms(decoded, 2) == item["rms"] > 0
    assert math.isfinite(item["snr_db"]) and item["snr_db"] > 18
    reference = args.sources / (item["symbol"] + "-source.pcm")
    if args.require_sources:
        assert reference.is_file(), "Missing SNR source: " + reference.name
    if reference.is_file():
        raw = reference.read_bytes()
        assert raw and len(raw) % 2 == 0 and len(raw) <= 1_440_000
        # Published installer contract: retain100/160ms around 20ms active frames,
        # normalize the clean synthesis peak, and pad only an odd sample count.
        active = [at for at in range(0, len(raw), 960) if audioop.rms(raw[at:at+960], 2) > 160]
        assert active
        raw = raw[max(0, active[0]-4800):min(len(raw), active[-1]+960+7680)]
        raw = audioop.mul(raw, 2, min(2., 24000. / audioop.max(raw, 2)))
        if len(raw) // 2 % 2:
            raw += b"\0\0"
        assert audioop.lin2adpcm(raw, 2, None)[0] == encoded
        residual = audioop.rms(audioop.add(raw, audioop.mul(decoded, 2, -1), 2), 2)
        snr = round(20 * math.log10(max(1, audioop.rms(raw, 2)) / max(1, residual)), 2)
        assert snr == item["snr_db"], (item["symbol"], snr, item["snr_db"])
        source_checks += 1
    oracles.append(decoded)
    for suffix in ("start", "end"):
        symbol = "_binary_" + item["file"].replace(".", "_") + "_" + suffix
        assert re.search(r'\b' + item["symbol"] + '_' + suffix + r'\[\]\s+asm\("' + symbol + r'"\)', source)
    assert re.search(r'\[' + item["enum"] + r'\]\s*=\s*\{\s*' + item["symbol"] + r'_start\s*,\s*' + item["symbol"] + r'_end\s*\}', source)


def function(text, name):
    """Extract verbatim C function using balanced braces, including one-line wrappers."""
    match = re.search(r"^(?:static\s+)?[A-Za-z_][A-Za-z_0-9 *]*\b" + re.escape(name) + r"\([^;{}]*?\)\s*\{", text, re.M)
    assert match, "Missing production function: " + name
    position, depth, quote = match.end(), 1, None
    while depth:
        assert position < len(text), "Unclosed function: " + name
        char = text[position]
        if quote:
            if char == chr(92):
                position += 2
                continue
            if char == quote:
                quote = None
        elif text.startswith("//", position):
            position = text.find("\n", position)
            assert position >= 0
            continue
        elif text.startswith("/*", position):
            position = text.index("*/", position + 2) + 2
            continue
        elif char in (chr(34), chr(39)):
            quote = char
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
        position += 1
    return text[match.start():position]


asset_type = re.search(r"typedef struct \{[^}]*\} prompt_asset_t;", source).group()
asset_catalog = re.search(r"static const prompt_asset_t s_prompt_assets\[QUIPUS_PROMPT_COUNT\]\s*=\s*\{.*?\n};", source, re.S).group()
names = ["play_adpcm_asset", "quipus_play_prompt", "quipus_play_consent_prompt", "quipus_play_error_prompt",
         "quipus_play_uploading_prompt", "quipus_play_uploaded_prompt", "quipus_play_saved_offline_prompt"]
body = "\n".join([asset_type, asset_catalog, *(function(source, name) for name in names)])
# Output chunks are compared to independently decoded actual installed clips.
# No heap APIs are declared in the production body: additions fail -Werror.
harness = r"""
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "quipus_adpcm.h"
typedef int esp_err_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_INVALID_SIZE 2
#define ESP_ERR_TIMEOUT 3
#define ESP_ERR_INVALID_ARG 4
#define LANTERN_TTS_SAMPLE_RATE 24000
PROMPT_ENUM
typedef struct { uint8_t *data; size_t bytes; const char *encoded; const char *oracle; } fixture_t;
FIXTURES
static const fixture_t *active;
static FILE *expected;
static size_t accepted;
static int begin_result, end_result, fail_write, cancel_write, begins, writes, ends, cancels;
static esp_err_t lantern_audio_pcm_begin(void) { ++begins; return begin_result; }
static esp_err_t lantern_audio_pcm_write(const void *data, size_t length) {
  ++writes;
  assert(data && length && length <= 2048 && length % 4 == 0);
  size_t remaining = active->bytes * 4 - accepted;
  assert(length == (remaining < 2048 ? remaining : 2048));
  uint8_t oracle[2048];
  assert(fread(oracle, 1, length, expected) == length && !memcmp(data, oracle, length));
  if (writes == fail_write) return ESP_ERR_TIMEOUT;
  if (writes == cancel_write) return ESP_FAIL;
  accepted += length;
  return ESP_OK;
}
static void lantern_audio_pcm_cancel(void) { ++cancels; }
static esp_err_t lantern_audio_pcm_end(void) { ++ends; return end_result; }
PRODUCTION_BODY
static void reset(const fixture_t *fixture) {
  if (expected) fclose(expected);
  active = fixture; expected = fopen(fixture->oracle, "rb"); assert(expected);
  accepted = 0; begin_result = end_result = fail_write = cancel_write = begins = writes = ends = cancels = 0;
}
static void success(unsigned prompt) {
  reset(&fixtures[prompt]); assert(quipus_play_prompt((quipus_prompt_t)prompt) == ESP_OK);
  assert(begins == 1 && ends == 1 && cancels == 0 && accepted == active->bytes * 4);
  assert(writes == (int)((active->bytes + 511) / 512));
}
int main(void) {
  _Static_assert(sizeof(fixtures)/sizeof(fixtures[0]) == QUIPUS_PROMPT_COUNT, "Fixture catalog count");
  for (unsigned i=0; i<QUIPUS_PROMPT_COUNT; ++i) {
    FILE *file = fopen(fixtures[i].encoded, "rb"); assert(file);
    assert(fread(fixtures[i].data, 1, fixtures[i].bytes, file) == fixtures[i].bytes);
    assert(fgetc(file) == EOF); fclose(file);
    success(i); int chunks = writes;
    reset(&fixtures[i]); begin_result = ESP_ERR_TIMEOUT;
    assert(quipus_play_prompt((quipus_prompt_t)i) == ESP_ERR_TIMEOUT && begins == 1 && writes == 0 && ends == 0 && cancels == 0);
    int failures[] = {1, (chunks+1)/2, chunks};
    for (unsigned at=0; at<3; ++at) {
      reset(&fixtures[i]); fail_write = failures[at]; end_result = ESP_FAIL;
      assert(quipus_play_prompt((quipus_prompt_t)i) == ESP_ERR_TIMEOUT);
      assert(writes == fail_write && ends == 1 && cancels == 1 && accepted == (size_t)(writes-1)*2048);
      reset(&fixtures[i]); cancel_write = failures[at];
      assert(quipus_play_prompt((quipus_prompt_t)i) == ESP_FAIL && writes == cancel_write && ends == 1 && cancels == 1);
    }
    reset(&fixtures[i]); end_result = ESP_ERR_TIMEOUT;
    assert(quipus_play_prompt((quipus_prompt_t)i) == ESP_ERR_TIMEOUT && ends == 1);
    reset(&fixtures[i]); end_result = ESP_FAIL;
    assert(quipus_play_prompt((quipus_prompt_t)i) == ESP_FAIL && ends == 1);
    success(i); // A retry must restart decoding and the speaker at the first sample.
  }
  // Reverse order catches decoder state leaking from one independent clip to another.
  for (unsigned i=QUIPUS_PROMPT_COUNT; i>0; --i) success(i-1);
  esp_err_t (*wrappers[])(void) = {quipus_play_consent_prompt, quipus_play_error_prompt,
    quipus_play_uploading_prompt, quipus_play_uploaded_prompt, quipus_play_saved_offline_prompt};
  unsigned wrapped[] = {QUIPUS_PROMPT_CONSENT, QUIPUS_PROMPT_ERROR, QUIPUS_PROMPT_UPLOADING,
    QUIPUS_PROMPT_UPLOADED, QUIPUS_PROMPT_SAVED_OFFLINE};
  for (unsigned i=0; i<sizeof(wrappers)/sizeof(wrappers[0]); ++i) {
    reset(&fixtures[wrapped[i]]); assert(wrappers[i]() == ESP_OK && accepted == active->bytes*4);
  }
  FILE *file=fopen(direct.encoded,"rb"); assert(file);
  assert(fread(direct.data,1,direct.bytes,file)==direct.bytes); fclose(file);
  size_t boundaries[] = {1, 511, 512, 513, 1025, 100000};
  for (unsigned i=0; i<sizeof(boundaries)/sizeof(boundaries[0]); ++i) {
    fixture_t bounded=direct; bounded.bytes=boundaries[i]; reset(&bounded);
    assert(play_adpcm_asset(bounded.data,bounded.bytes)==ESP_OK && accepted==bounded.bytes*4);
  }
  reset(&fixtures[0]);
  assert(quipus_play_prompt((quipus_prompt_t)-1)==ESP_ERR_INVALID_ARG);
  assert(quipus_play_prompt(QUIPUS_PROMPT_COUNT)==ESP_ERR_INVALID_ARG);
  assert(play_adpcm_asset(NULL,1)==ESP_ERR_INVALID_SIZE);
  assert(play_adpcm_asset(direct.data,0)==ESP_ERR_INVALID_SIZE);
  assert(play_adpcm_asset(direct.data,100001)==ESP_ERR_INVALID_SIZE);
  assert(!begins && !writes && !ends && !cancels);
  fclose(expected);
  printf("PASS: %u actual ADPCM clips, every PCM sample against independent audioop, bounded chunks/reset/wrappers/begin/write/drain/cancel/retry guards\n", (unsigned)QUIPUS_PROMPT_COUNT);
}
"""

completion_harness = r"""
#include <assert.h>
#include <stdbool.h>
#include <stdio.h>
typedef int esp_err_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_TIMEOUT 3
#define pdTRUE 1
#define pdMS_TO_TICKS(value) (value)
#define ESP_LOGI(...) ((void)0)
#define ESP_LOGE(...) ((void)0)
static bool s_pcm_playing, s_pcm_input_finished, s_pcm_failed, s_pcm_cancelled;
static int s_pcm_task, s_pcm_finished, notifications, waits, complete, late_failure;
static void xTaskNotifyGive(int task) { (void)task; ++notifications; }
static int xSemaphoreTake(int semaphore, int timeout) {
  (void)semaphore;
  assert(timeout == 5000);
  ++waits;
  if (late_failure) s_pcm_failed = true;
  return complete;
}
PRODUCTION_BODY
static void reset(void) {
  s_pcm_playing=s_pcm_input_finished=s_pcm_failed=s_pcm_cancelled=false;
  notifications=waits=complete=late_failure=0;
}
int main(void) {
  reset();
  assert(lantern_audio_pcm_end() == ESP_OK && notifications == 0 && waits == 0);
  reset(); s_pcm_failed=true;
  assert(lantern_audio_pcm_end() == ESP_FAIL);
  reset(); s_pcm_cancelled=true;
  assert(lantern_audio_pcm_end() == ESP_FAIL);
  reset(); s_pcm_playing=true; complete=pdTRUE;
  assert(lantern_audio_pcm_end() == ESP_OK);
  assert(s_pcm_input_finished && notifications == 1 && waits == 1);
  reset(); s_pcm_playing=true; complete=pdTRUE; late_failure=true;
  assert(lantern_audio_pcm_end() == ESP_FAIL);
  reset(); s_pcm_playing=true;
  assert(lantern_audio_pcm_end() == ESP_ERR_TIMEOUT);
  assert(s_pcm_failed && s_pcm_cancelled && notifications == 2 && waits == 1);
  puts("PASS: PCM completion preserves late errors, cancellation and drain timeout");
}
"""

completion_body = function((main / "lantern_audio.c").read_text(), "lantern_audio_pcm_end")
with tempfile.TemporaryDirectory(prefix="quipus-prompts-host-") as folder:
    build = Path(folder)
    fixture_declarations, fixture_items = [], []
    for index, item in enumerate(assets):
        variable = item["symbol"] + "_fixture"
        fixture_declarations += [f"static uint8_t {variable}[{item['bytes']}];",
            f"#define {item['symbol']}_start {variable}",
            f"#define {item['symbol']}_end ({variable} + sizeof({variable}))"]
        oracle = build / f"cue-{index}.pcm"; oracle.write_bytes(oracles[index])
        fixture_items.append("{" + f"{variable},sizeof({variable})," + json.dumps((main / "assets" / item["file"]).as_posix()) + "," + json.dumps(oracle.as_posix()) + "}")
    fixture_declarations += ["static const fixture_t fixtures[]={" + ",".join(fixture_items) + "};"]
    direct_data = random.Random(20261024).randbytes(100000)
    (build / "direct.adpcm").write_bytes(direct_data)
    (build / "direct.pcm").write_bytes(audioop.adpcm2lin(direct_data, 2, None)[0])
    fixture_declarations += ["static uint8_t direct_bytes[100000];",
        "static const fixture_t direct={direct_bytes,sizeof(direct_bytes)," + json.dumps((build / "direct.adpcm").as_posix()) + "," + json.dumps((build / "direct.pcm").as_posix()) + "};"]
    prompt_harness = harness.replace("PROMPT_ENUM", enum).replace("FIXTURES", "\n".join(fixture_declarations))
    for name, test_source, production_body in [("prompt", prompt_harness, body), ("completion", completion_harness, completion_body)]:
        test_file = build / (name + "_test.c")
        test_file.write_text(test_source.replace("PRODUCTION_BODY", production_body))
        binary = build / (name + "-test" + (".exe" if os.name == "nt" else ""))
        command = compiler + ["-std=c11", "-O1", "-UNDEBUG", "-Wall", "-Wextra", "-Werror", "-I" + str(main), str(test_file)]
        if name == "prompt":
            command += [str(main / "quipus_adpcm.c")]
        subprocess.run(command + ["-o", str(binary)], check=True, cwd=build)
        subprocess.run([str(binary)], check=True, cwd=build)
print(f"PASS: {len(assets)} encoded/decoded hashes, exact shared voice/text/enum/EMBED catalog, independently decoded peak/RMS; {sum(i['bytes'] for i in assets):,} flash bytes")
print(f"SNR: independently recomputed from {source_checks}/{len(assets)} original synthesis clips; all manifest values exceed18dB.")
