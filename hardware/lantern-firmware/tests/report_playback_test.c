/* Only HTTP, RTOS and audio edges are simulated; production functions are extracted. */
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
#define ESP_ERR_NO_MEM -2
#define ESP_ERR_TIMEOUT -3
#define ESP_ERR_INVALID_STATE -4
#define ESP_ERR_NOT_FOUND -5
#include "quipus_report_cache.h"
#include "quipus_voice_profile.h"
#include "prompt_enum_under_test.h"
#define LANTERN_REPORT_INTERRUPTED 0x7f01
#define HTTP_EVENT_ON_HEADER 1
#define HTTP_EVENT_ON_DATA 2
#define MALLOC_CAP_SPIRAM 1
#define MALLOC_CAP_8BIT 2
#define LANTERN_SCREEN_STATUS 7
#define LANTERN_API_BASE_URL "https://example.invalid"
#define HTTP_METHOD_POST 1
#define esp_crt_bundle_attach NULL
#define portTICK_PERIOD_MS 1
#define pdMS_TO_TICKS(ms) (ms)
#define ESP_LOGI(...) ((void)0)
#define ESP_LOGW(...) ((void)0)
#define portENTER_CRITICAL(lock) ((void)(lock))
#define portEXIT_CRITICAL(lock) ((void)(lock))
struct timeval { int64_t tv_sec, tv_usec; };
#include "report_playback_types.h"

typedef struct {
  int event_id; void *user_data; const char *header_key, *header_value;
  void *data; int data_len;
} esp_http_client_event_t;
typedef struct { audio_response_t *audio; } test_client_t;
typedef test_client_t *esp_http_client_handle_t;
typedef struct {const char *url;esp_err_t (*event_handler)(esp_http_client_event_t *);void *user_data;
  int timeout_ms,buffer_size;void *crt_bundle_attach;bool disable_auto_redirect;} esp_http_client_config_t;
static esp_err_t audio_http_event(esp_http_client_event_t *event);
void lantern_network_interrupt_report(void);
void lantern_network_end_report(void);

static char s_review_token[37], s_report_id[37], s_report_context[37], s_playback_id[37];
static char s_interaction_id[37];
static unsigned s_playback_page, s_last_spoken_page, s_report_page;
static struct {bool wifi_connected;} s_status;
static bool s_has_last_spoken_page, s_paging_has_context;
static atomic_uint s_speech_generation;
static bool s_report_playing, s_report_interrupted, s_report_request_active;
static bool s_report_cache_downloading;
static char s_report_cache_playback[37], s_report_cache_turn[37];
static unsigned s_report_cache_next_page, s_report_cache_generation;
static void abort_report_cache_download(void);
static struct {int unused;} configuration;
static void *s_config=&configuration;
static bool paired, recording, sd_capturing;
struct quipus_report_cache_reader {int unused;};
static struct quipus_report_cache_reader cached_reader;
static bool cache_writing, cache_reader_open;
static unsigned cache_begins, cache_appends, cache_commits, cache_aborts, cache_opens, cache_reads, cache_closes, cache_intros;
static size_t cache_download_bytes, cache_committed_bytes, cache_read_position;
static esp_err_t cache_begin_result, cache_append_result, cache_commit_result, cache_open_result, cache_intro_result;
static bool cache_bad_read, cache_zero_read;
static size_t cache_expected;
static int s_clock_lock;
static bool s_clock_synced;
static int64_t s_clock_anchor_wall, s_clock_anchor_mono;
static int64_t wall_seconds, mono_us;
static unsigned ticks, allocations, frees, cases, uuid_calls, client_inits, client_cleanups;
static unsigned begins, writes, ends, cancels, listener_resets, read_calls, write_calls;
static unsigned header_fetches, request_headers, context_headers, received_bytes;
static bool listener, pcm_active, pcm_cancelled;
static char sent_interaction[37];
static test_client_t client;
static unsigned inject_hits;
static enum { INJECT_NONE, OPEN, WRITE_BODY, HEADERS, READ_FIRST, READ_SECOND,
              PCM_WRITE, DRAIN, GENERATION_READ, LATE_BARGE, CACHE_OPEN, CACHE_READ, CACHE_INTRO, CACHE_RESET, CACHE_ALLOC, PAGE_CLEANUP, SECOND_PAGE_INIT } inject;
static bool exit_context;
static struct {
  int status, open_error, header_error, begin_error, write_error, end_error;
  const char *mime, *command, *context, *playback, *echo, *voice;
  bool cacheable, more;
  unsigned next_page;
  unsigned page;
  size_t bytes;
  bool alloc_fail, stalled, body_write_fail, repeat, audio_alloc_fail, client_init_fail;
} reply;

static void injection(unsigned stage) {
  if ((unsigned)inject != stage || inject_hits) return;
  ++inject_hits;
  if (inject == GENERATION_READ) atomic_fetch_add(&s_speech_generation, 1);
  else if (exit_context) lantern_network_end_report();
  else lantern_network_interrupt_report();
}
static bool lantern_storage_is_paired(void *config) {assert(config==&configuration);return paired;}
static bool lantern_audio_is_recording(void) {return recording;}
static bool lantern_sd_capture_active(void) {return sd_capturing;}
esp_err_t quipus_report_cache_begin(const char *id,const char *profile) {
  assert(id&&strlen(id)==36&&!strcmp(profile,QUIPUS_VOICE_PROFILE_VERSION)&&!cache_writing);
  ++cache_begins;if(cache_begin_result!=ESP_OK)return cache_begin_result;
  cache_writing=true;cache_download_bytes=0;return ESP_OK;
}
esp_err_t quipus_report_cache_append(const void *pcm,size_t bytes) {
  assert(cache_writing&&pcm&&bytes>0);++cache_appends;
  if(cache_append_result!=ESP_OK)return cache_append_result;
  cache_download_bytes+=bytes;return ESP_OK;
}
esp_err_t quipus_report_cache_commit(void) {
  assert(cache_writing&&cache_download_bytes>0);++cache_commits;
  if(cache_commit_result!=ESP_OK)return cache_commit_result;
  cache_committed_bytes=cache_download_bytes;cache_writing=false;return ESP_OK;
}
void quipus_report_cache_abort(void) {
  if(cache_writing)++cache_aborts;
  cache_writing=false;cache_download_bytes=0;
}
esp_err_t quipus_report_cache_open(const char *profile,quipus_report_cache_reader_t **reader) {
  assert(!strcmp(profile,QUIPUS_VOICE_PROFILE_VERSION)&&!cache_reader_open);++cache_opens;injection(CACHE_OPEN);
  if(cache_open_result!=ESP_OK)return cache_open_result;
  cache_reader_open=true;cache_read_position=0;*reader=&cached_reader;return ESP_OK;
}
size_t quipus_report_cache_size(const quipus_report_cache_reader_t *reader) {assert(reader==&cached_reader&&cache_reader_open);return cache_expected;}
size_t quipus_report_cache_read(quipus_report_cache_reader_t *reader,void *pcm,size_t bytes) {
  assert(reader==&cached_reader&&cache_reader_open&&pcm&&bytes<=2048);++cache_reads;injection(CACHE_READ);
  if(cache_zero_read)return 0;
  if(cache_bad_read)return 1;
  size_t remaining=cache_expected-cache_read_position;
  if(bytes>remaining)bytes=remaining;
  if(bytes>4)bytes=4;
  memset(pcm,0x21,bytes);cache_read_position+=bytes;return bytes;
}
void quipus_report_cache_close(quipus_report_cache_reader_t *reader) {assert(reader==&cached_reader&&cache_reader_open);++cache_closes;cache_reader_open=false;}
static esp_err_t quipus_play_prompt(quipus_prompt_t prompt) {
  assert(prompt==QUIPUS_PROMPT_CACHED_REPORT);++cache_intros;injection(CACHE_INTRO);return cache_intro_result;
}
static int64_t fixture_time(void *unused) { assert(!unused); return wall_seconds; }
static int64_t esp_timer_get_time(void) { return mono_us; }
static TickType_t xTaskGetTickCount(void) { return ticks; }
static void vTaskDelay(unsigned ms) { assert(ms == 10); ticks += ms; }
static void uuid_v4(char output[37]) {
  ++uuid_calls; snprintf(output,37,"00000000-0000-4000-8000-%012u",uuid_calls);
}
static void *heap_caps_malloc(size_t size, unsigned caps) {
  assert(size == 2048 && caps == (MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
  injection(CACHE_ALLOC);
  if (reply.alloc_fail) return NULL;
  void *result=malloc(size); assert(result); ++allocations; return result;
}
static void *heap_caps_calloc(size_t count,size_t size,unsigned caps) {
  assert(count==1&&size==sizeof(audio_response_t)&&caps==(MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT));
  if(reply.audio_alloc_fail)return NULL;
  void *result=calloc(count,size);assert(result);++allocations;return result;
}
static void device_authorization(char out[140]) {snprintf(out,140,"Device fixture");}
static bool recover_rejected_credential(int status) {(void)status;return false;}
static esp_http_client_handle_t esp_http_client_init(const esp_http_client_config_t *config) {
  assert(config&&config->user_data&&config->event_handler==audio_http_event);
  if(reply.client_init_fail)return NULL;
  ++client_inits;
  if(client_inits==2){injection(SECOND_PAGE_INIT);reply.page=1;reply.more=false;}
  client.audio=config->user_data;read_calls=0;return &client;
}
static void esp_http_client_set_method(esp_http_client_handle_t handle,int method) {assert(handle==&client&&method==HTTP_METHOD_POST);}
static void esp_http_client_set_post_field(esp_http_client_handle_t handle,const char *body,int size) {assert(handle==&client&&body&&size>0);}
static void esp_http_client_cleanup(esp_http_client_handle_t handle) {assert(handle==&client);++client_cleanups;injection(PAGE_CLEANUP);}
static void tested_free(void *ptr) { assert(ptr); ++frees; free(ptr); }
static void lantern_audio_set_report_listening(bool enabled) { listener=enabled; }
static void lantern_audio_reset_report_listening(void) { listener=false; ++listener_resets; injection(CACHE_RESET); }
static void lantern_audio_pcm_cancel(void) { pcm_cancelled=true; ++cancels; }
static esp_err_t lantern_audio_pcm_begin(void) {
  assert(!pcm_active); ++begins;
  if(reply.begin_error) return reply.begin_error;
  pcm_active=true; pcm_cancelled=false; return ESP_OK;
}
static esp_err_t lantern_audio_pcm_write(const void *data, size_t size) {
  assert(data && size > 0 && pcm_active); ++writes;
  injection(PCM_WRITE);
  if (pcm_cancelled) return ESP_FAIL;
  received_bytes += (unsigned)size; return reply.write_error;
}
static esp_err_t lantern_audio_pcm_end(void) {
  if(!pcm_active)return pcm_cancelled?ESP_FAIL:reply.end_error;
  ++ends; injection(DRAIN); pcm_active=false;
  return pcm_cancelled ? ESP_FAIL : reply.end_error;
}
static bool lantern_audio_take_speech_interrupt(void) {
  if(inject != LATE_BARGE || inject_hits) return false;
  ++inject_hits; return true;
}
static void lantern_display_show(int screen, const char *detail) {
  assert(screen==LANTERN_SCREEN_STATUS && !strcmp(detail,"STATUS REPORT"));
}
static void esp_http_client_set_header(esp_http_client_handle_t handle,
                                       const char *key, const char *value) {
  assert(handle==&client);
  if(!strcmp(key,"X-Quipus-Interaction-Id")) {
    assert(strlen(value)==36); strcpy(sent_interaction,value); ++request_headers;
  } else if(!strcmp(key,"X-Quipus-Context-Id")) {
    assert(!strcmp(value,s_report_context)); ++context_headers;
  } else if(!strcmp(key,"X-Quipus-Report-Mode")) {assert(!strcmp(value,"conversation"));}
  else assert(!strcmp(key,"Content-Type")||!strcmp(key,"Authorization")||!strcmp(key,"X-Lantern-Protocol"));
}
static esp_err_t esp_http_client_open(esp_http_client_handle_t handle, int length) {
  assert(handle==&client && length>0); injection(OPEN); return reply.open_error;
}
static int esp_http_client_write(esp_http_client_handle_t handle, const char *body, int length) {
  assert(handle==&client && body && length>0); ++write_calls; injection(WRITE_BODY);
  return reply.body_write_fail ? -1 : (length>8?8:length);
}
static esp_err_t header(const char *key,const char *value) {
  if(!value) return ESP_OK;
  esp_http_client_event_t event={.event_id=HTTP_EVENT_ON_HEADER,.user_data=client.audio,
    .header_key=key,.header_value=value};
  return audio_http_event(&event);
}
static int esp_http_client_fetch_headers(esp_http_client_handle_t handle) {
  assert(handle==&client); ++header_fetches; injection(HEADERS);
  if(reply.header_error) return -1;
  /* Match ESP-IDF callbacks; stale callbacks may be rejected before returning. */
  (void)header("X-Quipus-Interaction-Id", reply.echo ? reply.echo : sent_interaction);
  (void)header("Content-Type",reply.mime);
  (void)header("X-Lantern-Command",reply.command);
  (void)header("X-Quipus-Context-Id",reply.context);
  (void)header("X-Quipus-Playback-Id",reply.playback);
  (void)header("X-Quipus-Playback-Mode",reply.repeat ? "repeat" : "forward");
  (void)header("X-Quipus-Voice-Profile",reply.voice);
  (void)header("X-Quipus-Offline-Cache",reply.cacheable ? "report":NULL);
  if(reply.more){
    (void)header("X-Lantern-Report-Id","report-chain-1");
    char next[12];snprintf(next,sizeof(next),"%u",reply.next_page);
    (void)header("X-Lantern-Report-Page",next);
  }
  char page[12]; snprintf(page,sizeof(page),"%u",reply.page);
  (void)header("X-Quipus-Playback-Page",page);
  return 0;
}
static int esp_http_client_get_status_code(esp_http_client_handle_t handle) {
  assert(handle==&client); return reply.status;
}
static void esp_http_client_set_timeout_ms(esp_http_client_handle_t handle,int timeout) {
  assert(handle==&client && timeout==2000);
}
static int esp_http_client_read(esp_http_client_handle_t handle,char *data,int length) {
  assert(handle==&client && data && length==2048); ++read_calls;
  if(read_calls==1) { injection(READ_FIRST); injection(GENERATION_READ); }
  if(read_calls==2) injection(READ_SECOND);
  if(reply.stalled) return 0;
  size_t offset=(read_calls-1)*4;
  if(offset>=reply.bytes) return 0;
  size_t count=reply.bytes-offset; if(count>4)count=4;
  memset(data,0x21,count); return (int)count;
}
static bool esp_http_client_is_complete_data_received(esp_http_client_handle_t handle) {
  assert(handle==&client); return !reply.stalled;
}
#define time fixture_time
#define free tested_free
#include "report_playback_under_test.c"
#undef free
#undef time

static void reset(void) {
  assert(allocations==frees && !pcm_active);
  reply.status=200; reply.open_error=reply.header_error=reply.begin_error=0;
  reply.write_error=reply.end_error=0;
  abort_report_cache_download();
  reply.voice=QUIPUS_VOICE_PROFILE_VERSION;reply.cacheable=reply.more=false;reply.next_page=0;
  reply.mime="audio/pcm;rate=24000"; reply.command="report_answer";
  reply.context="context-1"; reply.playback="playback-1"; reply.echo=NULL;
  reply.page=3; reply.bytes=8;
  reply.alloc_fail=reply.stalled=reply.body_write_fail=reply.repeat=false;
  s_review_token[0]=s_report_id[0]=s_report_context[0]=s_playback_id[0]=s_interaction_id[0]=0;
  s_playback_page=s_last_spoken_page=0; s_has_last_spoken_page=s_paging_has_context=false;
  s_report_playing=s_report_interrupted=listener=pcm_cancelled=false;
  atomic_store(&s_speech_generation,0);
  inject=INJECT_NONE; inject_hits=0; exit_context=false;
  begins=writes=ends=cancels=listener_resets=read_calls=write_calls=0;
  header_fetches=request_headers=context_headers=received_bytes=ticks=0;
  cache_begins=cache_appends=cache_commits=cache_aborts=cache_opens=cache_reads=cache_closes=cache_intros=0;
  cache_begin_result=cache_append_result=cache_commit_result=cache_open_result=cache_intro_result=ESP_OK;
  cache_bad_read=cache_zero_read=cache_reader_open=false;cache_expected=8;
  cache_download_bytes=cache_read_position=0;cache_committed_bytes=42;
  s_config=&configuration;paired=true;recording=sd_capturing=false;
  s_status.wifi_connected=true;s_report_page=0;reply.audio_alloc_fail=reply.client_init_fail=false;
  s_report_request_active=false;client_inits=client_cleanups=0;
}
static esp_err_t perform(bool report) {
  audio_response_t audio={0}; char body[32]={0}; client.audio=&audio;
  esp_err_t result=perform_audio_request(&client,body,sizeof(body),&audio,report);
  assert(allocations==frees && !s_report_playing && !listener && !pcm_active);
  ++cases; return result;
}
static void successful_pages(void) {
  reset(); assert(perform(true)==ESP_OK);
  assert(begins==1 && writes==2 && ends==1 && received_bytes==8);
  assert(s_has_last_spoken_page && s_last_spoken_page==3 && s_playback_page==4);
  assert(!strcmp(s_report_context,"context-1") && !strcmp(s_playback_id,"playback-1"));
  char first_turn[37]; strcpy(first_turn,s_interaction_id);
  unsigned uuid_count=uuid_calls;
  strcpy(s_report_id,"legacy-next-page"); s_paging_has_context=true;
  read_calls=0; reply.page=4; assert(perform(true)==ESP_OK);
  assert(s_last_spoken_page==4 && s_playback_page==5);
  assert(uuid_calls==uuid_count && !strcmp(first_turn,s_interaction_id) && context_headers==1);
  /* The next page is interrupted after PCM begins: retain page 5 to resume. */
  read_calls=0; reply.page=5; inject=READ_SECOND;
  assert(perform(true)==LANTERN_REPORT_INTERRUPTED);
  assert(s_last_spoken_page==4 && s_playback_page==5 && s_has_last_spoken_page);
  assert(!strcmp(s_report_context,"context-1") && !strcmp(s_playback_id,"playback-1"));
}
static void cancellation_stages(void) {
  // Multi-page action speech must not inherit an earlier report's context.
  reset();
  strcpy(s_report_id,"action-next-page"); strcpy(s_report_context,"old-report-context");
  s_paging_has_context=false; reply.context=NULL; reply.command="action_reply";
  assert(perform(false)==ESP_OK && context_headers==0);

  const unsigned stages[]={OPEN,WRITE_BODY,HEADERS,READ_FIRST,READ_SECOND,PCM_WRITE,DRAIN,GENERATION_READ,LATE_BARGE};
  for(unsigned i=0;i<sizeof(stages)/sizeof(stages[0]);++i) {
    reset(); inject=stages[i];
    strcpy(s_review_token,"review-1"); strcpy(s_report_id,"legacy-1");
    assert(perform(true)==LANTERN_REPORT_INTERRUPTED);
    assert(inject_hits==1 && !s_has_last_spoken_page);
    if(stages[i]<=HEADERS || stages[i]==READ_FIRST || stages[i]==GENERATION_READ) assert(begins==0);
    if(stages[i]>HEADERS) assert(!s_review_token[0] && !s_report_id[0]);
    /* A late HTTP data callback may never restart PCM after cancel/idle. */
    audio_response_t stale={.generation_valid=true,.generation=atomic_load(&s_speech_generation)-1,.content_is_pcm=true};
    char bytes[4]={0}; unsigned old_begins=begins,old_writes=writes;
    esp_http_client_event_t event={.event_id=HTTP_EVENT_ON_DATA,.user_data=&stale,.data=bytes,.data_len=4};
    assert(audio_http_event(&event)==ESP_FAIL && begins==old_begins && writes==old_writes);
  }
  reset(); inject=READ_SECOND; exit_context=true;
  assert(perform(true)==LANTERN_REPORT_INTERRUPTED);
  assert(!s_report_context[0] && !s_playback_id[0] && !s_interaction_id[0]);
  assert(s_playback_page==0 && !s_has_last_spoken_page && listener_resets==1);
}
static void failed_or_non_audio_pages(void) {
  reset(); reply.alloc_fail=true;
  assert(perform(true)==ESP_ERR_NO_MEM && begins==0 && !s_has_last_spoken_page);
  reset(); reply.end_error=ESP_FAIL;
  assert(perform(true)==ESP_FAIL && ends==1 && !s_has_last_spoken_page && s_playback_page==3);
  reset(); reply.write_error=ESP_FAIL;
  assert(perform(true)==ESP_FAIL && !s_has_last_spoken_page);
  reset(); reply.begin_error=ESP_FAIL;
  assert(perform(true)==ESP_FAIL && begins==1 && ends==0 && !s_has_last_spoken_page);
  reset(); reply.bytes=0;
  assert(perform(true)==ESP_OK && begins==0 && !s_has_last_spoken_page);
  reset(); reply.mime="application/json";
  assert(perform(true)==ESP_OK && begins==0 && !s_has_last_spoken_page && !s_report_context[0]);
  reset(); reply.status=500; reply.mime="application/json";
  assert(perform(true)==ESP_OK && begins==0 && !s_has_last_spoken_page && !s_report_context[0]);
  reset(); reply.status=500;
  assert(perform(true)==ESP_OK && !s_has_last_spoken_page && !s_report_context[0]);
  reset(); reply.echo="foreign-turn";
  assert(perform(true)==LANTERN_REPORT_INTERRUPTED && begins==0 && !s_report_context[0]);
  reset(); reply.stalled=true;
  assert(perform(true)==ESP_ERR_TIMEOUT && ticks==10000 && !s_has_last_spoken_page);
  reset(); reply.open_error=ESP_FAIL;
  assert(perform(true)==ESP_FAIL && write_calls==0 && header_fetches==0 && begins==0);
  reset(); reply.body_write_fail=true;
  assert(perform(true)==ESP_FAIL && header_fetches==0 && begins==0);
  reset(); reply.header_error=-1; inject=HEADERS;
  assert(perform(true)==LANTERN_REPORT_INTERRUPTED && begins==0);
  reset(); reply.header_error=-1;
  assert(perform(true)==ESP_FAIL && begins==0);
  reset(); reply.command="start";
  assert(perform(false)==ESP_OK && !s_has_last_spoken_page);
}
static void repeat_keeps_forward_cursor(void) {
  reset(); assert(perform(true)==ESP_OK);
  read_calls=0; reply.page=4; assert(perform(true)==ESP_OK);
  assert(s_playback_page==5 && s_last_spoken_page==4);
  read_calls=0; reply.page=2; reply.repeat=true;
  assert(perform(true)==ESP_OK);
  assert(s_playback_page==5 && s_last_spoken_page==2);
  /* Interrupting a deliberate repeat must not rewind the forward cursor either. */
  read_calls=0; reply.page=1; inject=READ_SECOND;
  assert(perform(true)==LANTERN_REPORT_INTERRUPTED);
  assert(s_playback_page==5 && s_last_spoken_page==2);
  read_calls=0; inject=INJECT_NONE; inject_hits=0; reply.repeat=false; reply.page=5;
  assert(perform(true)==ESP_OK && s_playback_page==6 && s_last_spoken_page==5);
}
static void context_lifecycle(void) {
  reset(); assert(perform(true)==ESP_OK);
  unsigned generation=atomic_load(&s_speech_generation);
  lantern_network_interrupt_report();
  assert(atomic_load(&s_speech_generation)==generation+1);
  assert(s_has_last_spoken_page && s_last_spoken_page==3 && s_playback_page==4);
  assert(s_report_context[0] && s_playback_id[0] && s_interaction_id[0]);
  audio_response_t same={.playback_page=4}; strcpy(same.context_id,"context-1"); strcpy(same.playback_id,"playback-1");
  remember_report_position(&same); assert(s_has_last_spoken_page && s_last_spoken_page==3);
  strcpy(same.playback_id,"new-playback"); same.playback_page=0;
  remember_report_position(&same); assert(!s_has_last_spoken_page && s_playback_page==0);
  lantern_network_end_report();
  assert(!s_report_context[0] && !s_playback_id[0] && !s_interaction_id[0]);
  assert(!s_has_last_spoken_page && !s_last_spoken_page && !s_playback_page && listener_resets==1);
  cases+=3;
}
static void trusted_clock(void) {
  s_clock_synced=false; wall_seconds=1800000000LL; mono_us=1000000;
  assert(lantern_network_trusted_time()==0); clock_synchronised(NULL);
  assert(lantern_network_trusted_time()==0);
  struct timeval sync={.tv_sec=wall_seconds}; clock_synchronised(&sync);
  assert(lantern_network_trusted_time()==wall_seconds);
  wall_seconds+=3600; mono_us+=3600000000LL;
  assert(lantern_network_trusted_time()==wall_seconds);
  wall_seconds+=120; assert(lantern_network_trusted_time()==wall_seconds);
  ++wall_seconds; assert(lantern_network_trusted_time()==0);
  wall_seconds-=242; assert(lantern_network_trusted_time()==0);
  ++wall_seconds; assert(lantern_network_trusted_time()==wall_seconds);
  /* A fresh SNTP callback can re-anchor; an unannounced wall jump cannot. */
  wall_seconds=1799990000LL; assert(lantern_network_trusted_time()==0);
  sync.tv_sec=wall_seconds; clock_synchronised(&sync);
  assert(lantern_network_trusted_time()==wall_seconds);
  mono_us=s_clock_anchor_mono-1; assert(lantern_network_trusted_time()==0);
  mono_us=s_clock_anchor_mono;
  wall_seconds=1704067199LL; sync.tv_sec=wall_seconds; clock_synchronised(&sync);
  assert(lantern_network_trusted_time()==0);
  wall_seconds=4102444801LL; sync.tv_sec=wall_seconds; clock_synchronised(&sync);
  assert(lantern_network_trusted_time()==0);
  cases+=13;
}
static void cacheable_first_page(void) {
  reset();reply.page=0;reply.cacheable=true;reply.more=true;reply.next_page=1;
  assert(perform(true)==ESP_OK&&cache_begins==1&&cache_appends==2&&cache_commits==0);
  assert(s_report_cache_downloading&&cache_writing&&s_report_cache_next_page==1&&cache_download_bytes==8);
}
static void cache_download_lifecycle(void) {
  cacheable_first_page();
  read_calls=0;reply.page=1;reply.more=false;
  assert(perform(true)==ESP_OK&&cache_begins==1&&cache_appends==4&&cache_commits==1&&cache_committed_bytes==16);
  assert(!s_report_cache_downloading&&!cache_writing&&cache_aborts==0);
  reset();reply.page=0;reply.cacheable=true;
  assert(perform(true)==ESP_OK&&cache_commits==1&&cache_committed_bytes==8);
  /* Only complete, forward, matching-profile, explicitly eligible report PCM. */
  for(unsigned reason=0;reason<7;++reason) {
    reset();reply.page=0;reply.cacheable=true;
    if(reason==0)reply.cacheable=false;
    if(reason==1)reply.voice="other-voice";
    if(reason==2)reply.command="action_reply";
    if(reason==3)reply.repeat=true;
    if(reason==4)reply.playback=NULL;
    if(reason==5)reply.status=500;
    if(reason==6)reply.page=1;
    assert(perform(true)==ESP_OK&&cache_begins==0&&cache_commits==0&&cache_committed_bytes==42);
  }
  /* A continuation cannot splice another answer, turn, generation or page. */
  for(unsigned mismatch=0;mismatch<7;++mismatch) {
    cacheable_first_page();read_calls=0;reply.page=1;reply.more=false;
    if(mismatch==0)reply.playback="foreign-playback";
    if(mismatch==1)uuid_v4(s_interaction_id);
    if(mismatch==2)atomic_fetch_add(&s_speech_generation,1);
    if(mismatch==3)reply.page=2;
    if(mismatch==4)reply.repeat=true;
    if(mismatch==5)reply.voice="foreign-voice";
    if(mismatch==6)reply.cacheable=false;
    assert(perform(true)==ESP_OK&&cache_aborts==1&&cache_commits==0&&cache_committed_bytes==42);
    assert(!s_report_cache_downloading&&!cache_writing);
  }
  /* New page zero replaces an incomplete turn, never appends it. */
  cacheable_first_page();read_calls=0;reply.page=0;reply.more=false;reply.playback="new-answer";uuid_v4(s_interaction_id);
  assert(perform(true)==ESP_OK&&cache_aborts==1&&cache_begins==2&&cache_commits==1&&cache_committed_bytes==8);
  /* Failed pages retain the previously committed cache and release SD writer. */
  for(unsigned failure=0;failure<8;++failure) {
    cacheable_first_page();read_calls=0;reply.page=1;reply.more=false;
    if(failure==0)reply.open_error=ESP_FAIL;
    if(failure==1)reply.body_write_fail=true;
    if(failure==2)reply.header_error=-1;
    if(failure==3)reply.alloc_fail=true;
    if(failure==4)reply.stalled=true;
    if(failure==5)reply.write_error=ESP_FAIL;
    if(failure==6)reply.end_error=ESP_FAIL;
    if(failure==7)reply.echo="foreign-turn";
    assert(perform(true)!=ESP_OK&&cache_aborts==1&&cache_commits==0&&cache_committed_bytes==42);
    assert(!s_report_cache_downloading&&!cache_writing);
  }
  reset();reply.page=0;reply.cacheable=true;reply.alloc_fail=true;
  assert(perform(true)==ESP_ERR_NO_MEM&&cache_begins==1&&cache_aborts==1&&!s_report_cache_downloading);
  reset();reply.page=0;reply.cacheable=true;reply.more=true;reply.next_page=3;
  assert(perform(true)==ESP_OK&&cache_aborts==1&&cache_commits==0);
  for(unsigned failure=0;failure<3;++failure) {
    reset();reply.page=0;reply.cacheable=true;
    if(failure==0)cache_begin_result=ESP_FAIL;
    if(failure==1)cache_append_result=ESP_FAIL;
    if(failure==2)cache_commit_result=ESP_FAIL;
    assert(perform(true)==ESP_OK&&received_bytes==8&&cache_committed_bytes==42&&!cache_writing&&!s_report_cache_downloading);
  }
  const unsigned stages[]={OPEN,WRITE_BODY,HEADERS,READ_FIRST,READ_SECOND,PCM_WRITE,DRAIN,GENERATION_READ,LATE_BARGE};
  for(unsigned i=0;i<sizeof(stages)/sizeof(stages[0]);++i) {
    cacheable_first_page();read_calls=0;reply.page=1;reply.more=false;inject=stages[i];
    assert(perform(true)==LANTERN_REPORT_INTERRUPTED&&cache_commits==0&&cache_aborts==1&&cache_committed_bytes==42);
    assert(!s_report_cache_downloading&&!cache_writing);
  }
}
static void wrapper_cache_failure_cleanup(void) {
  for(unsigned failure=0;failure<5;++failure) {
    cacheable_first_page();read_calls=0;reply.page=1;reply.more=false;
    if(failure==0)s_status.wifi_connected=false;
    if(failure==1)paired=false;
    if(failure==2)reply.audio_alloc_fail=true;
    if(failure==3)reply.client_init_fail=true;
    if(failure==4)reply.status=500;
    assert(play_briefing_page("status",75,true,atomic_load(&s_speech_generation))!=ESP_OK);
    assert(!s_report_cache_downloading&&!cache_writing&&cache_aborts==1&&cache_committed_bytes==42);
    assert(allocations==frees&&!pcm_active);++cases;
  }
}
static void whole_turn_page_cancellation(void) {
  for(unsigned clear=0;clear<2;++clear) for(unsigned during_init=0;during_init<2;++during_init) {
    reset();reply.page=0;reply.cacheable=true;reply.more=true;reply.next_page=1;
    inject=during_init?SECOND_PAGE_INIT:PAGE_CLEANUP;exit_context=clear;
    assert(lantern_network_play_briefing("status",75)==LANTERN_REPORT_INTERRUPTED);
    assert(inject_hits==1&&begins==1&&writes==2&&ends==1&&header_fetches==1);
    assert(client_inits==(during_init?2:1)&&client_cleanups==client_inits);
    assert(!s_report_request_active&&!s_report_cache_downloading&&!cache_writing&&cache_commits==0);
    assert(!s_report_id[0]&&!s_review_token[0]&&allocations==frees&&!pcm_active);
    ++cases;
  }
  /* A bound generation must never be replaced by a fresh perform snapshot. */
  reset();audio_response_t audio={.generation_valid=true,.generation=0};
  char body[32]={0};client.audio=&audio;atomic_store(&s_speech_generation,1);
  assert(perform_audio_request(&client,body,sizeof(body),&audio,true)==LANTERN_REPORT_INTERRUPTED);
  assert(header_fetches==0&&write_calls==0&&begins==0);++cases;
}
static void no_offline_actions(void) {
  assert(!s_review_token[0]&&!s_report_id[0]&&!s_report_context[0]&&!s_playback_id[0]&&!s_interaction_id[0]);
  assert(!s_has_last_spoken_page&&s_playback_page==0);
}
static esp_err_t cached_play(void) {
  esp_err_t result=lantern_network_play_cached_report();++cases;
  assert(allocations==frees&&!pcm_active&&!cache_reader_open&&!s_report_playing);
  return result;
}
static void cached_report_lifecycle(void) {
  reset();strcpy(s_review_token,"old-review");strcpy(s_report_id,"old-report");strcpy(s_report_context,"old-context");strcpy(s_playback_id,"old-playback");
  strcpy(s_interaction_id,"old-turn");s_has_last_spoken_page=true;s_playback_page=5;
  assert(cached_play()==ESP_OK&&cache_intros==1&&begins==1&&writes==2&&ends==1&&received_bytes==8&&cache_closes==1);
  assert(request_headers==0&&write_calls==0&&header_fetches==0);no_offline_actions();
  for(unsigned gate=0;gate<4;++gate) {
    reset();
    if(gate==0)s_config=NULL;
    if(gate==1)paired=false;
    if(gate==2)recording=true;
    if(gate==3)sd_capturing=true;
    assert(cached_play()==ESP_ERR_INVALID_STATE&&cache_opens==0&&cache_intros==0&&begins==0);
  }
  reset();cache_open_result=ESP_ERR_NOT_FOUND;
  assert(cached_play()==ESP_ERR_NOT_FOUND&&cache_intros==0&&begins==0&&cache_closes==0);no_offline_actions();
  reset();reply.alloc_fail=true;
  assert(cached_play()==ESP_ERR_NO_MEM&&cache_closes==1&&cache_intros==0&&begins==0);
  for(unsigned invalid=0;invalid<3;++invalid) {
    reset();cache_expected=invalid==0?0:invalid==1?3:QUIPUS_REPORT_CACHE_MAX_PCM+2;
    assert(cached_play()==ESP_FAIL&&cache_closes==1&&cache_intros==0&&begins==0);
  }
  reset();inject=CACHE_RESET;
  assert(cached_play()==LANTERN_REPORT_INTERRUPTED&&cache_opens==0&&cache_intros==0&&begins==0);no_offline_actions();
  reset();inject=CACHE_ALLOC;
  assert(cached_play()==LANTERN_REPORT_INTERRUPTED&&cache_closes==1&&cache_intros==0&&begins==0);no_offline_actions();
  const unsigned stages[]={CACHE_OPEN,CACHE_INTRO,CACHE_READ,PCM_WRITE,DRAIN};
  for(unsigned i=0;i<sizeof(stages)/sizeof(stages[0]);++i) {
    reset();inject=stages[i];
    assert(cached_play()==LANTERN_REPORT_INTERRUPTED&&inject_hits==1&&cache_closes==1);no_offline_actions();
    if(stages[i]==CACHE_OPEN||stages[i]==CACHE_INTRO)assert(begins==0&&writes==0);
    if(stages[i]==CACHE_READ)assert(writes==0);
  }
  for(unsigned failure=0;failure<6;++failure) {
    reset();
    if(failure==0)cache_intro_result=ESP_FAIL;
    if(failure==1)reply.begin_error=ESP_FAIL;
    if(failure==2)cache_zero_read=true;
    if(failure==3)cache_bad_read=true;
    if(failure==4)reply.write_error=ESP_FAIL;
    if(failure==5)reply.end_error=ESP_FAIL;
    assert(cached_play()==ESP_FAIL&&cache_closes==1);no_offline_actions();
  }
}
int main(void) {
  successful_pages(); cancellation_stages(); failed_or_non_audio_pages();
  repeat_keeps_forward_cursor(); context_lifecycle(); trusted_clock();
  cache_download_lifecycle();wrapper_cache_failure_cleanup();whole_turn_page_cancellation();cached_report_lifecycle();
  printf("Report playback, cancellation, cursor and trusted-clock regressions passed: %u cases\n",cases);
  return 0;
}
