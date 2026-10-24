#pragma once
// Host ownership assertions; not a scheduler or acoustic model.
typedef struct { unsigned held; } portMUX_TYPE;
#define portMUX_INITIALIZER_UNLOCKED {0}
void test_enter_critical(portMUX_TYPE *lock);
void test_exit_critical(portMUX_TYPE *lock);
#define portENTER_CRITICAL(lock) test_enter_critical(lock)
#define portEXIT_CRITICAL(lock) test_exit_critical(lock)
