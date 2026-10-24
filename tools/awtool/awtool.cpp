// awtool: offline helper for the Airwindows registry.
//
//   awtool dump                 JSON with every effect, its category and parameters
//   awtool check [sr] [name]    run each effect on test audio; report non-finite output,
//                               silence and CPU cost (exit code 1 when any effect fails)
//   awtool analysis             self-test of the display measurements (aw_analysis.h)
//   awtool frames <name> [sec] [param=value ...]
//                               run an effect on a synthesized stereo drum loop and print the
//                               display frames airwin~ would send (JSON, 30 per second)

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
    expect("side level, identical L/R (dBFS)", d.ms[1], -120, -120);
    expect("output mid level (dBFS, sine at -12 = RMS -15.05)", d.ms[2], -15.2, -14.9);
    expect("difference RMS (out-in = -in/2: -15.05 dBFS)", d.diffRmsDb, -15.3, -14.8);
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

    // output = input delayed by 480 samples (10 ms): cross-correlation peaks in that lag bin
    {
        std::vector<double> past(4096, 0.0);
        std::mt19937 rng(7);
        std::uniform_real_distribution<double> u(-0.5, 0.5);
        run([&](long t, double &il, double &ir, double &ol, double &orr) {
            double x = u(rng);
            past[t % 4096] = x;
            il = ir = x;
            ol = orr = t >= 480 ? past[(t - 480) % 4096] : 0.0;
        }, d);
        int bestLag = 0;
        for (int b = 1; b < 64; ++b)
            if (d.xcorr[b] > d.xcorr[bestLag])
                bestLag = b;
        expect("cross-correlation peak bin (480 / 32 = 15)", bestLag, 15, 15);
        expect("cross-correlation peak value", d.xcorr[bestLag], 0.7, 1.05);
    }

    // opposite polarity L/R: correlation -1
    run([&](long t, double &il, double &ir, double &ol, double &orr) {
        double s = std::sin(2 * M_PI * 440.0 * t / sr);
        il = ir = s;
        ol = s;
        orr = -s;
    }, d);
    expect("correlation, opposite L/R", d.corr, -1.001, -0.999);
    expect("mid level, opposite L/R (dBFS)", d.ms[2], -120, -120);

    // silence: no gain change reported, correlation 1
    run([&](long, double &il, double &ir, double &ol, double &orr) { il = ir = ol = orr = 0; }, d);
    expect("silence: gain change", d.gainDb, 0, 0);
    expect("silence: input peak floor (dBFS)", d.inPkDb[0], -120, -120);

    printf("analysis: %d failures\n", fails);
    return fails ? 1 : 0;
}

// Stereo drum loop at 120 bpm: kick (pitch-swept sine), snare (noise + tone), hats (bright
// noise, panned differently left and right so the stereo image is not mono).
static void drum_loop(long t, double sr, double &l, double &r)
{
    static uint32_t seed = 12345;
    auto rnd = [&]() { seed = seed * 1664525u + 1013904223u; return ((seed >> 9) / 4194304.0) - 1.0; };
    const double beat = 0.5, tt = t / sr, ph = std::fmod(tt, beat * 4);
    double kt = std::fmod(tt, beat);
    double kick = std::sin(2 * M_PI * (50 * kt + 70 * (1 - std::exp(-kt * 30)) / 30)) * std::exp(-kt * 9);
    double snare = 0;
    for (double s0 : {beat, beat * 3})
        if (ph >= s0)
        {
            double st = ph - s0;
            snare += (0.6 * rnd() + 0.4 * std::sin(2 * M_PI * 185 * st)) * std::exp(-st * 16);
        }
    double ht = std::fmod(tt, beat / 2);
    static double hpL = 0, hpR = 0, lastN = 0;
    double n = rnd(), hp = n - lastN;
    lastN = n;
    hpL = hp * std::exp(-ht * 45);
    hpR = hp * std::exp(-std::fmod(tt + beat / 4, beat / 2) * 45);
    l = 0.55 * kick + 0.35 * snare + 0.18 * hpL;
    r = 0.55 * kick + 0.35 * snare + 0.18 * hpR;
}

static int frames(const char *name, double seconds, int nkv, char **kv)
{
    aw::ensureRegistry();
    int idx = aw::indexOf(name);
    if (idx < 0)
    {
        fprintf(stderr, "unknown effect %s\n", name);
        return 2;
    }
    const double sr = 48000.0;
    auto fx = AirwinRegistry::registry[idx].generator();
    fx->setSampleRate((float)sr);
    for (int i = 0; i < nkv; ++i)
    {
        int pi = -1;
        float v = 0;
        if (sscanf(kv[i], "%d=%f", &pi, &v) == 2 && pi >= 0 && pi < AirwinRegistry::registry[idx].nParams)
            fx->setParameter(pi, v);
    }
    aw::Collector col;
    col.setHop((long)(sr / 30));
    aw::Display d{};
    const int B = 256;
    std::vector<double> il(B), ir(B), ol(B), orr(B);
    long t = 0, total = (long)(seconds * sr);
    bool first = true;
    auto arr = [](const float *v, int n) {
        for (int i = 0; i < n; ++i)
            printf(i ? ",%.4g" : "%.4g", std::isfinite(v[i]) ? v[i] : -9.0);
    };
    printf("{\"effect\":\"%s\",\"sr\":%g,\"frames\":[\n", name, sr);
    while (t < total)
    {
        for (int i = 0; i < B; ++i, ++t)
            drum_loop(t, sr, il[i], ir[i]);
        double *in2[2] = {il.data(), ir.data()}, *out2[2] = {ol.data(), orr.data()};
        fx->processDoubleReplacing(in2, out2, B);
        col.push(il.data(), ir.data(), ol.data(), orr.data(), B);
        if (const aw::Frame *f = col.latest())
        {
            aw::analyze(*f, sr, d);
            float lv[8] = {d.inPkDb[0], d.inPkDb[1], d.outPkDb[0], d.outPkDb[1], d.inRmsDb, d.outRmsDb, d.gainDb, d.corr};
            float pk[2] = {d.inPk, d.outPk};
            float sc[128];
            std::copy(d.scopeL, d.scopeL + 64, sc);
            std::copy(d.scopeR, d.scopeR + 64, sc + 64);
            printf(first ? "{" : ",\n{");
            first = false;
            printf("\"levels\":["); arr(lv, 8);
            printf("],\"peaks\":["); arr(pk, 2);
            printf("],\"spec_in\":["); arr(d.specIn, aw::kBands);
            printf("],\"spec_out\":["); arr(d.specOut, aw::kBands);
            printf("],\"xfer\":["); arr(d.xfer, aw::kXferBins);
            printf("],\"scope\":["); arr(sc, 128);
            std::copy(d.inScopeL, d.inScopeL + 64, sc);
            std::copy(d.inScopeR, d.inScopeR + 64, sc + 64);
            printf("],\"scope_in\":["); arr(sc, 128);
            printf("],\"ms\":["); arr(d.ms, 4);
            printf("],\"spec_diff\":["); arr(d.specDiff, aw::kBands);
            float df[2] = {d.diffRmsDb, d.dcOut};
            printf("],\"diff\":["); arr(df, 2);
            printf("],\"xcorr\":["); arr(d.xcorr, 64);
            printf("]}");
        }
    }
    printf("\n]}\n");
    return 0;
}

int main(int argc, char **argv)
{
    if (argc >= 2 && !strcmp(argv[1], "dump"))
        return dump();
    if (argc >= 2 && !strcmp(argv[1], "check"))
        return check(argc >= 3 ? (float)atof(argv[2]) : 48000.f, argc >= 4 ? argv[3] : nullptr);
    if (argc >= 2 && !strcmp(argv[1], "analysis"))
        return analysis_test();
    if (argc >= 3 && !strcmp(argv[1], "frames"))
        return frames(argv[2], argc >= 4 ? atof(argv[3]) : 6.0, argc > 4 ? argc - 4 : 0, argv + 4);
    fprintf(stderr, "usage: awtool dump | check [samplerate] [name] | analysis | frames <name> [sec] [i=v ...]\n");
    return 2;
}
