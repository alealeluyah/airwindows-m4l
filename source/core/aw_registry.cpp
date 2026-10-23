// Registry for the Airwindows effects, built from airwin2rack's generated ModuleAdd.h.
// This replaces airwin2rack's AirwinRegistry.cpp, which also embeds the documentation
// text through CMakeRC; the Max external does not need that.

#include "AirwinRegistry.h"
#include "aw_registry.h"

std::vector<AirwinRegistry::awReg> AirwinRegistry::registry;
std::set<std::string> AirwinRegistry::categories;
std::vector<int> AirwinRegistry::fxAlphaOrdering;
std::vector<int> AirwinRegistry::fxChrisOrdering;
std::map<std::string, std::vector<std::string>> AirwinRegistry::fxByCategory;
std::map<std::string, std::vector<std::string>> AirwinRegistry::fxByCategoryChrisOrder;
std::unordered_map<std::string, int> AirwinRegistry::nameToIndex;
std::map<std::string, std::unordered_set<std::string>> AirwinRegistry::namesByCollection;

std::string AirwinRegistry::documentationStringFor(int) { return ""; }
void AirwinRegistry::dumpStatsToStdout() {}

#include "ModuleAdd.h"

namespace aw
{
void ensureRegistry()
{
    // Static initialisation of ModuleAdd.h fills the registry and builds its indexes
    // (its last line calls completeRegistry), so only the sample-rate default is left.
    if (AirwinConsolidatedBase::defaultSampleRate <= 0)
        AirwinConsolidatedBase::defaultSampleRate = 48000;
}

int indexOf(const std::string &name)
{
    ensureRegistry();
    auto it = AirwinRegistry::nameToIndex.find(name);
    return it == AirwinRegistry::nameToIndex.end() ? -1 : it->second;
}

static std::string trim(const char *s)
{
    std::string r(s);
    auto b = r.find_first_not_of(' ');
    auto e = r.find_last_not_of(' ');
    return b == std::string::npos ? std::string() : r.substr(b, e - b + 1);
}

std::string paramName(AirwinConsolidatedBase *fx, int i)
{
    char txt[kVstMaxParamStrLen * 4] = {0};
    fx->getParameterName(i, txt);
    return trim(txt);
}

std::string paramDisplay(AirwinConsolidatedBase *fx, int i)
{
    char val[kVstMaxParamStrLen * 4] = {0};
    char lbl[kVstMaxParamStrLen * 4] = {0};
    fx->getParameterDisplay(i, val);
    fx->getParameterLabel(i, lbl);
    auto v = trim(val), l = trim(lbl);
    return l.empty() ? v : v + " " + l;
}
} // namespace aw
