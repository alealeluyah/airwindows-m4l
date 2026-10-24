// nulltest: compare airwin-core against the "Airwindows Consolidated" Audio Unit.
//
//   nulltest [--sr 48000] [--block 512] [--seconds 2] [--only Name] [--no-ftz] [--csv out.csv]
//
// For every effect in our registry it:
//   1. loads the effect into the AU (aufx alFX Dthr) through its JUCE state
//      (ClassInfo -> "jucePluginState" -> <awconsolidated currentProcessorName=... awp_N=...>),
//      which is how AWConsolidatedProcessor::setStateInformation selects effect and params;
//   2. renders the same deterministic stereo test signal through the AU (float path,
//      processReplacing) and through airwin-core: processReplacing (float) and
//      processDoubleReplacing (double, the path airwin~ uses);
//   3. does this for the default parameters and for one deterministic random set.
//
// Airwindows seeds its dither state (fpdL/fpdR) with rand() in each constructor. The AU runs
// in this process and shares libc's rand(), so we call srand(seed) before the AU builds its
// processor and again before we build ours. The AU builds two instances per load
// (awProcessor, then awDisplayProcessor), so we build a second, unused instance too.
// A third render of ours with a different seed shows which effects depend on rand().
//
// JUCE wraps processBlock in ScopedNoDenormals (flush-to-zero). We do the same around our
// process calls, unless --no-ftz.

#include "aw_registry.h"

#include <AudioToolbox/AudioToolbox.h>
#include <CoreFoundation/CoreFoundation.h>

#include <cfenv>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <random>
#include <string>
#include <vector>

namespace
{
double gSR = 48000;
int gBlock = 512;
double gSeconds = 2.0; // programme length; 0.5 s of silence follows
bool gFTZ = true;

// ---------------------------------------------------------------- flush-to-zero
struct ScopedFTZ
{
#if defined(__aarch64__)
    uint64_t saved{0};
    bool on;
    explicit ScopedFTZ(bool en) : on(en)
    {
        if (!on)
            return;
        saved = __builtin_arm_rsr64("fpcr");
        __builtin_arm_wsr64("fpcr", saved | (1ull << 24)); // FZ, as juce::ScopedNoDenormals
    }
    ~ScopedFTZ()
    {
        if (on)
            __builtin_arm_wsr64("fpcr", saved);
    }
#else
    unsigned saved{0};
    bool on;
    explicit ScopedFTZ(bool en) : on(en)
    {
        if (!on)
            return;
        saved = __builtin_ia32_stmxcsr();
        __builtin_ia32_ldmxcsr(saved | 0x8040); // FTZ | DAZ, as juce::ScopedNoDenormals
    }
    ~ScopedFTZ()
    {
        if (on)
            __builtin_ia32_ldmxcsr(saved);
    }
#endif
};

// ---------------------------------------------------------------- test signal
// gSeconds (default 2.0 s) of programme (sine sweep + decaying tone bursts + noise, different per channel),
// then 0.5 s of digital silence for tails. Generated as float so both paths get the
// same input values.
struct Signal
{
    std::vector<float> L, R;
};

Signal makeSignal(double sr)
{
    Signal s;
    const int nOn = (int)(gSeconds * sr), n = (int)((gSeconds + 0.5) * sr);
    s.L.assign(n, 0.f);
    s.R.assign(n, 0.f);
    uint32_t lcg = 22222;
    auto noise = [&]() {
        lcg = lcg * 1664525u + 1013904223u;
        return (double)(lcg >> 8) / 16777216.0 * 2.0 - 1.0;
    };
    double ph = 0;
    for (int t = 0; t < nOn; ++t)
    {
        double tt = t / sr;
        double f = 40.0 * std::pow(500.0, tt / gSeconds); // 40 Hz .. 20 kHz
        ph += 2 * M_PI * f / sr;
        double burst = std::exp(-8.0 * std::fmod(tt, 0.25)) * std::sin(2 * M_PI * 330.0 * tt);
        double nz1 = noise(), nz2 = noise();
        s.L[t] = (float)(0.35 * std::sin(ph) + 0.25 * burst + 0.08 * nz1);
        s.R[t] = (float)(0.30 * std::sin(ph * 1.01 + 0.5) + 0.25 * burst * -1.0 + 0.08 * nz2);
    }
    return s;
}

// ---------------------------------------------------------------- AU host
struct AUHost
{
    AudioComponentInstance au{nullptr};
    const Signal *in{nullptr};
    size_t inPos{0};
    Float64 sampleTime{0};

    static OSStatus inputProc(void *ref, AudioUnitRenderActionFlags *, const AudioTimeStamp *,
                              UInt32, UInt32 frames, AudioBufferList *io)
    {
        auto *h = (AUHost *)ref;
        for (UInt32 c = 0; c < io->mNumberBuffers && c < 2; ++c)
        {
            const float *src = (c == 0 ? h->in->L.data() : h->in->R.data()) + h->inPos;
            memcpy(io->mBuffers[c].mData, src, frames * sizeof(float));
        }
        return noErr;
    }

    bool open()
    {
        AudioComponentDescription d{kAudioUnitType_Effect, 'alFX', 'Dthr', 0, 0};
        AudioComponent comp = AudioComponentFindNext(nullptr, &d);
        if (!comp)
        {
            fprintf(stderr, "AU aufx alFX Dthr not found\n");
            return false;
        }
        if (AudioComponentInstanceNew(comp, &au) != noErr)
            return false;

        AudioStreamBasicDescription f{};
        f.mSampleRate = gSR;
        f.mFormatID = kAudioFormatLinearPCM;
        f.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked |
                         kAudioFormatFlagIsNonInterleaved | kAudioFormatFlagsNativeEndian;
        f.mBytesPerPacket = 4;
        f.mFramesPerPacket = 1;
        f.mBytesPerFrame = 4;
        f.mChannelsPerFrame = 2;
        f.mBitsPerChannel = 32;
        OSStatus e = 0;
        e |= AudioUnitSetProperty(au, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Input, 0,
                                  &f, sizeof(f));
        e |= AudioUnitSetProperty(au, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Output, 0,
                                  &f, sizeof(f));
        UInt32 mf = gBlock;
        e |= AudioUnitSetProperty(au, kAudioUnitProperty_MaximumFramesPerSlice,
                                  kAudioUnitScope_Global, 0, &mf, sizeof(mf));
        AURenderCallbackStruct cb{inputProc, this};
        e |= AudioUnitSetProperty(au, kAudioUnitProperty_SetRenderCallback, kAudioUnitScope_Input,
                                  0, &cb, sizeof(cb));
        e |= AudioUnitInitialize(au);
        if (e != noErr)
        {
            fprintf(stderr, "AU setup failed (%d)\n", (int)e);
            return false;
        }
        return true;
    }

    // JUCE AudioProcessor::copyXmlToBinary layout: magic, length, xml text, NUL
    static std::vector<UInt8> juceBinary(const std::string &xml)
    {
        std::vector<UInt8> b(8 + xml.size() + 1, 0);
        uint32_t magic = 0x21324356, len = (uint32_t)xml.size() + 1;
        memcpy(b.data(), &magic, 4);
        memcpy(b.data() + 4, &len, 4);
        memcpy(b.data() + 8, xml.data(), xml.size());
        return b;
    }

    std::string currentState() // xml text of the AU's own state
    {
        CFPropertyListRef pl = nullptr;
        UInt32 sz = sizeof(pl);
        if (AudioUnitGetProperty(au, kAudioUnitProperty_ClassInfo, kAudioUnitScope_Global, 0, &pl,
                                 &sz) != noErr ||
            !pl)
            return "";
        std::string out;
        auto data = (CFDataRef)CFDictionaryGetValue((CFDictionaryRef)pl, CFSTR("jucePluginState"));
        if (data && CFDataGetLength(data) > 8)
            out.assign((const char *)CFDataGetBytePtr(data) + 8, CFDataGetLength(data) - 8);
        CFRelease(pl);
        return out;
    }

    bool load(const std::string &name, const std::vector<float> &params)
    {
        std::string xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?> <awconsolidated "
                          "streamingVersion=\"8524\" currentProcessorName=\"" +
                          name + "\"";
        for (int i = 0; i < 10; ++i)
        {
            char b[64];
            snprintf(b, sizeof(b), " awp_%d=\"%.9g\"", i, i < (int)params.size() ? params[i] : 0.f);
            xml += b;
        }
        xml += " monoBehaviour=\"0\"/>";
        auto bin = juceBinary(xml);

        CFPropertyListRef pl = nullptr;
        UInt32 sz = sizeof(pl);
        if (AudioUnitGetProperty(au, kAudioUnitProperty_ClassInfo, kAudioUnitScope_Global, 0, &pl,
                                 &sz) != noErr ||
            !pl)
            return false;
        CFMutableDictionaryRef md =
            CFDictionaryCreateMutableCopy(nullptr, 0, (CFDictionaryRef)pl);
        CFRelease(pl);
        CFDataRef cd = CFDataCreate(nullptr, bin.data(), bin.size());
        CFDictionarySetValue(md, CFSTR("jucePluginState"), cd);
        CFRelease(cd);
        CFPropertyListRef mdr = md;
        OSStatus e = AudioUnitSetProperty(au, kAudioUnitProperty_ClassInfo,
                                          kAudioUnitScope_Global, 0, &mdr, sizeof(mdr));
        CFRelease(md);
        return e == noErr;
    }

    // AU parameters ctrl_0..ctrl_9 as (name, value). JUCE lists the host Bypass first; the
    // ctrl_N ids are JUCE string hashes of "ctrl_0".."ctrl_9", so they are 10 consecutive ids.
    std::vector<std::pair<std::string, float>> params(int n)
    {
        std::vector<std::pair<std::string, float>> r;
        UInt32 sz = 0;
        if (AudioUnitGetPropertyInfo(au, kAudioUnitProperty_ParameterList, kAudioUnitScope_Global,
                                     0, &sz, nullptr) != noErr)
            return r;
        std::vector<AudioUnitParameterID> ids(sz / sizeof(AudioUnitParameterID));
        AudioUnitGetProperty(au, kAudioUnitProperty_ParameterList, kAudioUnitScope_Global, 0,
                             ids.data(), &sz);
        size_t start = 0;
        for (; start + 10 <= ids.size(); ++start)
        {
            bool run = true;
            for (size_t k = 1; k < 10; ++k)
                run &= ids[start + k] == ids[start] + k;
            if (run)
                break;
        }
        if (start + 10 > ids.size())
            return r;
        ids = std::vector<AudioUnitParameterID>(ids.begin() + start, ids.begin() + start + std::min(n, 10));
        for (int i = 0; i < (int)ids.size(); ++i)
        {
            AudioUnitParameterInfo info{};
            UInt32 isz = sizeof(info);
            AudioUnitGetProperty(au, kAudioUnitProperty_ParameterInfo, kAudioUnitScope_Global,
                                 ids[i], &info, &isz);
            char nm[256] = "";
            if (info.cfNameString)
            {
                CFStringGetCString(info.cfNameString, nm, sizeof(nm), kCFStringEncodingUTF8);
                if (info.flags & kAudioUnitParameterFlag_CFNameRelease)
                    CFRelease(info.cfNameString);
            }
            AudioUnitParameterValue v = 0;
            AudioUnitGetParameter(au, ids[i], kAudioUnitScope_Global, 0, &v);
            if (getenv("NULLTEST_DUMP_PARAMS"))
                printf("  AU param #%d id=%u name='%s' value=%.9g\n", i, (unsigned)ids[i], nm, v);
            r.push_back({nm, v});
        }
        return r;
    }

    bool render(const Signal &s, std::vector<float> &oL, std::vector<float> &oR)
    {
        in = &s;
        size_t n = s.L.size();
        oL.assign(n, 0.f);
        oR.assign(n, 0.f);
        AudioUnitReset(au, kAudioUnitScope_Global, 0);
        for (inPos = 0; inPos < n; inPos += gBlock)
        {
            UInt32 fr = (UInt32)std::min<size_t>(gBlock, n - inPos);
            AudioBufferList *abl =
                (AudioBufferList *)alloca(sizeof(AudioBufferList) + sizeof(AudioBuffer));
            abl->mNumberBuffers = 2;
            abl->mBuffers[0] = {1, fr * 4, oL.data() + inPos};
            abl->mBuffers[1] = {1, fr * 4, oR.data() + inPos};
            AudioTimeStamp ts{};
            ts.mSampleTime = sampleTime;
            ts.mFlags = kAudioTimeStampSampleTimeValid;
            AudioUnitRenderActionFlags fl = 0;
            if (AudioUnitRender(au, &fl, &ts, 0, fr, abl) != noErr)
                return false;
            // AU may hand back its own buffers
            if (abl->mBuffers[0].mData != oL.data() + inPos)
                memcpy(oL.data() + inPos, abl->mBuffers[0].mData, fr * 4);
            if (abl->mBuffers[1].mData != oR.data() + inPos)
                memcpy(oR.data() + inPos, abl->mBuffers[1].mData, fr * 4);
            sampleTime += fr;
        }
        return true;
    }
};

// ---------------------------------------------------------------- airwin-core
template <typename T>
void renderCore(int idx, const std::vector<float> &params, unsigned seed, const Signal &s,
                std::vector<T> &oL, std::vector<T> &oR)
{
    const auto &r = AirwinRegistry::registry[idx];
    srand(seed);
    auto fx = r.generator();
    auto twin = r.generator(); // mirrors the AU's awDisplayProcessor, so rand() advances alike
    (void)twin;
    fx->setSampleRate((float)gSR);
    for (int i = 0; i < r.nParams; ++i)
        fx->setParameter(i, params[i]);

    size_t n = s.L.size();
    std::vector<T> iL(s.L.begin(), s.L.end()), iR(s.R.begin(), s.R.end());
    oL.assign(n, 0);
    oR.assign(n, 0);
    ScopedFTZ ftz(gFTZ);
    for (size_t p = 0; p < n; p += gBlock)
    {
        int fr = (int)std::min<size_t>(gBlock, n - p);
        T *ins[2] = {iL.data() + p, iR.data() + p};
        T *outs[2] = {oL.data() + p, oR.data() + p};
        if constexpr (std::is_same_v<T, float>)
            fx->processReplacing(ins, outs, fr);
        else
            fx->processDoubleReplacing(ins, outs, fr);
    }
}

struct Diff
{
    double maxAbs{0}; // inf when one side is non-finite and the other is not
    double peak{0};   // peak |reference|
    bool nonFinite{false};
};

template <typename A, typename B>
Diff compare(const std::vector<A> &aL, const std::vector<A> &aR, const std::vector<B> &bL,
             const std::vector<B> &bR)
{
    Diff d;
    auto one = [&](const std::vector<A> &a, const std::vector<B> &b) {
        for (size_t i = 0; i < a.size(); ++i)
        {
            double x = a[i], y = b[i];
            bool fx = std::isfinite(x), fy = std::isfinite(y);
            if (!fx || !fy)
            {
                d.nonFinite = true;
                if (fx != fy || (!std::isnan(x) && !std::isnan(y) && x != y))
                    d.maxAbs = INFINITY;
                continue;
            }
            d.peak = std::max(d.peak, std::fabs(x));
            d.maxAbs = std::max(d.maxAbs, std::fabs(x - y));
        }
    };
    one(aL, bL);
    one(aR, bR);
    return d;
}

std::string dB(double v)
{
    if (v == 0)
        return "-inf";
    if (!std::isfinite(v))
        return "inf";
    char b[32];
    snprintf(b, sizeof(b), "%.1f", 20 * std::log10(v));
    return b;
}

unsigned nameHash(const std::string &s)
{
    unsigned h = 2166136261u;
    for (unsigned char c : s)
        h = (h ^ c) * 16777619u;
    return h;
}
} // namespace

int main(int argc, char **argv)
{
    const char *only = nullptr, *csvPath = nullptr;
    for (int i = 1; i < argc; ++i)
    {
        if (!strcmp(argv[i], "--sr") && i + 1 < argc)
            gSR = atof(argv[++i]);
        else if (!strcmp(argv[i], "--block") && i + 1 < argc)
            gBlock = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--seconds") && i + 1 < argc)
            gSeconds = atof(argv[++i]);
        else if (!strcmp(argv[i], "--only") && i + 1 < argc)
            only = argv[++i];
        else if (!strcmp(argv[i], "--csv") && i + 1 < argc)
            csvPath = argv[++i];
        else if (!strcmp(argv[i], "--no-ftz"))
            gFTZ = false;
        else
        {
            fprintf(stderr, "usage: nulltest [--sr hz] [--block n] [--seconds s] [--only Name] [--no-ftz] "
                            "[--csv file]\n");
            return 2;
        }
    }

    // Tolerance for AU (float path) vs airwin-core double path. The float path ends in a
    // float conversion plus Airwindows' 32-bit float dither, each worth about one float
    // ULP of the output (2^-24 relative, -144 dB). We allow 2^-16 of the reference peak
    // (-96 dB relative, 256 ULPs) and never less than 2^-20 absolute (-120 dBFS), so a
    // few ULPs of rounding and dither pass while any real DSP difference fails.
    const double relTol = std::pow(2.0, -16), absTol = std::pow(2.0, -20);

    aw::ensureRegistry();
    AirwinConsolidatedBase::defaultSampleRate = (float)gSR;

    AUHost au;
    if (!au.open())
        return 3;

    Signal sig = makeSignal(gSR);
    FILE *csv = csvPath ? fopen(csvPath, "w") : nullptr;
    if (csv)
        fprintf(csv, "effect,category,params,status,bitexact_float,double_maxdiff_db,"
                     "double_rel_db,ref_peak_db,seed_sensitive,seed_maxdiff_db,param_check\n");

    int nEff = 0, nMatch = 0, nDiffer = 0, nUntested = 0, nBitExact = 0, nSeedSens = 0;
    int nParamMismatch = 0, nNotRepeat = 0;
    std::vector<std::string> notRepeatList;
    std::vector<std::string> differList, untestedList, seedList;

    printf("nulltest: sr=%.0f block=%d ftz=%s tolerance=max(-96 dB rel peak, -120 dBFS)\n", gSR,
           gBlock, gFTZ ? "on" : "off");

    for (int idx : AirwinRegistry::fxAlphaOrdering)
    {
        const auto &r = AirwinRegistry::registry[idx];
        if (only && r.name != only)
            continue;
        nEff++;

        // parameter sets: defaults, and one deterministic random set
        std::vector<std::vector<float>> sets(2);
        {
            auto fx = r.generator();
            for (int i = 0; i < r.nParams; ++i)
                sets[0].push_back(fx->getParameter(i));
            std::mt19937 rng(nameHash(r.name));
            std::uniform_int_distribution<int> u(0, 1000);
            for (int i = 0; i < r.nParams; ++i)
                sets[1].push_back((float)(u(rng) / 1000.0));
        }

        bool effTested = true, effMatch = true, effBitExact = true, effSeed = false,
             effRepeat = true;
        std::string effNote;
        for (int ps = 0; ps < 2; ++ps)
        {
            const char *psName = ps == 0 ? "default" : "random";
            unsigned seed = nameHash(r.name) + 7919u * ps;
            std::string status, pcheck = "ok";

            srand(seed);
            bool loaded = au.load(r.name, sets[ps]);
            std::string st = loaded ? au.currentState() : "";
            bool selected = st.find("currentProcessorName=\"" + r.name + "\"") != std::string::npos;
            std::vector<float> aL, aR;
            if (!loaded || !selected || !au.render(sig, aL, aR))
            {
                status = !loaded ? "untested(load)" : !selected ? "untested(not in AU)"
                                                                : "untested(render)";
                effTested = false;
                if (csv)
                    fprintf(csv, "%s,%s,%s,%s,,,,,,,\n", r.name.c_str(), r.category.c_str(),
                            psName, status.c_str());
                printf("%-28s %-8s %s (nParams=%d)\n", r.name.c_str(), psName, status.c_str(),
                       r.nParams);
                break;
            }

            // the AU should now report our parameter names and values
            auto ap = au.params(r.nParams);
            auto fx0 = r.generator();
            for (int i = 0; i < r.nParams; ++i)
            {
                if (i >= (int)ap.size() || ap[i].first != aw::paramName(fx0.get(), i) ||
                    ap[i].second != sets[ps][i])
                {
                    char b[256];
                    snprintf(b, sizeof(b), "p%d au='%s'=%.9g ours='%s'=%.9g", i,
                             i < (int)ap.size() ? ap[i].first.c_str() : "?",
                             i < (int)ap.size() ? ap[i].second : -1.f,
                             aw::paramName(fx0.get(), i).c_str(), sets[ps][i]);
                    pcheck = b;
                    nParamMismatch++;
                    break;
                }
            }

            // Render order is the same on both sides (main seed, other seed, main seed again),
            // so process-global state inside an effect (function-local statics) advances in
            // step in the AU binary and in ours.
            const unsigned seed2 = seed ^ 0x5bd1e995u;
            std::vector<float> fL, fR, gL, gR, hL, hR, a1L, a1R, a2L, a2R;
            std::vector<double> dL, dR;
            renderCore<float>(idx, sets[ps], seed, sig, fL, fR);
            renderCore<double>(idx, sets[ps], seed, sig, dL, dR);
            srand(seed2);
            bool ok2 = au.load(r.name, sets[ps]) && au.render(sig, a1L, a1R);
            renderCore<float>(idx, sets[ps], seed2, sig, gL, gR);
            srand(seed);
            ok2 = ok2 && au.load(r.name, sets[ps]) && au.render(sig, a2L, a2R);
            renderCore<float>(idx, sets[ps], seed, sig, hL, hR);

            Diff fdiff = compare(aL, aR, fL, fR);
            if (ok2)
                fdiff.maxAbs = std::max({fdiff.maxAbs, compare(a1L, a1R, gL, gR).maxAbs,
                                         compare(a2L, a2R, hL, hR).maxAbs});
            else
                fdiff.maxAbs = INFINITY;
            Diff ddiff = compare(aL, aR, dL, dR);
            Diff sdiff = compare(fL, fR, gL, gR); // only the rand() seed differs

            // repeatability: same seed and parameters, rendered a second time on each side
            Diff rOurs = compare(fL, fR, hL, hR);
            Diff rAU = ok2 ? compare(aL, aR, a2L, a2R) : Diff{INFINITY, 0, false};
            bool repeatable = rOurs.maxAbs == 0 && rAU.maxAbs == 0;
            effRepeat &= repeatable;

            bool bitExact = fdiff.maxAbs == 0;
            bool seedSens = sdiff.maxAbs != 0;
            double tol = std::max(absTol, relTol * ddiff.peak);
            bool match = ddiff.maxAbs <= tol;
            effBitExact &= bitExact;
            effSeed |= seedSens;
            effMatch &= match;
            double rel = ddiff.peak > 0 ? ddiff.maxAbs / ddiff.peak : ddiff.maxAbs;

            status = match ? "match" : "DIFFER";
            printf("%-28s %-8s %-6s float:%s double:max %s dBFS (%s dB rel, peak %s dBFS)%s%s%s\n",
                   r.name.c_str(), psName, status.c_str(), bitExact ? "bit-exact" : "differs",
                   dB(ddiff.maxAbs).c_str(), dB(rel).c_str(), dB(ddiff.peak).c_str(),
                   seedSens ? (" seed-sensitive(" + dB(sdiff.maxAbs) + " dBFS)").c_str() : "",
                   ddiff.nonFinite ? " nonfinite" : "",
                   pcheck == "ok" ? "" : (" PARAMS " + pcheck).c_str());
            if (!bitExact)
                printf("    float path max diff %s dBFS\n", dB(fdiff.maxAbs).c_str());
            if (!repeatable)
                printf("    NOT REPEATABLE: ours vs ours %s dBFS, AU vs AU %s dBFS\n",
                       dB(rOurs.maxAbs).c_str(), dB(rAU.maxAbs).c_str());
            if (csv)
                fprintf(csv, "%s,%s,%s,%s,%d,%s,%s,%s,%d,%s,\"%s\"\n", r.name.c_str(),
                        r.category.c_str(), psName, status.c_str(), bitExact ? 1 : 0,
                        dB(ddiff.maxAbs).c_str(), dB(rel).c_str(), dB(ddiff.peak).c_str(),
                        seedSens ? 1 : 0, dB(sdiff.maxAbs).c_str(), pcheck.c_str());
            if (!match)
                effNote += std::string(effNote.empty() ? "" : "; ") + psName + " " +
                           dB(ddiff.maxAbs) + " dBFS (" + dB(rel) + " dB rel)";
        }
        if (!effTested)
        {
            nUntested++;
            untestedList.push_back(r.name + " (nParams=" + std::to_string(r.nParams) + ")");
            continue;
        }
        if (effMatch)
            nMatch++;
        else
        {
            nDiffer++;
            differList.push_back(r.name + ": " + effNote);
        }
        if (effBitExact)
            nBitExact++;
        if (!effRepeat)
        {
            nNotRepeat++;
            notRepeatList.push_back(r.name);
        }
        if (effSeed)
        {
            nSeedSens++;
            seedList.push_back(r.name);
        }
        fflush(stdout);
    }

    printf("\n=== summary ===\n");
    printf("effects: %d\n", nEff);
    printf("double path vs AU: matched within tolerance: %d, differ: %d, could not test: %d\n",
           nMatch, nDiffer, nUntested);
    printf("float path vs AU: bit-exact (both param sets): %d of %d tested\n", nBitExact,
           nEff - nUntested);
    printf("seed-sensitive (output depends on rand()-seeded dither/noise): %d\n", nSeedSens);
    printf("AU parameter name/value mismatches: %d\n", nParamMismatch);
    printf("not repeatable (same seed, same params, different output on a second run): %d\n",
           nNotRepeat);
    for (auto &s : notRepeatList)
        printf("NOTREPEATABLE %s\n", s.c_str());
    for (auto &s : differList)
        printf("DIFFER %s\n", s.c_str());
    for (auto &s : untestedList)
        printf("UNTESTED %s\n", s.c_str());
    if (csv)
        fclose(csv);
    return nDiffer ? 1 : 0;
}
