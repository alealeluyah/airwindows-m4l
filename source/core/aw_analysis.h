// aw_analysis.h : display measurements for the device UIs (header-only, no Max dependency).
//
// The audio thread calls Collector::push() per sample block. Every `hop` samples it publishes
// one Frame through a lock-free triple buffer. The UI thread calls Collector::latest() and
// turns the frame into display values with analyze().
//
// Frame contents: input/output peak and mean square per channel, output L/R cross terms
// (correlation), a transfer histogram (mean output per input-amplitude bin), the last
// kHist mono samples of input and output (for spectrum and waveform), and the last kScope
// output samples per channel (for an oscilloscope or vectorscope).

#pragma once

#include <algorithm>
#include <atomic>
#include <cmath>
#include <complex>
#include <vector>

namespace aw
{

static constexpr int kHist = 2048;  // FFT size
static constexpr int kScope = 256;
static constexpr int kXferBins = 32;
static constexpr int kBands = 48;   // log-spaced spectrum bands, 20 Hz .. 20 kHz

struct Frame
{
    float inPk[2], outPk[2];   // max |x|
    double inSq[2], outSq[2];  // sum of squares
    double lr, ll, rr;         // output cross terms
    double midSq[2], sideSq[2]; // sum of squares of (L+R)/2 and (L-R)/2: [0] input, [1] output
    double outSum;             // sum of the output mono signal (DC offset)
    double xferSum[kXferBins];
    int xferN[kXferBins];
    long n;                    // samples in this frame
    float histIn[kHist], histOut[kHist]; // chronological
    float scopeL[kScope], scopeR[kScope];
    float inScopeL[kScope], inScopeR[kScope];
    unsigned seq;
};

class Collector
{
  public:
    Collector() { reset(); }

    void setHop(long hop) { hop_.store(std::max<long>(64, hop), std::memory_order_relaxed); }

    // audio thread
    void push(const double *inL, const double *inR, const double *outL, const double *outR, long n)
    {
        for (long i = 0; i < n; ++i)
        {
            Frame &f = frames_[back_]; // publish() moves back_ to a fresh frame
            float il = (float)inL[i], ir = (float)inR[i], ol = (float)outL[i], orr = (float)outR[i];
            f.inPk[0] = std::max(f.inPk[0], std::fabs(il));
            f.inPk[1] = std::max(f.inPk[1], std::fabs(ir));
            f.outPk[0] = std::max(f.outPk[0], std::fabs(ol));
            f.outPk[1] = std::max(f.outPk[1], std::fabs(orr));
            f.inSq[0] += il * il;
            f.inSq[1] += ir * ir;
            f.outSq[0] += ol * ol;
            f.outSq[1] += orr * orr;
            f.midSq[0] += 0.25f * (il + ir) * (il + ir);
            f.sideSq[0] += 0.25f * (il - ir) * (il - ir);
            f.midSq[1] += 0.25f * (ol + orr) * (ol + orr);
            f.sideSq[1] += 0.25f * (ol - orr) * (ol - orr);
            f.outSum += 0.5f * (ol + orr);
            f.lr += ol * orr;
            f.ll += ol * ol;
            f.rr += orr * orr;
            float mi = 0.5f * (il + ir), mo = 0.5f * (ol + orr);
            int b = (int)std::floor((std::clamp(mi, -1.f, 0.99999f) + 1.f) * 0.5f * kXferBins);
            f.xferSum[b] += mo;
            f.xferN[b]++;
            ringIn_[pos_] = mi;
            ringOut_[pos_] = mo;
            scL_[spos_] = ol;
            scR_[spos_] = orr;
            siL_[spos_] = il;
            siR_[spos_] = ir;
            pos_ = (pos_ + 1) % kHist;
            spos_ = (spos_ + 1) % kScope;
            if (++f.n >= hop_.load(std::memory_order_relaxed))
                publish();
        }
    }

    // UI thread: newest frame, or nullptr when nothing new arrived
    const Frame *latest()
    {
        int m = mid_.load(std::memory_order_acquire);
        if (!(m & kDirty))
            return nullptr;
        m = mid_.exchange(front_, std::memory_order_acq_rel);
        front_ = m & ~kDirty;
        return &frames_[front_];
    }

    void reset()
    {
        for (auto &f : frames_)
            clear(f);
        back_ = 0;
        front_ = 1;
        mid_.store(2);
        pos_ = spos_ = 0;
        std::fill(std::begin(ringIn_), std::end(ringIn_), 0.f);
        std::fill(std::begin(ringOut_), std::end(ringOut_), 0.f);
        std::fill(std::begin(scL_), std::end(scL_), 0.f);
        std::fill(std::begin(scR_), std::end(scR_), 0.f);
        std::fill(std::begin(siL_), std::end(siL_), 0.f);
        std::fill(std::begin(siR_), std::end(siR_), 0.f);
    }

  private:
    static constexpr int kDirty = 4;

    static void clear(Frame &f)
    {
        f.inPk[0] = f.inPk[1] = f.outPk[0] = f.outPk[1] = 0.f;
        f.inSq[0] = f.inSq[1] = f.outSq[0] = f.outSq[1] = 0.0;
        f.lr = f.ll = f.rr = 0.0;
        f.midSq[0] = f.midSq[1] = f.sideSq[0] = f.sideSq[1] = f.outSum = 0.0;
        std::fill(std::begin(f.xferSum), std::end(f.xferSum), 0.0);
        std::fill(std::begin(f.xferN), std::end(f.xferN), 0);
        f.n = 0;
    }

    void publish()
    {
        Frame &f = frames_[back_];
        for (int i = 0; i < kHist; ++i)
        {
            f.histIn[i] = ringIn_[(pos_ + i) % kHist];
            f.histOut[i] = ringOut_[(pos_ + i) % kHist];
        }
        for (int i = 0; i < kScope; ++i)
        {
            f.scopeL[i] = scL_[(spos_ + i) % kScope];
            f.scopeR[i] = scR_[(spos_ + i) % kScope];
            f.inScopeL[i] = siL_[(spos_ + i) % kScope];
            f.inScopeR[i] = siR_[(spos_ + i) % kScope];
        }
        f.seq = ++seq_;
        back_ = mid_.exchange(back_ | kDirty, std::memory_order_acq_rel) & ~kDirty;
        clear(frames_[back_]);
    }

    Frame frames_[3];
    int back_{0}, front_{1};
    std::atomic<int> mid_{2};
    std::atomic<long> hop_{1600};
    unsigned seq_{0};
    int pos_{0}, spos_{0};
    float ringIn_[kHist], ringOut_[kHist], scL_[kScope], scR_[kScope], siL_[kScope], siR_[kScope];
};

// ---------------------------------------------------------------- UI-thread analysis

struct Display
{
    float inPkDb[2], outPkDb[2]; // dBFS
    float inRmsDb, outRmsDb;     // dBFS, mono
    float gainDb;                // outRms - inRms, 0 when the input is silent
    float corr;                  // output correlation -1..1 (1 for silence)
    float inPk, outPk;           // linear mono peaks (for scrolling waveforms)
    float specIn[kBands], specOut[kBands]; // dBFS per band
    float xfer[kXferBins];       // mean output per input bin, NAN where no samples
    float scopeL[64], scopeR[64];
    float inScopeL[64], inScopeR[64];
    float ms[4];                 // RMS dBFS: input mid, input side, output mid, output side
    float specDiff[kBands];      // band levels of (output - input), dBFS
    float diffRmsDb;             // RMS of (output - input) over the last kHist samples, dBFS
    float dcOut;                 // mean of the output (linear)
    float xcorr[64];             // |cross-correlation| of output vs input, lags 0..kHist-1 in 64 bins,
                                 // normalised so a pure delay reads 1 at its lag
};

inline float toDb(double lin) { return lin > 1e-6 ? (float)(20.0 * std::log10(lin)) : -120.f; }

inline void fft(std::vector<std::complex<double>> &a)
{
    const size_t n = a.size();
    for (size_t i = 1, j = 0; i < n; ++i)
    {
        size_t bit = n >> 1;
        for (; j & bit; bit >>= 1)
            j ^= bit;
        j ^= bit;
        if (i < j)
            std::swap(a[i], a[j]);
    }
    for (size_t len = 2; len <= n; len <<= 1)
    {
        double ang = -2.0 * M_PI / (double)len;
        std::complex<double> wl(std::cos(ang), std::sin(ang));
        for (size_t i = 0; i < n; i += len)
        {
            std::complex<double> w(1.0);
            for (size_t k = 0; k < len / 2; ++k)
            {
                auto u = a[i + k], v = a[i + k + len / 2] * w;
                a[i + k] = u + v;
                a[i + k + len / 2] = u - v;
                w *= wl;
            }
        }
    }
}

// Band levels in dBFS: a full-scale sine reads 0 dB in its band.
inline void spectrum(const float *x, double sr, float *bands)
{
    static thread_local std::vector<std::complex<double>> buf(kHist);
    for (int i = 0; i < kHist; ++i)
    {
        double w = 0.5 - 0.5 * std::cos(2.0 * M_PI * i / (kHist - 1));
        buf[i] = std::complex<double>(x[i] * w, 0.0);
    }
    fft(buf);
    const double norm = 2.0 / (kHist * 0.5); // Hann coherent gain is 0.5
    const double binHz = sr / kHist;
    for (int b = 0; b < kBands; ++b)
    {
        double f0 = 20.0 * std::pow(1000.0, (double)b / kBands);
        double f1 = 20.0 * std::pow(1000.0, (double)(b + 1) / kBands);
        int k0 = std::max(1, (int)std::floor(f0 / binHz)), k1 = std::max(k0, (int)std::floor(f1 / binHz));
        k1 = std::min(k1, kHist / 2 - 1);
        double peak = 0.0;
        for (int k = k0; k <= k1; ++k)
            peak = std::max(peak, std::abs(buf[k]) * norm);
        bands[b] = toDb(peak);
    }
}

// |cross-correlation| of y against x for lags 0 .. kHist-1, max per bin of kHist/64 lags.
inline void xcorr(const float *x, const float *y, float *out)
{
    const int N = 2 * kHist;
    static thread_local std::vector<std::complex<double>> X(N), Y(N);
    double ex = 0, ey = 0;
    for (int i = 0; i < N; ++i)
    {
        X[i] = i < kHist ? x[i] : 0.f;
        Y[i] = i < kHist ? y[i] : 0.f;
        if (i < kHist) { ex += x[i] * x[i]; ey += y[i] * y[i]; }
    }
    fft(X);
    fft(Y);
    for (int i = 0; i < N; ++i)
        Y[i] = std::conj(std::conj(Y[i]) * X[i]); // conj trick: ifft(z) = conj(fft(conj(z)))/N
    fft(Y);
    const double norm = (ex > 1e-12 && ey > 1e-12) ? 1.0 / (N * std::sqrt(ex * ey)) : 0.0;
    const int per = kHist / 64;
    for (int b = 0; b < 64; ++b)
    {
        double m = 0;
        for (int k = b * per; k < (b + 1) * per; ++k)
            m = std::max(m, std::abs(Y[(N - k) % N]) * norm);
        out[b] = (float)m;
    }
}

inline void analyze(const Frame &f, double sr, Display &d)
{
    for (int c = 0; c < 2; ++c)
    {
        d.inPkDb[c] = toDb(f.inPk[c]);
        d.outPkDb[c] = toDb(f.outPk[c]);
    }
    double n = std::max<long>(1, f.n);
    double inMs = 0.5 * (f.inSq[0] + f.inSq[1]) / n, outMs = 0.5 * (f.outSq[0] + f.outSq[1]) / n;
    d.inRmsDb = toDb(std::sqrt(inMs));
    d.outRmsDb = toDb(std::sqrt(outMs));
    d.gainDb = inMs > 1e-10 ? d.outRmsDb - d.inRmsDb : 0.f;
    d.corr = (f.ll > 1e-12 && f.rr > 1e-12) ? (float)(f.lr / std::sqrt(f.ll * f.rr)) : 1.f;
    d.inPk = std::max(f.inPk[0], f.inPk[1]);
    d.outPk = std::max(f.outPk[0], f.outPk[1]);
    spectrum(f.histIn, sr, d.specIn);
    spectrum(f.histOut, sr, d.specOut);
    for (int b = 0; b < kXferBins; ++b)
        d.xfer[b] = f.xferN[b] ? (float)(f.xferSum[b] / f.xferN[b]) : NAN;
    for (int i = 0; i < 64; ++i)
    {
        d.scopeL[i] = f.scopeL[i * (kScope / 64)];
        d.scopeR[i] = f.scopeR[i * (kScope / 64)];
        d.inScopeL[i] = f.inScopeL[i * (kScope / 64)];
        d.inScopeR[i] = f.inScopeR[i * (kScope / 64)];
    }
    d.ms[0] = toDb(std::sqrt(f.midSq[0] / n));
    d.ms[1] = toDb(std::sqrt(f.sideSq[0] / n));
    d.ms[2] = toDb(std::sqrt(f.midSq[1] / n));
    d.ms[3] = toDb(std::sqrt(f.sideSq[1] / n));
    d.dcOut = (float)(f.outSum / n);
    static thread_local std::vector<float> diff(kHist);
    double dsq = 0;
    for (int i = 0; i < kHist; ++i)
    {
        diff[i] = f.histOut[i] - f.histIn[i];
        dsq += diff[i] * diff[i];
    }
    d.diffRmsDb = toDb(std::sqrt(dsq / kHist));
    spectrum(diff.data(), sr, d.specDiff);
    xcorr(f.histIn, f.histOut, d.xcorr);
}

} // namespace aw
