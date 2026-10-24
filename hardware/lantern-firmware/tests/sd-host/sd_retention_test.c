#include "cJSON.h"
#include <stdbool.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <ctype.h>
#include <errno.h>
#include <math.h>
#include <sys/stat.h>
#define CHECK(c) do { if(!(c)){fprintf(stderr,"Check failed %d: %s\n",__LINE__,#c);exit(1);} } while(0)
typedef int esp_err_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_NO_MEM 1
#define ESP_ERR_INVALID_ARG 2
#define ESP_ERR_INVALID_STATE 3
#define ESP_ERR_NOT_SUPPORTED 4
#define LANTERN_HAS_SD_CARD 1
#define SD_RECORDING_DIRECTORY "/sdcard/lantern"
#define QUIPUS_ARCHIVE_HEADER 128
#define MALLOC_CAP_SPIRAM 1
#define MALLOC_CAP_8BIT 2
#define F_OK 0
typedef uint32_t TickType_t;
#define pdMS_TO_TICKS(ms) (ms)
static _Atomic uint32_t s_upload_count_generation,s_upload_count_revision;
static _Atomic size_t s_upload_count_value;
static _Atomic TickType_t s_upload_count_checked_at;
static atomic_bool s_upload_count_valid;
static TickType_t test_ticks;
static TickType_t xTaskGetTickCount(void){return test_ticks;}

typedef struct {
 char session_id[37],prompt_id[121],begin_event_id[37],consent_event_id[37],capture_event_id[37],stop_event_id[37],transcript_event_id[37],audio_event_id[37],completion_event_id[37],phone_event_id[37],owner_id[37],local_date[11],local_time[9];
 unsigned version; bool offline_local, discarded;
} lantern_cloud_session_t;
typedef struct { size_t index; bool open; } DIR;
struct dirent { char d_name[32]; };
static char s_temporary_path[96],s_recording_path[96],s_manifest_path[96],s_phone_path[96],s_phone_temporary[96];
static char s_recording_session_id[37],s_owner_id[37],s_device_id[37],s_stem[9],s_captured_at[25],s_phone_timing[768];
static uint8_t s_archive_key[32];
static bool s_secure_ready,s_time_uncertain,s_cloud_stopped,s_audio_uploaded,s_phone_uploaded,s_finalized,s_verified;
static uint64_t s_sequence;
static lantern_cloud_session_t s_session;
static size_t s_recording_bytes,s_phone_bytes;
static int64_t s_first_verified_at,s_delete_after,s_retention_last_seen;
static bool s_retention_cleanup_started;
static DIR *s_retention_directory;
static void *s_file,*s_phone_file,*s_write_stream;
static bool s_accepting,s_finish_requested,s_phone_finishing,s_writer_failed;
static struct { bool mounted; } s_status;
static const char *owner="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",*device="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",*session="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
static const int64_t T=INT64_C(1792800000);
typedef struct {char path[96],json[8192]; bool exists,tampered; size_t bytes; uint8_t pcm[32];} file_t;
static file_t files[40];
static DIR dirs[4]; static struct dirent entry;
static unsigned writes,removes,rename_calls,marker_calls,fail_remove_at,fail_write_at,fail_marker_at,scanned;
static bool fail_rename,fail_marker,marker,verified_marker;
static unsigned json_allocations,fail_json_at;
static void *json_malloc(size_t size){return ++json_allocations==fail_json_at?NULL:malloc(size);}
static char marker_session[37];
static void *heap_caps_malloc(size_t n,int caps){(void)caps;return malloc(n);}
static size_t xStreamBufferBytesAvailable(void *stream){(void)stream;return 0;}
static bool quipus_report_cache_busy(void){return false;}
static void refresh_space(void){}
static file_t *find_file(const char *path){for(size_t i=0;i<40;++i)if(files[i].exists&&!strcmp(path,files[i].path))return &files[i];return NULL;}
static file_t *create_file(const char *path,size_t bytes){file_t *f=find_file(path);if(f)return f;for(size_t i=0;i<40;++i)if(!files[i].exists){f=&files[i];memset(f,0,sizeof(*f));f->exists=true;f->bytes=bytes;snprintf(f->path,sizeof(f->path),"%s",path);for(size_t j=0;j<32;++j)f->pcm[j]=(uint8_t)(j*7+3);return f;}CHECK(false);return NULL;}
static int fake_access(const char *path,int mode){CHECK(mode==F_OK);return find_file(path)?0:-1;}
static int fake_stat(const char *path,struct stat *info){file_t *f=find_file(path);if(!f){errno=ENOENT;return -1;}info->st_size=(long)f->bytes;return 0;}
static int fake_rename(const char *from,const char *to){++rename_calls;if(fail_rename)return -1;file_t *f=find_file(from);if(!f||find_file(to))return -1;snprintf(f->path,sizeof(f->path),"%s",to);return 0;}
static int fake_remove(const char *path){++removes;if(removes==fail_remove_at){errno=EIO;return -1;}file_t *f=find_file(path);if(!f){errno=ENOENT;return -1;}f->exists=false;return 0;}
static DIR *fake_opendir(const char *path){CHECK(!strcmp(path,SD_RECORDING_DIRECTORY));for(size_t i=0;i<4;++i)if(!dirs[i].open){dirs[i]=(DIR){.open=true};return &dirs[i];}return NULL;}
static struct dirent *fake_readdir(DIR *dir){CHECK(dir&&dir->open);while(dir->index<40){file_t *f=&files[dir->index++];if(!f->exists)continue;++scanned;snprintf(entry.d_name,sizeof(entry.d_name),"%.31s",strrchr(f->path,'/')+1);return &entry;}return NULL;}
static int fake_closedir(DIR *dir){CHECK(dir&&dir->open);dir->open=false;return 0;}
static esp_err_t quipus_archive_journal_append(const char *path,const uint8_t *key,const char *json){(void)key;++writes;if(writes==fail_write_at)return ESP_FAIL;file_t *f=create_file(path,512);snprintf(f->json,sizeof(f->json),"%s",json);return ESP_OK;}
static esp_err_t quipus_archive_journal_read(const char *path,const uint8_t *key,char *out,size_t cap){(void)key;file_t *f=find_file(path);if(!f||f->tampered||strlen(f->json)>=cap)return ESP_FAIL;snprintf(out,cap,"%s",f->json);return ESP_OK;}
static esp_err_t pending_marker(const char *stem,const char *id,bool verified,bool erase){CHECK(!strcmp(stem,"11111111"));++marker_calls;if(fail_marker||marker_calls==fail_marker_at)return ESP_FAIL;if(erase){marker=false;verified_marker=false;}else{marker=true;verified_marker=verified;snprintf(marker_session,sizeof(marker_session),"%s",id);}return ESP_OK;}
static size_t pending_marker_count(void){return marker?1:0;}
#define access fake_access
#define stat(...) fake_stat(__VA_ARGS__)
#define rename fake_rename
#define remove fake_remove
#define opendir fake_opendir
#define readdir fake_readdir
#define closedir fake_closedir
#include "retention_under_test.c"
#undef stat
#undef remove
#undef rename
#undef opendir
#undef readdir
#undef closedir
static void reset(void){
 memset(files,0,sizeof(files));memset(dirs,0,sizeof(dirs));s_retention_directory=NULL;
 snprintf(s_owner_id,sizeof(s_owner_id),"%s",owner);snprintf(s_device_id,sizeof(s_device_id),"%s",device);
 paths_for_stem("11111111");memset(&s_session,0,sizeof(s_session));snprintf(s_session.session_id,sizeof(s_session.session_id),"%s",session);snprintf(s_session.owner_id,sizeof(s_session.owner_id),"%s",owner);s_session.version=1;
 snprintf(s_recording_session_id,sizeof(s_recording_session_id),"%s",session);s_secure_ready=s_status.mounted=s_finalized=true;s_verified=false;
 s_recording_bytes=32044;s_phone_bytes=16044;s_sequence=1;s_cloud_stopped=s_audio_uploaded=s_phone_uploaded=true;
 s_first_verified_at=s_delete_after=s_retention_last_seen=0;s_retention_cleanup_started=false;s_time_uncertain=false;s_captured_at[0]=s_phone_timing[0]=0;
 s_file=s_phone_file=s_write_stream=NULL;s_accepting=s_finish_requested=s_phone_finishing=s_writer_failed=false;
 atomic_store(&s_upload_count_valid,false);test_ticks=0;
 writes=removes=rename_calls=marker_calls=fail_remove_at=fail_write_at=fail_marker_at=scanned=0;fail_rename=fail_marker=false;marker=true;verified_marker=false;
 snprintf(marker_session,sizeof(marker_session),"%s",session);
 create_file(s_recording_path,512);create_file(s_phone_path,512);CHECK(write_manifest()==ESP_OK);
}
static void assert_audio(void){const char *paths[]={SD_RECORDING_DIRECTORY "/11111111.qpa",SD_RECORDING_DIRECTORY "/11111111.qpb"};for(size_t i=0;i<2;++i){file_t *f=find_file(paths[i]);CHECK(f);for(size_t j=0;j<32;++j)CHECK(f->pcm[j]==(uint8_t)(j*7+3));}CHECK(marker);}
static void reboot(void){s_retention_directory=NULL;memset(dirs,0,sizeof(dirs));s_first_verified_at=s_delete_after=s_retention_last_seen=0;s_verified=false;s_stem[0]=s_manifest_path[0]=0;}
static void load_cache(void){cJSON *json=load_manifest(SD_RECORDING_DIRECTORY "/11111111.qpc");CHECK(json&&activate_manifest(json,"11111111"));cJSON_Delete(json);}
static size_t cleanup(int64_t now,bool trusted){size_t removed=99;esp_err_t result=lantern_sd_retention_cleanup(now,trusted,8,&removed);CHECK(result==ESP_OK);return removed;}
static void assert_deadline(int64_t first){cJSON *j=load_manifest(SD_RECORDING_DIRECTORY "/11111111.qpc");CHECK(j);int64_t a,b,c;CHECK(retention_fields(j,&a,&b,&c));CHECK(a==first&&b==first+86400);cJSON_Delete(j);}
int main(void){
 // Discarded cloud silence is still a verified encrypted local cache. Its
 // optional session field roundtrips without changing the full-day deadline.
 reset();s_session.discarded=true;CHECK(write_manifest()==ESP_OK);
 CHECK(lantern_sd_recording_confirm_uploaded_at(T)==ESP_OK);assert_audio();assert_deadline(T);
 reboot();load_cache();CHECK(s_session.discarded);CHECK(removes==0);
 CHECK(cleanup(T+86399,true)==0);assert_audio();CHECK(cleanup(T+86400,true)==1);CHECK(!marker);
 reset();CHECK(lantern_sd_recording_confirm_uploaded_at(T)==ESP_OK);assert_audio();CHECK(removes==0&&verified_marker);CHECK(find_file(SD_RECORDING_DIRECTORY "/11111111.qpc")&&!find_file(SD_RECORDING_DIRECTORY "/11111111.qpm"));assert_deadline(T);
 CHECK(lantern_sd_upload_pending_count()==0&&lantern_sd_pending_count()==1&&lantern_sd_has_private_material());CHECK(stem_has_files("11111111"));
 CHECK(lantern_sd_recording_confirm_uploaded_at(T+5000)==ESP_OK);assert_deadline(T);CHECK(cleanup(T+86399,true)==0);assert_audio();
 reboot();load_cache();CHECK(s_first_verified_at==T&&s_delete_after==T+86400);CHECK(lantern_sd_recording_confirm_uploaded_at(T+8000)==ESP_OK);assert_deadline(T);
 CHECK(cleanup(T+86400,true)==1);CHECK(!find_file(SD_RECORDING_DIRECTORY "/11111111.qpa")&&!find_file(SD_RECORDING_DIRECTORY "/11111111.qpb")&&!marker);CHECK(!lantern_sd_has_private_material());

 // Unverified data never ages out; invalid/untrusted/rollback clocks preserve.
 reset();CHECK(cleanup(T+864000,true)==0);assert_audio();CHECK(!s_verified);
 CHECK(lantern_sd_recording_confirm_uploaded_at(T)==ESP_OK);
 CHECK(cleanup(T+864000,false)==0);CHECK(cleanup(0,true)==0);CHECK(cleanup(INT64_C(9999999999),true)==0);assert_audio();
 CHECK(cleanup(T+7200,true)==0);reboot();load_cache();CHECK(s_retention_last_seen==T+7200);CHECK(cleanup(T+3600,true)==0);assert_audio();assert_deadline(T);

 // Unknown clock and legacy verified proof get a fresh conservative full day.
 reset();CHECK(lantern_sd_recording_confirm_uploaded()==ESP_OK);CHECK(cleanup(0,false)==0);assert_audio();CHECK(cleanup(T,true)==0);assert_deadline(T);CHECK(cleanup(T+86399,true)==0);assert_audio();CHECK(cleanup(T+86400,true)==1);
 reset();s_verified=true;CHECK(write_manifest()==ESP_OK);cJSON *legacy=load_manifest(s_manifest_path);CHECK(legacy);cJSON_DeleteItemFromObjectCaseSensitive(legacy,"firstVerifiedAt");cJSON_DeleteItemFromObjectCaseSensitive(legacy,"deleteAfter");cJSON_DeleteItemFromObjectCaseSensitive(legacy,"retentionLastSeenAt");char *text=cJSON_PrintUnformatted(legacy);CHECK(text);CHECK(quipus_archive_journal_append(s_manifest_path,s_archive_key,text)==ESP_OK);free(text);cJSON_Delete(legacy);
 CHECK(lantern_sd_upload_pending_count()==0);CHECK(cleanup(T,true)==0);assert_audio();assert_deadline(T);

 // A torn verification journal cannot turn an unverified recording into cache.
 reset();fail_write_at=writes+1;CHECK(lantern_sd_recording_confirm_uploaded_at(T)==ESP_FAIL);CHECK(!s_verified&&s_first_verified_at==0);CHECK(lantern_sd_upload_pending_count()==1);assert_audio();CHECK(removes==0);
 reset();fail_rename=true;CHECK(lantern_sd_recording_confirm_uploaded_at(T)==ESP_FAIL);CHECK(lantern_sd_upload_pending_count()==0);assert_audio();fail_rename=false;CHECK(cleanup(T+10,true)==0);assert_deadline(T);

 // No cleanup when its proof write fails; a torn multi-file deletion resumes.
 reset();CHECK(lantern_sd_recording_confirm_uploaded_at(T)==ESP_OK);fail_write_at=writes+1;size_t removed=99;CHECK(lantern_sd_retention_cleanup(T+86400,true,8,&removed)==ESP_FAIL&&removed==0);assert_audio();CHECK(removes==0);
 reset();CHECK(lantern_sd_recording_confirm_uploaded_at(T)==ESP_OK);fail_remove_at=2;CHECK(lantern_sd_retention_cleanup(T+86400,true,8,&removed)==ESP_FAIL&&removed==0);CHECK(!find_file(SD_RECORDING_DIRECTORY "/11111111.qpa")&&find_file(SD_RECORDING_DIRECTORY "/11111111.qpb")&&marker);reboot();load_cache();CHECK(s_retention_cleanup_started);CHECK(cleanup(T+86401,false)==0);CHECK(marker);fail_remove_at=0;CHECK(cleanup(T+86401,true)==1);CHECK(!marker);

 // Trusted-marker failures cannot erase audio; a post-deletion marker fault
 // retains identity/key protection until conservative recovery completes.
 reset();fail_marker=true;CHECK(lantern_sd_recording_confirm_uploaded_at(T)==ESP_FAIL);assert_audio();CHECK(removes==0);fail_marker=false;CHECK(cleanup(T+86400,true)==1);CHECK(!marker);
 reset();CHECK(lantern_sd_recording_confirm_uploaded_at(T)==ESP_OK);fail_marker_at=marker_calls+2;CHECK(lantern_sd_retention_cleanup(T+86400,true,8,&removed)==ESP_FAIL&&removed==0);CHECK(marker&&verified_marker&&lantern_sd_has_private_material());CHECK(!find_file(SD_RECORDING_DIRECTORY "/11111111.qpc"));
 reset();CHECK(lantern_sd_recording_confirm_uploaded_at(T)==ESP_OK);cJSON *bad=load_manifest(SD_RECORDING_DIRECTORY "/11111111.qpc");CHECK(bad);cJSON_SetNumberValue(cJSON_GetObjectItemCaseSensitive(bad,"deleteAfter"),T+1);char *bad_text=cJSON_PrintUnformatted(bad);CHECK(bad_text);CHECK(quipus_archive_journal_append(SD_RECORDING_DIRECTORY "/11111111.qpc",s_archive_key,bad_text)==ESP_OK);free(bad_text);cJSON_Delete(bad);CHECK(lantern_sd_retention_cleanup(T+86400,true,8,&removed)==ESP_ERR_INVALID_STATE);assert_audio();

 // Authentication/owner conflicts, quarantine and unexpected unsealed data stay.
 reset();CHECK(lantern_sd_recording_confirm_uploaded_at(T)==ESP_OK);find_file(SD_RECORDING_DIRECTORY "/11111111.qpc")->tampered=true;CHECK(cleanup(T+864000,true)==0);assert_audio();
 reset();CHECK(lantern_sd_recording_confirm_uploaded_at(T)==ESP_OK);snprintf(s_owner_id,sizeof(s_owner_id),"dddddddd-dddd-4ddd-8ddd-dddddddddddd");CHECK(cleanup(T+864000,true)==0);assert_audio();
 reset();CHECK(lantern_sd_recording_confirm_uploaded_at(T)==ESP_OK);create_file(SD_RECORDING_DIRECTORY "/11111111.qpx",512);CHECK(lantern_sd_retention_cleanup(T+86400,true,8,&removed)==ESP_ERR_INVALID_STATE);assert_audio();CHECK(find_file(SD_RECORDING_DIRECTORY "/11111111.qpx"));
 reset();CHECK(lantern_sd_recording_confirm_uploaded_at(T)==ESP_OK);create_file(SD_RECORDING_DIRECTORY "/11111111.tmp",1024);CHECK(lantern_sd_retention_cleanup(T+86400,true,8,&removed)==ESP_ERR_INVALID_STATE);assert_audio();

 // Active capture and bounded scan protect responsiveness and file ownership.
 reset();CHECK(lantern_sd_recording_confirm_uploaded_at(T)==ESP_OK);s_file=(void*)1;CHECK(lantern_sd_retention_cleanup(T+86400,true,8,&removed)==ESP_ERR_INVALID_STATE);assert_audio();s_file=NULL;
 for(unsigned i=0;i<12;++i){char path[96];snprintf(path,sizeof(path),SD_RECORDING_DIRECTORY "/noise%02u.bin",i);create_file(path,10);}scanned=0;CHECK(lantern_sd_retention_cleanup(T+86300,true,2,&removed)==ESP_OK&&scanned<=2);unsigned prior=scanned;CHECK(lantern_sd_retention_cleanup(T+86300,true,2,&removed)==ESP_OK&&scanned-prior<=2);assert_audio();
 unsigned before_scan=scanned;CHECK(lantern_sd_retention_cleanup(T+86300,true,1000,&removed)==ESP_OK);CHECK(scanned-before_scan<=8);
 // Malformed byte counts cannot start cache migration, proof writes or
 // deletion. Include direct NaN (before serialization turns it into null).
 const double bad_counts[]={-1,NAN,32044.5,268435457,45,0};
 const char *byte_fields[]={"audioBytes","phoneBytes"};
 for(unsigned field=0;field<2;++field){
  for(unsigned fault=0;fault<8;++fault){
   if(field==1&&fault==5)continue; // No phone source is a valid zero count.
   reset();CHECK(lantern_sd_recording_confirm_uploaded_at(T)==ESP_OK);
   cJSON *invalid=load_manifest(SD_RECORDING_DIRECTORY "/11111111.qpc");CHECK(invalid);
   cJSON_DeleteItemFromObjectCaseSensitive(invalid,byte_fields[field]);
   if(fault<6)CHECK(cJSON_AddNumberToObject(invalid,byte_fields[field],bad_counts[fault]));
   else if(fault==7)CHECK(cJSON_AddNullToObject(invalid,byte_fields[field]));
   unsigned old_writes=writes,old_renames=rename_calls;bool deleted=true;
   CHECK(retention_cleanup_record("11111111",SD_RECORDING_DIRECTORY "/11111111.qpc",invalid,T+86400,&deleted)==ESP_ERR_INVALID_STATE);
   CHECK(!deleted&&removes==0&&writes==old_writes&&rename_calls==old_renames);assert_audio();cJSON_Delete(invalid);
  }
 }
 // Actual manifest commits/cache handoffs/expiry invalidate cached counts.
 reset();CHECK(lantern_sd_upload_pending_count()==1);uint32_t revision=atomic_load(&s_upload_count_generation);CHECK(write_manifest()==ESP_OK);CHECK(atomic_load(&s_upload_count_generation)!=revision);CHECK(lantern_sd_upload_pending_count()==1);
 CHECK(lantern_sd_recording_confirm_uploaded_at(T)==ESP_OK);CHECK(lantern_sd_upload_pending_count()==0);revision=atomic_load(&s_upload_count_generation);CHECK(cleanup(T+86400,true)==1);CHECK(atomic_load(&s_upload_count_generation)!=revision);
 // Every manifest allocation is atomic: never append a partial proof.
 reset();cJSON_Hooks hooks={.malloc_fn=json_malloc,.free_fn=free};json_allocations=fail_json_at=0;cJSON_InitHooks(&hooks);CHECK(write_manifest()==ESP_OK);unsigned allocations=json_allocations;cJSON_InitHooks(NULL);CHECK(allocations>20);
 for(unsigned failure=1;failure<=allocations;++failure){reset();char before[8192];snprintf(before,sizeof(before),"%s",find_file(s_manifest_path)->json);unsigned prior_writes=writes;json_allocations=0;fail_json_at=failure;cJSON_InitHooks(&hooks);esp_err_t result=write_manifest();cJSON_InitHooks(NULL);CHECK(result==ESP_ERR_NO_MEM||result==ESP_OK);if(result!=ESP_OK){CHECK(writes==prior_writes);CHECK(!strcmp(before,find_file(s_manifest_path)->json));}assert_audio();}
 puts("PASS: actual authenticated metadata, 24h first-verification retention, reboot/idempotency, queue exclusion/reset protection, invalid/rollback time, legacy migration, torn journal/deletion, owner/auth/recovery preservation and bounded idle cleanup");
 return 0;
}
