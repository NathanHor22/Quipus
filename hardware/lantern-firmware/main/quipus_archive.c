#include "quipus_archive.h"
#include "esp_heap_caps.h"
#include "esp_random.h"
#include "mbedtls/gcm.h"
#include "mbedtls/md.h"
#include "mbedtls/platform_util.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define RECORD_OVERHEAD 20u
#define JOURNAL_LIMIT 4096u
#define MAX_PCM_BYTES (268435456u - 44u)

struct quipus_archive_writer {
  FILE *file;
  mbedtls_gcm_context gcm;
  uint8_t header[QUIPUS_ARCHIVE_HEADER];
  uint8_t block[QUIPUS_ARCHIVE_BLOCK];
  uint8_t cipher[QUIPUS_ARCHIVE_BLOCK];
  size_t buffered, total;
  uint32_t index;
  bool failed;
};
struct quipus_archive_reader {
  FILE *file;
  mbedtls_gcm_context gcm;
  uint8_t header[QUIPUS_ARCHIVE_HEADER];
  uint8_t plain[QUIPUS_ARCHIVE_BLOCK];
  uint8_t cipher[QUIPUS_ARCHIVE_BLOCK];
  size_t pcm_bytes, position, cached_bytes;
  uint32_t cached_index;
  bool cached, failed;
};
static uint32_t u32(const uint8_t *p) {
  return (uint32_t)p[0] | (uint32_t)p[1] << 8 | (uint32_t)p[2] << 16 |
         (uint32_t)p[3] << 24;
}
static void put32(uint8_t *p, uint32_t n) {
  p[0] = n;
  p[1] = n >> 8;
  p[2] = n >> 16;
  p[3] = n >> 24;
}
static void nonce_for(const uint8_t *header, uint32_t index,
                      uint8_t nonce[12]) {
  memcpy(nonce, header + 124, 8);
  put32(nonce + 8, index);
}
static int set_file_key(mbedtls_gcm_context *gcm, const uint8_t master[32],
                        const uint8_t *header) {
  uint8_t key[32];
  int result = mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),
                               master, 32, header, QUIPUS_ARCHIVE_HEADER, key);
  if (!result)
    result = mbedtls_gcm_setkey(gcm, MBEDTLS_CIPHER_ID_AES, key, 256);
  mbedtls_platform_zeroize(key, sizeof(key));
  return result;
}
static bool valid_id(const char *s) { return s && strlen(s) == 36; }
static esp_err_t flush_block(quipus_archive_writer_t *w) {
  if (!w || w->failed || !w->file)
    return ESP_FAIL;
  if (!w->buffered)
    return ESP_OK;
  uint8_t nonce[12], aad[QUIPUS_ARCHIVE_HEADER + 8], tag[16], length[4];
  nonce_for(w->header, w->index, nonce);
  memcpy(aad, w->header, QUIPUS_ARCHIVE_HEADER);
  put32(aad + QUIPUS_ARCHIVE_HEADER, w->index);
  put32(aad + QUIPUS_ARCHIVE_HEADER + 4, w->buffered);
  put32(length, w->buffered);
  if (mbedtls_gcm_crypt_and_tag(&w->gcm, MBEDTLS_GCM_ENCRYPT, w->buffered,
                                nonce, 12, aad, sizeof(aad), w->block,
                                w->cipher, 16, tag) ||
      fwrite(length, 1, 4, w->file) != 4 ||
      fwrite(w->cipher, 1, w->buffered, w->file) != w->buffered ||
      fwrite(tag, 1, 16, w->file) != 16 || fflush(w->file) ||
      fsync(fileno(w->file))) {
    w->failed = true;
    return ESP_FAIL;
  }
  w->total += w->buffered;
  w->buffered = 0;
  w->index++;
  return ESP_OK;
}
esp_err_t quipus_archive_create(const char *path, const uint8_t key[32],
                                const char *session, const char *owner,
                                const char *device, unsigned source,
                                quipus_archive_writer_t **out) {
  if (!out || !key || !valid_id(session) || !valid_id(owner) ||
      !valid_id(device) || source > 1)
    return ESP_ERR_INVALID_ARG;
  *out = NULL;
  quipus_archive_writer_t *w =
      heap_caps_calloc(1, sizeof(*w), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!w)
    return ESP_ERR_NO_MEM;
  mbedtls_gcm_init(&w->gcm);
  memcpy(w->header, "QPA1", 4);
  put32(w->header + 4, 1);
  put32(w->header + 8, source);
  put32(w->header + 12, 16000);
  memcpy(w->header + 16, session, 36);
  memcpy(w->header + 52, owner, 36);
  memcpy(w->header + 88, device, 36);
  esp_fill_random(w->header + 124, 8);
  if (set_file_key(&w->gcm, key, w->header)) {
    quipus_archive_abort(w);
    return ESP_FAIL;
  }
  w->file = fopen(path, "wb");
  if (!w->file ||
      fwrite(w->header, 1, sizeof(w->header), w->file) != sizeof(w->header) ||
      fflush(w->file) || fsync(fileno(w->file))) {
    quipus_archive_abort(w);
    return ESP_FAIL;
  }
  *out = w;
  return ESP_OK;
}
esp_err_t quipus_archive_append(quipus_archive_writer_t *w, const void *pcm,
                                size_t bytes) {
  if (!w || !pcm || bytes % 2 || bytes > MAX_PCM_BYTES ||
      w->total + w->buffered + bytes > MAX_PCM_BYTES)
    return ESP_ERR_INVALID_ARG;
  const uint8_t *input = pcm;
  while (bytes) {
    size_t n = QUIPUS_ARCHIVE_BLOCK - w->buffered;
    if (n > bytes)
      n = bytes;
    memcpy(w->block + w->buffered, input, n);
    w->buffered += n;
    input += n;
    bytes -= n;
    if (w->buffered == QUIPUS_ARCHIVE_BLOCK && flush_block(w) != ESP_OK)
      return ESP_FAIL;
  }
  return ESP_OK;
}
esp_err_t quipus_archive_finish(quipus_archive_writer_t *w, size_t *pcm_bytes) {
  if (!w)
    return ESP_ERR_INVALID_ARG;
  esp_err_t result = flush_block(w);
  if (result == ESP_OK && pcm_bytes)
    *pcm_bytes = w->total;
  quipus_archive_abort(w);
  return result;
}
void quipus_archive_abort(quipus_archive_writer_t *w) {
  if (!w)
    return;
  if (w->file)
    fclose(w->file);
  mbedtls_gcm_free(&w->gcm);
  mbedtls_platform_zeroize(w, sizeof(*w));
  free(w);
}
static esp_err_t decrypt_block(quipus_archive_reader_t *r, uint32_t index,
                               size_t length) {
  if (r->failed || !length || length > QUIPUS_ARCHIVE_BLOCK || length % 2)
    return ESP_FAIL;
  size_t position = QUIPUS_ARCHIVE_HEADER +
                    (size_t)index * (QUIPUS_ARCHIVE_BLOCK + RECORD_OVERHEAD);
  uint8_t size[4], nonce[12], aad[QUIPUS_ARCHIVE_HEADER + 8], tag[16];
  if (fseek(r->file, (long)position, SEEK_SET) ||
      fread(size, 1, 4, r->file) != 4 || u32(size) != length ||
      fread(r->cipher, 1, length, r->file) != length ||
      fread(tag, 1, 16, r->file) != 16)
    return ESP_FAIL;
  nonce_for(r->header, index, nonce);
  memcpy(aad, r->header, QUIPUS_ARCHIVE_HEADER);
  put32(aad + QUIPUS_ARCHIVE_HEADER, index);
  put32(aad + QUIPUS_ARCHIVE_HEADER + 4, length);
  if (mbedtls_gcm_auth_decrypt(&r->gcm, length, nonce, 12, aad, sizeof(aad),
                               tag, 16, r->cipher, r->plain)) {
    r->failed = true;
    memset(r->plain, 0, sizeof(r->plain));
    return ESP_FAIL;
  }
  r->cached = true;
  r->cached_index = index;
  r->cached_bytes = length;
  return ESP_OK;
}
esp_err_t quipus_archive_open(const char *path, const uint8_t key[32],
                              const char *session, const char *owner,
                              const char *device, unsigned source,
                              quipus_archive_reader_t **out) {
  if (!out || !valid_id(session) || !valid_id(owner) || !valid_id(device))
    return ESP_ERR_INVALID_ARG;
  *out = NULL;
  quipus_archive_reader_t *r =
      heap_caps_calloc(1, sizeof(*r), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!r)
    return ESP_ERR_NO_MEM;
  mbedtls_gcm_init(&r->gcm);
  r->file = fopen(path, "rb");
  if (!r->file ||
      fread(r->header, 1, sizeof(r->header), r->file) != sizeof(r->header) ||
      memcmp(r->header, "QPA1", 4) || u32(r->header + 4) != 1 ||
      u32(r->header + 8) != source || u32(r->header + 12) != 16000 ||
      memcmp(r->header + 16, session, 36) ||
      memcmp(r->header + 52, owner, 36) || memcmp(r->header + 88, device, 36) ||
      set_file_key(&r->gcm, key, r->header))
    goto invalid;
  // Derive complete-block bounds without decrypting an hour of audio on every
  // open. Each block is authenticated before it is ever returned to a caller.
  // The immutable encrypted journal checks the exact finalized logical length.
  if (fseek(r->file, 0, SEEK_END))
    goto invalid;
  long end = ftell(r->file);
  if (end < QUIPUS_ARCHIVE_HEADER)
    goto invalid;
  size_t payload = (size_t)end - QUIPUS_ARCHIVE_HEADER;
  size_t full = payload / (QUIPUS_ARCHIVE_BLOCK + RECORD_OVERHEAD);
  size_t remainder = payload % (QUIPUS_ARCHIVE_BLOCK + RECORD_OVERHEAD);
  r->pcm_bytes = full * QUIPUS_ARCHIVE_BLOCK;
  if (remainder >= RECORD_OVERHEAD) {
    uint8_t size[4];
    size_t last =
        QUIPUS_ARCHIVE_HEADER + full * (QUIPUS_ARCHIVE_BLOCK + RECORD_OVERHEAD);
    if (fseek(r->file, (long)last, SEEK_SET) || fread(size, 1, 4, r->file) != 4)
      goto invalid;
    size_t length = u32(size);
    if (!length || length > QUIPUS_ARCHIVE_BLOCK || length % 2)
      goto invalid;
    if (remainder >= length + RECORD_OVERHEAD)
      r->pcm_bytes += length;
  }
  if (!r->pcm_bytes || r->pcm_bytes > MAX_PCM_BYTES)
    goto invalid;
  size_t first_length =
      r->pcm_bytes > QUIPUS_ARCHIVE_BLOCK ? QUIPUS_ARCHIVE_BLOCK : r->pcm_bytes;
  if (decrypt_block(r, 0, first_length) != ESP_OK)
    goto invalid;
  r->cached = false;
  *out = r;
  return ESP_OK;
invalid:
  quipus_archive_close(r);
  return ESP_FAIL;
}
size_t quipus_archive_size(const quipus_archive_reader_t *r) {
  return r ? r->pcm_bytes + 44 : 0;
}
static void wav_header(uint8_t *h, size_t bytes) {
  memset(h, 0, 44);
  memcpy(h, "RIFF", 4);
  put32(h + 4, bytes + 36);
  memcpy(h + 8, "WAVEfmt ", 8);
  put32(h + 16, 16);
  h[20] = 1;
  h[22] = 1;
  put32(h + 24, 16000);
  put32(h + 28, 32000);
  h[32] = 2;
  h[34] = 16;
  memcpy(h + 36, "data", 4);
  put32(h + 40, bytes);
}
size_t quipus_archive_read(quipus_archive_reader_t *r, void *output,
                           size_t bytes) {
  if (!r || !output || r->failed)
    return 0;
  uint8_t *out = output;
  size_t copied = 0, total = quipus_archive_size(r);
  if (r->position >= total)
    return 0;
  if (bytes > total - r->position)
    bytes = total - r->position;
  if (r->position < 44) {
    uint8_t header[44];
    wav_header(header, r->pcm_bytes);
    size_t n = 44 - r->position;
    if (n > bytes)
      n = bytes;
    memcpy(out, header + r->position, n);
    r->position += n;
    copied += n;
  }
  while (copied < bytes) {
    size_t pcm_position = r->position - 44;
    uint32_t index = pcm_position / QUIPUS_ARCHIVE_BLOCK;
    size_t offset = pcm_position % QUIPUS_ARCHIVE_BLOCK,
           length = r->pcm_bytes - (size_t)index * QUIPUS_ARCHIVE_BLOCK;
    if (length > QUIPUS_ARCHIVE_BLOCK)
      length = QUIPUS_ARCHIVE_BLOCK;
    if ((!r->cached || r->cached_index != index) &&
        decrypt_block(r, index, length) != ESP_OK)
      return 0;
    size_t n = length - offset;
    if (n > bytes - copied)
      n = bytes - copied;
    memcpy(out + copied, r->plain + offset, n);
    copied += n;
    r->position += n;
  }
  return copied;
}
int quipus_archive_seek(quipus_archive_reader_t *r, size_t position) {
  if (!r || r->failed || position > quipus_archive_size(r))
    return -1;
  r->position = position;
  return 0;
}
void quipus_archive_close(quipus_archive_reader_t *r) {
  if (!r)
    return;
  if (r->file)
    fclose(r->file);
  mbedtls_gcm_free(&r->gcm);
  mbedtls_platform_zeroize(r, sizeof(*r));
  free(r);
}
static esp_err_t repair_journal_tail(const char *path, const uint8_t key[32]) {
  FILE *file = fopen(path, "rb+");
  if (!file)
    return access(path, F_OK) == 0 ? ESP_FAIL : ESP_OK;
  uint8_t *cipher = malloc(JOURNAL_LIMIT), *plain = malloc(JOURNAL_LIMIT);
  if (!cipher || !plain) {
    free(cipher);
    free(plain);
    fclose(file);
    return ESP_ERR_NO_MEM;
  }
  mbedtls_gcm_context gcm;
  mbedtls_gcm_init(&gcm);
  int result = mbedtls_gcm_setkey(&gcm, MBEDTLS_CIPHER_ID_AES, key, 256);
  long valid_end = 0;
  bool torn = false;
  while (!result) {
    uint8_t header[20], tag[16];
    size_t n = fread(header, 1, 20, file);
    if (!n)
      break;
    if (n < 20) {
      torn = true;
      break;
    }
    size_t length = u32(header + 4);
    if (memcmp(header, "QPM1", 4) || !length || length > JOURNAL_LIMIT) {
      result = -1;
      break;
    }
    if (fread(cipher, 1, length, file) != length ||
        fread(tag, 1, 16, file) != 16) {
      torn = true;
      break;
    }
    if (mbedtls_gcm_auth_decrypt(&gcm, length, header + 8, 12, header, 8, tag,
                                 16, cipher, plain)) {
      result = -1;
      break;
    }
    valid_end = ftell(file);
    if (valid_end < 0) {
      result = -1;
      break;
    }
  }
  if (!result && torn &&
      (ftruncate(fileno(file), valid_end) || fflush(file) ||
       fsync(fileno(file))))
    result = -1;
  mbedtls_gcm_free(&gcm);
  mbedtls_platform_zeroize(plain, JOURNAL_LIMIT);
  free(plain);
  free(cipher);
  fclose(file);
  return result ? ESP_FAIL : ESP_OK;
}
esp_err_t quipus_archive_journal_append(const char *path, const uint8_t key[32],
                                        const char *json) {
  size_t length = json ? strlen(json) : 0;
  if (!length || length > JOURNAL_LIMIT)
    return ESP_ERR_INVALID_ARG;
  if (repair_journal_tail(path, key) != ESP_OK)
    return ESP_FAIL;
  uint8_t *cipher = malloc(length), header[20], tag[16];
  if (!cipher)
    return ESP_ERR_NO_MEM;
  memcpy(header, "QPM1", 4);
  put32(header + 4, length);
  esp_fill_random(header + 8, 12);
  mbedtls_gcm_context gcm;
  mbedtls_gcm_init(&gcm);
  int result = mbedtls_gcm_setkey(&gcm, MBEDTLS_CIPHER_ID_AES, key, 256);
  if (!result)
    result = mbedtls_gcm_crypt_and_tag(&gcm, MBEDTLS_GCM_ENCRYPT, length,
                                       header + 8, 12, header, 8,
                                       (const uint8_t *)json, cipher, 16, tag);
  FILE *f = result ? NULL : fopen(path, "ab");
  bool ok = f && fwrite(header, 1, 20, f) == 20 &&
            fwrite(cipher, 1, length, f) == length &&
            fwrite(tag, 1, 16, f) == 16 && !fflush(f) && !fsync(fileno(f));
  if (f)
    fclose(f);
  mbedtls_gcm_free(&gcm);
  memset(cipher, 0, length);
  free(cipher);
  return ok ? ESP_OK : ESP_FAIL;
}
esp_err_t quipus_archive_journal_read(const char *path, const uint8_t key[32],
                                      char *json, size_t capacity) {
  FILE *f = fopen(path, "rb");
  if (!f || capacity < 2) {
    if (f)
      fclose(f);
    return ESP_FAIL;
  }
  uint8_t *cipher = malloc(JOURNAL_LIMIT), *plain = malloc(JOURNAL_LIMIT);
  bool found = false;
  if (!cipher || !plain) {
    free(cipher);
    free(plain);
    fclose(f);
    return ESP_ERR_NO_MEM;
  }
  mbedtls_gcm_context gcm;
  mbedtls_gcm_init(&gcm);
  int result = mbedtls_gcm_setkey(&gcm, MBEDTLS_CIPHER_ID_AES, key, 256);
  while (!result) {
    uint8_t header[20], tag[16];
    size_t n = fread(header, 1, 20, f);
    if (!n)
      break;
    if (n < 20)
      break;
    size_t length = u32(header + 4);
    if (memcmp(header, "QPM1", 4) || !length || length > JOURNAL_LIMIT ||
        length >= capacity) {
      result = -1;
      break;
    }
    if (fread(cipher, 1, length, f) != length || fread(tag, 1, 16, f) != 16)
      break;
    if (mbedtls_gcm_auth_decrypt(&gcm, length, header + 8, 12, header, 8, tag,
                                 16, cipher, plain)) {
      result = -1;
      break;
    }
    memcpy(json, plain, length);
    json[length] = 0;
    found = true;
  }
  mbedtls_gcm_free(&gcm);
  mbedtls_platform_zeroize(plain, JOURNAL_LIMIT);
  free(plain);
  free(cipher);
  fclose(f);
  return found && !result ? ESP_OK : ESP_FAIL;
}
