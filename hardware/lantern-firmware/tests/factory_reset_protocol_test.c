#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "lantern_storage.h"
#include "quipus_setup_form.h"
#include "cJSON.h"
#define CHECK(value) do { if (!(value)) { fprintf(stderr,"Check failed %d: %s\n",__LINE__,#value); exit(1); } } while (0)
#define ESP_ERR_NO_MEM 0x101
typedef uint32_t TickType_t;
#define pdMS_TO_TICKS(ms) (ms)
#define LANTERN_SCREEN_SETUP 1
static const char *DEVICE="22222222-2222-4222-8222-222222222222";
static const char *RESET="33333333-3333-4333-8333-333333333333";
static const char *SECRET="KKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKK";
static lantern_config_t config, *s_config=&config;
static lantern_factory_reset_t s_factory_reset, stored;
static bool s_factory_reset_pending, s_factory_reset_unreadable, s_suspend_auto_reconnect;
static struct { bool wifi_connected,paired,reset_pending; char last_error[96]; } s_status;
static void *s_setup_mutex=(void *)1;
static bool s_setup_saved, setup_mutex_busy, try_wifi_during_ack;
esp_err_t lantern_network_save_setup(quipus_setup_form_t *, bool, char *, size_t);
#define pdTRUE 1
static int xSemaphoreTake(void *mutex,unsigned wait){CHECK(mutex==s_setup_mutex && !wait);if(setup_mutex_busy)return 0;setup_mutex_busy=true;return pdTRUE;}
static void xSemaphoreGive(void *mutex){CHECK(mutex==s_setup_mutex && setup_mutex_busy);setup_mutex_busy=false;}
static bool lantern_network_bluetooth_allowed(void){return false;}
static unsigned wifi_saves;
bool quipus_setup_normalize_pairing_code(char code[21]){return strlen(code)==10;}

static TickType_t s_reset_ack_at, s_reset_status_at, ticks;
static bool s_credential_rejected;
static bool recording, idle=true, sd_done=true, save_fails, account_fails, archive_fails, settings_fails, journal_clear_fails;
static esp_err_t sd_result;
static unsigned erased_sd, erased_archive, erased_account, erased_settings, erased_journal, posts, ack_posts, restarts, prompts;
static int http_status;
static const char *http_body;
typedef struct { char data[6144]; } response_buffer_t;
static response_buffer_t *response_buffer_create(void){return calloc(1,sizeof(response_buffer_t));}
static void notify(void){}
static void set_error(const char *message){CHECK(message && *message);snprintf(s_status.last_error,sizeof(s_status.last_error),"%s",message);++prompts;}
esp_err_t lantern_storage_save_wifi(const char *ssid,const char *password,const char *code){CHECK(!*code);++wifi_saves;snprintf(config.wifi_ssid,sizeof(config.wifi_ssid),"%s",ssid);snprintf(config.wifi_password,sizeof(config.wifi_password),"%s",password);return ESP_OK;}
bool lantern_storage_is_paired(const lantern_config_t *c){return c && c->device_id[0] && c->device_secret[0];}
static bool lantern_audio_is_recording(void){return recording;}
static bool lantern_sd_can_power_down(void){return idle;}
static TickType_t xTaskGetTickCount(void){return ticks;}
static void abort_report_cache_download(void){}
static void quipus_report_cache_detach(void){}
static void lantern_audio_clear_private_buffer(void){}
static void lantern_transcript_reset(void){}
static void lantern_sd_clear_identity(void){}
static void esp_wifi_disconnect(void){}
static esp_err_t esp_wifi_restore(void){return ESP_OK;}
static void vTaskDelay(unsigned ms){ticks+=ms;}
static void esp_restart(void){++restarts;}
static void lantern_display_show(int screen,const char *text){CHECK(screen==LANTERN_SCREEN_SETUP && text);}
static esp_err_t lantern_sd_factory_reset_step(size_t limit,bool *done){CHECK(limit==8);++erased_sd;*done=sd_done;return sd_result;}
esp_err_t lantern_storage_clear_archive_identity(void){++erased_archive;return archive_fails ? ESP_FAIL : ESP_OK;}
esp_err_t lantern_storage_clear_account(lantern_config_t *c){++erased_account;if(account_fails)return ESP_FAIL;memset(c->owner_id,0,sizeof(c->owner_id));memset(c->device_id,0,sizeof(c->device_id));memset(c->device_secret,0,sizeof(c->device_secret));return ESP_OK;}
esp_err_t lantern_storage_clear(void){++erased_settings;return settings_fails ? ESP_FAIL : ESP_OK;}
esp_err_t lantern_storage_clear_factory_reset(void){++erased_journal;if(journal_clear_fails)return ESP_FAIL;memset(&stored,0,sizeof(stored));return ESP_OK;}
esp_err_t lantern_storage_save_factory_reset(const lantern_factory_reset_t *reset){
 if(save_fails)return ESP_FAIL;
 if(strlen(reset->request_id)!=36 || reset->request_id[0]=='Z')return ESP_ERR_INVALID_ARG;
 stored=*reset;return ESP_OK;
}
static int post_json_with_timeout(const char *path,const char *body,const char *auth,response_buffer_t *response,int timeout){
 CHECK(!strcmp(path,"/api/device/v1/reset") && timeout==10000);
 char expected[140];snprintf(expected,sizeof(expected),"Device %s.%s",DEVICE,SECRET);CHECK(!strcmp(auth,expected));
 ++posts;
 if(strstr(body,"acknowledge")){++ack_posts;
   if(try_wifi_during_ack){quipus_setup_form_t form={0};char error[96];strcpy(form.ssid,"Must not survive reset");unsigned saved=wifi_saves;CHECK(lantern_network_save_setup(&form,false,error,sizeof(error))!=ESP_OK&&wifi_saves==saved);}
   CHECK(strstr(body,RESET));CHECK(s_factory_reset.stage==LANTERN_RESET_ERASED);CHECK(erased_sd&&erased_archive&&erased_account);}
 else CHECK(!strcmp(body,"{\"action\":\"status\"}"));
 snprintf(response->data,sizeof(response->data),"%s",http_body?http_body:"");return http_status;
}
#include "reset_network_under_test.c"
static void fixture(void){
 memset(&config,0,sizeof(config));strcpy(config.device_id,DEVICE);strcpy(config.device_secret,SECRET);strcpy(config.wifi_ssid,"office");
 memset(&stored,0,sizeof(stored));memset(&s_factory_reset,0,sizeof(s_factory_reset));
 s_factory_reset_pending=s_factory_reset_unreadable=s_suspend_auto_reconnect=false;
 s_status.wifi_connected=s_status.paired=true;s_status.reset_pending=false;s_status.last_error[0]=0;s_setup_saved=setup_mutex_busy=try_wifi_during_ack=false;wifi_saves=0;
 recording=false;idle=sd_done=true;save_fails=account_fails=archive_fails=settings_fails=journal_clear_fails=false;sd_result=ESP_OK;
 erased_sd=erased_archive=erased_account=erased_settings=erased_journal=posts=ack_posts=restarts=prompts=0;
 ticks=10000;s_reset_ack_at=s_reset_status_at=0;s_credential_rejected=false;http_status=200;
 http_body="{\"reset\":{\"id\":\"33333333-3333-4333-8333-333333333333\",\"deviceId\":\"22222222-2222-4222-8222-222222222222\",\"mode\":\"factory\",\"completed\":false}}";
}
static void discover(void){CHECK(request_factory_reset());CHECK(s_factory_reset_pending && s_status.reset_pending && !s_status.paired);CHECK(!erased_sd&&!ack_posts);}
int main(void){
 CHECK(strstr(pairing_conflict_message("{\"code\":\"DEVICE_RESET_PENDING\"}"),"SD"));
 CHECK(strstr(pairing_conflict_message("{\"code\":\"DEVICE_OWNERSHIP_CONFLICT\"}"),"original account"));
 CHECK(strstr(pairing_conflict_message("{\"code\":\"DEVICE_ALREADY_PAIRED\"}"),"Already paired"));
 CHECK(!pairing_conflict_message("{\"error\":\"untrusted account details\"}"));
 CHECK(!pairing_conflict_message("not JSON"));
 fixture();http_status=503;
 CHECK(recover_rejected_credential(401));CHECK(!s_factory_reset_pending&&!erased_sd&&!erased_settings);
 CHECK(lantern_storage_is_paired(&config)&&!strcmp(config.device_secret,SECRET));
 CHECK(!recover_rejected_credential(500));CHECK(posts==1);
 // A reset can still arrive after an initial outage, without another button tap.
 http_status=200;
 lantern_network_retry_rejected_credential();
 CHECK(s_factory_reset_pending && !erased_sd && posts==2);
 fixture();http_status=204;
 CHECK(recover_rejected_credential(401) && !s_credential_rejected && s_status.paired);
 CHECK(!s_factory_reset_pending && !erased_sd && lantern_storage_is_paired(&config));
 fixture();http_body="not JSON";CHECK(!request_factory_reset()&&!erased_sd);
 fixture();http_body="{\"reset\":{\"id\":\"33333333-3333-4333-8333-333333333333\",\"deviceId\":\"44444444-4444-4444-8444-444444444444\",\"mode\":\"factory\"}}";
 CHECK(!request_factory_reset()&&!erased_sd);
 fixture();save_fails=true;CHECK(!request_factory_reset()&&!erased_sd&&!s_factory_reset_pending);
 fixture();discover();
 quipus_setup_form_t form={0};char error[96];
 strcpy(form.ssid,"New Wi-Fi");strcpy(form.password,"new-test-password");strcpy(form.pairing_code,"ABCDE23456");
 CHECK(lantern_network_save_setup(&form,false,error,sizeof(error))!=ESP_OK && !wifi_saves);
 form.pairing_code[0]=0;
 CHECK(lantern_network_save_setup(&form,true,error,sizeof(error))!=ESP_OK && !wifi_saves);
 CHECK(lantern_network_save_setup(&form,false,error,sizeof(error))==ESP_OK && wifi_saves==1);
 CHECK(!strcmp(config.wifi_ssid,"New Wi-Fi") && !strcmp(stored.device_secret,SECRET));
 s_factory_reset.stage=LANTERN_RESET_ACKNOWLEDGED;
 CHECK(lantern_network_save_setup(&form,false,error,sizeof(error))!=ESP_OK && wifi_saves==1);
 fixture();discover();setup_mutex_busy=true;
 CHECK(lantern_network_continue_factory_reset()==ESP_ERR_INVALID_STATE&&!erased_sd&&!ack_posts);
 setup_mutex_busy=false;try_wifi_during_ack=true;recording=true;CHECK(lantern_network_continue_factory_reset()==ESP_ERR_INVALID_STATE&&!erased_sd);
 recording=false;idle=false;CHECK(lantern_network_continue_factory_reset()==ESP_ERR_INVALID_STATE&&!erased_sd);
 idle=true;sd_result=ESP_ERR_INVALID_STATE;
 CHECK(lantern_network_continue_factory_reset()==ESP_ERR_INVALID_STATE&&!erased_archive&&!ack_posts);
 sd_result=ESP_OK;sd_done=false;CHECK(lantern_network_continue_factory_reset()==ESP_OK&&!erased_archive&&!ack_posts);
 sd_done=true;archive_fails=true;CHECK(lantern_network_continue_factory_reset()==ESP_FAIL&&!ack_posts);
 archive_fails=false;http_status=-1;
 CHECK(lantern_network_continue_factory_reset()==ESP_FAIL);CHECK(s_factory_reset.stage==LANTERN_RESET_ERASED&&!erased_settings&&ack_posts==1);
 CHECK(!config.device_id[0]&&!config.device_secret[0]&&!strcmp(config.wifi_ssid,"office"));
 // A reboot resumes using the durable reset-only verifier, not cleared account credentials.
 memset(&s_factory_reset,0,sizeof(s_factory_reset));s_factory_reset=stored;s_reset_ack_at=0;
 http_status=200;http_body="{\"resetComplete\":false}";
 CHECK(lantern_network_continue_factory_reset()==ESP_FAIL&&!erased_settings);
 ticks+=11000;http_body="{\"resetComplete\":true}";save_fails=true;
 CHECK(lantern_network_continue_factory_reset()==ESP_FAIL&&!erased_settings&&s_factory_reset.stage==LANTERN_RESET_ERASED);
 ticks+=11000;save_fails=false;settings_fails=true;
 CHECK(lantern_network_continue_factory_reset()==ESP_FAIL&&stored.stage==LANTERN_RESET_ACKNOWLEDGED&&!restarts);
 // After server ACK persisted, local finalization needs no network at all.
 s_status.wifi_connected=false;settings_fails=false;unsigned before=posts;
 CHECK(lantern_network_continue_factory_reset()==ESP_OK&&posts==before&&restarts==1&&erased_journal==1);
 CHECK(!stored.stage&&!config.wifi_ssid[0]);
 fixture();s_factory_reset_unreadable=true;
 CHECK(lantern_network_factory_reset_pending());
 CHECK(lantern_network_continue_factory_reset()==ESP_FAIL&&!erased_sd&&!posts);
 puts("PASS: authenticated reset intent, no erase on generic auth failures, absent/busy SD, lost ACK and reboot-safe finalization");
 return 0;
}
