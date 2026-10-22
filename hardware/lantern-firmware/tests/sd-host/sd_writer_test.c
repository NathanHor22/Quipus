// Fault-injection harness for the real production SD coordinator functions.
// Crypto/container integrity is independently covered by test-firmware-archive.py.
#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdatomic.h>
#include <setjmp.h>

typedef int esp_err_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_NO_MEM 0x101
#define ESP_ERR_INVALID_ARG 0x102
#define ESP_ERR_INVALID_STATE 0x103
#define ESP_ERR_INVALID_SIZE 0x104
#define ESP_ERR_TIMEOUT 0x107
#define LANTERN_HAS_SD_CARD 1
#define MALLOC_CAP_SPIRAM 1
#define MALLOC_CAP_8BIT 2
#define pdTRUE 1
#define pdPASS 1
#define portMAX_DELAY UINT32_MAX
#define pdMS_TO_TICKS(ms) (ms)
#define ESP_LOGE(tag, ...) ((void)(tag))
#define CHECK(c) do { if (!(c)) { fprintf(stderr, "Check failed %d: %s\n", __LINE__, #c); exit(1); } } while (0)

typedef struct test_stream { uint8_t *data; size_t used, capacity; } *StreamBufferHandle_t;
typedef int StaticStreamBuffer_t;
typedef int *SemaphoreHandle_t;
typedef void *TaskHandle_t;
typedef struct { bool mounted; } lantern_sd_status_t;
typedef struct { FILE *file; size_t bytes; bool failed; } quipus_archive_writer_t;
static const char *TAG = "sd-host";
static lantern_sd_status_t s_status;
static quipus_archive_writer_t *s_file, *s_phone_file;
static char s_temporary_path[96], s_recording_path[96];
static size_t s_pcm_bytes, s_recording_bytes;
static bool s_finalized;
static struct test_stream stream;
static int semaphore, allocations, fail_allocation, task_creations;
static bool fail_task, timeout_finish;
static esp_err_t append_error, finish_error, journal_error;
static unsigned worker_waits, append_calls, finish_calls, journal_calls;
static jmp_buf worker_return;
static void writer_task(void *argument);
static void run_writer(void);
static esp_err_t write_manifest(void);
static void refresh_space(void);
static void *heap_caps_malloc(size_t bytes, int caps) { (void)caps; return ++allocations == fail_allocation ? NULL : malloc(bytes); }
static SemaphoreHandle_t xSemaphoreCreateBinary(void) { return &semaphore; }
static StreamBufferHandle_t xStreamBufferCreateStatic(size_t n, size_t trigger, uint8_t *buffer, StaticStreamBuffer_t *state) {
  (void)trigger; (void)state; stream.data=buffer; stream.capacity=n-1; stream.used=0; return (StreamBufferHandle_t)&stream;
}
static int xTaskCreatePinnedToCore(void (*task)(void *), const char *name, unsigned stack, void *arg, unsigned priority, TaskHandle_t *handle, int core) {
  (void)task; (void)name; (void)stack; (void)arg; (void)priority; (void)core;
  ++task_creations; if(fail_task) return 0; *handle=(void *)1; return pdPASS;
}
static size_t xStreamBufferSpacesAvailable(StreamBufferHandle_t s) { return s->capacity-s->used; }
static size_t xStreamBufferBytesAvailable(StreamBufferHandle_t s) { return s->used; }
static size_t xStreamBufferSend(StreamBufferHandle_t s, const void *data, size_t n, unsigned wait) {
  (void)wait; size_t space=xStreamBufferSpacesAvailable(s); if(n>space)n=space;
  memcpy(s->data+s->used,data,n); s->used+=n; return n;
}
static size_t xStreamBufferReceive(StreamBufferHandle_t s, void *out, size_t n, unsigned wait) {
  (void)wait; if(n>s->used)n=s->used; memcpy(out,s->data,n); s->used-=n; memmove(s->data,s->data+n,s->used); return n;
}
static unsigned ulTaskNotifyTake(int clear, unsigned wait) { (void)clear; (void)wait; if(worker_waits++)longjmp(worker_return,1); return 1; }
static void xTaskNotifyGive(TaskHandle_t task) { (void)task; }
static void xSemaphoreGive(SemaphoreHandle_t sem) { *sem=1; }
static int xSemaphoreTake(SemaphoreHandle_t sem, unsigned wait) { if(!*sem && wait && !timeout_finish)run_writer(); if(!*sem)return 0; *sem=0; return pdTRUE; }
static esp_err_t quipus_archive_append(quipus_archive_writer_t *w, const void *data, size_t n) {
  ++append_calls; if(append_error!=ESP_OK){w->failed=true;return append_error;}
  if(w->failed||n%2)return ESP_FAIL;
  CHECK(fwrite(data,1,n,w->file)==n); CHECK(fflush(w->file)==0); w->bytes+=n; return ESP_OK;
}
static esp_err_t quipus_archive_finish(quipus_archive_writer_t *w, size_t *pcm) {
  ++finish_calls; esp_err_t result=w->failed?ESP_FAIL:finish_error;
  if(result==ESP_OK)*pcm=w->bytes;
  CHECK(fclose(w->file)==0);free(w);return result;
}

#include "sd_writer_under_test.c"

static void run_writer(void) { worker_waits=0; if(setjmp(worker_return)==0)writer_task(NULL); }
static esp_err_t write_manifest(void) { ++journal_calls; return journal_error; }
static void refresh_space(void) {}
static void start_fixture(void) {
  CHECK(!s_file&&!s_phone_file&&!s_finish_requested);
  remove("sd-test.tmp");remove("sd-test.qpa");
  snprintf(s_temporary_path,sizeof(s_temporary_path),"sd-test.tmp");
  snprintf(s_recording_path,sizeof(s_recording_path),"sd-test.qpa");
  s_file=calloc(1,sizeof(*s_file));CHECK(s_file);s_file->file=fopen(s_temporary_path,"wb");CHECK(s_file->file);
  s_status.mounted=true;s_accepting=true;s_writer_failed=false;s_finalized=false;
  s_recording_bytes=s_pcm_bytes=0;stream.used=0;semaphore=0;
  append_error=finish_error=journal_error=ESP_OK;timeout_finish=false;
  atomic_store(&s_recording_error,ESP_OK);
}
static size_t file_size(const char *path) { FILE *f=fopen(path,"rb");CHECK(f);CHECK(fseek(f,0,SEEK_END)==0);long n=ftell(f);CHECK(n>=0);fclose(f);return (size_t)n; }
int main(void) {
  // A missing worker buffer fails before task startup; retries reuse resources.
  fail_allocation=2;
  CHECK(ensure_writer()==ESP_ERR_NO_MEM);CHECK(s_writer_task==NULL);CHECK(task_creations==0);
  uint8_t *storage=s_write_stream_storage;
  fail_allocation=0;fail_task=true;
  CHECK(ensure_writer()==ESP_ERR_NO_MEM);CHECK(s_write_stream_storage==storage);CHECK(s_write_block);CHECK(allocations==3);
  fail_task=false;CHECK(ensure_writer()==ESP_OK);CHECK(allocations==3);CHECK(ensure_writer()==ESP_OK);CHECK(task_creations==2);
  CHECK(lantern_sd_can_power_down());
  int16_t pcm[320]; for(size_t i=0;i<320;++i)pcm[i]=(int16_t)i;
  start_fixture();CHECK(!lantern_sd_can_power_down());
  lantern_sd_recording_write(pcm,320);CHECK(stream.used==sizeof(pcm));run_writer();
  CHECK(lantern_sd_recording_error()==ESP_OK);CHECK(lantern_sd_recording_finish()==ESP_OK);
  CHECK(file_size("sd-test.qpa")==sizeof(pcm));CHECK(s_finalized);CHECK(lantern_sd_recording_ready());
  CHECK(lantern_sd_can_power_down()); // A finalized unuploaded recording is safe.
  s_phone_finishing=true;CHECK(!lantern_sd_can_power_down());s_phone_finishing=false;
  s_phone_file=(quipus_archive_writer_t *)1;CHECK(!lantern_sd_can_power_down());s_phone_file=NULL;

  // Queue overflow rejects a whole frame; already accepted even-byte PCM drains.
  start_fixture();stream.capacity=sizeof(pcm)+1;
  lantern_sd_recording_write(pcm,320);lantern_sd_recording_write(pcm,320);
  CHECK(lantern_sd_recording_error()==ESP_ERR_NO_MEM);CHECK(!s_accepting);CHECK(stream.used==sizeof(pcm));
  lantern_sd_recording_write(pcm,320);CHECK(stream.used==sizeof(pcm));
  CHECK(lantern_sd_recording_finish()==ESP_ERR_NO_MEM);CHECK(file_size("sd-test.qpa")==sizeof(pcm));
  CHECK(!lantern_sd_recording_ready());CHECK(lantern_sd_can_power_down());
  stream.capacity=SD_WRITE_BUFFER_BYTES-1;

  // Card I/O failure latches immediately and cannot be replaced by another fault.
  start_fixture();lantern_sd_recording_write(pcm,320);run_writer();
  append_error=ESP_ERR_TIMEOUT;lantern_sd_recording_write(pcm,320);run_writer();
  CHECK(lantern_sd_recording_error()==ESP_ERR_TIMEOUT);CHECK(!s_accepting);
  size_t queued=stream.used;lantern_sd_recording_write(pcm,320);CHECK(stream.used==queued);
  recording_failed(ESP_ERR_NO_MEM);CHECK(lantern_sd_recording_error()==ESP_ERR_TIMEOUT);
  CHECK(lantern_sd_recording_finish()==ESP_ERR_TIMEOUT);CHECK(file_size("sd-test.tmp")==sizeof(pcm));
  CHECK(s_recording_bytes==0);CHECK(!lantern_sd_recording_ready());CHECK(lantern_sd_can_power_down());

  // A final journal failure retains the completed audio rather than deleting it.
  start_fixture();lantern_sd_recording_write(pcm,320);journal_error=ESP_FAIL;
  CHECK(lantern_sd_recording_finish()==ESP_FAIL);CHECK(file_size("sd-test.qpa")==sizeof(pcm));
  CHECK(!lantern_sd_recording_ready());CHECK(lantern_sd_can_power_down());

  // A timed-out finalization continues owning the archive and blocks shutdown.
  start_fixture();lantern_sd_recording_write(pcm,320);timeout_finish=true;
  CHECK(lantern_sd_recording_finish()==ESP_ERR_TIMEOUT);CHECK(lantern_sd_capture_active());CHECK(!lantern_sd_can_power_down());
  timeout_finish=false;run_writer();CHECK(!lantern_sd_capture_active());CHECK(lantern_sd_can_power_down());
  CHECK(lantern_sd_recording_error()==ESP_ERR_TIMEOUT);CHECK(file_size("sd-test.qpa")==sizeof(pcm));
  CHECK(append_calls>=6&&finish_calls==5&&journal_calls==4);
  remove("sd-test.tmp");remove("sd-test.qpa");free(s_write_block);free(s_write_stream_storage);
  puts("SD coordinator fault tests passed: allocation retry, full-frame queue overflow, I/O failure, retained audio, journal failure, finalization timeout and safe offline shutdown.");
  return 0;
}
