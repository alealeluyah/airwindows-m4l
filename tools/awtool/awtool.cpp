// awtool: offline helper for the Airwindows registry.
//
//   awtool dump                 JSON with every effect, its category and parameters
//   awtool check [sr] [name]    run each effect on test audio; report non-finite output,
//                               silence and CPU cost (exit code 1 when any effect fails)

#include "aw_registry.h"

#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <random>
#include <string>
#include <vector>

static std::string json_escape(const std::string &s)
{
    std::string o;
    for (unsigned char c : s)
    {
        switch (c)
        {
        case '"': o += "\\\""; break;
        case '\\': o += "\\\\"; break;
        case '\n': o += "\\n"; break;
        case '\r': break;
        case '\t': o += "\\t"; break;
        default:
            if (c < 0x20)
            {
                char b[8];
                snprintf(b, sizeof(b), "\\u%04x", c);
                o += b;
            }
            else
                o += (char)c;
        }
    }
    return o;
}

static int dump()
{
    aw::ensureRegistry();
    printf("[\n");
    bool first = true;
    for (int idx : AirwinRegistry::fxAlphaOrdering)
    {
        const auto &r = AirwinRegistry::registry[idx];
        auto fx = r.generator();
        printf("%s  {\"name\": \"%s\", \"category\": \"%s\", \"what\": \"%s\", \"collections\": [",
               first ? "" : ",\n", json_escape(r.name).c_str(), json_escape(r.category).c_str(),
               json_escape(r.whatText).c_str());
        for (size_t c = 0; c < r.collections.size(); ++c)
            printf("%s\"%s\"", c ? ", " : "", json_escape(r.collections[c]).c_str());
        printf("], \"params\": [");
        for (int i = 0; i < r.nParams; ++i)
        {
            printf("%s{\"name\": \"%s\", \"default\": %.6f, \"display\": \"%s\"}", i ? ", " : "",
                   json_escape(aw::paramName(fx.get(), i)).c_str(), fx->getParameter(i),
                   json_escape(aw::paramDisplay(fx.get(), i)).c_str());
        }
        printf("]}");
        first = false;
    }
    printf("\n]\n");
    return 0;
}

static int check(float sr, const char *only)
{
    aw::ensureRegistry();
    AirwinConsolidatedBase::defaultSampleRate = sr;
    const int block = 128;
    const int seconds = 2;
    const int blocks = (int)(sr * seconds) / block;

    std::mt19937 rng(1234);
    std::normal_distribution<double> noise(0.0, 0.1);

    int failures = 0;
    for (int idx : AirwinRegistry::fxAlphaOrdering)
    {
        const auto &r = AirwinRegistry::registry[idx];
        if (only && r.name != only)
            continue;
        auto fx = r.generator();
        fx->setSampleRate(sr);

        std::vector<double> inL(block), inR(block), outL(block), outR(block);
        double *ins[2] = {inL.data(), inR.data()};
        double *outs[2] = {outL.data(), outR.data()};
        double peak = 0, energy = 0;
        bool finite = true;
        long t = 0;
        auto start = std::chrono::steady_clock::now();
        for (int b = 0; b < blocks; ++b)
        {
            // first second: noise burst with a sine; second second: silence (tails)
            for (int i = 0; i < block; ++i, ++t)
            {
                bool on = t < (long)sr;
                double s = on ? 0.3 * std::sin(2 * M_PI * 220.0 * t / sr) + noise(rng) : 0.0;
                inL[i] = s;
                inR[i] = on ? 0.3 * std::sin(2 * M_PI * 330.0 * t / sr) + noise(rng) : 0.0;
            }
            fx->processDoubleReplacing(ins, outs, block);
            for (int i = 0; i < block; ++i)
            {
                if (!std::isfinite(outL[i]) || !std::isfinite(outR[i]))
                    finite = false;
                peak = std::max(peak, std::max(std::fabs(outL[i]), std::fabs(outR[i])));
                energy += outL[i] * outL[i] + outR[i] * outR[i];
            }
        }
        double secs = std::chrono::duration<double>(std::chrono::steady_clock::now() - start).count();
        double cpu = 100.0 * secs / seconds; // percent of one core in real time
        const char *status = !finite ? "NONFINITE" : (energy == 0 ? "SILENT" : "ok");
        if (!finite)
            failures++;
        printf("%-28s %-12s %-10s peak=%8.4f cpu=%6.3f%%\n", r.name.c_str(), r.category.c_str(),
               status, peak, cpu);
    }
    printf("failures: %d\n", failures);
    return failures ? 1 : 0;
}

int main(int argc, char **argv)
{
    if (argc >= 2 && !strcmp(argv[1], "dump"))
        return dump();
    if (argc >= 2 && !strcmp(argv[1], "check"))
        return check(argc >= 3 ? (float)atof(argv[2]) : 48000.f, argc >= 4 ? argv[3] : nullptr);
    fprintf(stderr, "usage: awtool dump | check [samplerate] [name]\n");
    return 2;
}
