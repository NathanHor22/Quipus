#pragma once
typedef struct { int unused; } srmodel_list_t;
srmodel_list_t *esp_srmodel_init(const char *partition);
char *esp_srmodel_filter(srmodel_list_t *models, const char *prefix, const char *match);
void esp_srmodel_deinit(srmodel_list_t *models);
