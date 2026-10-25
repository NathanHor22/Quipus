// Production queue/quarantine functions are extracted verbatim by the runner.
// Only filesystem, authenticated-manifest and archive-codec edges are fixtures.
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <stdatomic.h>
#define CHECK(value) do { if (!(value)) { fprintf(stderr,"Check failed %d: %s\n",__LINE__,#value); exit(1); } } while (0)
typedef int esp_err_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_NO_MEM 1
#define ESP_ERR_INVALID_ARG 2
#define ESP_ERR_INVALID_SIZE 6
#define ESP_ERR_INVALID_STATE 3
#define ESP_ERR_NOT_FOUND 4
#define ESP_ERR_NOT_SUPPORTED 5
#define LANTERN_HAS_SD_CARD 1
#define SD_RECORDING_DIRECTORY "/sdcard/lantern"
#define F_OK 0
typedef uint32_t TickType_t;
#define pdMS_TO_TICKS(ms) (ms)
static _Atomic uint32_t s_upload_count_generation,s_upload_count_revision;
static _Atomic size_t s_upload_count_value;
static _Atomic TickType_t s_upload_count_checked_at;
static atomic_bool s_upload_count_valid;
static TickType_t test_ticks;
static TickType_t xTaskGetTickCount(void){return test_ticks;}


typedef struct { char session_id[37]; bool offline_local; } lantern_cloud_session_t;
typedef struct fixture fixture_t;
typedef struct { double valuedouble; bool number, truth; fixture_t *manifest; } cJSON;
struct fixture {
  const char *stem, *id, *owner, *device;
  bool present, offline, audio_uploaded, stopped, invalid, incomplete;
  bool quarantined, cached, pending_marker;
  uint8_t audio[32], phone[32];
  cJSON root, sequence, uploaded, verified;
};
static fixture_t files[2], *active;
static bool s_secure_ready=true, s_verified, s_finalized, s_cloud_stopped, s_audio_uploaded, s_phone_uploaded, s_writer_failed;
static const char *s_owner_id="owner-a", *s_device_id="device-a", *TAG="sd-test";
static void *s_file, *s_phone_file;
static atomic_int s_recording_error;
static size_t s_recording_bytes, s_phone_bytes;
static char s_temporary_path[96]="temporary", s_recording_path[96]="recording";
static char s_phone_temporary[96]="phone-temp", s_phone_path[96]="phone", s_manifest_path[96]="manifest";
static lantern_cloud_session_t s_session;
static unsigned opens, activations, writes, confirmations, renames, recoveries, loads, logs, normalizations;
static unsigned fail_load_at, fail_recovery_at;
static bool mutate_during_load;
static void invalidate_upload_count(void);
static bool fail_rename, fail_write;
static bool fail_open;
static struct { bool mounted; } s_status;
static unsigned orphan_markers, marker_queries;
static size_t pending_marker_count(void) {
  ++marker_queries;
  size_t count=orphan_markers;
  for(size_t i=0;i<2;++i) if(files[i].pending_marker) ++count;
  return count;
}
static esp_err_t timing_result;
static const char *last_category, *last_result;
typedef struct { unsigned index; } DIR;
struct dirent { char d_name[20]; };
static DIR directory;
static struct dirent entry;
static DIR *opendir(const char *path) {
  CHECK(strcmp(path,SD_RECORDING_DIRECTORY)==0); ++opens; directory.index=0; return fail_open ? NULL : &directory;
}
static struct dirent *readdir(DIR *dir) {
  while (dir->index < 2) {
    fixture_t *f=&files[dir->index++];
    if (!f->present && !f->quarantined && !f->cached) continue;
    snprintf(entry.d_name,sizeof(entry.d_name),"%s.%s",f->stem,f->present ? "qpm" : f->cached ? "qpc" : "qpx");
    return &entry;
  }
  return NULL;
}
static void closedir(DIR *dir) { CHECK(dir==&directory); }
static bool manifest_name(const char *name,char stem[9]) {
  if (strlen(name)!=12 || strcmp(name+8,".qpm")) return false;
  memcpy(stem,name,8); stem[8]=0; return true;
}
static cJSON *load_manifest(const char *path) {
  if (mutate_during_load) { mutate_during_load=false; invalidate_upload_count(); }
  if (++loads==fail_load_at) return NULL;
  for (size_t i=0;i<2;++i) {
    char expected[96]; snprintf(expected,sizeof(expected),SD_RECORDING_DIRECTORY "/%s.qpm",files[i].stem);
    if (files[i].present && strcmp(path,expected)==0) return &files[i].root;
  }
  return NULL;
}
static cJSON *cJSON_GetObjectItemCaseSensitive(cJSON *json,const char *key) {
  if (!json || !json->manifest) return NULL;
  if (strcmp(key,"sequence")==0) return &json->manifest->sequence;
  if (strcmp(key,"audioUploaded")==0) return &json->manifest->uploaded;
  if (strcmp(key,"verified")==0) return &json->manifest->verified;
  return NULL;
}
static bool cJSON_IsNumber(cJSON *json) { return json && json->number; }
bool cJSON_IsTrue(cJSON *json) { return json && json->truth; }
static void cJSON_Delete(cJSON *json) { (void)json; }
static bool activate_manifest(cJSON *json,const char *stem) {
  ++activations;
  fixture_t *f=json->manifest;
  CHECK(strcmp(stem,f->stem)==0);
  // Structural failure happens before changing active paths in production.
  if (f->invalid || strcmp(f->owner,s_owner_id) || strcmp(f->device,s_device_id)) return false;
  active=f;
  snprintf(s_session.session_id,sizeof(s_session.session_id),"%s",f->id);
  s_session.offline_local=f->offline; s_audio_uploaded=f->audio_uploaded;
  s_cloud_stopped=f->stopped; s_phone_uploaded=false; s_finalized=!f->incomplete;
  return true;
}
static esp_err_t recover_track(const char *temporary,const char *recording,bool phone,size_t *size) {
  (void)temporary; (void)recording; (void)phone; ++recoveries;
  if (recoveries==fail_recovery_at) return ESP_FAIL;
  *size=32044; return ESP_OK;
}
static esp_err_t normalize_recovered_phone_timing(void) { ++normalizations; return timing_result; }
static esp_err_t write_manifest(void) { ++writes; return fail_write ? ESP_FAIL : ESP_OK; }
static int access(const char *path,int mode) {
  CHECK(mode==F_OK);
  for (size_t i=0;i<2;++i) {
    char expected[96]; snprintf(expected,sizeof(expected),SD_RECORDING_DIRECTORY "/%s.qpx",files[i].stem);
    if (strcmp(path,expected)==0) return files[i].quarantined ? 0 : -1;
    snprintf(expected,sizeof(expected),SD_RECORDING_DIRECTORY "/%s.qpc",files[i].stem);
    if (strcmp(path,expected)==0) return files[i].cached ? 0 : -1;
  }
  CHECK(false); return -1;
}
static int queue_rename(const char *from,const char *to) {
  ++renames;
  for (size_t i=0;i<2;++i) {
    char expected[96],target[96];
    snprintf(expected,sizeof(expected),SD_RECORDING_DIRECTORY "/%s.qpm",files[i].stem);
    snprintf(target,sizeof(target),SD_RECORDING_DIRECTORY "/%s.qpx",files[i].stem);
    bool quarantine=strcmp(to,target)==0;
    snprintf(target,sizeof(target),SD_RECORDING_DIRECTORY "/%s.qpc",files[i].stem);
    bool cache=strcmp(to,target)==0;
    if (strcmp(from,expected)==0 && (quarantine || cache)) {
      CHECK(files[i].present && !(cache ? files[i].cached : files[i].quarantined));
      if (fail_rename) return -1;
      files[i].present=false;
      if(cache) files[i].cached=true; else files[i].quarantined=true;
      return 0;
    }
  }
  // Renaming any encrypted track instead of metadata is forbidden.
  CHECK(false); return -1;
}
static void log_quarantine(const char *tag,const char *format,const char *category,const char *result) {
  CHECK(strcmp(tag,TAG)==0);
  CHECK(strcmp(format,"SD queue quarantine category=%s result=%s")==0);
  CHECK(!strcmp(category,"metadata") || !strcmp(category,"audio") || !strcmp(category,"phone_timing"));
  CHECK(!strcmp(result,"preserved") || !strcmp(result,"rename_failed") || !strcmp(result,"already_present"));
  ++logs; last_category=category; last_result=result;
}
#define rename queue_rename
#define ESP_LOGW log_quarantine
#include "sd_queue_under_test.c"
#undef ESP_LOGW
#undef rename
static void reset(void) {
  // Newer file is listed first; persisted sequence, not directory order, wins.
  files[0]=(fixture_t){.stem="22222222",.id="new-offline",.owner=s_owner_id,.device=s_device_id,.present=true,.offline=true,.pending_marker=true};
  files[1]=(fixture_t){.stem="11111111",.id="older-cloud",.owner=s_owner_id,.device=s_device_id,.present=true,.audio_uploaded=true,.stopped=true,.pending_marker=true};
  for (size_t i=0;i<2;++i) {
    files[i].root.manifest=&files[i]; files[i].sequence.number=true; files[i].uploaded.truth=files[i].audio_uploaded;
    for (size_t j=0;j<32;++j) { files[i].audio[j]=(uint8_t)(j+i*31); files[i].phone[j]=(uint8_t)(255-j-i*31); }
  }
  files[0].sequence.valuedouble=20; files[1].sequence.valuedouble=10;
  s_secure_ready=true; s_file=s_phone_file=NULL; s_verified=false; active=NULL;
  opens=activations=writes=confirmations=renames=recoveries=loads=logs=normalizations=0;
  fail_load_at=fail_recovery_at=0; fail_rename=fail_write=false; timing_result=ESP_OK;
  fail_open=false; s_status.mounted=true; orphan_markers=marker_queries=0;
  last_category=last_result=NULL; mutate_during_load=false;
  atomic_store(&s_upload_count_valid,false); test_ticks=0;
  memset(&s_session,0,sizeof(s_session)); atomic_store(&s_recording_error,ESP_FAIL); s_writer_failed=true;
}
static void check_preserved(void) {
  for (size_t i=0;i<2;++i) {
    CHECK(files[i].pending_marker);
    for (size_t j=0;j<32;++j) {
      CHECK(files[i].audio[j]==(uint8_t)(j+i*31)); CHECK(files[i].phone[j]==(uint8_t)(255-j-i*31));
    }
  }
  CHECK(confirmations==0);
}
static esp_err_t select_pending(lantern_cloud_session_t *selected) {
  return lantern_sd_next_pending(s_owner_id,s_device_id,selected,NULL,NULL,NULL);
}
int main(void) {
  lantern_cloud_session_t selected={0}; bool stopped=false,audio=false,phone=false;
  reset();
  CHECK(lantern_sd_next_pending(s_owner_id,s_device_id,&selected,&stopped,&audio,&phone)==ESP_OK);
  CHECK(strcmp(selected.session_id,"older-cloud")==0 && !selected.offline_local && stopped && audio && !phone);
  CHECK(files[0].present && files[1].present && renames==0 && logs==0);
  CHECK(atomic_load(&s_recording_error)==ESP_OK && !s_writer_failed);
  // An unresolved cloud409 must select the same valid oldest file again.
  CHECK(select_pending(&selected)==ESP_OK && !strcmp(selected.session_id,"older-cloud"));
  CHECK(renames==0 && logs==0); check_preserved();
  files[1].present=false; // Simulated verified cloud completion of only this file.
  CHECK(select_pending(&selected)==ESP_OK && !strcmp(selected.session_id,"new-offline"));
  CHECK(files[0].present && renames==0);

  reset();
  CHECK(lantern_sd_next_pending("other-owner",s_device_id,NULL,NULL,NULL,NULL)==ESP_ERR_INVALID_STATE);
  CHECK(lantern_sd_next_pending(s_owner_id,"other-device",NULL,NULL,NULL,NULL)==ESP_ERR_INVALID_STATE);
  CHECK(lantern_sd_next_pending(NULL,s_device_id,NULL,NULL,NULL,NULL)==ESP_ERR_INVALID_STATE);
  CHECK(lantern_sd_next_pending(s_owner_id,NULL,NULL,NULL,NULL,NULL)==ESP_ERR_INVALID_STATE);
  s_secure_ready=false; CHECK(select_pending(NULL)==ESP_ERR_INVALID_STATE);
  s_secure_ready=true; s_file=(void *)1; CHECK(select_pending(NULL)==ESP_ERR_INVALID_STATE);
  s_file=NULL; s_phone_file=(void *)1; CHECK(select_pending(NULL)==ESP_ERR_INVALID_STATE);
  CHECK(opens==0 && activations==0 && writes==0 && renames==0); check_preserved();

  reset(); files[1].invalid=true;
  CHECK(select_pending(NULL)==ESP_FAIL);
  CHECK(writes==0 && recoveries==0 && renames==1 && !files[1].present && files[1].quarantined);
  CHECK(!strcmp(last_category,"metadata") && !strcmp(last_result,"preserved")); check_preserved();
  CHECK(select_pending(&selected)==ESP_OK && !strcmp(selected.session_id,"new-offline")); check_preserved();

  reset(); fail_load_at=3; // Transient second-read failure, not structural damage.
  CHECK(select_pending(NULL)==ESP_FAIL);
  CHECK(renames==0 && logs==0 && files[1].present); check_preserved();
  CHECK(select_pending(&selected)==ESP_OK && !strcmp(selected.session_id,"older-cloud"));

  reset(); files[1].incomplete=true; timing_result=ESP_ERR_INVALID_ARG;
  CHECK(select_pending(NULL)==ESP_ERR_INVALID_ARG);
  CHECK(recoveries==2 && normalizations==1 && writes==0 && renames==1 && files[1].quarantined);
  CHECK(!strcmp(last_category,"phone_timing")); check_preserved();
  CHECK(select_pending(&selected)==ESP_OK && !strcmp(selected.session_id,"new-offline")); check_preserved();

  reset(); files[1].incomplete=true; timing_result=ESP_ERR_NO_MEM;
  CHECK(select_pending(NULL)==ESP_ERR_NO_MEM);
  CHECK(normalizations==1 && renames==0 && logs==0 && files[1].present); check_preserved();
  timing_result=ESP_OK; CHECK(select_pending(&selected)==ESP_OK && !strcmp(selected.session_id,"older-cloud"));

  reset(); files[1].incomplete=true; timing_result=ESP_ERR_INVALID_SIZE;
  CHECK(select_pending(NULL)==ESP_ERR_INVALID_SIZE);
  CHECK(renames==1 && files[1].quarantined && !strcmp(last_category,"phone_timing")); check_preserved();

  reset(); fail_recovery_at=1;
  CHECK(select_pending(NULL)==ESP_FAIL);
  CHECK(renames==1 && files[1].quarantined && !strcmp(last_category,"audio")); check_preserved();
  CHECK(select_pending(&selected)==ESP_OK && !strcmp(selected.session_id,"new-offline"));

  reset(); fail_write=true;
  CHECK(select_pending(NULL)==ESP_FAIL);
  CHECK(writes==1 && renames==0 && files[1].present); check_preserved();
  fail_write=false; CHECK(select_pending(&selected)==ESP_OK && !strcmp(selected.session_id,"older-cloud"));

  reset(); files[1].invalid=true; fail_rename=true;
  CHECK(select_pending(NULL)==ESP_FAIL);
  CHECK(renames==1 && files[1].present && !files[1].quarantined && !strcmp(last_result,"rename_failed")); check_preserved();
  fail_rename=false; CHECK(select_pending(NULL)==ESP_FAIL);
  CHECK(renames==2 && files[1].quarantined); check_preserved();

  reset(); files[1].invalid=true; files[1].quarantined=true;
  CHECK(select_pending(NULL)==ESP_FAIL);
  CHECK(renames==0 && files[1].present && files[1].quarantined && !strcmp(last_result,"already_present")); check_preserved();

  reset(); files[0].present=files[1].present=false;
  CHECK(select_pending(NULL)==ESP_ERR_NOT_FOUND);
  CHECK(writes==0 && renames==0 && logs==0); check_preserved();
  // Work scheduling must not mistake retained quarantine/orphan evidence for
  // uploadable manifests. The conservative identity/reset count stays intact.
  reset(); orphan_markers=15;
  CHECK(lantern_sd_upload_pending_count()==2 && marker_queries==0);
  CHECK(lantern_sd_pending_count()==17 && marker_queries==1);
  CHECK(loads>0 && activations==0 && writes==0 && renames==0);
  files[1].present=false; files[1].quarantined=true; invalidate_upload_count();
  marker_queries=0;
  CHECK(lantern_sd_upload_pending_count()==1 && marker_queries==0);
  CHECK(files[1].quarantined && files[1].pending_marker);
  CHECK(lantern_sd_pending_count()==17);
  files[0].present=false; // Simulate only an externally verified cleanup.
  files[0].pending_marker=false; invalidate_upload_count();
  marker_queries=0;
  CHECK(lantern_sd_upload_pending_count()==0 && marker_queries==0);
  CHECK(lantern_sd_pending_count()==16);
  CHECK(orphan_markers==15 && files[1].pending_marker && files[1].quarantined);
  CHECK(loads>0 && activations==0 && writes==0 && renames==0);
  reset(); files[1].verified.truth=true;
  CHECK(lantern_sd_upload_pending_count()==1);
  CHECK(select_pending(&selected)==ESP_OK && !strcmp(selected.session_id,"new-offline"));
  CHECK(files[1].cached && !files[1].present && files[1].pending_marker);
  CHECK(lantern_sd_upload_pending_count()==1 && lantern_sd_pending_count()==2);
  check_preserved();
  reset(); fail_open=true;
  CHECK(lantern_sd_upload_pending_count()==0 && marker_queries==0);
  CHECK(files[0].present && files[1].present); check_preserved();
  reset(); s_status.mounted=false;
  CHECK(lantern_sd_upload_pending_count()==0 && opens==0 && marker_queries==0);
  check_preserved();
  // One scan serves frequent telemetry; real metadata transitions invalidate.
  reset(); CHECK(lantern_sd_upload_pending_count()==2);
  unsigned opened=opens, loaded=loads;
  for(test_ticks=1000;test_ticks<60000;test_ticks+=1000)
    CHECK(lantern_sd_upload_pending_count()==2);
  CHECK(opens==opened && loads==loaded);
  quarantine_manifest("11111111","metadata");
  CHECK(lantern_sd_upload_pending_count()==1 && opens==opened+1);
  CHECK(lantern_sd_pending_count()==2 && files[1].pending_marker);

  // External changes are observed by the bounded refresh interval.
  reset(); CHECK(lantern_sd_upload_pending_count()==2); opened=opens;
  files[1].present=false;
  test_ticks=59999; CHECK(lantern_sd_upload_pending_count()==2 && opens==opened);
  test_ticks=60000; CHECK(lantern_sd_upload_pending_count()==1 && opens==opened+1);

  // A mutation during a scan cannot publish that overtaken snapshot.
  reset(); mutate_during_load=true; CHECK(lantern_sd_upload_pending_count()==2);
  opened=opens; CHECK(lantern_sd_upload_pending_count()==2 && opens==opened+1);

  reset(); test_ticks=UINT32_MAX-30000; CHECK(lantern_sd_upload_pending_count()==2); opened=opens;
  test_ticks=10000; CHECK(lantern_sd_upload_pending_count()==2 && opens==opened);
  test_ticks=30000; CHECK(lantern_sd_upload_pending_count()==2 && opens==opened+1);
  atomic_store(&s_upload_count_generation,UINT32_MAX); CHECK(lantern_sd_upload_pending_count()==2); opened=opens;
  invalidate_upload_count(); CHECK(atomic_load(&s_upload_count_generation)==0);
  CHECK(lantern_sd_upload_pending_count()==2 && opens==opened+1);
  reset(); fail_open=true; CHECK(lantern_sd_upload_pending_count()==0);
  fail_open=false; CHECK(lantern_sd_upload_pending_count()==2);
  puts("PASS: SD candidate-vs-protection counts, SD FIFO, retained cloud-conflicted files, invalid metadata/phone/audio quarantine, preserved tracks/markers, transient reads/writes, rename/collision safety and identity/writer guards");
}
