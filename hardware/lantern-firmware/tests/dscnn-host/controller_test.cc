// Actual candidate wrapper/controller. Host VAD is deliberately synthetic.
#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <iterator>
#include <vector>
#include "quipus_local_recognizer.h"
#include "quipus_local_inference.h"
extern "C" {int quipus_test_fail_allocation;unsigned quipus_test_allocations;unsigned quipus_test_yields;int quipus_test_fail_vad;int quipus_test_silent_vad;}
static std::array<int16_t,80000> samples;
static std::vector<int16_t> read_pcm(const char *path){
 std::ifstream input(path,std::ios::binary);assert(input);
 std::vector<unsigned char> bytes{std::istreambuf_iterator<char>(input),std::istreambuf_iterator<char>()};
 assert(bytes.size()==32000);std::vector<int16_t> values(16000);
 for(unsigned i=0;i<16000;++i)values[i]=int16_t(unsigned(bytes[2*i])|(unsigned(bytes[2*i+1])<<8));return values;
}
static void background(){for(unsigned i=0;i<80000;++i)samples[i]=(i&1)?19:-19;}
static void insert(const std::vector<int16_t> &word,unsigned start,float gain=1){
 assert(start+word.size()<=samples.size());for(unsigned i=0;i<word.size();++i)samples[start+i]=int16_t(std::nearbyint(word[i]*gain));
}
static unsigned assertions;
static bool run(const char *name,bool must_not_yes=true,bool navigation=false,bool allow_error=false,bool require_windows=true){
 const auto original=samples;const unsigned allocations=quipus_test_allocations;
 quipus_local_result_t result={};
 auto error=navigation?quipus_local_recognizer_classify_navigation(samples.data(),80000,&result):quipus_local_recognizer_classify(samples.data(),80000,&result);
 ++assertions;if(error!=ESP_OK && !allow_error){std::fprintf(stderr,"FAIL %s error=%d\n",name,error);return false;}
 ++assertions;if(original!=samples){std::fprintf(stderr,"FAIL %s changed caller PCM\n",name);return false;}
 ++assertions;if(allocations!=quipus_test_allocations){std::fprintf(stderr,"FAIL %s allocated per response\n",name);return false;}
 ++assertions;if(error==ESP_OK && ((require_windows && result.windows!=41) || (!require_windows && result.windows!=0 && result.windows!=41))){std::fprintf(stderr,"FAIL %s windows=%u\n",name,result.windows);return false;}
 ++assertions;if(must_not_yes && result.intent==QUIPUS_LOCAL_YES){std::fprintf(stderr,"FAIL %s unsafe YES\n",name);return false;}
 std::printf("case=%s result=%d confidence=%u yes=%u no=%u possible_no=%u\n",name,result.intent,result.confidence,result.diagnostics.yes_windows,result.diagnostics.no_windows,result.diagnostics.possible_no_windows);
 return true;
}
int main(int argc,char **argv){
 assert(argc>=2);
 if(std::strcmp(argv[1],"--allocation-failure")==0||std::strcmp(argv[1],"--vad-failure")==0){
  quipus_test_fail_allocation=std::strcmp(argv[1],"--allocation-failure")==0;
  quipus_test_fail_vad=std::strcmp(argv[1],"--vad-failure")==0;
  assert(quipus_local_recognizer_init()!=ESP_OK);assert(!quipus_local_recognizer_available());
  quipus_local_result_t result={};result.intent=QUIPUS_LOCAL_YES;
  assert(quipus_local_recognizer_classify(samples.data(),80000,&result)!=ESP_OK);
  assert(result.intent==QUIPUS_LOCAL_UNKNOWN);std::puts("PASS failed initialization cannot authorize");return 0;
 }
 assert(argc==5);
 auto yes=read_pcm(argv[1]),no=read_pcm(argv[2]),up=read_pcm(argv[3]),legacy_no=read_pcm(argv[4]);
 assert(quipus_local_recognizer_init()==ESP_OK);assert(quipus_local_recognizer_available());
 unsigned failures=0;
 // Positive outcomes are observations until policy/gain validation is complete.
 background();insert(yes,16000);failures+=!run("public_yes_observation",false);
 auto first=samples;
 background();insert(no,16000);failures+=!run("selected_no");
 background();insert(legacy_no,16000);failures+=!run("legacy_go_misclassified_no");
 background();insert(up,16000);failures+=!run("unrelated_public_up");
 background();insert(yes,16000);insert(no,64000);failures+=!run("yes_then_late_no");
 background();insert(no,16000);insert(yes,64000);failures+=!run("no_then_yes");
 background();insert(yes,16000);insert(no,64000,.03f);failures+=!run("yes_then_quiet_late_no");
 background();insert(no,16000,.03f);failures+=!run("quiet_no");
 background();insert(yes,16000);quipus_test_silent_vad=1;failures+=!run("yes_without_activity");quipus_test_silent_vad=0;
 samples.fill(0);failures+=!run("digital_zero",true,false,false,false);
 samples.fill(-100);failures+=!run("negative_only",true,false,true,false);
 for(unsigned i=0;i<80000;++i)samples[i]=int16_t(5000*std::sin(2*3.141592653589793*1000*i/16000));failures+=!run("steady_tone");
 uint32_t state=7;for(unsigned i=0;i<80000;++i){state=state*1664525U+1013904223U;samples[i]=int16_t((state>>16)%1001)-500;}failures+=!run("deterministic_noise");
 samples=first;failures+=!run("public_yes_after_unrelated_responses",false);
 // NAVIGATION remains non-authorizing; no-activity must never become its YES.
 quipus_test_silent_vad=1;failures+=!run("navigation_without_activity",true,true);quipus_test_silent_vad=0;
 quipus_local_result_t invalid={};invalid.intent=QUIPUS_LOCAL_YES;
 assert(quipus_local_recognizer_classify(nullptr,80000,&invalid)!=ESP_OK && invalid.intent==QUIPUS_LOCAL_UNKNOWN);
 std::printf("SUMMARY controller_cases=15 assertions=%u failures=%u; synthetic VAD only, not acoustic consent validation\n",assertions,failures);
 return failures?1:0;
}
