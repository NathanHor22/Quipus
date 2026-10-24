// Actual C frontend + actual TFLM adapter. Public/generated fixtures only.
#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <iterator>
#include <vector>
#include "quipus_mfcc.h"
#include "quipus_dscnn.h"
static unsigned checks;
#define CHECK(value) do { ++checks; if (!(value)) { \
 std::fprintf(stderr,"FAIL line %d: %s\n",__LINE__,#value); return 1; } } while (0)
static std::vector<uint8_t> read_file(const char *path) {
 std::ifstream input(path,std::ios::binary); assert(input);
 return {std::istreambuf_iterator<char>(input),std::istreambuf_iterator<char>()};
}
static quipus_mfcc_workspace_t workspace;
static std::array<int16_t,16000> pcm;
static std::array<int8_t,490> features;
static std::array<float,490> mfcc;
static std::array<int8_t,12> scores;
static int selftest(const std::vector<uint8_t> &model) {
 static const char *names[]={"down","go","left","no","off","on","right","stop","up","yes","silence","unknown"};
 CHECK(QUIPUS_DSCNN_NO==3 && QUIPUS_DSCNN_YES==9 && QUIPUS_DSCNN_SILENCE==10);
 for(unsigned i=0;i<12;++i) CHECK(std::strcmp(quipus_dscnn_label(i),names[i])==0);
 CHECK(quipus_dscnn_label(12)==nullptr);
 quipus_dscnn_close(); scores.fill(7);
 CHECK(quipus_dscnn_predict(features.data(),490,scores.data())==QUIPUS_DSCNN_NOT_READY);
 CHECK(std::all_of(scores.begin(),scores.end(),[](int v){return v==-128;}));
 CHECK(quipus_dscnn_init(model.data(),model.size()-1)==QUIPUS_DSCNN_INVALID_ARGUMENT);
 auto damaged=model; damaged[0]^=255;
 CHECK(quipus_dscnn_init(damaged.data(),damaged.size())==QUIPUS_DSCNN_INVALID_MODEL);
 CHECK(quipus_dscnn_init(model.data(),model.size())==QUIPUS_DSCNN_OK);
 CHECK(quipus_dscnn_arena_used()>0 && quipus_dscnn_arena_used()<=QUIPUS_DSCNN_ARENA_BYTES);
 CHECK(quipus_dscnn_predict(nullptr,490,scores.data())==QUIPUS_DSCNN_INVALID_ARGUMENT);
 CHECK(quipus_dscnn_predict(features.data(),489,scores.data())==QUIPUS_DSCNN_INVALID_ARGUMENT);
 CHECK(std::all_of(scores.begin(),scores.end(),[](int v){return v==-128;}));
 CHECK(quipus_dscnn_reset()==QUIPUS_DSCNN_OK);
 uint8_t mapped[4];
 // Every class is checked. Unrelated labels must never become YES or NO.
 for(unsigned label=0;label<12;++label) {
  scores.fill(-128); scores[label]=127; scores[(label==11)?0:11]=-127;
  CHECK(quipus_dscnn_map4(scores.data(),mapped)==QUIPUS_DSCNN_OK);
  CHECK(mapped[2]==(label==9?255:0)); CHECK(mapped[3]==(label==3?255:0));
 }
 scores.fill(-128); std::memset(mapped,42,4);
 CHECK(quipus_dscnn_map4(scores.data(),mapped)==QUIPUS_DSCNN_INVALID_DISTRIBUTION);
 CHECK(mapped[0]==0 && mapped[1]==0 && mapped[2]==0 && mapped[3]==0);
 scores.fill(127);
 CHECK(quipus_dscnn_map4(scores.data(),mapped)==QUIPUS_DSCNN_INVALID_DISTRIBUTION);
 CHECK(mapped[2]==0 && mapped[3]==0);
 CHECK(quipus_dscnn_map4(nullptr,mapped)==QUIPUS_DSCNN_INVALID_ARGUMENT);
 CHECK(quipus_dscnn_map4(scores.data(),nullptr)==QUIPUS_DSCNN_INVALID_ARGUMENT);
 // Tiny quantization excess can only leave the unknown bucket, never raise YES.
 scores.fill(-128);scores[9]=72;scores[3]=-118;scores[10]=-118;scores[11]=-90;
 CHECK(quipus_dscnn_map4(scores.data(),mapped)==QUIPUS_DSCNN_OK);
 CHECK(mapped[2]==200 && mapped[3]==10 && mapped[0]==10 && mapped[1]==36);
 features.fill(7);mfcc.fill(7);
 CHECK(quipus_mfcc_compute(&workspace,pcm.data(),0,mfcc.data(),features.data())==QUIPUS_MFCC_INVALID_ARGUMENT);
 CHECK(quipus_mfcc_compute(nullptr,pcm.data(),16000,mfcc.data(),features.data())==QUIPUS_MFCC_INVALID_ARGUMENT);
 CHECK(quipus_mfcc_compute(&workspace,nullptr,16000,mfcc.data(),features.data())==QUIPUS_MFCC_INVALID_ARGUMENT);
 CHECK(quipus_mfcc_compute(&workspace,pcm.data(),16001,mfcc.data(),features.data())==QUIPUS_MFCC_INVALID_ARGUMENT);
 CHECK(quipus_mfcc_compute(&workspace,pcm.data(),16000,nullptr,nullptr)==QUIPUS_MFCC_INVALID_ARGUMENT);
 CHECK(quipus_mfcc_compute(&workspace,pcm.data(),16000,mfcc.data(),features.data())==QUIPUS_MFCC_NO_POSITIVE_PEAK);
 CHECK(std::all_of(features.begin(),features.end(),[](int v){return v==83;}));
 CHECK(std::all_of(mfcc.begin(),mfcc.end(),[](float v){return v==0;}));
 int8_t quant=7;
 CHECK(quipus_mfcc_quantize(NAN,&quant)!=QUIPUS_MFCC_OK);
 CHECK(quipus_mfcc_quantize(INFINITY,&quant)!=QUIPUS_MFCC_OK);
 CHECK(quipus_mfcc_quantize(0,nullptr)==QUIPUS_MFCC_INVALID_ARGUMENT);
 quipus_dscnn_close(); CHECK(quipus_dscnn_arena_used()==0);
 std::printf("PASS: %u actual frontend/backend API, label, mapping, reset and fail-closed checks\n",checks);
 return 0;
}
static int fixture(int argc,char **argv,const std::vector<uint8_t> &model) {
 CHECK(argc==8);
 auto raw=read_file(argv[3]); CHECK(raw.size()>0 && raw.size()%2==0 && raw.size()<=32000);
 for(size_t i=0;i<raw.size()/2;++i)pcm[i]=int16_t(uint16_t(raw[2*i])|(uint16_t(raw[2*i+1])<<8));
 auto status=quipus_mfcc_compute(&workspace,pcm.data(),raw.size()/2,mfcc.data(),features.data());
 if(std::strcmp(argv[4],"reject")==0) {
  CHECK(status==QUIPUS_MFCC_NO_POSITIVE_PEAK);
  CHECK(std::all_of(features.begin(),features.end(),[](int v){return v==83;}));
  CHECK(std::all_of(mfcc.begin(),mfcc.end(),[](float v){return v==0;}));
  // No invocation on rejected raw audio. This is not a claim about VAD.
  std::puts("PASS safe frontend rejection; inference not called");return 0;
 }
 CHECK(status==QUIPUS_MFCC_OK);
 auto expected=read_file(argv[5]); auto output=read_file(argv[6]);
 CHECK(expected.size()==490 && output.size()==12);
 CHECK(std::memcmp(features.data(),expected.data(),490)==0);
 CHECK(std::all_of(mfcc.begin(),mfcc.end(),[](float v){return std::isfinite(v);}));
 CHECK(quipus_dscnn_init(model.data(),model.size())==QUIPUS_DSCNN_OK);
 CHECK(quipus_dscnn_predict(features.data(),490,scores.data())==QUIPUS_DSCNN_OK);
 // TF2.20 reference vs pinned older TFLM differs by one LSB on one known case.
 int maximum=0;for(unsigned i=0;i<12;++i) maximum=std::max(maximum,std::abs(int(scores[i])-int(int8_t(output[i]))));
 CHECK(maximum<=1);
 auto top=unsigned(std::max_element(scores.begin(),scores.end())-scores.begin());
 CHECK(std::strcmp(quipus_dscnn_label(top),argv[7])==0);
 uint8_t mapped[4]; CHECK(quipus_dscnn_map4(scores.data(),mapped)==QUIPUS_DSCNN_OK);
 CHECK(mapped[2]==uint8_t(int(scores[9])+128) && mapped[3]==uint8_t(int(scores[3])+128));
 auto previous=scores;
 CHECK(quipus_dscnn_reset()==QUIPUS_DSCNN_OK);
 CHECK(quipus_dscnn_predict(features.data(),490,scores.data())==QUIPUS_DSCNN_OK);
 CHECK(previous==scores);
 std::printf("PASS features=490/490 top=%s TF_max_LSB=%d reset=exact\n",quipus_dscnn_label(top),maximum);
 quipus_dscnn_close();return 0;
}
int main(int argc,char **argv) {
 if(argc<3){std::fprintf(stderr,"Usage: dscnn-host MODEL --selftest|--case ...\n");return 2;}
 auto model=read_file(argv[1]); CHECK(model.size()==53936);
 if(std::strcmp(argv[2],"--selftest")==0)return selftest(model);
 if(std::strcmp(argv[2],"--case")==0)return fixture(argc,argv,model);
 return 2;
}
