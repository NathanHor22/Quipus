/* Real cJSON and extracted production receipt/session functions; HTTP/SD edges only. */
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include "cJSON.h"
typedef int esp_err_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_INVALID_ARG -2
#define ESP_ERR_NO_MEM -3
#include "completion_types.h"
static const char *id="11111111-1111-4111-8111-111111111111";
static const char *owner="22222222-2222-4222-8222-222222222222";
static const char *event_id="33333333-3333-4333-8333-333333333333";
static const char *response_json;
static int response_status;
static bool allocation_fail, matches;
static esp_err_t checkpoint_result;
static size_t phone_size;
static unsigned allocations,frees,posts,checkpoints,errors,uuids,cases,invalid_receipts;
#define TAG "completion-host"
static void bounded_log(const char *tag,const char *format,...) {
  assert(!strcmp(tag,TAG) && !strstr(format,"%s") && strlen(format)<100); ++invalid_receipts;
}
#define ESP_LOGW(...) bounded_log(__VA_ARGS__)
static bool checkpoint_phone;
static response_buffer_t *response_buffer_create(void) {
  if(allocation_fail) return NULL;
  response_buffer_t *r=calloc(1,sizeof(*r)); assert(r); ++allocations; return r;
}
static void tracked_free(void *p) { assert(p); ++frees; free(p); }
static void uuid_v4(char out[37]) { ++uuids; strcpy(out,event_id); }
static bool lantern_sd_recording_matches_session(const char *session_id) { assert(!strcmp(session_id,id)); return matches; }
static size_t lantern_sd_phone_size(void) { return phone_size; }
static esp_err_t lantern_sd_checkpoint(const lantern_cloud_session_t *session,bool stopped,bool audio,bool phone) {
  ++checkpoints; assert(stopped && audio && !strcmp(session->session_id,id));
  assert(!session->discarded && !session->archive_verified && !session->archive_accepted && !session->processing_queued);
  checkpoint_phone=phone; return checkpoint_result;
}
static void device_authorization(char out[140]) { strcpy(out,"Device fixture-only"); }
static int post_json_with_timeout(const char *path,const char *body,const char *authorization,
                                  response_buffer_t *response,int timeout) {
  ++posts; assert(strstr(path,id) && strstr(path,"/complete"));
  assert(strstr(body,event_id) && !strcmp(authorization,"Device fixture-only") && timeout==125000);
  if(response_json) { assert(strlen(response_json)<sizeof(response->data)); strcpy(response->data,response_json); response->length=strlen(response_json); }
  return response_status;
}
static void provider_error(const char *operation,int status,const response_buffer_t *response) {
  assert(!strcmp(operation,"Meeting processing") && status==response_status && response); ++errors;
}
#define free tracked_free
#include "completion_under_test.c"
#undef free

static lantern_cloud_session_t session(void) {
  lantern_cloud_session_t s={.version=4,.discarded=true,.archive_verified=true,.archive_accepted=true,.processing_queued=true};
  strcpy(s.session_id,id); strcpy(s.owner_id,owner); return s;
}
static void reset(void) {
  assert(allocations==frees); allocation_fail=matches=false;
  checkpoint_result=ESP_OK; phone_size=0; response_status=200; response_json=NULL;
  posts=checkpoints=errors=uuids=invalid_receipts=0; checkpoint_phone=false;
}
static void expect(const char *json,int result,bool discarded,bool verified,bool ready) {
  reset(); response_json=json; lantern_cloud_session_t s=session(); bool transcript=true;
  assert(lantern_network_complete_session(&s,&transcript)==result);
  assert(s.discarded==discarded && s.archive_verified==verified && transcript==ready);
  assert(!strcmp(s.session_id,id));
  assert(invalid_receipts==(result==ESP_FAIL?1U:0U));
  assert(allocations==frees && posts==1 && uuids==1); ++cases;
}
static void extra(const char *fields,int result,bool discarded,bool verified,bool ready) {
  char json[2048]; snprintf(json,sizeof(json),"{\"session\":{\"sessionId\":\"%s\",\"version\":8},%s}",id,fields);
  expect(json,result,discarded,verified,ready);
}
static void parser_tests(void) {
  extra("\"archiveAccepted\":true,\"archiveVerified\":true,\"discarded\":true,\"discardReason\":\"short_digital_silence\",\"processingQueued\":true,\"meeting\":{\"status\":\"ready\"}",ESP_OK,true,true,false);
  extra("\"archiveAccepted\":true,\"archiveVerified\":true,\"processingQueued\":false,\"meeting\":{\"status\":\"ready\"}",ESP_OK,false,true,true);
  extra("\"archiveVerified\":true,\"discarded\":false",ESP_OK,false,true,false);
  extra("\"archiveVerified\":true,\"discarded\":false,\"discardReason\":\"other\"",ESP_OK,false,true,false);
  extra("\"archiveAccepted\":true,\"archiveVerified\":false,\"processingQueued\":true",ESP_OK,false,false,false);
  const char *bad[]={
    "\"archiveVerified\":true,\"discarded\":true",
    "\"archiveVerified\":true,\"discarded\":true,\"discardReason\":\"other\"",
    "\"archiveVerified\":true,\"discarded\":true,\"discardReason\":null",
    "\"archiveVerified\":true,\"discarded\":true,\"discardReason\":7",
    "\"archiveVerified\":true,\"discarded\":true,\"discardReason\":\"SHORT_DIGITAL_SILENCE\"",
    "\"archiveVerified\":false,\"discarded\":true,\"discardReason\":\"short_digital_silence\"",
    "\"discarded\":true,\"discardReason\":\"short_digital_silence\"",
    "\"archiveVerified\":\"true\",\"discarded\":true,\"discardReason\":\"short_digital_silence\"",
    "\"archiveVerified\":true,\"discarded\":\"true\",\"discardReason\":\"short_digital_silence\"",
    "\"archiveVerified\":true,\"discarded\":1,\"discardReason\":\"short_digital_silence\"",
    "\"archiveVerified\":true,\"discarded\":null,\"discardReason\":\"short_digital_silence\""};
  for(unsigned i=0;i<sizeof(bad)/sizeof(bad[0]);++i) extra(bad[i],ESP_FAIL,false,false,false);
  expect("{}",ESP_FAIL,false,false,false);
  expect("{",ESP_FAIL,false,false,false);
  expect("{\"session\":{\"version\":8},\"archiveVerified\":true,\"discarded\":true,\"discardReason\":\"short_digital_silence\"}",ESP_FAIL,false,false,false);
  expect("{\"session\":{\"sessionId\":\"foreign\",\"version\":8},\"archiveVerified\":true,\"discarded\":true,\"discardReason\":\"short_digital_silence\"}",ESP_FAIL,false,false,false);
  char invalid_version[512]; snprintf(invalid_version,sizeof(invalid_version),"{\"session\":{\"sessionId\":\"%s\",\"version\":\"8\"},\"archiveVerified\":true}",id);
  expect(invalid_version,ESP_FAIL,false,false,false);
}
static void completed_null_machine_tests(void) {
  char json[2048];
  // Actual PROCESSING_QUEUED response: resetToReady clears the machine ID.
  snprintf(json,sizeof(json),"{\"accepted\":true,\"archiveAccepted\":true,\"archiveVerified\":true,\"processingQueued\":true,\"discarded\":false,\"sessionId\":\"%s\",\"conversationId\":\"hardware:%s\",\"meeting\":null,\"session\":{\"state\":\"ready\",\"sessionId\":null,\"version\":8,\"prompt\":null}}",id,id);
  expect(json,ESP_OK,false,true,false);
  // Both current explicit binding and the deployed legacy conversation binding
  // are supported independently, preserving the requested local UUID.
  snprintf(json,sizeof(json),"{\"sessionId\":\"%s\",\"archiveVerified\":true,\"session\":{\"state\":\"ready\",\"sessionId\":null,\"version\":8}}",id);
  expect(json,ESP_OK,false,true,false);
  snprintf(json,sizeof(json),"{\"conversationId\":\"hardware:%s\",\"archiveVerified\":true,\"meeting\":{\"status\":\"ready\"},\"session\":{\"state\":\"report_ready\",\"sessionId\":null,\"version\":8}}",id);
  expect(json,ESP_OK,false,true,true);
  snprintf(json,sizeof(json),"{\"conversationId\":\"hardware:%s\",\"archiveVerified\":true,\"discarded\":true,\"discardReason\":\"short_digital_silence\",\"session\":{\"state\":\"ready\",\"sessionId\":null,\"version\":8}}",id);
  expect(json,ESP_OK,true,true,false);
  // Missing/foreign/conflicting envelope or machine identities cannot confirm
  // another recording, even when one of the other identifiers happens to match.
  const char *bad[]={
    "{\"archiveVerified\":true,\"session\":{\"state\":\"ready\",\"sessionId\":null,\"version\":8}}",
    "{\"sessionId\":\"foreign\",\"archiveVerified\":true,\"session\":{\"state\":\"ready\",\"sessionId\":null,\"version\":8}}",
    "{\"conversationId\":\"hardware:foreign\",\"archiveVerified\":true,\"session\":{\"state\":\"ready\",\"sessionId\":null,\"version\":8}}"};
  for(unsigned i=0;i<sizeof(bad)/sizeof(bad[0]);++i) expect(bad[i],ESP_FAIL,false,false,false);
  snprintf(json,sizeof(json),"{\"sessionId\":\"%s\",\"conversationId\":\"hardware:foreign\",\"archiveVerified\":true,\"session\":{\"state\":\"ready\",\"sessionId\":null,\"version\":8}}",id);
  expect(json,ESP_FAIL,false,false,false);
  snprintf(json,sizeof(json),"{\"sessionId\":\"foreign\",\"conversationId\":\"hardware:%s\",\"archiveVerified\":true,\"session\":{\"state\":\"ready\",\"sessionId\":null,\"version\":8}}",id);
  expect(json,ESP_FAIL,false,false,false);
  snprintf(json,sizeof(json),"{\"sessionId\":\"%s\",\"archiveVerified\":true,\"session\":{\"state\":\"ready\",\"sessionId\":\"foreign\",\"version\":8}}",id);
  expect(json,ESP_FAIL,false,false,false);
  const char *states[]={"recording","awaiting_consent","error","status_report",""};
  for(unsigned i=0;i<sizeof(states)/sizeof(states[0]);++i) {
    snprintf(json,sizeof(json),"{\"sessionId\":\"%s\",\"archiveVerified\":true,\"session\":{\"state\":\"%s\",\"sessionId\":null,\"version\":8}}",id,states[i]);
    expect(json,ESP_FAIL,false,false,false);
  }
  snprintf(json,sizeof(json),"{\"sessionId\":\"%s\",\"archiveVerified\":true,\"session\":{\"state\":\"ready\",\"sessionId\":7,\"version\":8}}",id);
  expect(json,ESP_FAIL,false,false,false);
  snprintf(json,sizeof(json),"{\"sessionId\":\"%s\",\"archiveVerified\":true,\"session\":{\"state\":\"ready\",\"version\":8}}",id);
  expect(json,ESP_FAIL,false,false,false);
}
static void failure_and_retry_tests(void) {
  const int statuses[]={201,400,401,500,-1};
  for(unsigned i=0;i<sizeof(statuses)/sizeof(statuses[0]);++i) {
    reset(); response_status=statuses[i]; response_json="{}"; lantern_cloud_session_t s=session(); bool ready=true;
    assert(lantern_network_complete_session(&s,&ready)==ESP_FAIL);
    assert(!s.discarded && !s.archive_verified && !s.archive_accepted && !s.processing_queued && !ready);
    assert(allocations==frees); ++cases;
  }
  reset(); allocation_fail=true; lantern_cloud_session_t s=session(); bool ready=true;
  assert(lantern_network_complete_session(&s,&ready)==ESP_ERR_NO_MEM && !s.discarded && !s.archive_verified && !ready && posts==0); ++cases;
  reset(); matches=true; checkpoint_result=ESP_FAIL; s=session(); ready=true;
  assert(lantern_network_complete_session(&s,&ready)==ESP_FAIL && !s.discarded && !s.archive_verified && !ready && posts==0 && checkpoints==1); ++cases;
  reset(); assert(lantern_network_complete_session(NULL,&ready)==ESP_ERR_INVALID_ARG && !ready); ++cases;
  s=session(); s.session_id[0]=0; ready=true;
  assert(lantern_network_complete_session(&s,&ready)==ESP_ERR_INVALID_ARG && !s.discarded && !s.archive_verified && !ready); ++cases;
  // Retry uses the same completion identity and persists no stale receipt.
  char json[512]; snprintf(json,sizeof(json),"{\"session\":{\"sessionId\":\"%s\",\"version\":8},\"archiveVerified\":true,\"discarded\":true,\"discardReason\":\"short_digital_silence\"}",id);
  reset(); response_json=json; response_status=201; matches=true; s=session();
  assert(lantern_network_complete_session(&s,&ready)==ESP_OK && s.discarded && s.archive_verified);
  assert(checkpoint_phone && checkpoints==1 && uuids==1);
  response_status=500; assert(lantern_network_complete_session(&s,&ready)==ESP_FAIL);
  assert(!s.discarded && !s.archive_verified && !ready && checkpoints==2 && uuids==1 && allocations==frees); ++cases;
  for(unsigned has_event=0;has_event<2;++has_event) {
    reset(); response_json=json; matches=true; phone_size=16044; s=session();
    if(has_event) strcpy(s.phone_event_id,event_id);
    assert(lantern_network_complete_session(&s,NULL)==ESP_OK && checkpoint_phone==(has_event!=0)); ++cases;
  }
}
static void sd_roundtrip(void) {
  lantern_cloud_session_t before=session(); before.offline_local=true;
  cJSON *json=cJSON_CreateObject(); assert(json && add_session(json,&before));
  char *text=cJSON_PrintUnformatted(json); assert(text); cJSON *loaded=cJSON_Parse(text); assert(loaded);
  lantern_cloud_session_t after; memset(&after,0xa5,sizeof(after));
  assert(read_session(loaded,&after) && after.discarded && after.offline_local);
  assert(after.version==before.version && !strcmp(after.session_id,before.session_id) && !strcmp(after.owner_id,before.owner_id));
  free(text); cJSON_Delete(loaded);
  cJSON_DeleteItemFromObjectCaseSensitive(json,"discarded");
  memset(&after,0xa5,sizeof(after)); assert(read_session(json,&after) && !after.discarded); ++cases;
  assert(cJSON_AddStringToObject(json,"discarded","true"));
  assert(read_session(json,&after) && !after.discarded); ++cases;
  cJSON_DeleteItemFromObjectCaseSensitive(json,"discarded"); assert(cJSON_AddBoolToObject(json,"discarded",false));
  assert(read_session(json,&after) && !after.discarded); ++cases;
  cJSON_Delete(json); ++cases;
}
int main(void) {
  parser_tests(); completed_null_machine_tests(); failure_and_retry_tests(); sd_roundtrip();
  printf("PASS: actual strict verified-discard parser, stale receipt reset, retry identity, legacy SD roundtrip (%u cases)\n",cases);
  return 0;
}
