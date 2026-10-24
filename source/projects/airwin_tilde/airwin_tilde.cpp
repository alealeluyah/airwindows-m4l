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
//
// Effect swaps and parameter changes reach the audio thread lock-free.

#include "ext.h"
#include "ext_obex.h"
#include "z_dsp.h"

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

    // audio thread
    FxBox *audio{nullptr};
    float audioRate{0.f};
    float applied[kMaxParams];
    uint32_t appliedGen{0};
    std::vector<double> inL, inR;

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
    if (!fx)
    {
        if (outs[0] != ins[0])
            std::copy(ins[0], ins[0] + n, outs[0]);
        if (outs[1] != ins[1])
            std::copy(ins[1], ins[1] + n, outs[1]);
        return;
    }

    uint32_t gen = im->paramGen.load();
    if (gen != im->appliedGen)
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
    // but some effects read ahead, so feed it private copies of the input.
    for (long off = 0; off < n; off += kChunk)
    {
        long len = (std::min)(kChunk, n - off);
        std::copy(ins[0] + off, ins[0] + off + len, im->inL.data());
        std::copy(ins[1] + off, ins[1] + off + len, im->inR.data());
        double *in2[2] = {im->inL.data(), im->inR.data()};
        double *out2[2] = {outs[0] + off, outs[1] + off};
        fx->fx->processDoubleReplacing(in2, out2, (VstInt32)len);
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
    class_dspinit(c);
    class_register(CLASS_BOX, c);
    airwin_class = c;
}
