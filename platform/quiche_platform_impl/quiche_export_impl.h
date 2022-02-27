#ifndef QUICHE_EXPORT_IMPL
#define QUICHE_EXPORT_IMPL

// dirty hack to fix absl include error

#include "absl/types/optional.h"

#define QUICHE_EXPORT_IMPL
#define QUICHE_EXPORT_PRIVATE_IMPL
#define QUICHE_NO_EXPORT_IMPL

#endif