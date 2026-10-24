#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <setjmp.h>

#define LANTERN_DISPLAY_WIDTH 240
#define LANTERN_DISPLAY_MENU_ITEMS 5
#define LANTERN_DISPLAY_MENU_TEXT 48
#define portTICK_PERIOD_MS 1
#define portMAX_DELAY UINT32_MAX
#define pdMS_TO_TICKS(ms) (ms)
#define pdTRUE 1
#define taskENTER_CRITICAL(...) ((void)0)
#define taskEXIT_CRITICAL(...) ((void)0)
typedef unsigned TickType_t;
#include "display_types.h"

static uint16_t pixels[LANTERN_DISPLAY_WIDTH * LANTERN_DISPLAY_HEIGHT];
static uint16_t *s_pixels = pixels;
static unsigned clipped, flushed_rows, full_flushes;
static const char *frame_directory;
static bool flush_rows(int first, int end) {
  assert(first >= 0 && end <= LANTERN_DISPLAY_HEIGHT && end > first);
  flushed_rows += (unsigned)(end-first);
  if(first==0 && end==LANTERN_DISPLAY_HEIGHT) ++full_flushes;
  return true;
}
static unsigned queued;
static int s_updates = 1;
static display_update_t queued_update;
static void xQueueOverwrite(int queue, const display_update_t *update) {
  assert(queue==1); queued_update=*update; ++queued;
}
#if CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
static unsigned clock_ms, receive_calls;
static bool volume_expiry_task;
static jmp_buf task_finished;
static TickType_t xTaskGetTickCount(void) { return clock_ms; }
static int xQueueReceive(int queue, display_update_t *update, TickType_t wait) {
  assert(queue==1);
  if(receive_calls++==0) {
    assert(wait==portMAX_DELAY); *update=queued_update; return pdTRUE;
  }
  if(volume_expiry_task) {
    if(receive_calls==2) assert(wait==1500);
    else { assert(wait==portMAX_DELAY); longjmp(task_finished,1); }
  } else {
    assert(wait==120);
    if(receive_calls>=3) longjmp(task_finished,1);
  }
  clock_ms += wait;
  return 0;
}
#endif
#include "display_under_test.c"

static void capture(const char *name) {
  if(!frame_directory) return;
  char path[1024];
  snprintf(path,sizeof(path),"%s/%s.ppm",frame_directory,name);
  FILE *file=fopen(path,"wb"); assert(file);
  fprintf(file,"P6\n%d %d\n255\n",LANTERN_DISPLAY_WIDTH,LANTERN_DISPLAY_HEIGHT);
  for(size_t i=0;i<sizeof(pixels)/sizeof(pixels[0]);++i) {
    unsigned v=pixels[i];
    unsigned char rgb[3]={(unsigned char)((v>>11)*255/31),
      (unsigned char)(((v>>5)&63)*255/63),(unsigned char)((v&31)*255/31)};
    assert(fwrite(rgb,1,3,file)==3);
  }
  assert(fclose(file)==0);
}
static void render(display_update_t *update) {
  clipped=flushed_rows=full_flushes=0;
  render_screen(update);
  assert(clipped==0);
}
static void state(display_update_t *update, lantern_screen_t screen,
                  const char *detail, const char *name) {
  update->view=DISPLAY_STATE; update->screen=screen;
  ++update->revision; snprintf(update->detail,sizeof(update->detail),"%s",detail);
  render(update); assert(full_flushes==1); capture(name);
}
#if CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
static uint32_t region_hash(int x,int y,int width,int height) {
  uint32_t hash=2166136261U;
  for(int row=y;row<y+height;++row) for(int col=x;col<x+width;++col)
    hash=(hash^pixels[row*LANTERN_DISPLAY_WIDTH+col])*16777619U;
  return hash;
}
static void caption_test(lantern_screen_t screen,const char *detail,const char *expected) {
  display_update_t update={.screen=screen}; char actual[32];
  snprintf(update.detail,sizeof(update.detail),"%s",detail);
  warm_face_caption(&update,actual); assert(!strcmp(actual,expected));
  assert(strlen(actual)*11-1<LANTERN_DISPLAY_WIDTH-10);
}
static void volume_feedback_tests(display_update_t *u) {
  u->speaking=false; u->speech_level=0; u->battery_level=-1;
  u->power_state=LANTERN_POWER_UNKNOWN;
  state(u,LANTERN_SCREEN_READY,"SAY COMPUTER OR PRESS MIDDLE","volume-idle");
  clock_ms=10000; s_requested=*u; s_requested.volume=-1;
  s_requested.volume_feedback=false; queued=0;
  lantern_display_set_volume(80);
  assert(queued==1 && !s_requested.volume_feedback && !volume_feedback_remaining(&s_requested));
  render(&queued_update); uint32_t quiet=region_hash(70,0,65,29);
  uint32_t face=region_hash(0,29,240,211);
  clock_ms=10020; lantern_display_set_volume(60);
  assert(queued==2 && s_requested.volume_feedback && volume_feedback_remaining(&s_requested)==1500);
  render(&queued_update); assert(flushed_rows==29 && full_flushes==0);
  uint32_t volume=region_hash(70,0,65,29); assert(volume!=quiet);
  assert(region_hash(0,29,240,211)==face); capture("volume-60");
  clock_ms=11000; lantern_display_set_volume(60);
  assert(queued==2 && s_requested.volume_changed_at==10020);
  lantern_display_set_status(-1,LANTERN_POWER_CHARGING,LANTERN_CONNECTIVITY_OFFLINE,-127,true);
  assert(queued==3 && s_requested.volume_changed_at==10020);
  render(&queued_update); assert(flushed_rows==29 && region_hash(70,0,65,29)==volume);
  assert(region_hash(0,29,240,211)==face);
  clock_ms=11519; render(&s_requested); assert(flushed_rows==0);
  clock_ms=11520; render(&s_requested);
  assert(flushed_rows==29 && region_hash(70,0,65,29)==quiet);
  assert(region_hash(0,29,240,211)==face); capture("volume-expired");
  clock_ms=11600; render(&s_requested); assert(flushed_rows==0);
  // Repeated changes while holding renew the deadline; a clamped unchanged
  // value does not. Compact battery and volume zones never overwrite each other.
  clock_ms=20000; lantern_display_set_volume(65);
  clock_ms=20250; lantern_display_set_volume(70);
  clock_ms=20500; lantern_display_set_volume(75);
  assert(s_requested.volume_changed_at==20500);
  clock_ms=21999; assert(volume_feedback_remaining(&s_requested)==1);
  clock_ms=22000; assert(!volume_feedback_remaining(&s_requested));
  lantern_display_set_volume(100); TickType_t at=s_requested.volume_changed_at;
  unsigned before=queued;
  clock_ms=22300; lantern_display_set_volume(999);
  assert(queued==before && s_requested.volume==100 && s_requested.volume_changed_at==at);
  lantern_display_set_status(67,LANTERN_POWER_BATTERY,LANTERN_CONNECTIVITY_ONLINE,-55,true);
  render(&queued_update); assert(region_hash(70,0,65,29)!=quiet);
  uint32_t measured=region_hash(150,0,90,29); capture("volume-with-battery");
  clock_ms=at+1500; render(&s_requested);
  assert(flushed_rows==29 && region_hash(150,0,90,29)==measured && region_hash(0,29,240,211)==face);
  // Unsigned tick arithmetic remains correct across the RTOS uptime wrap.
  clock_ms=UINT32_MAX-500; lantern_display_set_volume(50);
  clock_ms=499; assert(volume_feedback_remaining(&s_requested)==500);
  clock_ms=999; assert(!volume_feedback_remaining(&s_requested));
  // Execute the actual owner loop. It waits once for expiry, clears only the
  // status strip, then goes back to an infinite idle wait with no polling.
  clock_ms=30000; lantern_display_set_volume(55);
  receive_calls=0; volume_expiry_task=true;
  if(!setjmp(task_finished)) display_task(NULL);
  assert(clock_ms==31500 && receive_calls==3 && !volume_feedback_remaining(&s_requested));
  assert(region_hash(70,0,65,29)==quiet && region_hash(0,29,240,211)==face);
}
static void wave_tests(display_update_t *u) {
  caption_test(LANTERN_SCREEN_SAVING,"UPLOADING AUDIO 5%","Uploading / 5%");
  caption_test(LANTERN_SCREEN_SAVING,"UPLOADING AUDIO 100%","Uploading / 100%");
  caption_test(LANTERN_SCREEN_SAVING,"UPLOADING AUDIO 101%","Uploading");
  caption_test(LANTERN_SCREEN_SAVING,"VERIFYING FULL RECORDING","Verifying upload");
  caption_test(LANTERN_SCREEN_SAVING,"CHECKING FULL RECORDING","Preparing upload");
  caption_test(LANTERN_SCREEN_SAVING,"CONNECTING TO STORAGE","Connecting");
  caption_test(LANTERN_SCREEN_SAVING,"RECONNECTING UPLOAD","Reconnecting");
  caption_test(LANTERN_SCREEN_SAVING,"PROCESSING SUMMARY","Processing");
  caption_test(LANTERN_SCREEN_COMPLETE,"SUMMARY PROCESSING","Processing");
  caption_test(LANTERN_SCREEN_COMPLETE,"SAVED LOCALLY - WILL SYNC ON WIFI","Saved offline");
  caption_test(LANTERN_SCREEN_COMPLETE,"UPLOADED TO DASHBOARD","Uploaded");
  state(u,LANTERN_SCREEN_BOOTING,"INITIALIZING AUDIO. PLEASE WAIT.","starting");
  state(u,LANTERN_SCREEN_READY,"SAY COMPUTER OR PRESS MIDDLE","ready");
  assert(!warm_face_animating(u));
  for(int y=30;y<80;++y) for(int x=0;x<LANTERN_DISPLAY_WIDTH;++x)
    assert(pixels[y*LANTERN_DISPLAY_WIDTH+x]==rgb565(255,255,255));
  // Unknown measurements must never invent a battery or charging state. The
  // USB-only profile names its actual supply; a battery-capable profile says PWR.
  u->battery_level=-1; u->power_state=LANTERN_POWER_UNKNOWN; render(u);
  uint32_t unknown_power=region_hash(150,0,90,29);
  for(int y=17;y<27;++y) for(int x=150;x<LANTERN_DISPLAY_WIDTH;++x)
    assert(pixels[y*LANTERN_DISPLAY_WIDTH+x]==rgb565(255,255,255));
  uint32_t power_label=region_hash(210,9,25,7);
  rect(210,9,25,7,rgb565(255,255,255));
  const char *expected_power=LANTERN_BATTERY_INSTALLED ? "PWR" : "USB";
  draw_text(LANTERN_DISPLAY_WIDTH-7-text_width(expected_power,1),9,expected_power,1,rgb565(103,120,138));
  assert(region_hash(210,9,25,7)==power_label);
  u->power_state=LANTERN_POWER_CHARGING; render(u);
  assert(region_hash(150,0,90,29)==unknown_power); capture("usb-power");
  u->power_state=LANTERN_POWER_BATTERY; render(u);
  assert(region_hash(150,0,90,29)==unknown_power);
  u->wifi_rssi=-127; render(u);
  assert(pixels[9*LANTERN_DISPLAY_WIDTH+19]==rgb565(103,120,138));
  u->wifi_rssi=-55; u->battery_level=100; render(u);
  uint32_t neutral_mouth=region_hash(82,132,76,28);
  state(u,LANTERN_SCREEN_CONSENT,"SAY YES WE CONSENT OR NO","consent");
  assert(region_hash(82,132,76,28)==neutral_mouth);
  state(u,LANTERN_SCREEN_RECORDING,"00:42 - PRESS MIDDLE TO STOP","recording");
  uint32_t open_mouth=region_hash(82,132,76,28);
  assert(open_mouth!=neutral_mouth && !warm_face_animating(u));
  u->speaking=true; u->speech_level=4; clock_ms=4750;
  render(u); assert(flushed_rows==0 && region_hash(82,132,76,28)==open_mouth);
  u->speaking=false; u->speech_level=0;
  render(u); assert(flushed_rows==0 && region_hash(82,132,76,28)==open_mouth);
  state(u,LANTERN_SCREEN_SAVING,"UPLOADING AUDIO 5%","uploading-5");
  uint32_t heading_before=region_hash(0,207,240,26);
  snprintf(u->detail,sizeof(u->detail),"UPLOADING AUDIO 67%%");
  render(u); assert(full_flushes==0 && flushed_rows==26);
  assert(region_hash(0,207,240,26)!=heading_before);
  assert(region_hash(82,132,76,28)==neutral_mouth); capture("uploading-67");
  state(u,LANTERN_SCREEN_SAVING,"VERIFYING FULL RECORDING","verifying");
  state(u,LANTERN_SCREEN_COMPLETE,"SAVED LOCALLY - WILL SYNC ON WIFI","saved-offline");
  state(u,LANTERN_SCREEN_STATUS,"TODAY'S MEETINGS AND NEXT ACTIONS","report");
  u->speaking=true; u->speech_level=2; clock_ms=0;
  render(u); assert(full_flushes==0 && flushed_rows==28);
  uint32_t quiet=region_hash(82,132,76,28); capture("speaking-quiet");
  u->speech_level=4;
  render(u); assert(full_flushes==0 && flushed_rows==28);
  assert(region_hash(82,132,76,28)!=quiet); capture("speaking-louder");
  clock_ms=4750;
  render(u); assert(full_flushes==0 && flushed_rows==28); capture("speaking-blink");
  u->speaking=false; u->speech_level=0;
  render(u); assert(full_flushes==0 && flushed_rows==56);
  assert(region_hash(82,132,76,28)==neutral_mouth);
  state(u,LANTERN_SCREEN_ERROR,"AUDIO UPLOAD PAUSED. LOCAL COPY IS KEPT.","error-retained");
  uint32_t safe_error_frame=region_hash(0,29,LANTERN_DISPLAY_WIDTH,LANTERN_DISPLAY_HEIGHT-29);
  snprintf(u->detail,sizeof(u->detail),"SD FILES NEED REVIEW HTTP 500 INTERNAL DETAIL");
  render(u); assert(flushed_rows==0);
  assert(region_hash(0,29,LANTERN_DISPLAY_WIDTH,LANTERN_DISPLAY_HEIGHT-29)==safe_error_frame);
  state(u,LANTERN_SCREEN_LISTENING,"SAY START RECORDING OR STATUS REPORT","listening");
  assert(warm_face_animating(u));
  clock_ms=0; render(u); assert(full_flushes==0 && flushed_rows==28);
  snprintf(u->setup_password,sizeof(u->setup_password),"K7M4Q9TXAB");
  state(u,LANTERN_SCREEN_SETUP,"QUIPUS-A1C44D","setup"); assert(!warm_face_animating(u));
  state(u,LANTERN_SCREEN_BLUETOOTH,"123456","bluetooth"); assert(!warm_face_animating(u));
  // Feed the actual speech API, then the actual display owner. A throttled newer
  // level is still picked up at its bounded timeout without another PCM frame.
  u->screen=LANTERN_SCREEN_STATUS; u->speaking=false; u->speech_level=0;
  u->revision++; s_requested=*u; clock_ms=0; queued=0;
  lantern_display_set_speech_level(20,true); assert(queued==1 && queued_update.speech_level==2);
  clock_ms=20; lantern_display_set_speech_level(80,true);
  assert(queued==1 && s_requested.speech_level==4);
  receive_calls=0; volume_expiry_task=false;
  if(!setjmp(task_finished)) display_task(NULL);
  assert(clock_ms==140 && receive_calls==3);
  uint32_t loud=region_hash(82,132,76,28);
  lantern_display_set_speech_level(0,false);
  assert(queued==2 && !queued_update.speaking);
  render(&queued_update); assert(full_flushes==0);
  assert(region_hash(82,132,76,28)!=loud);
  volume_feedback_tests(u);
  puts("Waveshare face, caption, truthful USB/battery, transient volume deadlines, PCM mailbox and partial redraws passed");
}
#endif
int main(int argc,char **argv) {
  if(argc>1) frame_directory=argv[1];
  display_update_t u={.view=DISPLAY_STATE,.battery_level=100,
    .power_state=LANTERN_POWER_CHARGING,.connectivity=LANTERN_CONNECTIVITY_ONLINE,
    .wifi_rssi=-55,.paired=true,.volume=100,.charge_eta_minutes=75};
#if CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
  u.battery_level=-1; u.power_state=LANTERN_POWER_UNKNOWN;
  wave_tests(&u);
#else
  s_requested=u;
  unsigned char before[sizeof(s_requested)];
  memcpy(before,&s_requested,sizeof(before));
  lantern_display_set_speech_level(80,true);
  assert(!memcmp(&s_requested,before,sizeof(before)));
  state(&u,LANTERN_SCREEN_READY,"PRESS TO START","ready");
  state(&u,LANTERN_SCREEN_RECORDING,"00:42 - PRESS TO STOP","recording");
#if LANTERN_DISPLAY_HEIGHT > 240
  u.view=DISPLAY_SPLASH; ++u.revision; render(&u); assert(full_flushes==1); capture("splash");
  u.view=DISPLAY_HOME; ++u.revision; render(&u); assert(full_flushes==1); capture("home");
  u.view=DISPLAY_KEYBOARD; ++u.revision;
  snprintf(u.title,sizeof(u.title),"Office Wi-Fi"); snprintf(u.input,sizeof(u.input),"fixture-password");
  render(&u); assert(full_flushes==1); capture("keyboard");
#endif
  puts("Legacy display profile and speech API no-op passed");
#endif
  return 0;
}
