#include "quipus_archive.h"
#define CHECK(condition) do { if(!(condition)){ fprintf(stderr,"Check failed at line %d: %s\n",__LINE__,#condition);exit(1); } } while(0)
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <unistd.h>

static const char *session="11111111-1111-4111-8111-111111111111";
static const char *owner="22222222-2222-4222-8222-222222222222";
static const char *device="33333333-3333-4333-8333-333333333333";
static uint8_t key[32],other_key[32],pcm[10000];
// Deterministic host-only randomness. Production links ESP hardware entropy.
void esp_fill_random(void *out,size_t length){static uint32_t seed=1;uint8_t *p=out;while(length--){seed=seed*1664525u+1013904223u;*p++=(uint8_t)(seed>>24);}}
static void tamper(const char *path,long offset){FILE *f=fopen(path,"rb+");CHECK(f);CHECK(!fseek(f,offset,SEEK_SET));int value=fgetc(f);CHECK(value!=EOF);CHECK(!fseek(f,offset,SEEK_SET));fputc(value^0x80,f);fclose(f);}
static void fresh(const char *path){remove(path);quipus_archive_writer_t *w=NULL;CHECK(quipus_archive_create(path,key,session,owner,device,0,&w)==ESP_OK);CHECK(quipus_archive_append(w,pcm,512)==ESP_OK);CHECK(quipus_archive_append(w,pcm+512,8188)==ESP_OK);CHECK(quipus_archive_append(w,pcm+8700,1300)==ESP_OK);size_t bytes=0;CHECK(quipus_archive_finish(w,&bytes)==ESP_OK);CHECK(bytes==sizeof(pcm));}
int main(void){
  for(size_t i=0;i<sizeof(key);i++){key[i]=(uint8_t)i;other_key[i]=(uint8_t)(i+1);}
  for(size_t i=0;i<sizeof(pcm);i++)pcm[i]=(uint8_t)(i*13+7);
  const char *file="archive-test.qpa",*journal="archive-test.qpm";fresh(file);
  quipus_archive_reader_t *r=NULL;CHECK(quipus_archive_open(file,key,session,owner,device,0,&r)==ESP_OK);
  CHECK(quipus_archive_size(r)==10044);uint8_t bytes[10044];CHECK(quipus_archive_read(r,bytes,sizeof(bytes))==sizeof(bytes));
  CHECK(!memcmp(bytes,"RIFF",4));CHECK(!memcmp(bytes+44,pcm,sizeof(pcm)));CHECK(!quipus_archive_seek(r,44+4090));
  uint8_t cross[128];CHECK(quipus_archive_read(r,cross,sizeof(cross))==sizeof(cross));CHECK(!memcmp(cross,pcm+4090,sizeof(cross)));quipus_archive_close(r);
  CHECK(quipus_archive_open(file,other_key,session,owner,device,0,&r)!=ESP_OK);
  CHECK(quipus_archive_open(file,key,session,device,owner,0,&r)!=ESP_OK);
  tamper(file,QUIPUS_ARCHIVE_HEADER+4116+4+20);CHECK(quipus_archive_open(file,key,session,owner,device,0,&r)==ESP_OK);
  CHECK(!quipus_archive_seek(r,44+4096));CHECK(quipus_archive_read(r,cross,sizeof(cross))==0);quipus_archive_close(r);
  fresh(file);tamper(file,52);CHECK(quipus_archive_open(file,key,session,owner,device,0,&r)!=ESP_OK);
  fresh(file);FILE *f=fopen(file,"rb+");CHECK(f);CHECK(!fseek(f,-8,SEEK_END));long shortened=ftell(f);CHECK(!ftruncate(fileno(f),shortened));fclose(f);
  CHECK(quipus_archive_open(file,key,session,owner,device,0,&r)==ESP_OK);CHECK(quipus_archive_size(r)==44+8192);quipus_archive_close(r);
  remove(file);quipus_archive_writer_t *w=NULL;CHECK(quipus_archive_create(file,key,session,owner,device,0,&w)==ESP_OK);
  CHECK(quipus_archive_append(w,pcm,6000)==ESP_OK);quipus_archive_abort(w);
  CHECK(quipus_archive_open(file,key,session,owner,device,0,&r)==ESP_OK);CHECK(quipus_archive_size(r)==44+4096);quipus_archive_close(r);
  remove(journal);CHECK(quipus_archive_journal_append(journal,key,"{\"state\":1}")==ESP_OK);
  f=fopen(journal,"ab");CHECK(f);fwrite("QPM1bad",1,7,f);fclose(f);char json[128];
  CHECK(quipus_archive_journal_read(journal,key,json,sizeof(json))==ESP_OK);CHECK(!strcmp(json,"{\"state\":1}"));
  CHECK(quipus_archive_journal_append(journal,key,"{\"state\":2}")==ESP_OK);
  CHECK(quipus_archive_journal_read(journal,key,json,sizeof(json))==ESP_OK);CHECK(!strcmp(json,"{\"state\":2}"));
  tamper(journal,25);CHECK(quipus_archive_journal_read(journal,key,json,sizeof(json))!=ESP_OK);
  CHECK(quipus_archive_journal_append(journal,key,"{\"state\":3}")!=ESP_OK);
  // Retention proof is encrypted/authenticated and survives a torn append.
  remove(journal);
  const char *retention="{\"verified\":true,\"firstVerifiedAt\":1792800000,\"deleteAfter\":1792886400,\"retentionLastSeenAt\":1792800000}";
  CHECK(quipus_archive_journal_append(journal,key,retention)==ESP_OK);
  f=fopen(journal,"ab");CHECK(f);fwrite("QPM1bad",1,7,f);fclose(f);
  char proof[512];CHECK(quipus_archive_journal_read(journal,key,proof,sizeof(proof))==ESP_OK);CHECK(!strcmp(proof,retention));
  if(getenv("QUIPUS_ARCHIVE_TEST_KEEP"))fresh(file);else remove(file);remove(journal);puts("Archive host tests passed: full replay, seek, keys, owner binding, tamper rejection, torn audio and metadata recovery.");return 0;
}
