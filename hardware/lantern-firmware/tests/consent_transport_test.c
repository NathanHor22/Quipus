#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <stdatomic.h>

typedef int esp_err_t;
typedef unsigned TickType_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_INVALID_ARG -2
#define ESP_ERR_INVALID_STATE -3
#define ESP_ERR_NO_MEM -4
#define ESP_ERR_NOT_FOUND -5
#define ESP_ERR_TIMEOUT -6
#define LANTERN_REPORT_INTERRUPTED 0x7f01
#define MALLOC_CAP_SPIRAM 1
#define MALLOC_CAP_8BIT 2
#define LANTERN_MIC_SAMPLE_RATE 16000
#define LANTERN_API_BASE_URL "https://fixture.invalid"
#define HTTP_METHOD_POST 1
#define HTTP_EVENT_ON_HEADER 1
#define HTTP_EVENT_ON_DATA 2
#define portTICK_PERIOD_MS 1
#define pdMS_TO_TICKS(ms) (ms)
#define ESP_LOGI(...) ((void)0)
#define ESP_LOGW(...) ((void)0)
#include "consent_transport_types.h"

typedef struct {
  int event_id;
  void *user_data;
  const char *header_key;
  const char *header_value;
  void *data;
  int data_len;
} esp_http_client_event_t;
typedef struct {
  const char *url;
  esp_err_t (*event_handler)(esp_http_client_event_t *);
  void *user_data;
  int timeout_ms;
  esp_err_t (*crt_bundle_attach)(void *);
  bool disable_auto_redirect;
  int buffer_size, buffer_size_tx;
} esp_http_client_config_t;
typedef struct { esp_http_client_config_t config; } test_client_t;
typedef test_client_t *esp_http_client_handle_t;

static int fixture_config;
static void *s_config = &fixture_config;
static struct { bool wifi_connected; } s_status;
static bool paired;
static char s_report_context[37], s_playback_id[37], s_review_token[37], s_report_id[37];
static unsigned s_playback_page, s_report_page, s_last_spoken_page;
static bool s_paging_has_context;
static bool s_has_last_spoken_page;
static atomic_uint s_speech_generation;
static bool s_power_off_requested;
static char s_interaction_id[37];
static unsigned uuid_calls;
static void uuid_v4(char out[37]) { snprintf(out,37,"00000000-0000-4000-8000-%012u",++uuid_calls); }
static struct {
  int status, transport, pcm_begin, pcm_write, pcm_end;
  const char *command_key, *command, *content_type, *report_id;
  unsigned next_page;
  bool tone, init_fail, copy_fail;
  size_t bytes, samples;
} reply;
static test_client_t client_storage;
static unsigned client_inits, client_closes, requests, intent_headers, wake_headers, context_headers;
static unsigned pcm_begins, pcm_writes, pcm_ends, recovered, report_pages;
static int recovered_status, request_timeout;
static unsigned allocations, frees;
static bool posted, last_report_request;
static char request_context[32];
static unsigned cases, cache_aborts;
static bool cancel_on_cleanup, cancel_on_page;

static void *heap_caps_malloc(size_t n, unsigned caps) {
  assert(caps == (MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
  void *p = malloc(n); if (p) ++allocations; return p;
}
static void *heap_caps_calloc(size_t n, size_t size, unsigned caps) {
  assert(caps == (MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
  void *p = calloc(n, size); if (p) ++allocations; return p;
}
static void tested_free(void *p) { if (p) ++frees; free(p); }
static bool lantern_storage_is_paired(void *config) {
  assert(config == &fixture_config); return paired;
}
static size_t sent_samples(void) {
  size_t limit=LANTERN_MIC_SAMPLE_RATE*8U; return reply.samples<limit?reply.samples:limit;
}
static size_t lantern_audio_buffered_samples(void) { return reply.samples; }
static size_t lantern_audio_copy_samples(int16_t *out, size_t offset, size_t count) {
  assert(count == sent_samples() && offset == reply.samples-count);
  for (size_t i = 0; i < count; ++i) out[i] = (int16_t)((offset+i) * 7);
  return reply.copy_fail ? count - 1 : count;
}
static void device_authorization(char out[140]) { strcpy(out, "Bearer fixture-secret"); }
static esp_err_t esp_crt_bundle_attach(void *unused) { (void)unused; return ESP_OK; }
static esp_http_client_handle_t esp_http_client_init(const esp_http_client_config_t *config) {
  ++client_inits; assert(config && config->disable_auto_redirect);
  assert(strstr(config->url, "/api/device/v1/command"));
  assert(config->buffer_size == 4096 && config->buffer_size_tx == 4096);
  request_timeout = config->timeout_ms;
  client_storage.config = *config;
  return reply.init_fail ? NULL : &client_storage;
}
static void esp_http_client_set_method(esp_http_client_handle_t client, int method) {
  assert(client == &client_storage && method == HTTP_METHOD_POST);
}
static void esp_http_client_set_header(esp_http_client_handle_t client, const char *key, const char *value) {
  assert(client == &client_storage && key && value);
  if (!strcmp(key, "X-Quipus-Consent-Response")) {
    assert(!strcmp(value, "intent-only")); ++intent_headers;
  } else if (!strcmp(key, "X-Quipus-Wake-Response")) {
    assert(!strcmp(value, "dispatch")); ++wake_headers;
  } else if (!strcmp(key, "X-Lantern-Command-Context")) {
    snprintf(request_context, sizeof(request_context), "%s", value);
  } else if (!strcmp(key, "X-Quipus-Context-Id")) {
    assert(!strcmp(value, s_report_context)); ++context_headers;
  } else if (!strcmp(key, "Content-Type")) {
    assert(!strcmp(value, "audio/wav"));
  }
}
static uint32_t le32(const unsigned char *p) {
  return p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}
static void esp_http_client_set_post_field(esp_http_client_handle_t client, const char *body, int size) {
  assert(client == &client_storage && size == (int)(44 + sent_samples() * 2));
  assert(!memcmp(body, "RIFF", 4) && !memcmp(body + 8, "WAVEfmt ", 8));
  assert(le32((const unsigned char *)body + 24) == LANTERN_MIC_SAMPLE_RATE);
  assert(le32((const unsigned char *)body + 40) == sent_samples() * 2);
  assert((unsigned char)body[22] == 1 && (unsigned char)body[34] == 16);
  const int16_t *pcm=(const int16_t *)(body+44);
  size_t offset=reply.samples-sent_samples();
  assert(pcm[0]==(int16_t)(offset*7));
  assert(pcm[sent_samples()-1]==(int16_t)((reply.samples-1)*7));
  assert(size <= 256044);
  posted = true;
}
static esp_err_t emit_header(esp_http_client_handle_t client, const char *key, const char *value) {
  if (!value) return ESP_OK;
  esp_http_client_event_t event = {.event_id=HTTP_EVENT_ON_HEADER,
    .user_data=client->config.user_data,.header_key=key,.header_value=value};
  return client->config.event_handler(&event);
}
static esp_err_t perform_audio_request(esp_http_client_handle_t client, const void *body,
                                      size_t length, audio_response_t *audio, bool report) {
  assert(client == &client_storage && body && posted && length == 44 + sent_samples() * 2);
  assert(audio == client->config.user_data); ++requests; last_report_request = report;
  if (reply.transport != ESP_OK) return reply.transport;
  assert(emit_header(client, "Content-Type", reply.content_type) == ESP_OK);
  if (reply.command_key) assert(emit_header(client, reply.command_key, reply.command) == ESP_OK);
  if (reply.tone) assert(emit_header(client, "X-Lantern-Voice-Output", "tone") == ESP_OK);
  if (reply.report_id) {
    char page[12]; snprintf(page,sizeof(page),"%u",reply.next_page);
    assert(emit_header(client,"X-Lantern-Report-Id",reply.report_id)==ESP_OK);
    assert(emit_header(client,"X-Lantern-Report-Page",page)==ESP_OK);
  }
  if (reply.bytes) {
    unsigned char pcm[16] = {0}; assert(reply.bytes <= sizeof(pcm));
    esp_http_client_event_t event = {.event_id=HTTP_EVENT_ON_DATA,
      .user_data=audio,.data=pcm,.data_len=(int)reply.bytes};
    esp_err_t result = client->config.event_handler(&event);
    if (result != ESP_OK) return result;
  }
  return ESP_OK;
}
static int esp_http_client_get_status_code(esp_http_client_handle_t client) {
  assert(client == &client_storage); return reply.status;
}
static void esp_http_client_cleanup(esp_http_client_handle_t client) {
  assert(client == &client_storage); ++client_closes;
  if(cancel_on_cleanup)atomic_fetch_add(&s_speech_generation,1);
}
static esp_err_t lantern_audio_pcm_begin(void) { ++pcm_begins; return reply.pcm_begin; }
static esp_err_t lantern_audio_pcm_write(const void *data, size_t count) {
  assert(data && count == reply.bytes); ++pcm_writes; return reply.pcm_write;
}
static esp_err_t lantern_audio_pcm_end(void) { ++pcm_ends; return reply.pcm_end; }
static bool recover_rejected_credential(int status) { ++recovered; recovered_status=status; return false; }
static void abort_report_cache_download(void) {++cache_aborts;}
static esp_err_t play_briefing_page(const char *kind, int battery, bool allow, unsigned generation) {
  assert(generation==atomic_load(&s_speech_generation));
  assert(!strcmp(kind,"status") && battery == 75 && allow);
  assert(reply.report_id && !strcmp(s_report_id,reply.report_id));
  assert(s_report_page==reply.next_page);
  ++report_pages; s_report_id[0]='\0';
  if(cancel_on_page)atomic_fetch_add(&s_speech_generation,1);
  return ESP_OK;
}
static void lantern_network_cancel_review(void) { s_review_token[0]=s_report_id[0]='\0'; }

static unsigned clock_ms, cancel_at, recording_starts, recording_stops, late_voice_frames;
static bool s_recording;
static size_t s_sample_count, s_write_index;
static void production_audio_set_recording(bool recording);
static enum { VOICE_EARLY, VOICE_EARLY_AND_LATE_NO, VOICE_SILENT, VOICE_LATE, VOICE_CONTINUOUS } voice_fixture;
static TickType_t xTaskGetTickCount(void) { return clock_ms; }
static void vTaskDelay(unsigned ms) {
  assert(ms == 20);
  if (s_recording) s_sample_count += (size_t)ms * LANTERN_MIC_SAMPLE_RATE / 1000;
  clock_ms += ms;
  if (cancel_at && clock_ms >= cancel_at) s_power_off_requested=true;
}
static void lantern_audio_set_recording(bool enabled) {
  assert(enabled != s_recording);
  production_audio_set_recording(enabled);
  assert(s_recording == enabled);
  if (enabled) {
    assert(s_sample_count == 0 && s_write_index == 0);
    ++recording_starts;
  } else ++recording_stops;
}
static unsigned lantern_audio_level(void) {
  if (voice_fixture == VOICE_SILENT) return 0;
  if (voice_fixture == VOICE_CONTINUOUS) return VOICE_ACTIVITY_LEVEL+10;
  if (voice_fixture == VOICE_LATE) return clock_ms>=28000 && clock_ms<28120 ? VOICE_ACTIVITY_LEVEL+10 : 0;
  if (clock_ms >= 20 && clock_ms < 120) return VOICE_ACTIVITY_LEVEL + 10;
  if (voice_fixture == VOICE_EARLY_AND_LATE_NO && clock_ms >= 3600 && clock_ms < 3900) {
    ++late_voice_frames; return VOICE_ACTIVITY_LEVEL + 10;
  }
  return 0;
}

#define free tested_free
#include "consent_transport_under_test.c"
#undef free

static void reset_reply(int status, const char *command) {
  assert(allocations == frees);
  reply.status=status; reply.command_key="X-Lantern-Command"; reply.command=command;
  reply.transport=reply.pcm_begin=reply.pcm_write=reply.pcm_end=ESP_OK;
  reply.content_type=reply.report_id=NULL; reply.next_page=0;
  reply.tone=reply.init_fail=reply.copy_fail=false;
  reply.bytes=0; reply.samples=16;
  s_interaction_id[0]=0;
  s_status.wifi_connected=true; s_config=&fixture_config; paired=true;
  s_report_context[0]=s_playback_id[0]=s_review_token[0]=s_report_id[0]='\0';
  s_report_page=s_playback_page=s_last_spoken_page=0; s_has_last_spoken_page=false;
  atomic_store(&s_speech_generation,0);
  client_inits=client_closes=requests=intent_headers=wake_headers=context_headers=0;
  pcm_begins=pcm_writes=pcm_ends=recovered=report_pages=0;
  recovered_status=0; request_timeout=0; posted=last_report_request=false;
  request_context[0]='\0';
  cancel_on_cleanup=cancel_on_page=false;cache_aborts=0;
}
static void decision(const char *context, int expected, const char *intent) {
  char actual[32]="stale-intent";
  assert(lantern_network_run_voice_command(context,75,actual,sizeof(actual)) == expected);
  assert(!strcmp(actual,intent)); assert(allocations == frees);
  assert(client_closes == (!reply.init_fail ? client_inits : 0U));
  ++cases;
}
static void consent_tests(void) {
  const char *accepted[]={"consent_yes","consent_no","unknown"};
  const char *contexts[]={"consent","consent_retry"};
  for (unsigned c=0;c<2;++c) for(unsigned i=0;i<3;++i) {
    reset_reply(204,accepted[i]); decision(contexts[c],ESP_OK,accepted[i]);
    assert(intent_headers==1 && request_timeout==25000 && !strcmp(request_context,contexts[c]));
    assert(requests==1 && pcm_begins==0 && pcm_writes==0 && pcm_ends==0 && recovered==0);
  }
  const char *rejected[]={NULL,"","start","report_answer","consent_yes_extra","Consent_yes"};
  for(unsigned i=0;i<sizeof(rejected)/sizeof(rejected[0]);++i) {
    reset_reply(204,rejected[i]); decision("consent",ESP_FAIL,"");
    assert(recovered==1 && recovered_status==204 && pcm_begins==0);
  }
  reset_reply(204,"consent_yes"); reply.command_key="X-Foreign-Command";
  decision("consent",ESP_FAIL,"");
  const int statuses[]={200,201,202,400,401,403,429,500};
  for(unsigned i=0;i<sizeof(statuses)/sizeof(statuses[0]);++i) {
    reset_reply(statuses[i],"consent_yes"); decision("consent",ESP_FAIL,"");
    assert(recovered==1 && recovered_status==statuses[i]);
  }
  reset_reply(204,"consent_yes"); reply.transport=ESP_ERR_TIMEOUT;
  decision("consent",ESP_FAIL,""); assert(recovered_status==-1);
  // Compatibility: old servers acknowledge decisions with a short PCM tone.
  reset_reply(200,"consent_no"); reply.content_type="audio/pcm"; reply.bytes=4; reply.tone=true;
  decision("consent_retry",ESP_OK,"consent_no");
  assert(intent_headers==1 && pcm_begins==1 && pcm_writes==1 && pcm_ends==1);
  reset_reply(200,"consent_yes"); reply.content_type="application/json"; reply.bytes=4;
  decision("consent",ESP_FAIL,""); assert(pcm_begins==0);
  for(unsigned phase=0;phase<3;++phase) {
    reset_reply(200,"consent_yes"); reply.content_type="audio/pcm"; reply.bytes=4;
    if(phase==0) reply.pcm_begin=ESP_FAIL;
    else if(phase==1) reply.pcm_write=ESP_FAIL;
    else reply.pcm_end=ESP_FAIL;
    decision("consent",ESP_FAIL,"");
  }
}
static void ordinary_command_tests(void) {
  reset_reply(204,"consent_yes"); decision("wake_command",ESP_ERR_NOT_FOUND,"");
  assert(intent_headers==0 && wake_headers==1 && request_timeout==120000 && recovered==0 && pcm_begins==0);
  reset_reply(200,"start"); reply.content_type="audio/pcm;rate=24000"; reply.bytes=4;
  decision("wake_command",ESP_OK,"start"); assert(intent_headers==0 && pcm_ends==1);
  reset_reply(200,"report_answer"); reply.content_type="audio/pcm"; reply.bytes=4;
  strcpy(s_report_context,"fixture-context"); strcpy(s_playback_id,"fixture-playback");
  decision("report",ESP_OK,"report_answer");
  assert(intent_headers==0 && context_headers==1 && request_timeout==120000 && last_report_request);
  reset_reply(200,NULL); reply.content_type="audio/pcm"; reply.bytes=4;
  decision("action",ESP_FAIL,"");
  reset_reply(204,"consent_yes"); reply.transport=LANTERN_REPORT_INTERRUPTED;
  decision("report",LANTERN_REPORT_INTERRUPTED,"report_answer");
  reset_reply(204,"report_stop"); decision("report",ESP_OK,"report_stop");
  assert(pcm_begins==0 && recovered==0 && last_report_request);
  reset_reply(204,"report_stop"); decision("wake_command",ESP_ERR_NOT_FOUND,"");
  reset_reply(204,"report_answer"); decision("report",ESP_ERR_NOT_FOUND,"");
  reset_reply(204,"report_stop"); reply.command_key="X-Foreign-Command";
  decision("report",ESP_ERR_NOT_FOUND,"");
  reset_reply(204,"consent_yes"); reply.samples=0;
  decision("consent",ESP_ERR_INVALID_STATE,""); assert(requests==0 && client_inits==0);
  reset_reply(204,"consent_yes"); reply.copy_fail=true;
  decision("consent",ESP_FAIL,""); assert(requests==0 && client_inits==0);
  reset_reply(204,"consent_yes"); reply.init_fail=true;
  decision("consent",ESP_FAIL,""); assert(requests==0);
}
static void dispatch_tests(void) {
  const char *accepted[]={"start_recording","status_report","wifi_setup"};
  for(unsigned i=0;i<sizeof(accepted)/sizeof(accepted[0]);++i) {
    reset_reply(204,accepted[i]); decision("wake_command",ESP_OK,accepted[i]);
    assert(intent_headers==0 && wake_headers==1 && request_timeout==120000);
    assert(!strcmp(request_context,"wake_command") && requests==1);
    assert(pcm_begins==0 && pcm_writes==0 && pcm_ends==0 && recovered==0 && report_pages==0);
  }
  reset_reply(204,"status_report"); reply.command_key="x-lantern-command";
  decision("wake_command",ESP_OK,"status_report");
  // An unknown/missing dispatch never becomes a recording command.
  const char *unknown[]={NULL,"","unknown","start_recording_extra","consent_yes","retry_recovery"};
  for(unsigned i=0;i<sizeof(unknown)/sizeof(unknown[0]);++i) {
    reset_reply(204,unknown[i]); decision("wake_command",ESP_ERR_NOT_FOUND,"");
    assert(wake_headers==1 && pcm_begins==0 && recovered==0);
  }
  reset_reply(204,"status_report"); reply.command_key="X-Foreign-Command";
  decision("wake_command",ESP_ERR_NOT_FOUND,"");
  const int statuses[]={200,201,400,401,403,429,500};
  for(unsigned i=0;i<sizeof(statuses)/sizeof(statuses[0]);++i) {
    reset_reply(statuses[i],"status_report"); decision("wake_command",ESP_FAIL,"");
    assert(recovered_status==statuses[i] && pcm_begins==0);
  }
  reset_reply(204,"status_report"); reply.transport=ESP_ERR_TIMEOUT;
  decision("wake_command",ESP_FAIL,""); assert(recovered_status==-1);
  // Advanced queries retain their PCM reply, report context and next-page fetch.
  reset_reply(200,"report_answer"); reply.content_type="audio/pcm"; reply.bytes=4;
  reply.report_id="fixture-next-page"; reply.next_page=3;
  strcpy(s_report_context,"fixture-context"); strcpy(s_playback_id,"fixture-playback");
  decision("wake_command",ESP_OK,"report_answer");
  assert(wake_headers==1 && intent_headers==0 && context_headers==1 && request_timeout==120000);
  assert(pcm_begins==1 && pcm_writes==1 && pcm_ends==1 && report_pages==1);
  assert(!strcmp(s_report_context,"fixture-context") && !strcmp(s_playback_id,"fixture-playback"));
  assert(!s_report_id[0] && !last_report_request);
}
static void command_turn_cancellation_tests(void) {
  for(unsigned phase=0;phase<2;++phase) {
    reset_reply(200,"report_answer");reply.content_type="audio/pcm";reply.bytes=4;
    reply.report_id="fixture-next-page";reply.next_page=1;
    cancel_on_cleanup=phase==0;cancel_on_page=phase==1;
    decision("report",LANTERN_REPORT_INTERRUPTED,"report_answer");
    assert(report_pages==(phase==0?0:1)&&cache_aborts==1&&requests==1);
    assert(allocations==frees);
  }
}
static void recovery_tests(void) {
  const char *accepted[]={"retry_recovery","cancel_recovery","status_report","wifi_setup","unknown"};
  for(unsigned i=0;i<sizeof(accepted)/sizeof(accepted[0]);++i) {
    reset_reply(204,accepted[i]); decision("recovery",ESP_OK,accepted[i]);
    assert(request_timeout==25000 && !strcmp(request_context,"recovery"));
    assert(intent_headers==0 && wake_headers==0 && context_headers==0 && requests==1);
    assert(pcm_begins==0 && pcm_writes==0 && pcm_ends==0 && report_pages==0 && recovered==0);
  }
  const char *rejected[]={NULL,"","start_recording","stop_recording","consent_yes","consent_no","report_answer","retry_recovery_extra","Retry_recovery"};
  for(unsigned i=0;i<sizeof(rejected)/sizeof(rejected[0]);++i) {
    reset_reply(204,rejected[i]); decision("recovery",ESP_FAIL,"");
    assert(recovered==1 && recovered_status==204 && pcm_begins==0 && report_pages==0);
  }
  reset_reply(204,"retry_recovery"); reply.command_key="X-Foreign-Command";
  decision("recovery",ESP_FAIL,"");
  reset_reply(204,"retry_recovery"); reply.command_key=NULL;
  decision("recovery",ESP_FAIL,"");
  const int statuses[]={200,201,202,400,401,403,429,500};
  for(unsigned i=0;i<sizeof(statuses)/sizeof(statuses[0]);++i) {
    reset_reply(statuses[i],"retry_recovery"); decision("recovery",ESP_FAIL,"");
    assert(recovered_status==statuses[i] && pcm_begins==0);
  }
  reset_reply(204,"retry_recovery"); reply.transport=ESP_ERR_TIMEOUT;
  decision("recovery",ESP_FAIL,""); assert(recovered_status==-1 && request_timeout==25000);
}
static void reset_capture(void) {
  clock_ms=cancel_at=recording_starts=recording_stops=late_voice_frames=0;
  s_power_off_requested=false; s_recording=false; voice_fixture=VOICE_EARLY;
  s_sample_count=32000; s_write_index=123;
}
static void capture_tests(void) {
  reset_capture(); voice_fixture=VOICE_EARLY_AND_LATE_NO;
  assert(capture_utterance(5000,false));
  assert(clock_ms==5000 && late_voice_frames>0 && !s_recording);
  assert(recording_starts==1 && recording_stops==1);
  assert(s_sample_count==5 * LANTERN_MIC_SAMPLE_RATE); ++cases;
  reset_capture(); voice_fixture=VOICE_EARLY_AND_LATE_NO;
  assert(capture_short_utterance(5000));
  assert(clock_ms==20+VOICE_MIN_CAPTURE_MS && late_voice_frames==0 && !s_recording); ++cases;
  reset_capture(); voice_fixture=VOICE_SILENT;
  assert(!capture_utterance(5000,false)); assert(clock_ms==5000 && !s_recording); ++cases;
  reset_capture(); cancel_at=240;
  assert(capture_utterance(5000,false));
  assert(clock_ms==240 && recording_stops==1 && !s_recording); ++cases;
  reset_capture(); voice_fixture=VOICE_LATE;
  assert(capture_short_utterance(30000));
  assert(clock_ms==28000+VOICE_MIN_CAPTURE_MS && !s_recording);
  assert(s_sample_count==29 * LANTERN_MIC_SAMPLE_RATE); ++cases;
  reset_capture(); voice_fixture=VOICE_CONTINUOUS;
  assert(capture_short_utterance(30000));
  assert(clock_ms==7000 && !s_recording); ++cases;
  reset_capture(); s_power_off_requested=true;
  assert(!capture_utterance(5000,false));
  assert(clock_ms==0 && recording_stops==1 && !s_recording); ++cases;
}
static void bounded_transport_tests(void) {
  reset_reply(200,"report_answer"); reply.content_type="audio/pcm"; reply.bytes=4;
  reply.samples=29 * LANTERN_MIC_SAMPLE_RATE;
  unsigned old_uuid=uuid_calls;
  decision("report",ESP_OK,"report_answer");
  assert(uuid_calls==old_uuid+1 && s_interaction_id[0]);
  char first_turn[37]; strcpy(first_turn,s_interaction_id);
  decision("report",ESP_OK,"report_answer");
  assert(uuid_calls==old_uuid+2 && strcmp(first_turn,s_interaction_id));
}
static void stale_response_tests(void) {
  reset_reply(204,"consent_yes");
  audio_response_t audio={.generation_valid=true,.generation=1};
  esp_http_client_event_t event={.event_id=HTTP_EVENT_ON_HEADER,.user_data=&audio,
    .header_key="X-Lantern-Command",.header_value="consent_yes"};
  atomic_store(&s_speech_generation,2);
  assert(audio_http_event(&event)==ESP_FAIL && audio.command[0]=='\0' && pcm_begins==0);
  audio.generation=2; strcpy(audio.interaction_id,"expected-interaction");
  event.header_key="X-Quipus-Interaction-Id"; event.header_value="abandoned-interaction";
  assert(audio_http_event(&event)==ESP_FAIL && audio.playback_failed && pcm_begins==0);
  cases+=2;
}
int main(void) {
  stale_response_tests(); bounded_transport_tests();
  consent_tests(); ordinary_command_tests(); command_turn_cancellation_tests(); dispatch_tests(); recovery_tests(); capture_tests();
  printf("Consent/dispatch/recovery transport, headers, WAV and capture regressions passed: %u cases\n",cases);
  return 0;
}
