#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <ctype.h>
#include <errno.h>
#define CHECK(value) do { if (!(value)) { fprintf(stderr,"Check failed %d: %s\n",__LINE__,#value); exit(1); } } while (0)
typedef int esp_err_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_INVALID_ARG 1
#define ESP_ERR_INVALID_STATE 2
#define LANTERN_HAS_SD_CARD 1
#define SD_MOUNT_POINT "/sdcard"
#define SD_RECORDING_DIRECTORY "/sdcard/lantern"
#define S_ISREG(mode) ((mode) == 1)
struct stat { int st_mode; };
typedef struct { unsigned phase, index; } DIR;
struct dirent { char d_name[64]; };
static DIR dirs[2], *s_factory_reset_directory, *s_retention_directory;
static unsigned s_factory_reset_phase;
static bool s_factory_reset_blocked;
static struct { bool mounted; } s_status;
static void *s_card=(void *)1;
static bool card_ready=true, drop_after_scan;
static esp_err_t sdmmc_get_status(void *card) { CHECK(card==s_card); return card_ready ? ESP_OK : ESP_FAIL; }
static bool idle=true, fail_open, fail_read, fail_stat, fail_remove;
static unsigned scans, deletes, detaches, invalidates;
typedef struct { char name[64]; bool exists, regular; } item_t;
static item_t files[2][24];
static struct dirent entry;
static bool lantern_sd_can_power_down(void) { return idle; }
static void invalidate_upload_count(void) { ++invalidates; }
static void quipus_report_cache_detach(void) { ++detaches; }
static DIR *opendir(const char *path) {
  unsigned phase = !strcmp(path, SD_RECORDING_DIRECTORY) ? 0 : 1;
  CHECK(!phase || !strcmp(path, "/sdcard/quipus-reports"));
  if (fail_open) { errno=EIO; return NULL; }
  dirs[phase]=(DIR){.phase=phase}; return &dirs[phase];
}
static void closedir(DIR *dir) { CHECK(dir==&dirs[0] || dir==&dirs[1]); }
static struct dirent *readdir(DIR *dir) {
  ++scans;
  if (drop_after_scan) card_ready=false;
  if (fail_read) { errno=EIO; return NULL; }
  while(dir->index < 24) {
    item_t *item=&files[dir->phase][dir->index++];
    if (!item->exists) continue;
    strcpy(entry.d_name,item->name); return &entry;
  }
  return NULL;
}
static item_t *item_for(const char *path) {
  unsigned phase = !strncmp(path, SD_RECORDING_DIRECTORY "/", strlen(SD_RECORDING_DIRECTORY)+1) ? 0 : 1;
  const char *name=strrchr(path,'/'); CHECK(name);
  for(unsigned i=0;i<24;++i) if(files[phase][i].exists && !strcmp(files[phase][i].name,name+1)) return &files[phase][i];
  return NULL;
}
static int stat(const char *path,struct stat *info) {
  item_t *item=item_for(path);
  if(fail_stat || !item) { errno=EIO; return -1; }
  info->st_mode=item->regular ? 1 : 2; return 0;
}
#define remove reset_test_remove
static int reset_test_remove(const char *path) {
  item_t *item=item_for(path);
  if(fail_remove) { errno=EIO; return -1; }
  if(!item) { errno=ENOENT; return -1; }
  CHECK(item->regular); item->exists=false; ++deletes; return 0;
}
#include "reset_sd_under_test.c"
static void fixture(void) {
  memset(files,0,sizeof(files)); s_status.mounted=true; idle=true;card_ready=true;drop_after_scan=false;
  s_factory_reset_directory=s_retention_directory=NULL;
  s_factory_reset_phase=0; s_factory_reset_blocked=false;
  fail_open=fail_read=fail_stat=fail_remove=false;
  scans=deletes=detaches=invalidates=0;
}
static void add(unsigned phase,unsigned slot,const char *name,bool regular) {
  strcpy(files[phase][slot].name,name);files[phase][slot].exists=true;files[phase][slot].regular=regular;
}
static bool all_done(void) {
  bool done=false;
  for(unsigned i=0;i<30 && !done;++i) { unsigned before=scans;
    CHECK(lantern_sd_factory_reset_step(99,&done)==ESP_OK);
    CHECK(scans-before<=8);
  }
  return done;
}
int main(void) {
  fixture(); bool done=true;
  s_status.mounted=false;
  CHECK(lantern_sd_factory_reset_step(8,&done)==ESP_ERR_INVALID_STATE && !done && !deletes);
  s_status.mounted=true;card_ready=false;
  CHECK(lantern_sd_factory_reset_step(8,&done)==ESP_ERR_INVALID_STATE && !done && !deletes);
  card_ready=true;drop_after_scan=true;
  CHECK(lantern_sd_factory_reset_step(8,&done)==ESP_ERR_INVALID_STATE && !done);
  CHECK(s_factory_reset_phase==0);
  drop_after_scan=false;card_ready=true;idle=false;
  CHECK(lantern_sd_factory_reset_step(8,&done)==ESP_ERR_INVALID_STATE && !done && !deletes);
  idle=true;
  CHECK(lantern_sd_factory_reset_step(0,&done)==ESP_ERR_INVALID_ARG);
  CHECK(lantern_sd_factory_reset_step(8,NULL)==ESP_ERR_INVALID_ARG);
  // Only finite private filenames are eligible; never a traversal/user file.
  CHECK(!factory_reset_file_name("../00000001.qpa",false));
  CHECK(!factory_reset_file_name("00000001.qpa/other",false));
  CHECK(!factory_reset_file_name("notes.txt",false));
  CHECK(!factory_reset_file_name("private.qpa",false));
  CHECK(factory_reset_file_name("aB0912F0.qpc",false));
  CHECK(factory_reset_file_name("report0.qpa",true));
  CHECK(factory_reset_file_name("REPORT1.QPM",true));
  CHECK(!factory_reset_file_name("report2.qpa",true));
  const char *extensions[]={"qpm","qpc","qpa","qpb","qpt","qpx","wav","tmp"};
  for(unsigned i=0;i<8;++i){char name[24];snprintf(name,sizeof(name),"%08x.%s",i,extensions[i]);add(0,i,name,true);}
  add(0,9,"notes.txt",true);add(1,0,"report0.qpa",true);add(1,1,"report0.qpm",true);
  add(1,2,"report1.qpa",true);add(1,3,"report1.qpm",true);add(1,5,"notes.txt",true);
  CHECK(all_done() && deletes==12 && files[0][9].exists && files[1][5].exists);
  CHECK(invalidates==12 && detaches>=1);
  CHECK(lantern_sd_factory_reset_step(8,&done)==ESP_OK && done);
  // I/O failure must prevent ACK and revisit the failed file on retry.
  fixture();add(0,0,"00000001.qpa",true);fail_remove=true;
  CHECK(lantern_sd_factory_reset_step(8,&done)==ESP_FAIL && !done && !deletes);
  fail_remove=false;CHECK(all_done() && deletes==1);
  fixture();add(0,0,"00000001.qpa",true);fail_stat=true;
  CHECK(lantern_sd_factory_reset_step(8,&done)==ESP_FAIL && !done);
  fail_stat=false;CHECK(all_done() && deletes==1);
  fixture();fail_open=true;CHECK(lantern_sd_factory_reset_step(8,&done)==ESP_FAIL && !done);
  fail_open=false;CHECK(all_done());
  fixture();fail_read=true;CHECK(lantern_sd_factory_reset_step(8,&done)==ESP_FAIL && !done);
  fail_read=false;CHECK(all_done());
  // Unknown private-looking material and directories are never assumed erased.
  fixture();add(0,0,"unknown.qpa",true);
  CHECK(lantern_sd_factory_reset_step(8,&done)==ESP_FAIL && !done && !deletes);
  fixture();add(0,0,"00000001.qpa",false);
  CHECK(lantern_sd_factory_reset_step(8,&done)==ESP_FAIL && !done && !deletes);
  puts("PASS: bounded SD factory reset, project-only filenames, busy/absent-card guards and I/O failure recovery");
  return 0;
}
