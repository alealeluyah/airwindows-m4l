// Dithers: design options. All helpers are private to this IIFE.
(() => {
  const N = 256, K = 128;
  const WIN = Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
  const COS = [], SIN = [];
  for (let k = 0; k < K; k++) { COS.push(new Float32Array(N)); SIN.push(new Float32Array(N));
    for (let n = 0; n < N; n++) { COS[k][n] = Math.cos(2 * Math.PI * k * n / N); SIN[k][n] = Math.sin(2 * Math.PI * k * n / N); } }

  // Simulated 16-bit quantiser with TPDF dither and a little noise shaping.
  // Measures in-vs-out: error = out - in, its spectrum, histogram and level.
  const dbl = a => 20 * Math.log10(Math.max(a, 1e-9));
  function step0(st, dt) {
    if (!st.dz) Object.assign(st, { dz: true, n: 0, cnt: 1, s: new Float32Array(N), y: new Float32Array(N), e: new Float32Array(N),
      spec: new Float32Array(K).fill(-130), hist: new Float32Array(31), nd: -98, ndL: -98, ndR: -98, snr: 60, amp: 3, nh: [], peak: 0, floor: -110 });
    const amp = 3 + 1.8 * Math.sin(st.t * 0.6), shape = 0.75 + 0.2 * Math.sin(st.t * 0.45 + 1), ph = st.t * 3;
    let eq = 0, sq = 0, sqL = 0, sqR = 0, pk = 0;
    for (let n = 0; n < N; n++) {
      const s = amp * Math.sin(2 * Math.PI * 4 * n / N + ph);
      const r = (noise(st.cnt++) + noise(st.cnt++)) * 0.5 * 1.0;
      const v = s - shape * eq, y = Math.round(v + r);
      eq = y - v; st.s[n] = s; st.y[n] = y; st.e[n] = y - s;
      sq += st.e[n] ** 2; if (n < N / 2) sqL += st.e[n] ** 2; else sqR += st.e[n] ** 2;
      pk = Math.max(pk, Math.abs(st.e[n]));
      const b = Math.round(st.e[n] / 0.2) + 15; if (b >= 0 && b < 31) st.hist[b] += 1;
    }
    for (let b = 0; b < 31; b++) st.hist[b] *= 0.985;
    const f = dbv => dbv;
    st.nd += (f(dbl(Math.sqrt(sq / N) / 32768)) - st.nd) * 0.2;
    st.ndL += (dbl(Math.sqrt(sqL / (N / 2)) / 32768) - st.ndL) * 0.2;
    st.ndR += (dbl(Math.sqrt(sqR / (N / 2)) / 32768) - st.ndR) * 0.2;
    st.snr += (dbl((amp / Math.SQRT2) / Math.max(1e-3, Math.sqrt(sq / N))) - st.snr) * 0.2;
    st.peak = Math.max(pk, st.peak - dt * 1.5); st.amp = amp;
    st.nh.push(st.nd); if (st.nh.length > 600) st.nh.shift();
    if (++st.n % 2 === 0) {                      // spectrum of the output (tone + noise floor)
      let sum = 0;
      for (let k = 0; k < K; k++) {
        let re = 0, im = 0;
        for (let n = 0; n < N; n++) { const w = WIN[n] * st.y[n]; re += w * COS[k][n]; im -= w * SIN[k][n]; }
        const m = Math.sqrt(re * re + im * im) * 2 / (N * 0.5) / 32768;
        st.spec[k] += (dbl(m) - st.spec[k]) * 0.35; if (k > 3) sum += st.spec[k];
      }
      st.floor = sum / (K - 4);
    }
  }

  // ---------- shared layout
  // gainStrip from app.js, with its In / Out labels moved apart (they touch otherwise)
  function gs(c, th, x, st) {
    gainStrip(c, th, x, st);
    const y = HEAD_H + 6, h = DEVICE_H - 12, mx = x + 44;
    c.fillStyle = th.body; c.fillRect(x + 32, y + h - 12, 28, 11);
    c.fillStyle = th.panel; c.fillRect(x + 32, y + h - 12, 28, 11);
    txt(c, mx + 3, y + h - 3, "In", { color: th.dim, size: 8, align: "right" });
    txt(c, mx + 6, y + h - 3, "Out", { color: th.dim, size: 8, align: "left" });
  }
  function step(st, dt) {
    if (!st.pre) { st.pre = true; for (let i = 0; i < 560; i++) { st.t += 0.016; step0(st, 0.016); } }
    step0(st, dt);
    const d = drums(st.t), a = db(d.env * 0.8 + 0.03);
    st.inL = Math.max(a, st.inL - 24 * dt); st.outL = Math.max(a - 0.2, st.outL - 24 * dt);
  }

  function dials(c, th, ps, vals, W) {
    const n = ps.length;
    if (!n) { rr(c, W - 92, HEAD_H + 4, 88, DEVICE_H - 8, 3, th.panel); txt(c, W - 48, HEAD_H + 88, "No controls", { color: th.dim });
      return 96; }
    const rows = n <= 5 ? 1 : n <= 10 ? 2 : 3, cols = Math.ceil(n / rows), w = cols * 52;
    knobGrid(c, th, ps, { x: W - w - 4, y: HEAD_H + 4, w, h: DEVICE_H - 8 }, cols, vals);
    return w + 8;
  }
  function panel(c, th, w, readouts) {
    const x = 4, y = HEAD_H + 4, h = DEVICE_H - 8;
    rr(c, x, y, w, h, 3, th.display);
    menu(c, th, x + 4, y + 3, 104, "BuildATPDF"); arrows(c, th, x + 112, y + 3);
    c.fillStyle = th.dline; c.fillRect(x, y + 21, w, 1);
    let rx = x + w - 6;
    readouts.slice().reverse().forEach(r => {
      txt(c, rx, y + 14, r[1], { color: r[2], align: "right" }); rx -= r[1].length * 5 + 4;
      txt(c, rx, y + 14, r[0], { color: th.dispText, align: "right" }); rx -= r[0].length * 5 + 10;
    });
    return { x, y, w, h, px: x + 6, py: y + 26, pw: w - 12, ph: h - 32 };
  }
  const clipTo = (c, x, y, w, h) => { c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); };
  const fm = v => (v >= 0 ? "+" : "") + v.toFixed(1);

  // ---------- A: zoomed waveform
  function drawA(c, th, st, ps, vals) {
    const W = 600, dw = dials(c, th, ps, vals, W);
    gs(c, th, W, st);
    const P = panel(c, th, W - dw - 8, [["Noise", `${st.nd.toFixed(1)} dBFS`, th.orange], ["Level", `${st.amp.toFixed(1)} LSB`, th.cyan]]);
    if (!st.s) return;
    const mid = P.py + P.ph / 2, sc = P.ph / 14;
    clipTo(c, P.px, P.py, P.pw, P.ph);
    c.lineWidth = 1;
    for (let l = -6; l <= 6; l++) { c.strokeStyle = l === 0 ? th.scale : th.dline; c.beginPath(); c.moveTo(P.px, mid - l * sc); c.lineTo(P.px + P.pw, mid - l * sc); c.stroke(); }
    c.strokeStyle = th.cyan; c.lineWidth = 1.5; c.beginPath();
    for (let i = 0; i < N; i++) { const x = P.px + i / (N - 1) * P.pw, y = mid - st.s[i] * sc; i ? c.lineTo(x, y) : c.moveTo(x, y); }
    c.stroke();
    c.strokeStyle = th.orange; c.lineWidth = 1.5; c.beginPath();
    for (let i = 0; i < N; i++) { const x0 = P.px + i / N * P.pw, x1 = P.px + (i + 1) / N * P.pw, y = mid - st.y[i] * sc;
      i ? c.lineTo(x0, y) : c.moveTo(x0, y); c.lineTo(x1, y); }
    c.stroke(); c.restore();
    [-4, 0, 4].forEach(l => txt(c, P.px + 1, mid - l * sc - 2, l ? fm(l) : "0", { color: th.scale, size: 8.5, align: "left" }));
    txt(c, P.px + P.pw - 4, P.py + 9, "In", { color: th.cyan, align: "right", size: 9 });
    txt(c, P.px + P.pw - 20, P.py + 9, "Out", { color: th.orange, align: "right", size: 9 });
    txt(c, P.x + P.w - 6, P.y + P.h - 3, "grid = 1 LSB", { color: th.scale, size: 8.5, align: "right" });
  }

  // ---------- B: spectrum of the output
  function drawB(c, th, st, ps, vals) {
    const W = 620, dw = dials(c, th, ps, vals, W);
    gs(c, th, W, st);
    const P = panel(c, th, W - dw - 8, [["Floor", `${(st.floor || -130).toFixed(0)} dB`, th.orange]]);
    if (!st.spec) return;
    const lo = -140, hi = -60, yOf = d => P.py + P.ph - 10 - (P.ph - 10) * (Math.min(hi, Math.max(lo, d)) - lo) / (hi - lo);
    const xOf = k => P.px + P.pw * k / (K - 1);
    clipTo(c, P.px, P.py, P.pw, P.ph);
    c.lineWidth = 1; c.strokeStyle = th.dline;
    for (let d = -120; d <= -80; d += 20) { c.beginPath(); c.moveTo(P.px, yOf(d)); c.lineTo(P.px + P.pw, yOf(d)); c.stroke(); }
    c.globalAlpha = 0.28; c.fillStyle = th.cyan; c.beginPath(); c.moveTo(xOf(0), P.py + P.ph - 10);
    for (let k = 0; k < K; k++) c.lineTo(xOf(k), yOf(st.spec[k]));
    c.lineTo(xOf(K - 1), P.py + P.ph - 10); c.fill(); c.globalAlpha = 1;
    c.strokeStyle = th.cyan; c.lineWidth = 1.5; c.beginPath();
    for (let k = 0; k < K; k++) k ? c.lineTo(xOf(k), yOf(st.spec[k])) : c.moveTo(xOf(k), yOf(st.spec[k]));
    c.stroke();
    c.strokeStyle = th.orange; c.lineWidth = 1; c.setLineDash && c.setLineDash([3, 3]);
    c.beginPath(); c.moveTo(P.px, yOf(st.floor)); c.lineTo(P.px + P.pw, yOf(st.floor)); c.stroke(); c.setLineDash && c.setLineDash([]);
    c.restore();
    for (let d = -120; d <= -80; d += 20) txt(c, P.px + P.pw - 2, yOf(d) - 2, String(d), { color: th.scale, size: 8.5, align: "right" });
    ["0", "5k", "10k", "15k", "20k"].forEach((s, i) => txt(c, P.px + 3 + (P.pw - 6) * i / 4, P.py + P.ph - 1, s, { color: th.scale, size: 8.5, align: i === 0 ? "left" : i === 4 ? "right" : "center" }));
    txt(c, xOf(4) + 6, Math.max(P.py + 9, yOf(st.spec[4]) + 3), "tone", { color: th.cyan, size: 9, align: "left" });
  }

  // ---------- C: error histogram + noise meters + history
  function drawC(c, th, st, ps, vals) {
    const W = 560, dw = dials(c, th, ps, vals, W);
    gs(c, th, W, st);
    const P = panel(c, th, W - dw - 8, [["SNR", `${st.snr.toFixed(0)} dB`, th.cyan], ["Peak", `${(st.peak || 0).toFixed(1)} LSB`, th.orange]]);
    if (!st.hist) return;
    const hh = P.ph - 44, hw = P.pw - 62, base = P.py + hh;
    const mx = Math.max(1, ...st.hist);
    clipTo(c, P.px, P.py, hw, hh + 12);
    c.fillStyle = th.cyan;
    for (let b = 0; b < 31; b++) { const bh = (st.hist[b] / mx) * (hh - 6), bw = hw / 31; c.fillRect(P.px + b * bw + 0.5, base - bh, bw - 1, bh); }
    c.restore();
    c.fillStyle = th.scale; c.fillRect(P.px, base, hw, 1);
    [-2, -1, 0, 1, 2].forEach(l => txt(c, P.px + hw / 2 + l * hw / 6, base + 9, l ? fm(l) : "0", { color: th.scale, size: 8.5 }));
    txt(c, P.px + 2, P.py + 8, "Error  (out - in), LSB", { color: th.dispText, size: 8.5, align: "left" });
    // noise meters
    const mx0 = P.px + hw + 8, f = d => (d + 110) / 30;
    meterV(c, th, mx0, P.py, 10, hh, f(st.ndL)); meterV(c, th, mx0 + 12, P.py, 10, hh, f(st.ndR));
    [-100, -90, -80].forEach(d => { const y = P.py + hh * (1 - f(d)); txt(c, mx0 + 26, y + 3, String(d), { color: th.scale, size: 8.5, align: "left" }); });
    txt(c, mx0 + 5, base + 9, "L", { color: th.dispText, size: 8.5 }); txt(c, mx0 + 17, base + 9, "R", { color: th.dispText, size: 8.5 });
    // noise-floor history strip
    const sy = P.py + P.ph - 28, sh = 24;
    c.fillStyle = th.dline; c.fillRect(P.px, sy - 2, P.pw, 1);
    clipTo(c, P.px, sy, P.pw, sh);
    c.strokeStyle = th.orange; c.lineWidth = 1.5; c.beginPath();
    const n = Math.min(st.nh.length, Math.floor(P.pw));
    for (let i = 0; i < n; i++) { const e = st.nh[st.nh.length - 1 - i], x = P.px + P.pw - i, y = sy + sh - (sh - 11) * Math.min(1, Math.max(0, (e + 101) / 8));
      i ? c.lineTo(x, y) : c.moveTo(x, y); }
    c.stroke(); c.restore();
    txt(c, P.px + 2, sy + 8, "Noise floor over time", { color: th.dispText, size: 8.5, align: "left" });
  }

  DESIGNS["Dithers"] = {
    effect: "BuildATPDF",
    refs: [["SaturatorL12.png", "Saturator (waveform + curve display)"], ["EQEightL12.png", "EQ Eight (spectrum)"], ["UtilityL12.png", "Utility (meters)"]],
    lead: "Visual cue: the tiny error a dither adds, measured as output minus input, shown as a zoomed waveform, a noise spectrum and a noise-floor meter.",
    options: [
      { id: "A", name: "Zoomed waveform", width: 668, step,
        why: "A very quiet sine zoomed to bit level: the input line in cyan, the stepped output in orange, like the waveform view of Saturator.",
        bullets: ["Input and output waveform, grid = 1 LSB step", "Readouts: noise floor (dBFS) and signal level", "Driven by the audio in and the audio out of the device"],
        draw: drawA },
      { id: "B", name: "Noise spectrum", width: 688, step,
        why: "FFT spectrum of the output with a dashed line at the measured noise floor, in the style of EQ Eight's analyser.",
        bullets: ["FFT of the output, 0–20 kHz, -140 to -60 dB", "Dashed line = average noise floor", "Shows where the noise sits, so noise shaping is visible"],
        draw: drawB },
      { id: "C", name: "Error meter", width: 628, step,
        why: "Histogram of the error (output minus input) beside two noise meters and a scrolling noise-floor trace.",
        bullets: ["Histogram of the difference between output and input", "Left/right noise meters and SNR readout", "Driven by the in-vs-out difference of each sample"],
        draw: drawC },
    ],
  };
})();
