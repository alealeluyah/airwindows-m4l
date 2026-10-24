// awtool: offline helper for the Airwindows registry.
//
//   awtool dump                 JSON with every effect, its category and parameters
//   awtool check [sr] [name]    run each effect on test audio; report non-finite output,
//                               silence and CPU cost (exit code 1 when any effect fails)
//   awtool analysis             self-test of the display measurements (aw_analysis.h)

#include "aw_analysis.h"
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

// Feed known signals through aw::Collector and check what aw::analyze reports.
static int analysis_test()
{
    const double sr = 48000.0;
    int fails = 0;
    auto expect = [&](const char *what, double got, double lo, double hi) {
        bool ok = got >= lo && got <= hi;
        printf("%s %-46s %9.3f  (want %.2f .. %.2f)\n", ok ? "ok  " : "FAIL", what, got, lo, hi);
        fails += !ok;
    };
    auto run = [&](auto gen, aw::Display &d) {
        aw::Collector c;
        c.setHop(1600);
        std::vector<double> il(256), ir(256), ol(256), orr(256);
        long t = 0;
        const aw::Frame *last = nullptr;
        for (int blk = 0; blk < 200; ++blk)
        {
            for (int i = 0; i < 256; ++i, ++t)
                gen(t, il[i], ir[i], ol[i], orr[i]);
            c.push(il.data(), ir.data(), ol.data(), orr.data(), 256);
            if (const aw::Frame *f = c.latest())
                last = f;
        }
        if (last)
            aw::analyze(*last, sr, d);
        return last != nullptr;
    };

    aw::Display d{};
    // 1 kHz sine at -6 dBFS in; output is the same sine at -12 dBFS (6 dB less), identical L/R
    bool got = run([&](long t, double &il, double &ir, double &ol, double &orr) {
        double s = std::sin(2 * M_PI * 1000.0 * t / sr);
        il = ir = 0.5 * s;
        ol = orr = 0.25 * s;
    }, d);
    expect("frame published", got, 1, 1);
    expect("input peak L (dBFS)", d.inPkDb[0], -6.1, -5.9);
    expect("output peak R (dBFS)", d.outPkDb[1], -12.1, -11.9);
    expect("input RMS (dBFS, sine = peak - 3.01)", d.inRmsDb, -9.1, -8.9);
    expect("gain change out-in (dB)", d.gainDb, -6.1, -5.9);
    expect("correlation, identical L/R", d.corr, 0.999, 1.001);
    int best = 0;
    for (int b = 1; b < aw::kBands; ++b)
        if (d.specIn[b] > d.specIn[best])
            best = b;
    double f0 = 20.0 * std::pow(1000.0, (double)best / aw::kBands), f1 = 20.0 * std::pow(1000.0, (double)(best + 1) / aw::kBands);
    expect("loudest band contains 1 kHz (lower edge Hz)", f0, 800, 1000);
    expect("loudest band contains 1 kHz (upper edge Hz)", f1, 1000, 1200);
    expect("loudest band level (dBFS, sine at -6)", d.specIn[best], -7.5, -5.5);
    expect("band 2 octaves away is low (dBFS)", d.specIn[std::max(0, best - 10)], -200, -50);
    // transfer: output = input/2, so a bin near input +0.47 reads about +0.12 (mono = average)
    int bin = (int)((0.47 + 1.0) * 0.5 * aw::kXferBins);
    expect("transfer bin follows out = in/2", d.xfer[bin] / ((bin + 0.5) / aw::kXferBins * 2 - 1), 0.4, 0.6);

    // opposite polarity L/R: correlation -1
    run([&](long t, double &il, double &ir, double &ol, double &orr) {
        double s = std::sin(2 * M_PI * 440.0 * t / sr);
        il = ir = s;
        ol = s;
        orr = -s;
    }, d);
    expect("correlation, opposite L/R", d.corr, -1.001, -0.999);

    // silence: no gain change reported, correlation 1
    run([&](long, double &il, double &ir, double &ol, double &orr) { il = ir = ol = orr = 0; }, d);
    expect("silence: gain change", d.gainDb, 0, 0);
    expect("silence: input peak floor (dBFS)", d.inPkDb[0], -120, -120);

    printf("analysis: %d failures\n", fails);
    return fails ? 1 : 0;
}

int main(int argc, char **argv)
{
    if (argc >= 2 && !strcmp(argv[1], "dump"))
        return dump();
    if (argc >= 2 && !strcmp(argv[1], "check"))
        return check(argc >= 3 ? (float)atof(argv[2]) : 48000.f, argc >= 4 ? argv[3] : nullptr);
    if (argc >= 2 && !strcmp(argv[1], "analysis"))
        return analysis_test();
    fprintf(stderr, "usage: awtool dump | check [samplerate] [name] | analysis\n");
    return 2;
}
