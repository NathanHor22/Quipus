#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "quipus_barge_in.h"
#define CHECK(c) do {if(!(c)){fprintf(stderr,"Check failed %d: %s\n",__LINE__,#c);exit(1);}}while(0)
#if CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
#include "esp_aec.h"
#include "esp_vad.h"
#include "freertos/FreeRTOS.h"
static int chunk_size=512;
static aec_handle_t aec;
static bool fail_aec,fail_vad,echo_only,speech=true,reset_during_aec,reset_during_vad;
static unsigned allocations,fail_allocation,aec_calls,vad_calls,vad_resets;
static int16_t vad_log[200000],last_ref[1024];
static size_t vad_log_count;
static unsigned critical_depth,critical_enters,critical_exits;
static bool reset_at_lock_entry;
static void (*after_unlock)(void);
void test_enter_critical(portMUX_TYPE *lock){
 CHECK(lock&&critical_depth==0&&!lock->held);
 if(reset_at_lock_entry){reset_at_lock_entry=false;quipus_barge_in_reset();}
 lock->held=1;critical_depth=1;++critical_enters;
}
void test_exit_critical(portMUX_TYPE *lock){
 CHECK(lock&&lock->held&&critical_depth==1);
 lock->held=0;critical_depth=0;++critical_exits;
 if(after_unlock){void (*callback)(void)=after_unlock;after_unlock=NULL;callback();}
}
static bool inject_after_energy;
static unsigned energy_returns;
static uint32_t mean_absolute(const int16_t*,size_t);
#endif
void __cyg_profile_func_enter(void *function,void *site) __attribute__((no_instrument_function));
void __cyg_profile_func_exit(void *function,void *site) __attribute__((no_instrument_function));
void __cyg_profile_func_enter(void *function,void *site){(void)function;(void)site;}
void __cyg_profile_func_exit(void *function,void *site){
 (void)site;
#if CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
 if(inject_after_energy&&function==(void*)mean_absolute&&++energy_returns==2){inject_after_energy=false;quipus_barge_in_reset();}
#else
 (void)function;
#endif
}
#if CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
aec_handle_t *aec_create(int rate,int filters,int channels,int mode){CHECK(rate==16000&&filters==4&&channels==1&&mode==AEC_MODE_SR_LOW_COST);aec.chunk=chunk_size;return fail_aec?NULL:&aec;}
int aec_get_chunksize(aec_handle_t *h){CHECK(h==&aec);return h->chunk;}
void aec_destroy(aec_handle_t *h){CHECK(h==&aec);}
void aec_process(aec_handle_t *h,const int16_t *mic,const int16_t *ref,int16_t *clean){CHECK(h==&aec&&critical_depth==0);++aec_calls;memcpy(last_ref,ref,(size_t)h->chunk*2);if(echo_only)memset(clean,0,(size_t)h->chunk*2);else memcpy(clean,mic,(size_t)h->chunk*2);if(reset_during_aec){reset_during_aec=false;quipus_barge_in_reset();}}
vad_handle_t vad_create(int mode){CHECK(mode==VAD_MODE_3);return fail_vad?NULL:(void*)1;}
int vad_process(vad_handle_t handle,const int16_t *samples,int rate,int ms){CHECK(handle==(void*)1&&rate==16000&&ms==20&&critical_depth==0);++vad_calls;if(vad_log_count+320<=200000){memcpy(vad_log+vad_log_count,samples,640);vad_log_count+=320;}if(reset_during_vad){reset_during_vad=false;quipus_barge_in_reset();}return speech?VAD_SPEECH:0;}
void vad_reset_trigger(vad_handle_t handle){CHECK(handle==(void*)1);++vad_resets;}
void vad_destroy(vad_handle_t handle){CHECK(handle==(void*)1);}
void *heap_caps_malloc(size_t n,unsigned caps){CHECK(caps==3&&critical_depth==0);if(++allocations==fail_allocation)return NULL;void *p=malloc(n);CHECK(p);memset(p,0xa5,n);return p;}
void *heap_caps_aligned_alloc(size_t alignment,size_t n,unsigned caps){CHECK(alignment==16);return heap_caps_malloc(n,caps);}
#endif
#include "barge_under_test.c"
#if CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
static void release_fixture(void){
 free(s_mic);free(s_ref);free(s_clean);free(s_reference);free(s_preroll);free(s_capture);
 s_mic=s_ref=s_clean=s_reference=s_preroll=s_capture=NULL;s_aec=NULL;s_vad=NULL;
}
static void reset_fixture(void){
 CHECK(critical_depth==0&&critical_enters==critical_exits);
 after_unlock=NULL;reset_at_lock_entry=false;
 release_fixture();fail_aec=fail_vad=echo_only=reset_during_aec=reset_during_vad=inject_after_energy=false;speech=true;
 chunk_size=512;allocations=fail_allocation=aec_calls=vad_calls=vad_resets=energy_returns=0;vad_log_count=0;
 s_chunk=s_fill=s_preroll_write=s_preroll_count=s_capture_count=s_vad_fill=0;s_age=s_speech=s_silence=s_feed_generation=0;
 atomic_store(&s_ref_read,0);atomic_store(&s_ref_write,0);atomic_store(&s_generation,0);atomic_store(&s_capture_generation,0);
 atomic_store(&s_enabled,false);atomic_store(&s_event,false);atomic_store(&s_capturing,false);atomic_store(&s_ready,false);atomic_store(&s_overflow,false);
}
static void frame(int16_t value){int16_t samples[512],ref[512]={0};for(size_t i=0;i<512;++i)samples[i]=value;quipus_barge_in_reference(ref,512);quipus_barge_in_feed(samples,512);}
static void reset_at_producer_handoff(void){
 CHECK(critical_depth==0&&atomic_load(&s_ref_write)>0);
 quipus_barge_in_enable(false);quipus_barge_in_enable(true);
 CHECK(atomic_load(&s_ref_read)==0&&atomic_load(&s_ref_write)==0);
}
static void trigger(void){for(unsigned i=1;i<=20;++i)frame((int16_t)(1000+i));CHECK(quipus_barge_in_take_event());CHECK(!quipus_barge_in_take_event());CHECK(quipus_barge_in_capture_pending());}
#endif
int main(void){
#if !CONFIG_LANTERN_BOARD_WAVESHARE_LCD_154
 CHECK(quipus_barge_in_init()==ESP_ERR_NOT_SUPPORTED);quipus_barge_in_enable(true);int16_t audio[4]={1,2,3,4};quipus_barge_in_reference(audio,4);quipus_barge_in_feed(audio,4);CHECK(!quipus_barge_in_take_event()&&!quipus_barge_in_capture_pending()&&!quipus_barge_in_capture_ready());CHECK(quipus_barge_in_take_audio(audio,4)==0);quipus_barge_in_reset();puts("PASS: legacy profile echo listener is disabled/no-op");
#else
 reset_fixture();fail_aec=true;CHECK(quipus_barge_in_init()==ESP_ERR_NO_MEM);
 for(unsigned i=1;i<=6;++i){reset_fixture();fail_allocation=i;CHECK(quipus_barge_in_init()==ESP_ERR_NO_MEM);CHECK(!s_aec&&!s_capture);}
 reset_fixture();fail_vad=true;CHECK(quipus_barge_in_init()==ESP_ERR_NO_MEM);reset_fixture();chunk_size=0;CHECK(quipus_barge_in_init()==ESP_ERR_NO_MEM);reset_fixture();chunk_size=1025;CHECK(quipus_barge_in_init()==ESP_ERR_NO_MEM);
 reset_fixture();CHECK(quipus_barge_in_init()==ESP_OK);frame(1000);CHECK(aec_calls==0&&vad_calls==0&&!quipus_barge_in_capture_pending());
 // Arbitrary microphone chunk sizes preserve every32ms AEC tail in20ms VAD.
 quipus_barge_in_enable(true);speech=false;int16_t stream[5120];for(size_t i=0;i<5120;++i)stream[i]=(int16_t)(500+i%127);size_t pos=0;const size_t chunks[]={13,799,5,513,120,999};unsigned part=0;
 while(pos<5120){size_t n=chunks[part++%6];if(n>5120-pos)n=5120-pos;quipus_barge_in_feed(stream+pos,n);pos+=n;}
 CHECK(aec_calls==10&&vad_calls==16&&vad_log_count==5120&&s_vad_fill==0);CHECK(!memcmp(vad_log,stream,sizeof(stream)));CHECK(!quipus_barge_in_take_event());
 // FIFO reference, zero-filled underflow and bounded overflow (no I2S wait).
 reset_fixture();CHECK(quipus_barge_in_init()==ESP_OK);quipus_barge_in_enable(true);speech=false;int16_t refs[8192];for(size_t i=0;i<8192;++i)refs[i]=(int16_t)(i+1);quipus_barge_in_reference(refs,512);int16_t mic[512]={0};quipus_barge_in_feed(mic,512);CHECK(!memcmp(last_ref,refs,1024));quipus_barge_in_feed(mic,512);for(size_t i=0;i<512;++i)CHECK(last_ref[i]==0);
 quipus_barge_in_reference(refs,8192);unsigned written=atomic_load(&s_ref_write);quipus_barge_in_reference(refs,1);CHECK(atomic_load(&s_overflow)&&atomic_load(&s_ref_write)==written);unsigned calls=aec_calls;speech=true;for(unsigned i=0;i<25;++i)frame(1500);CHECK(aec_calls==calls&&!quipus_barge_in_take_event());
 // A producer relinquishes ownership before reset; old samples cannot
 // survive a reset at handoff, and disable while waiting drops the push.
 reset_fixture();CHECK(quipus_barge_in_init()==ESP_OK);quipus_barge_in_enable(true);speech=false;
 after_unlock=reset_at_producer_handoff;quipus_barge_in_reference(refs,240);
 CHECK(!after_unlock&&atomic_load(&s_ref_write)==0);
 quipus_barge_in_feed(mic,512);for(size_t i=0;i<512;++i)CHECK(last_ref[i]==0);
 reset_at_lock_entry=true;unsigned before_write=atomic_load(&s_ref_write);quipus_barge_in_reference(refs,240);
 CHECK(!reset_at_lock_entry&&atomic_load(&s_ref_write)==before_write);
 CHECK(critical_depth==0&&critical_enters==critical_exits);
 // Echo-only cleaned output and adaptation warmup cannot trigger capture.
 reset_fixture();CHECK(quipus_barge_in_init()==ESP_OK);quipus_barge_in_enable(true);echo_only=true;for(unsigned i=0;i<30;++i)frame(3000);CHECK(!quipus_barge_in_take_event());echo_only=false;for(unsigned i=0;i<4;++i)frame(1000);CHECK(!quipus_barge_in_take_event());
 reset_fixture();CHECK(quipus_barge_in_init()==ESP_OK);quipus_barge_in_enable(true);for(unsigned i=0;i<15;++i)frame(1000);CHECK(!quipus_barge_in_take_event());for(unsigned i=0;i<5;++i)frame(1000);CHECK(quipus_barge_in_take_event());
 //320ms preroll survives stopping speaker monitoring; silence finalizes bounded.
 reset_fixture();CHECK(quipus_barge_in_init()==ESP_OK);quipus_barge_in_enable(true);trigger();CHECK(s_capture_count==5120&&s_capture[0]==1011&&s_capture[5119]==1020);quipus_barge_in_enable(false);speech=false;for(unsigned i=0;i<22;++i)frame(0);CHECK(quipus_barge_in_capture_ready());CHECK(s_capture_count==16384);int16_t *out=malloc((CAPTURE_SAMPLES+1)*2);CHECK(out);out[CAPTURE_SAMPLES]=12345;CHECK(quipus_barge_in_take_audio(out,1)==0&&quipus_barge_in_capture_ready());size_t count=quipus_barge_in_take_audio(out,CAPTURE_SAMPLES);CHECK(count==16384&&out[0]==1011&&out[5119]==1020&&out[CAPTURE_SAMPLES]==12345);for(size_t i=0;i<count;++i)CHECK(s_capture[i]==0);CHECK(!quipus_barge_in_capture_ready()&&quipus_barge_in_take_audio(out,CAPTURE_SAMPLES)==0);
 reset_fixture();CHECK(quipus_barge_in_init()==ESP_OK);quipus_barge_in_enable(true);trigger();quipus_barge_in_enable(false);for(unsigned i=0;i<220;++i)frame(1500);CHECK(quipus_barge_in_capture_ready()&&s_capture_count==CAPTURE_SAMPLES);CHECK(quipus_barge_in_take_audio(out,CAPTURE_SAMPLES)==CAPTURE_SAMPLES);free(out);
 // Reset during either heavy callback cancels the in-flight frame/generation.
 for(unsigned edge=0;edge<2;++edge){reset_fixture();CHECK(quipus_barge_in_init()==ESP_OK);quipus_barge_in_enable(true);for(unsigned i=0;i<19;++i)frame(1500);if(edge)reset_during_vad=true;else reset_during_aec=true;frame(1500);CHECK(!quipus_barge_in_take_event()&&!quipus_barge_in_capture_pending());}
 // Instrument actual mean_absolute EXIT to cancel after the generation check,
 // immediately before frame publication. No modified production body is used.
 reset_fixture();CHECK(quipus_barge_in_init()==ESP_OK);quipus_barge_in_enable(true);for(unsigned i=0;i<19;++i)frame(1500);inject_after_energy=true;energy_returns=0;frame(1500);CHECK(!quipus_barge_in_take_event()&&!quipus_barge_in_capture_pending());for(unsigned i=0;i<240;++i)frame(1500);CHECK(!quipus_barge_in_capture_pending()&&!quipus_barge_in_capture_ready());
 CHECK(critical_depth==0&&critical_enters==critical_exits);release_fixture();puts("PASS: actual echo listener allocation faults, disabled work, exact VAD chunk bridge, reference FIFO/overflow, warmup, preroll, bounded capture, handoff wipe and cancellation generation edges (acoustics not tested)");
#endif
 return 0;
}
