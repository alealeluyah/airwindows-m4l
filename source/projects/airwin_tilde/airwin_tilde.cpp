// airwin~ : runs any Airwindows effect (from airwin2rack's consolidated set) inside Max.
//
// Inlets:  signal L (also takes messages), signal R
// Outlets: signal L, signal R, info messages
//
// Messages:
//   algo <name>        load an effect with its default parameters; outputs its description
//   algokeep <name>    load an effect but keep parameters set since the object was created
//                      (used while Live restores a saved set)
//   sync               output "pvalue <i> <0..1>" for every parameter of the current effect
//   param <i> <0..1>   set parameter i; outputs "display <i> <text>"
//   reset              reload the current effect (clears tails)
//   list <category>    output "algos <names...>" (all effects when no category given)
//   categories         output "categories <names...>"
//   ingain <dB>        input gain before the effect (smoothed; -70 dB or less = silence)
//   outgain <dB>       output gain after the effect (smoothed)
//   meter <0|1>        stop/start display data, about 30 times per second:
//                        levels <inPkL inPkR outPkL outPkR inRms outRms gain corr> (dB; corr -1..1)
//                        peaks <in out>          linear mono peaks of the last frame
//                        spec_in / spec_out <48> band levels in dBFS, 20 Hz .. 20 kHz, log-spaced
//                        xfer <32>               mean output per input-amplitude bin (-9 = no data)
//                        scope <64 L> <64 R>     recent output samples
//                        scope_in <64 L> <64 R>  recent input samples
//                        ms <inMid inSide outMid outSide>  RMS dBFS
//                        spec_diff <48>          band levels of (output - input), dBFS
//                        diff <rmsDb> <dc>       level of (output - input), output DC offset
//                        xcorr <64>              |cross-correlation| out vs in, lags 0..2047 / 32
//                        (peaks <in out> comes last in each frame)
//
// Effect swaps and parameter changes reach the audio thread lock-free.

#include "ext.h"
#include "ext_obex.h"
#include "z_dsp.h"

#include "aw_analysis.h"
#include "aw_registry.h"

#include <atomic>
#include <cmath>
#include <memory>
#include <string>
#include <vector>

static constexpr int kMaxParams = 64; // fits the display-dirty bitmask
static constexpr int kRetireSlots = 8;
static constexpr long kChunk = 4096;  // private input copy; longer vectors are processed in chunks

struct FxBox
{
    std::unique_ptr<AirwinConsolidatedBase> fx;
    int nParams{0};
};

struct Impl
{
    // main thread
    std::unique_ptr<FxBox> ui; // shadow instance for names and display text
    int algo{-1};
    double sr{48000};

    // handover
    std::atomic<FxBox *> pending{nullptr};
    std::atomic<FxBox *> retired[kRetireSlots];
    std::atomic<float> params[kMaxParams];
    std::atomic<bool> touched[kMaxParams];
    std::atomic<uint32_t> paramGen{0};
    std::atomic<uint64_t> displayDirty{0};
    std::atomic<float> sampleRate{48000.f};
    std::atomic<float> inGainTarget{1.f}, outGainTarget{1.f};

    // audio thread
    FxBox *audio{nullptr};
    float audioRate{0.f};
    float applied[kMaxParams];
    uint32_t appliedGen{0};
    double inGain{1.0}, outGain{1.0}; // smoothed per sample toward the targets
    std::vector<double> inL, inR;

    // display measurements: audio thread pushes, meter clock (main thread) reads
    aw::Collector meter;
    aw::Display shown;

    Impl() : inL(kChunk, 0.0), inR(kChunk, 0.0)
    {
        for (auto &r : retired)
            r.store(nullptr);
        for (int i = 0; i < kMaxParams; ++i)
        {
            params[i].store(0.f);
            touched[i].store(false);
            applied[i] = NAN;
        }
    }
    ~Impl()
    {
        delete audio;
        delete pending.exchange(nullptr);
        for (auto &r : retired)
            delete r.exchange(nullptr);
    }
};

typedef struct _airwin
{
    t_pxobject ob;
    void *infoOut;
    void *qelem;     // frees retired effects on the main thread
    void *displayQ;  // sends value text for changed parameters on the main thread
    void *meterClock; // display data, when "meter 1"
    bool meterOn;
    Impl *impl;
} t_airwin;

static t_class *airwin_class = nullptr;

static void out_sym(t_airwin *x, const char *sel, const std::string &s)
{
    t_atom a;
    atom_setsym(&a, gensym(s.c_str()));
    outlet_anything(x->infoOut, gensym(sel), 1, &a);
}

static void out_int_sym(t_airwin *x, const char *sel, long i, const std::string &s)
{
    t_atom a[2];
    atom_setlong(a, i);
    atom_setsym(a + 1, gensym(s.c_str()));
    outlet_anything(x->infoOut, gensym(sel), 2, a);
}

static void out_int_float(t_airwin *x, const char *sel, long i, double f)
{
    t_atom a[2];
    atom_setlong(a, i);
    atom_setfloat(a + 1, f);
    outlet_anything(x->infoOut, gensym(sel), 2, a);
}

static FxBox *make_fx(int idx, double sr)
{
    const auto &reg = AirwinRegistry::registry[idx];
    auto box = new FxBox();
    box->fx = reg.generator();
    box->fx->setSampleRate((float)sr);
    box->nParams = (std::min)(reg.nParams, kMaxParams);
    return box;
}

static void free_retired(t_airwin *x)
{
    for (auto &r : x->impl->retired)
        delete r.exchange(nullptr);
}

// Main thread only.
static void airwin_load(t_airwin *x, int idx, bool keep)
{
    Impl *im = x->impl;
    FxBox *next = make_fx(idx, im->sr);
    im->algo = idx;
    im->ui.reset(make_fx(idx, im->sr));
    FxBox *ui = im->ui.get();

    // defaults come from a freshly constructed effect
    for (int i = 0; i < ui->nParams; ++i)
    {
        if (keep && im->touched[i].load())
            ui->fx->setParameter(i, im->params[i].load());
        else
            im->params[i].store(ui->fx->getParameter(i));
    }

    // Publish the new effect before announcing the new values, so the audio thread never
    // applies them to the previous effect (whose parameter indexes mean something else).
    delete im->pending.exchange(next);
    im->paramGen.fetch_add(1);
}

static void airwin_report(t_airwin *x)
{
    Impl *im = x->impl;
    if (im->algo < 0 || !im->ui)
        return;
    const auto &reg = AirwinRegistry::registry[im->algo];
    FxBox *ui = im->ui.get();
    out_sym(x, "what", reg.whatText);
    out_sym(x, "category", reg.category);
    t_atom n;
    atom_setlong(&n, ui->nParams);
    outlet_anything(x->infoOut, gensym("nparams"), 1, &n);
    for (int i = 0; i < ui->nParams; ++i)
    {
        out_int_sym(x, "pname", i, aw::paramName(ui->fx.get(), i));
        out_int_float(x, "pvalue", i, im->params[i].load());
        out_int_sym(x, "display", i, aw::paramDisplay(ui->fx.get(), i));
    }
    out_sym(x, "algo", reg.name);
}

static void airwin_algo(t_airwin *x, t_symbol *s, long ac, t_atom *av);

// defer_low callbacks receive a short argc
static void airwin_algo_deferred(t_airwin *x, t_symbol *s, short ac, t_atom *av)
{
    airwin_algo(x, s, ac, av);
}

static void airwin_algo(t_airwin *x, t_symbol *s, long ac, t_atom *av)
{
    // effect state lives on the main thread; defer_low always queues (defer may not)
    if (!systhread_ismainthread())
    {
        defer_low(x, (method)airwin_algo_deferred, s, (short)ac, av);
        return;
    }
    if (ac < 1 || atom_gettype(av) != A_SYM)
    {
        object_error((t_object *)x, "algo needs an effect name");
        return;
    }
    int idx = aw::indexOf(atom_getsym(av)->s_name);
    if (idx < 0)
    {
        object_error((t_object *)x, "unknown effect: %s", atom_getsym(av)->s_name);
        return;
    }
    airwin_load(x, idx, s == gensym("algokeep"));
    airwin_report(x);
}

static void airwin_sync(t_airwin *x)
{
    if (!systhread_ismainthread())
    {
        defer_low(x, (method)airwin_sync, NULL, 0, NULL);
        return;
    }
    Impl *im = x->impl;
    if (!im->ui)
        return;
    for (int i = 0; i < im->ui->nParams; ++i)
        out_int_float(x, "pvalue", i, im->params[i].load());
}

static void airwin_reset(t_airwin *x)
{
    if (!systhread_ismainthread())
    {
        defer_low(x, (method)airwin_reset, NULL, 0, NULL);
        return;
    }
    if (x->impl->algo >= 0)
    {
        // keep the current parameter values across the reload
        bool was[kMaxParams];
        for (int i = 0; i < kMaxParams; ++i)
        {
            was[i] = x->impl->touched[i].load();
            x->impl->touched[i].store(true);
        }
        airwin_load(x, x->impl->algo, true);
        for (int i = 0; i < kMaxParams; ++i)
            x->impl->touched[i].store(was[i]);
    }
}

// qelem callback (main thread): one pass per UI tick however many values changed
static void airwin_display(t_airwin *x)
{
    Impl *im = x->impl;
    uint64_t dirty = im->displayDirty.exchange(0);
    if (!im->ui)
        return;
    for (int i = 0; i < im->ui->nParams; ++i)
    {
        if (!(dirty & (uint64_t(1) << i)))
            continue;
        im->ui->fx->setParameter(i, im->params[i].load());
        out_int_sym(x, "display", i, aw::paramDisplay(im->ui->fx.get(), i));
    }
}

static void airwin_param(t_airwin *x, t_symbol *, long ac, t_atom *av)
{
    if (ac < 2)
        return;
    long i = atom_getlong(av);
    if (i < 0 || i >= kMaxParams)
        return;
    float v = (float)atom_getfloat(av + 1);
    v = v < 0.f ? 0.f : (v > 1.f ? 1.f : v);
    x->impl->params[i].store(v);
    x->impl->touched[i].store(true);
    x->impl->paramGen.fetch_add(1);
    x->impl->displayDirty.fetch_or(uint64_t(1) << i);
    qelem_set(x->displayQ);
}

static float db_to_gain(double db) { return db <= -70.0 ? 0.f : (float)std::pow(10.0, db / 20.0); }

static void airwin_ingain(t_airwin *x, double db) { x->impl->inGainTarget.store(db_to_gain(db)); }
static void airwin_outgain(t_airwin *x, double db) { x->impl->outGainTarget.store(db_to_gain(db)); }

static void airwin_list_algos(t_airwin *x, t_symbol *s, long ac, t_atom *av)
{
    aw::ensureRegistry();
    std::vector<t_atom> out;
    auto add = [&](const std::string &n) {
        t_atom a;
        atom_setsym(&a, gensym(n.c_str()));
        out.push_back(a);
    };
    if (ac > 0 && atom_gettype(av) == A_SYM)
    {
        auto it = AirwinRegistry::fxByCategory.find(atom_getsym(av)->s_name);
        if (it != AirwinRegistry::fxByCategory.end())
            for (const auto &n : it->second)
                add(n);
    }
    else
    {
        for (int i : AirwinRegistry::fxAlphaOrdering)
            add(AirwinRegistry::registry[i].name);
    }
    outlet_anything(x->infoOut, gensym("algos"), (short)out.size(), out.data());
}

static void airwin_categories(t_airwin *x)
{
    aw::ensureRegistry();
    std::vector<t_atom> out;
    for (const auto &c : AirwinRegistry::categories)
    {
        t_atom a;
        atom_setsym(&a, gensym(c.c_str()));
        out.push_back(a);
    }
    outlet_anything(x->infoOut, gensym("categories"), (short)out.size(), out.data());
}

static void out_floats(t_airwin *x, const char *sel, const float *v, int n, float nanAs = -9.f)
{
    t_atom a[128];
    n = (std::min)(n, 128);
    for (int i = 0; i < n; ++i)
        atom_setfloat(a + i, std::isfinite(v[i]) ? v[i] : nanAs);
    outlet_anything(x->infoOut, gensym(sel), (short)n, a);
}

// meter clock (main thread): newest frame -> display messages
static void airwin_meter_tick(t_airwin *x)
{
    if (!x->meterOn)
        return;
    Impl *im = x->impl;
    if (const aw::Frame *f = im->meter.latest())
    {
        aw::Display &d = im->shown;
        aw::analyze(*f, im->sr, d);
        float lv[8] = {d.inPkDb[0], d.inPkDb[1], d.outPkDb[0], d.outPkDb[1], d.inRmsDb, d.outRmsDb, d.gainDb, d.corr};
        out_floats(x, "levels", lv, 8);
        out_floats(x, "spec_in", d.specIn, aw::kBands);
        out_floats(x, "spec_out", d.specOut, aw::kBands);
        out_floats(x, "spec_diff", d.specDiff, aw::kBands);
        out_floats(x, "xfer", d.xfer, aw::kXferBins);
        float sc[128];
        std::copy(d.scopeL, d.scopeL + 64, sc);
        std::copy(d.scopeR, d.scopeR + 64, sc + 64);
        out_floats(x, "scope", sc, 128);
        std::copy(d.inScopeL, d.inScopeL + 64, sc);
        std::copy(d.inScopeR, d.inScopeR + 64, sc + 64);
        out_floats(x, "scope_in", sc, 128);
        out_floats(x, "ms", d.ms, 4);
        float df[2] = {d.diffRmsDb, d.dcOut};
        out_floats(x, "diff", df, 2);
        out_floats(x, "xcorr", d.xcorr, 64);
        float pk[2] = {d.inPk, d.outPk};
        out_floats(x, "peaks", pk, 2); // last: the display redraws on this one
    }
    clock_fdelay(x->meterClock, 33.);
}

static void airwin_meter(t_airwin *x, long on)
{
    x->meterOn = on != 0;
    if (x->meterOn)
        clock_fdelay(x->meterClock, 0.);
    else
        clock_unset(x->meterClock);
}

static void airwin_perform64(t_airwin *x, t_object *, double **ins, long, double **outs, long,
                             long n, long, void *)
{
    Impl *im = x->impl;

    // Swap in a pending effect only when the old one can be parked for the main thread to
    // free; otherwise keep the old one for this block. The audio thread never frees memory.
    std::atomic<FxBox *> *slot = nullptr;
    for (auto &r : im->retired)
        if (!r.load())
        {
            slot = &r;
            break;
        }
    if (slot || !im->audio)
    {
        if (FxBox *p = im->pending.exchange(nullptr))
        {
            FxBox *old = im->audio;
            im->audio = p;
            im->audioRate = 0.f;
            im->appliedGen = im->paramGen.load() - 1;
            for (auto &a : im->applied)
                a = NAN;
            if (old)
            {
                slot->store(old); // only the audio thread fills slots, so it is still free
                qelem_set(x->qelem);
            }
        }
    }

    FxBox *fx = im->audio;
    if (fx)
    {
        float sr = im->sampleRate.load();
        if (sr != im->audioRate)
        {
            im->audioRate = sr;
            fx->fx->setSampleRate(sr);
        }
    }

    uint32_t gen = im->paramGen.load();
    if (fx && gen != im->appliedGen)
    {
        im->appliedGen = gen;
        for (int i = 0; i < fx->nParams; ++i)
        {
            float v = im->params[i].load();
            if (!(v == im->applied[i]))
            {
                im->applied[i] = v;
                fx->fx->setParameter(i, v);
            }
        }
    }

    // Max may hand the same buffer to input and output; Airwindows reads and writes per sample
    // but some effects read ahead, so feed it private copies of the input (with input gain).
    // One-pole smoothing of both gains, about 10 ms.
    const double k = 1.0 - std::exp(-1.0 / (0.010 * (im->audioRate > 0 ? im->audioRate : 48000.0)));
    const double inT = im->inGainTarget.load(), outT = im->outGainTarget.load();
    for (long off = 0; off < n; off += kChunk)
    {
        long len = (std::min)(kChunk, n - off);
        double gi = im->inGain;
        for (long i = 0; i < len; ++i)
        {
            gi += (inT - gi) * k;
            im->inL[i] = ins[0][off + i] * gi;
            im->inR[i] = ins[1][off + i] * gi;
        }
        im->inGain = gi;
        double *in2[2] = {im->inL.data(), im->inR.data()};
        double *out2[2] = {outs[0] + off, outs[1] + off};
        if (fx)
            fx->fx->processDoubleReplacing(in2, out2, (VstInt32)len);
        else
        {
            std::copy(in2[0], in2[0] + len, out2[0]);
            std::copy(in2[1], in2[1] + len, out2[1]);
        }
        double go = im->outGain;
        for (long i = 0; i < len; ++i)
        {
            go += (outT - go) * k;
            out2[0][i] *= go;
            out2[1][i] *= go;
        }
        im->outGain = go;
        im->meter.push(in2[0], in2[1], out2[0], out2[1], len);
    }
}

static void airwin_dsp64(t_airwin *x, t_object *dsp64, short *, double samplerate,
                         long maxvectorsize, long)
{
    // The audio thread may still run the old chain: it owns the audio-side effects and its
    // buffers, so it only receives the new rate through an atomic.
    Impl *im = x->impl;
    im->sr = samplerate;
    im->sampleRate.store((float)samplerate);
    im->meter.setHop((long)(samplerate / 30.0));
    AirwinConsolidatedBase::defaultSampleRate = (float)samplerate;
    if (im->ui)
        im->ui->fx->setSampleRate((float)samplerate);
    object_method(dsp64, gensym("dsp_add64"), x, airwin_perform64, 0, NULL);
}

static void airwin_assist(t_airwin *, void *, long m, long a, char *s)
{
    if (m == ASSIST_INLET)
        snprintf(s, 256, a == 0 ? "(signal) Left in, messages" : "(signal) Right in");
    else
        snprintf(s, 256, a == 0 ? "(signal) Left out" : a == 1 ? "(signal) Right out" : "Info");
}

static void *airwin_new(t_symbol *, long ac, t_atom *av)
{
    t_airwin *x = (t_airwin *)object_alloc(airwin_class);
    if (!x)
        return nullptr;
    dsp_setup((t_pxobject *)x, 2);
    x->ob.z_misc |= Z_NO_INPLACE;
    x->infoOut = outlet_new((t_object *)x, NULL);
    outlet_new((t_object *)x, "signal");
    outlet_new((t_object *)x, "signal");
    x->qelem = qelem_new(x, (method)free_retired);
    x->displayQ = qelem_new(x, (method)airwin_display);
    x->meterClock = clock_new(x, (method)airwin_meter_tick);
    x->meterOn = false;
    x->impl = new Impl();
    x->impl->sr = sys_getsr() > 0 ? sys_getsr() : 48000;
    x->impl->sampleRate.store((float)x->impl->sr);
    aw::ensureRegistry();

    if (ac > 0 && atom_gettype(av) == A_SYM)
    {
        int idx = aw::indexOf(atom_getsym(av)->s_name);
        if (idx >= 0)
            airwin_load(x, idx, false);
    }
    return x;
}

static void airwin_free(t_airwin *x)
{
    dsp_free((t_pxobject *)x);
    clock_unset(x->meterClock);
    object_free(x->meterClock);
    qelem_free(x->qelem);
    qelem_free(x->displayQ);
    delete x->impl;
}

extern "C" void ext_main(void *)
{
    t_class *c = class_new("airwin~", (method)airwin_new, (method)airwin_free, sizeof(t_airwin),
                           0L, A_GIMME, 0);
    class_addmethod(c, (method)airwin_dsp64, "dsp64", A_CANT, 0);
    class_addmethod(c, (method)airwin_assist, "assist", A_CANT, 0);
    class_addmethod(c, (method)airwin_algo, "algo", A_GIMME, 0);
    class_addmethod(c, (method)airwin_algo, "algokeep", A_GIMME, 0);
    class_addmethod(c, (method)airwin_sync, "sync", 0);
    class_addmethod(c, (method)airwin_param, "param", A_GIMME, 0);
    class_addmethod(c, (method)airwin_reset, "reset", 0);
    class_addmethod(c, (method)airwin_list_algos, "list", A_GIMME, 0);
    class_addmethod(c, (method)airwin_categories, "categories", 0);
    class_addmethod(c, (method)airwin_meter, "meter", A_LONG, 0);
    class_addmethod(c, (method)airwin_ingain, "ingain", A_FLOAT, 0);
    class_addmethod(c, (method)airwin_outgain, "outgain", A_FLOAT, 0);
    class_dspinit(c);
    class_register(CLASS_BOX, c);
    airwin_class = c;
}
