"""Install only a completely validated catalog of the shared Quipus voice."""
from pathlib import Path
import hashlib, json, re, shutil
ROOT=Path(__file__).resolve().parents[1]
STAGE=ROOT/".tmp-firmware-face/marin-assets"
MAIN=ROOT/"hardware/lantern-firmware/main"
manifest=json.loads((STAGE/"prompts.json").read_text())
profile=json.loads((ROOT/"lib/quipus-voice-profile.json").read_text())
catalog=json.loads((ROOT/"lib/quipus-prompt-text.json").read_text())["prompts"]
assert manifest["profile"]==profile and len(manifest["prompts"])==len(catalog)
assert sum(i["bytes"] for i in manifest["prompts"])<=1600000
for item,expected in zip(manifest["prompts"],catalog):
    assert all(item[k]==v for k,v in expected.items())
    data=(STAGE/item["file"]).read_bytes()
    assert len(data)==item["bytes"] and item["samples"]==len(data)*2
    assert hashlib.sha256(data).hexdigest()==item["sha256"]
    assert .3<item["seconds"]<7 and item["sample_rate"]==24000 and item["codec"]=="ima-adpcm4"
    assert item["snr_db"]>18 and item["peak"]<32767
for item in manifest["prompts"]:shutil.copyfile(STAGE/item["file"],MAIN/"assets"/item["file"])
(MAIN/"assets/prompts.json").write_text(json.dumps(manifest,indent=2)+"\n")
(MAIN/"quipus_voice_profile.h").write_text('#pragma once\n#define QUIPUS_VOICE_PROFILE_VERSION "'+profile["version"]+'"\n')
parts=['// Generated from the shared Quipus voice profile. See assets/prompts.json.',
 '#include "quipus_local_prompts.h"','#include "quipus_adpcm.h"','#include <stdint.h>',
 '#include "lantern_audio.h"','#include "lantern_board.h"',
 '_Static_assert(LANTERN_TTS_SAMPLE_RATE == 24000, "Local voice requires24kHz output");']
for item in manifest["prompts"]:
    for end in ('start','end'):
        parts.append('extern const uint8_t '+item["symbol"]+'_'+end+'[] asm("_binary_'+item["file"].replace('.','_')+'_'+end+'");')
parts+=['typedef struct { const uint8_t *start; const uint8_t *end; } prompt_asset_t;',
 'static const prompt_asset_t s_prompt_assets[QUIPUS_PROMPT_COUNT] = {']
for item in manifest["prompts"]:parts.append('  ['+item["enum"]+'] = {'+item["symbol"]+'_start, '+item["symbol"]+'_end},')
parts+=['};',r"""
static esp_err_t play_adpcm_asset(const uint8_t *data, size_t length) {
  if (!data || !length || length > 100000U) return ESP_ERR_INVALID_SIZE;
  esp_err_t result = lantern_audio_pcm_begin();
  if (result != ESP_OK) return result;
  quipus_adpcm_state_t state;
  quipus_adpcm_init(&state);
  int16_t output[1024];
  for (size_t offset = 0; offset < length; offset += 512) {
    size_t bytes = length - offset;
    if (bytes > 512) bytes = 512;
    size_t samples = quipus_adpcm_decode(data + offset, bytes, output, 1024, &state);
    if (samples != bytes * 2) { result = ESP_FAIL; break; }
    result = lantern_audio_pcm_write(output, samples * sizeof(output[0]));
    if (result != ESP_OK) break;
  }
  if (result != ESP_OK) lantern_audio_pcm_cancel();
  esp_err_t drained = lantern_audio_pcm_end();
  return result != ESP_OK ? result : drained;
}
esp_err_t quipus_play_prompt(quipus_prompt_t prompt) {
  if (prompt < 0 || prompt >= QUIPUS_PROMPT_COUNT) return ESP_ERR_INVALID_ARG;
  const prompt_asset_t *asset = &s_prompt_assets[prompt];
  return play_adpcm_asset(asset->start, (size_t)(asset->end - asset->start));
}
"""]
for name,enum in [('consent','CONSENT'),('error','ERROR'),('uploading','UPLOADING'),('uploaded','UPLOADED'),('saved_offline','SAVED_OFFLINE')]:
    parts.append('esp_err_t quipus_play_'+name+'_prompt(void) { return quipus_play_prompt(QUIPUS_PROMPT_'+enum+'); }')
(MAIN/"quipus_local_prompts.c").write_text("\n\n".join(parts)+"\n")
p=MAIN/"CMakeLists.txt";s=p.read_text()
s=re.sub(r'^\s*"assets/[^"\n]+\.(?:pcm|adpcm)"\n','',s,flags=re.M)
if '"quipus_adpcm.c"' not in s:s=s.replace('    "quipus_local_prompts.c"','    "quipus_local_prompts.c"\n    "quipus_adpcm.c"')
embeds=''.join('    "assets/'+item['file']+'"\n' for item in manifest['prompts'])
s=s.replace('  INCLUDE_DIRS "."',embeds+'  INCLUDE_DIRS "."');p.write_text(s)
readme=['# Quipus local speech assets','',
 'All clips use the same warm, confident female voice as online reports.',
 'Profile: `'+profile['version']+'`; voice: `'+profile['voice']+'`; model: `'+profile['model']+'`.','',
 'Generated from original Quipus interface text through the configured OpenAI speech service. These are generated audio clips, not a local voice-generation model.','',
 'Storage:24kHz mono IMA ADPCM4-bit, initial predictor/index0, high nibble first. The bounded decoder outputs at most1024 signed16-bit PCM samples per512-byte block and resets for each clip. No network or runtime synthesis is required.','',
 'Reproduction: scripts/generate-quipus-voice-assets.py then scripts/install-quipus-voice-assets.py. The endpoint is disabled without an ephemeral deployment-only token. Never put API keys on the board.','',
 'Only quiet synthesis margins are trimmed, with100ms leading and160ms trailing protection. Each generated catalog is checked against exact text/profile and encoded/decoded hashes before installation.','',
 'Consent clips only ask the question. Playback, intent selection, buttons and silence cannot approve consent.']
for item in manifest['prompts']:
    readme+=['','## `'+item['file']+'`','',item['text'],'',
      str(item['seconds'])+'seconds; '+str(item['bytes'])+'bytes; decoded SNR '+str(item['snr_db'])+'dB.',
      'SHA256 `'+item['sha256']+'`.']
(MAIN/'assets/README.md').write_text('\n'.join(readme)+'\n')
print('Installed',len(manifest['prompts']),'single-voice clips;',sum(i['bytes'] for i in manifest['prompts']),'flash bytes')
