/* Actual boot admission and stable fault loop; only hardware/network edges mocked. */
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <setjmp.h>
#include "quipus_controls.h"
#include "quipus_ota_policy.h"
static bool lantern_sd_can_power_down(void);
typedef int esp_err_t;
typedef unsigned TickType_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154 TEST_WAVE
#define LANTERN_HAS_PHYSICAL_BUTTONS (!TEST_TOUCH)
#define LANTERN_HAS_TOUCHSCREEN TEST_TOUCH
#define LANTERN_HAS_POWER_BUTTON (!TEST_TOUCH)
#define LANTERN_POWER_BUTTON_GPIO 5
#define LANTERN_BUTTON_MAIN_GPIO 5
#define GPIO_MODE_INPUT 1
#define GPIO_PULLUP_ENABLE 1
#define ESP_ERROR_CHECK_WITHOUT_ABORT(expr) ((void)(expr))
#define ESP_ERROR_CHECK(expr) assert((expr)==ESP_OK)
#define ESP_LOGE(...) ((void)0)
#define ESP_LOGW(...) ((void)0)
#define ESP_LOGI(...) ((void)0)
#define LANTERN_SCREEN_SAVING 1
#define LANTERN_POWER_HOLD_GPIO 2
#define pdMS_TO_TICKS(ms) (ms)
#define pdTICKS_TO_MS(ticks) (ticks)
#define LANTERN_POWER_CHARGING 2
enum {LOCAL_READY,LOCAL_ERROR,LOCAL_RECORDING};
enum {RECOVERY_NONE};
typedef int lantern_power_state_t;
typedef struct {bool paired;int connectivity,wifi_rssi;} lantern_network_status_t;
#if LANTERN_HAS_PHYSICAL_BUTTONS
typedef struct {uint64_t pin_bit_mask;int mode,pull_up_en;} gpio_config_t;
#endif
static bool s_boot_complete,s_controls_ready,s_wake_available,s_power_off_requested;
#if TEST_WAVE
static bool s_agora_active;
static struct {int unused;} s_cloud_session;
static unsigned audio_chimes;
#endif
static int s_state,s_recovery,s_battery_level=-1;
static struct {char owner[12],device[12];uint8_t key[32];} s_config,original_config;
static unsigned now_ms,deadline,sd_ready_at,normal_startups,cases;
static unsigned audio_initializations,network_starts,portal_starts,screen_updates,status_updates,restarts,shutdowns;
static int audio_result,network_result,input_result;
static unsigned heartbeats,installs;
static bool update_offered;
static bool initially_held;
static unsigned intervals[4][2],interval_count;
static char title[48],body[96];
static jmp_buf done;
enum {TIMED_OUT=1,RESTARTED,POWERED_OFF};
static int64_t esp_timer_get_time(void) {return (int64_t)now_ms*1000;}
static TickType_t xTaskGetTickCount(void) {return now_ms;}
static void vTaskDelay(unsigned ms) {assert(ms==20||ms==200);now_ms+=ms;if(now_ms>=deadline)longjmp(done,TIMED_OUT);}
static bool pressed(void) {
  if(initially_held&&now_ms<5000)return true;
  for(unsigned i=0;i<interval_count;++i)if(now_ms>=intervals[i][0]&&now_ms<intervals[i][1])return true;
  return false;
}
#if LANTERN_HAS_PHYSICAL_BUTTONS
static int rtc_gpio_deinit(int pin) {assert(pin==5);return ESP_OK;}
static int gpio_config(const gpio_config_t *config) {
  assert(config&&config->pin_bit_mask==(1ULL<<5)&&config->mode==GPIO_MODE_INPUT&&config->pull_up_en==1);return input_result;
}
static int gpio_get_level(int pin) {assert(pin==5);return pressed()?0:1;}
#else
static esp_err_t lantern_board_touch_init(void) {return input_result;}
static bool lantern_board_touch_read(uint16_t *x,uint16_t *y) {*x=*y=40;return pressed();}
#endif
static void lantern_display_show_detail(const char *heading,const char *text,const char *footer) {
  assert(heading&&text&&!footer);++screen_updates;snprintf(title,sizeof(title),"%s",heading);snprintf(body,sizeof(body),"%s",text);
  assert(!strcmp(title,"MICROPHONE OFFLINE"));
}
static esp_err_t lantern_network_start(void *config,void *callback) {
  assert(config==&s_config&&!callback&&!s_boot_complete&&!s_controls_ready&&!s_wake_available&&s_state==LOCAL_ERROR);
  ++network_starts;return network_result;
}
static esp_err_t lantern_network_open_setup_portal(void) {assert(network_starts==1&&network_result==ESP_OK);++portal_starts;return ESP_OK;}
static void lantern_network_get_status(lantern_network_status_t *out) {*out=(lantern_network_status_t){.paired=true,.connectivity=1,.wifi_rssi=-50};}
static void update_battery_level(void) {s_battery_level=-1;}
static esp_err_t lantern_network_send_heartbeat(const char *state,unsigned version,int battery) {
  assert(network_result==ESP_OK&&!strcmp(state,"error")&&version==0&&battery==-1);++heartbeats;return ESP_OK;
}
static bool lantern_ota_offer_ready(void) {return update_offered;}
static esp_err_t lantern_ota_install(void) {assert(lantern_sd_can_power_down());++installs;update_offered=false;return ESP_FAIL;}
static lantern_power_state_t battery_power_state(void) {return 0;}
static void lantern_display_set_status(int battery,lantern_power_state_t power,int connectivity,int rssi,bool paired) {
  assert(battery==-1&&power==0&&connectivity==1&&rssi==-50&&paired);++status_updates;
}
static bool lantern_sd_can_power_down(void) {return now_ms>=sd_ready_at;}
static void esp_restart(void) {assert(now_ms>=sd_ready_at);++restarts;longjmp(done,RESTARTED);}
#if TEST_WAVE
static void lantern_wake_set_enabled(bool enabled) {assert(!enabled);}
static bool finish_local_recording(void) {assert(false);return false;}
static void lantern_audio_set_streaming(bool enabled) {assert(!enabled);}
static void lantern_agora_stop(void) {}
static void lantern_network_end_report(void) {}
static bool quipus_phone_audio_idle(void) {return true;}
static void show_error(int recovery,const char *detail,const char *prompt) {(void)recovery;(void)detail;(void)prompt;assert(false);}
static int lantern_sd_checkpoint(void *session,bool stopped,bool uploaded,bool phone) {(void)session;(void)stopped;(void)uploaded;(void)phone;assert(false);return ESP_FAIL;}
static void lantern_display_show(int screen,const char *detail) {assert(screen==LANTERN_SCREEN_SAVING&&detail);}
static void lantern_audio_chime(unsigned count) {(void)count;++audio_chimes;assert(false);}
static void lantern_display_set_awake(bool awake) {assert(!awake);}
static void lantern_board_speaker_enable(bool enabled) {assert(!enabled);}
static int esp_sleep_enable_ext0_wakeup(int pin,int level) {assert(pin==5&&level==0);return ESP_OK;}
static int rtc_gpio_pullup_en(int pin) {assert(pin==5);return ESP_OK;}
static int rtc_gpio_pulldown_dis(int pin) {assert(pin==5);return ESP_OK;}
static void gpio_set_level(int pin,int level) {assert(pin==2&&level==0&&now_ms>=sd_ready_at);++shutdowns;}
static void esp_deep_sleep_start(void) {assert(shutdowns==1&&audio_chimes==0);longjmp(done,POWERED_OFF);}
#endif
static esp_err_t lantern_audio_init(void) {++audio_initializations;return audio_result;}
#include "audio_fault_under_test.c"
static void reset(void) {
  memset(&s_config,0x4a,sizeof(s_config));original_config=s_config;
  s_boot_complete=s_controls_ready=s_wake_available=true;s_power_off_requested=false;s_state=LOCAL_READY;s_recovery=7;
  now_ms=0;deadline=8000;sd_ready_at=0;normal_startups=0;
  audio_initializations=network_starts=portal_starts=screen_updates=status_updates=restarts=shutdowns=heartbeats=installs=0;
  update_offered=false;
#if TEST_WAVE
  s_agora_active=false;audio_chimes=0;
#endif
  audio_result=ESP_FAIL;network_result=input_result=ESP_OK;initially_held=false;interval_count=0;title[0]=body[0]=0;
}
static int exercise(void) {
  int result=setjmp(done);
  if(!result){actual_audio_boot_branch();return 0;}
  assert(!memcmp(&s_config,&original_config,sizeof(s_config)));
  assert(audio_initializations==1&&network_starts==1&&normal_startups==0);
  assert(!s_boot_complete&&!s_controls_ready&&!s_wake_available&&s_state==LOCAL_ERROR&&s_recovery==RECOVERY_NONE);
  ++cases;return result;
}
static void tap(unsigned start,unsigned stop) {assert(interval_count<4);intervals[interval_count][0]=start;intervals[interval_count++][1]=stop;}
int main(void) {
  reset();audio_result=ESP_OK;assert(exercise()==0&&normal_startups==1&&network_starts==0&&screen_updates==0);++cases;
  reset();assert(exercise()==TIMED_OUT&&restarts==0&&shutdowns==0&&portal_starts==1&&status_updates>=6);
  assert(!strcmp(title,"MICROPHONE OFFLINE")&&strstr(body,"restart"));
  reset();tap(100,220);assert(exercise()==RESTARTED&&restarts==1&&shutdowns==0&&now_ms==220);
  reset();initially_held=true;deadline=6000;assert(exercise()==TIMED_OUT&&restarts==0&&shutdowns==0);
  reset();sd_ready_at=400;tap(100,220);tap(500,620);
  assert(exercise()==RESTARTED&&restarts==1&&now_ms==620&&screen_updates==2);
  reset();network_result=ESP_FAIL;tap(100,220);
  assert(exercise()==RESTARTED&&portal_starts==0&&status_updates==0);
  // The fault screen keeps checking in so the dashboard shows it and a fixed
  // firmware can arrive; an update waits for idle hands and finished saving.
  reset();deadline=40000;assert(exercise()==TIMED_OUT&&heartbeats==2&&installs==0);
  reset();network_result=ESP_FAIL;deadline=40000;assert(exercise()==TIMED_OUT&&heartbeats==0);
  reset();update_offered=true;deadline=100000;assert(exercise()==TIMED_OUT&&installs==0);
  reset();update_offered=true;deadline=140000;assert(exercise()==TIMED_OUT&&installs==1&&screen_updates==2);
  reset();update_offered=true;sd_ready_at=200000;deadline=140000;assert(exercise()==TIMED_OUT&&installs==0);
  reset();input_result=ESP_FAIL;tap(100,220);
  assert(exercise()==TIMED_OUT&&restarts==0&&shutdowns==0&&strstr(body,"RESET"));
#if TEST_WAVE
  reset();tap(100,2400);assert(exercise()==POWERED_OFF&&shutdowns==1&&restarts==0&&now_ms>=2400);
  reset();sd_ready_at=2500;tap(100,2400);tap(3000,5400);
  assert(exercise()==POWERED_OFF&&shutdowns==1&&restarts==0&&now_ms>=5400&&screen_updates==2);
#else
  reset();tap(100,2400);assert(exercise()==TIMED_OUT&&restarts==0&&shutdowns==0);
#endif
  printf("Actual nonrebooting audio fault: %u cases passed (Wave=%d touch=%d), one init and preserved identity\n",cases,TEST_WAVE,TEST_TOUCH);
  return 0;
}
