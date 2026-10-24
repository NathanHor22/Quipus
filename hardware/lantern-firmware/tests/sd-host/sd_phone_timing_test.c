// Test the verbatim production normalizer against real ESP-IDF cJSON, with
// allocation failure at each parser/mutation/serializer allocation boundary.
#include "cJSON.h"
#include <stdbool.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define CHECK(value) do { if (!(value)) { fprintf(stderr,"Check failed %d: %s\n",__LINE__,#value); exit(1); } } while (0)
typedef int esp_err_t;
#define ESP_OK 0
#define ESP_ERR_NO_MEM 1
#define ESP_ERR_INVALID_ARG 2
#define ESP_ERR_INVALID_SIZE 3
static size_t s_phone_bytes;
static char s_phone_timing[768];
static unsigned allocations, fail_at;
static void *fault_malloc(size_t bytes) { return ++allocations==fail_at ? NULL : malloc(bytes); }
#include "sd_phone_timing_under_test.c"
static const char *valid_timing="{\"receivedSamples\":999,\"missingSamples\":99999,\"offsetSeconds\":0.2}";
static void reset(unsigned failure) {
  s_phone_bytes=32044;
  snprintf(s_phone_timing,sizeof(s_phone_timing),"%s",valid_timing);
  allocations=0; fail_at=failure;
  cJSON_Hooks hooks={.malloc_fn=fault_malloc,.free_fn=free}; cJSON_InitHooks(&hooks);
}
static void verify_normalized(void) {
  cJSON_InitHooks(NULL);
  cJSON *json=cJSON_Parse(s_phone_timing); CHECK(cJSON_IsObject(json));
  CHECK(cJSON_GetNumberValue(cJSON_GetObjectItemCaseSensitive(json,"receivedSamples"))==16000);
  CHECK(cJSON_GetNumberValue(cJSON_GetObjectItemCaseSensitive(json,"missingSamples"))==16000);
  CHECK(cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(json,"recovered")));
  CHECK(cJSON_GetNumberValue(cJSON_GetObjectItemCaseSensitive(json,"offsetSeconds"))==0.2);
  cJSON_Delete(json);
}
int main(void) {
  reset(0); CHECK(normalize_recovered_phone_timing()==ESP_OK);
  unsigned baseline=allocations; CHECK(baseline>5); verify_normalized();
  unsigned failures=0;
  for (unsigned i=1;i<=baseline;++i) {
    reset(i); esp_err_t result=normalize_recovered_phone_timing();
    CHECK(result==ESP_ERR_NO_MEM || result==ESP_OK);
    if (result==ESP_ERR_NO_MEM) {
      ++failures; CHECK(strcmp(s_phone_timing,valid_timing)==0);
    } else verify_normalized();
  }
  CHECK(failures>5);
  reset(0); snprintf(s_phone_timing,sizeof(s_phone_timing),"[]");
  CHECK(normalize_recovered_phone_timing()==ESP_ERR_INVALID_ARG);
  CHECK(strcmp(s_phone_timing,"[]")==0);
  reset(0); snprintf(s_phone_timing,sizeof(s_phone_timing),"{");
  CHECK(normalize_recovered_phone_timing()==ESP_ERR_NO_MEM); // Ambiguous parser failure stays retriable.
  CHECK(strcmp(s_phone_timing,"{")==0);
  reset(0); memcpy(s_phone_timing,"{\"padding\":\"",12);
  memset(s_phone_timing+12,'x',720); memcpy(s_phone_timing+732,"\"}",3);
  char original[768]; snprintf(original,sizeof(original),"%s",s_phone_timing);
  CHECK(normalize_recovered_phone_timing()==ESP_ERR_INVALID_SIZE);
  CHECK(strcmp(s_phone_timing,original)==0);
  reset(1); s_phone_bytes=44;
  CHECK(normalize_recovered_phone_timing()==ESP_OK && allocations==0);
  cJSON_InitHooks(NULL);
  printf("PASS: actual phone normalization, %u real cJSON allocation-fault boundaries, structural/size rejection and unchanged metadata on transient failure\n",failures);
}
