#include "quipus_adpcm.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define CHECK(x) do { if (!(x)) { fprintf(stderr,"ADPCM failed:%d %s\n", __LINE__, #x); exit(1); } } while (0)
int main(int argc, char **argv) {
  uint8_t data[513]; int16_t output[1024]; quipus_adpcm_state_t state;
  quipus_adpcm_init(&state); CHECK(state.predictor == 0 && state.index == 0);
  if (argc == 1) {
    memset(data, 0x77, sizeof(data)); memset(output, 0x5A, sizeof(output));
    quipus_adpcm_state_t invalid[] = {{-32769,0},{32768,0},{0,-1},{0,89}};
    for (size_t i=0; i<sizeof(invalid)/sizeof(invalid[0]); ++i) {
      quipus_adpcm_state_t original=invalid[i];
      CHECK(!quipus_adpcm_decode(data,1,output,1024,&invalid[i]));
      CHECK(!memcmp(&original,&invalid[i],sizeof(original)) && output[0]==0x5A5A);
    }
    CHECK(!quipus_adpcm_decode(data,513,output,1024,&state));
    CHECK(!quipus_adpcm_decode(data,2,output,3,&state));
    CHECK(!quipus_adpcm_decode(NULL,1,output,1024,&state));
    CHECK(!quipus_adpcm_decode(data,1,NULL,1024,&state));
    CHECK(!quipus_adpcm_decode(data,1,output,1024,NULL));
    CHECK(!quipus_adpcm_decode(data,0,output,1024,&state));
    CHECK(state.predictor==0 && state.index==0 && output[0]==0x5A5A);
    puts("ADPCM argument/capacity/state guards passed without mutation."); return 0;
  }
  CHECK(argc==7); FILE *input=fopen(argv[1],"rb"), *out=fopen(argv[2],"wb"); CHECK(input && out);
  state.predictor=atoi(argv[3]); state.index=atoi(argv[4]); size_t chunk=(size_t)atoi(argv[5]);
  CHECK(chunk && chunk<=512); int reset=atoi(argv[6]);
  size_t bytes;
  while ((bytes=fread(data,1,chunk,input))) {
    if (reset) quipus_adpcm_init(&state);
    CHECK(quipus_adpcm_decode(data,bytes,output,1024,&state)==bytes*2);
    CHECK(fwrite(output,2,bytes*2,out)==bytes*2);
  }
  CHECK(!ferror(input)); CHECK(!fclose(input)); CHECK(!fclose(out));
  printf("%d %d\n", state.predictor,state.index); return 0;
}
