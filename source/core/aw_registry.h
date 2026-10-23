#pragma once

#include "AirwinRegistry.h"
#include <string>

namespace aw
{
void ensureRegistry();
int indexOf(const std::string &name); // -1 when unknown
std::string paramName(AirwinConsolidatedBase *fx, int i);
std::string paramDisplay(AirwinConsolidatedBase *fx, int i); // value and unit, trimmed
} // namespace aw
