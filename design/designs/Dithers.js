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

  // ---------- live(): measurements from airwin~ (about 30 per second)
  // Fields filled: inL/outL (gain strip), s/y/e (scope input/output/error), spec/dspec (48 bands),
  // hist (error histogram, 16-bit steps), nd/ndL/ndR (noise, dBFS), peak (LSB), snrTxt, lvl, nh (history).
  const NBD = 48, LSB = 32768;
  const fin = (v, d) => (Number.isFinite(v) ? v : d);
  const hold = (prev, v, rate, dt) => Math.max(v, fin(prev, -120) - rate * dt);
  const dbF = a => Math.max(-120, dbl(a));
  function live(st, m, dt) {
    if (!st.lz) Object.assign(st, { lz: true, real: true, s: [], y: [], e: [], hist: new Float32Array(31), nd: -120, ndL: -120, ndR: -120, peak: 0,
      spec: new Float32Array(NBD).fill(-120), dspec: new Float32Array(NBD).fill(-120), nh: [], lvl: -120, snrTxt: "", wsc: 0.05, inL: -60, outL: -60 });
    st.inL = hold(st.inL, Math.max(fin(m.inPkDb[0], -120), fin(m.inPkDb[1], -120)), 24, dt);
    st.outL = hold(st.outL, Math.max(fin(m.outPkDb[0], -120), fin(m.outPkDb[1], -120)), 24, dt);
    st.lvl = fin(m.outRmsDb, -120);
    st.nd = hold(st.nd, Math.max(-120, fin(m.diffRmsDb, -120)), 24, dt);
    const snr = fin(m.outRmsDb, -120) - fin(m.diffRmsDb, -120);
    st.snrTxt = st.lvl <= -119 ? "-" : m.diffRmsDb <= -119 ? ">120 dB" : `${Math.max(0, Math.min(120, snr)).toFixed(0)} dB`;
    const nS = Math.min((m.scopeL || []).length, (m.inScopeL || []).length);
    if (nS > 0) {
      st.s = Array.from(m.inScopeL.slice(0, nS), v => fin(v, 0)); st.y = Array.from(m.scopeL.slice(0, nS), v => fin(v, 0));
      st.e = st.y.map((v, i) => v - st.s[i]);
      let pkS = 0; for (let i = 0; i < nS; i++) pkS = Math.max(pkS, Math.abs(st.s[i]), Math.abs(st.y[i]));
      st.wsc = Math.max(0.01, pkS, st.wsc * Math.exp(-dt / 0.7));
      for (let b = 0; b < 31; b++) st.hist[b] *= 0.97;
      let pk = 0;
      [["scopeL", "inScopeL", "ndL"], ["scopeR", "inScopeR", "ndR"]].forEach(([o, i, k]) => {
        const a = m[o] || [], b = m[i] || [], n = Math.min(a.length, b.length, nS); let sq = 0;
        for (let j = 0; j < n; j++) { const e = fin(a[j], 0) - fin(b[j], 0); sq += e * e; pk = Math.max(pk, Math.abs(e) * LSB);
          const bin = Math.round(e * LSB / 0.2) + 15; if (bin >= 0 && bin < 31) st.hist[bin] += 1; }
        st[k] = hold(st[k], n ? dbF(Math.sqrt(sq / n)) : -120, 24, dt);
      });
      st.peak = Math.max(pk, st.peak - dt * 1.5);
    }
    for (let i = 0; i < NBD; i++) {
      st.spec[i] = hold(st.spec[i], fin((m.specOut || [])[i], -120), 30, dt);
      st.dspec[i] = hold(st.dspec[i], fin((m.specDiff || [])[i], -120), 30, dt);
    }
    st.nh.push(st.nd); if (st.nh.length > 600) st.nh.shift();
  }
  const ndTxt = st => ((st.nd === undefined || st.nd <= -119) ? "<-119 dBFS" : `${st.nd.toFixed(1)} dBFS`);
  const sameNote = (c, th, st, x, y, al, short) => { if (st.nd <= -119) txt(c, x, y, short ? "no added noise" : "output = input: no added noise", { color: th.orange, size: 9, align: al || "right" }); };
  const logX = (P, f) => P.px + P.pw * Math.log(f / bandHz(0)) / Math.log(bandHz(NBD - 1) / bandHz(0));

  // A, real: input and output scope on top, error (out - in) in 16-bit steps below
  function drawAReal(c, th, st, P) {
    const wh = Math.round(P.ph * 0.6), mid = P.py + wh / 2, n = st.s.length;
    // one zoom for input and output (RUBRIC 2.6): the loudest visible point fills ~90 % of the scope
    let pkS = 0; for (let i = 0; i < n; i++) pkS = Math.max(pkS, Math.abs(st.s[i]), Math.abs(st.y[i]));
    const g = fit(st, "waveA", pkS), sc = (wh / 2 - 3) * g;
    const ey = P.py + wh + 6, eh = P.ph - wh - 6, emid = ey + eh / 2, esc = (eh / 2 - 1) / 3;
    clipTo(c, P.px, P.py, P.pw, P.ph);
    c.lineWidth = 1; c.strokeStyle = th.scale; c.beginPath(); c.moveTo(P.px, mid); c.lineTo(P.px + P.pw, mid); c.stroke();
    c.strokeStyle = th.dline; c.beginPath(); c.moveTo(P.px, mid - wh / 2 + 3); c.lineTo(P.px + P.pw, mid - wh / 2 + 3); c.moveTo(P.px, mid + wh / 2 - 3); c.lineTo(P.px + P.pw, mid + wh / 2 - 3); c.stroke();
    if (n > 1) {
      c.strokeStyle = th.cyan; c.lineWidth = 1.5; c.beginPath();
      for (let i = 0; i < n; i++) { const x = P.px + i / (n - 1) * P.pw, y = mid - st.s[i] * sc; i ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.stroke();
      c.strokeStyle = th.orange; c.lineWidth = 1.5; c.beginPath();
      for (let i = 0; i < n; i++) { const x0 = P.px + i / n * P.pw, x1 = P.px + (i + 1) / n * P.pw, y = mid - st.y[i] * sc; i ? c.lineTo(x0, y) : c.moveTo(x0, y); c.lineTo(x1, y); }
      c.stroke();
    }
    c.fillStyle = th.dline; c.fillRect(P.px, ey - 3, P.pw, 1);
    c.strokeStyle = th.dline; c.lineWidth = 1;
    for (let l = -2; l <= 2; l += 2) { c.beginPath(); c.moveTo(P.px, emid - l * esc); c.lineTo(P.px + P.pw, emid - l * esc); c.stroke(); }
    if (n > 1) {
      c.strokeStyle = th.orange; c.lineWidth = 1.5; c.beginPath();
      for (let i = 0; i < n; i++) { const x = P.px + i / (n - 1) * P.pw, y = emid - Math.max(-3, Math.min(3, st.e[i] * LSB)) * esc; i ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.stroke();
    }
    c.restore();
    legend(c, th, P.x + 6, P.y + P.h - 4, [[th.cyan, "In", "The sound going into the effect, measured at its input."], [th.orange, "Out", "The sound coming out of the effect, measured at its output. In the error strip it shows out minus in."]], { line: true });
    zoomNote(c, th, P, g);
    hint(P.px, P.py, P.pw, wh, "Input And Output Waveform", "A short piece of the sound, zoomed in. Cyan is the input, orange is the output. Measured from the audio going in and out.");
    hint(P.px, ey, P.pw, eh, "Error Trace", "Output minus input, in steps of the 16-bit grid. This is the rounding noise and dither the effect adds.");
    hint(P.px + 2, P.py + 1, 120, 10, "Full Height Label", "The level that reaches the top of the scope, in dBFS. It follows the signal.");
    txt(c, P.px + 2, P.py + 9, `full height = ${dbl(1 / g).toFixed(0)} dBFS`, { color: th.scale, size: 8.5, align: "left" });
    txt(c, P.px + 2, ey + 8, "Error (out - in), 16-bit steps", { color: th.dispText, size: 8.5, align: "left" });
    sameNote(c, th, st, P.px + P.pw - 4, ey + 8);
    txt(c, P.x + P.w - 6, P.y + P.h - 4, "grid = 2 steps", { color: th.scale, size: 8.5, align: "right" });
    hint(P.x + P.w - 70, P.y + P.h - 13, 66, 10, "Grid Size", "Each error grid line is 2 steps of the 16-bit sample. A step is the smallest level a 16-bit file can store.");
  }
  // B, real: output spectrum (cyan) with the added part (output - input) in orange
  function drawBReal(c, th, st, P) {
    const lo = -120, hi = 0, b0 = P.py + P.ph - 10, ph = P.ph - 10;
    const yOf = d => b0 - ph * (Math.min(hi, Math.max(lo, d)) - lo) / (hi - lo), xOf = i => P.px + P.pw * i / (NBD - 1);
    clipTo(c, P.px, P.py, P.pw, P.ph);
    c.lineWidth = 1; c.strokeStyle = th.dline;
    for (let d = -100; d <= -20; d += 20) { c.beginPath(); c.moveTo(P.px, yOf(d)); c.lineTo(P.px + P.pw, yOf(d)); c.stroke(); }
    c.globalAlpha = 0.28; c.fillStyle = th.cyan; c.beginPath(); c.moveTo(xOf(0), b0);
    for (let i = 0; i < NBD; i++) c.lineTo(xOf(i), yOf(st.spec[i]));
    c.lineTo(xOf(NBD - 1), b0); c.fill(); c.globalAlpha = 1;
    c.strokeStyle = th.cyan; c.lineWidth = 1.5; c.beginPath();
    for (let i = 0; i < NBD; i++) i ? c.lineTo(xOf(i), yOf(st.spec[i])) : c.moveTo(xOf(i), yOf(st.spec[i]));
    c.stroke();
    c.strokeStyle = th.orange; c.lineWidth = 1.5; c.beginPath();
    for (let i = 0; i < NBD; i++) i ? c.lineTo(xOf(i), yOf(st.dspec[i])) : c.moveTo(xOf(i), yOf(st.dspec[i]));
    c.stroke();
    c.strokeStyle = th.orange; c.lineWidth = 1; c.setLineDash && c.setLineDash([3, 3]);
    c.beginPath(); c.moveTo(P.px, yOf(st.nd)); c.lineTo(P.px + P.pw, yOf(st.nd)); c.stroke(); c.setLineDash && c.setLineDash([]);
    c.restore();
    for (let d = -100; d <= -20; d += 20) txt(c, P.px + P.pw - 2, yOf(d) - 2, String(d), { color: th.scale, size: 8.5, align: "right" });
    [[100, "100"], [1000, "1k"], [10000, "10k"]].forEach(([f, s]) => txt(c, logX(P, f), P.py + P.ph - 1, s, { color: th.scale, size: 8.5 }));
    legend(c, th, P.lx, P.ly, [[th.cyan, "Output", "The loudness of the output at each pitch (frequency). Measured from the output audio."], [th.orange, "Added", "Output minus input: the part the effect adds, at each pitch."]], { line: true });
    hint(P.px, P.py, P.pw, P.ph, "Output Spectrum", "Loudness at each pitch, low pitches on the left. Cyan is the output, orange is what the effect added. Measured from the input and output audio.");
    hint(P.px, yOf(st.nd) - 3, P.pw, 6, "Noise Floor Line", "The dashed orange line is the average level of the added noise, in dB. Measured as output minus input.");
    hint(P.px + P.pw - 24, P.py, 24, P.ph - 10, "Level Scale", "Loudness in dB. 0 dB is the loudest level a digital signal can have.");
    hint(P.px, P.py + P.ph - 10, P.pw, 10, "Pitch Scale", "Pitch in Hz, on a log scale: each step to the right is a multiple of the last.");
    sameNote(c, th, st, P.px + 3, P.py + 9, "left");
  }
  function cHints(c, th, P, hw, hh, base) {
    legend(c, th, P.x + 6, P.y + P.h - 4, [[th.cyan, "Error count", "Bars: how often each size of error happens. Error is output minus input."], [th.orange, "Noise trace", "The line at the bottom: the noise level over time."]]);
    hint(P.px, P.py, hw, hh + 12, "Error Histogram", "How often each size of error happens, in 16-bit steps. A wide, smooth bump means a smooth dither. Measured as output minus input.");
    hint(P.px + hw + 8, P.py, 24, hh, "Noise Meters", "Left and right level of the added noise, in dBFS. Measured as output minus input.");
    hint(P.px + hw + 34, P.py, 28, hh, "Noise Scale", "Scale for the noise meters, in dBFS.");
    hint(P.px, P.py + P.ph - 28, P.pw, 28, "Noise Floor Trace", "The level of the added noise over time, newest on the right. Measured as output minus input.");
  }
  // C, real: histogram of the error in 16-bit steps, noise meters, noise history
  function drawCReal(c, th, st, P) {
    const hh = P.ph - 44, hw = P.pw - 62, base = P.py + hh, mx = Math.max(1, ...st.hist);
    clipTo(c, P.px, P.py, hw, hh + 12);
    c.fillStyle = th.cyan;
    for (let b = 0; b < 31; b++) { const bh = (st.hist[b] / mx) * (hh - 6), bw = hw / 31; c.fillRect(P.px + b * bw + 0.5, base - bh, bw - 1, bh); }
    c.restore();
    c.fillStyle = th.scale; c.fillRect(P.px, base, hw, 1);
    [-2, -1, 0, 1, 2].forEach(l => txt(c, P.px + hw / 2 + l * hw / 6, base + 9, l ? fm(l) : "0", { color: th.scale, size: 8.5 }));
    txt(c, P.px + 2, P.py + 8, "Error  (out - in), 16-bit steps", { color: th.dispText, size: 8.5, align: "left" });
    cHints(c, th, P, hw, hh, base);
    sameNote(c, th, st, P.px + 2, P.py + 20, "left", true);
    const mx0 = P.px + hw + 8, f = d => (d + 130) / 60;
    meterV(c, th, mx0, P.py, 10, hh, f(st.ndL)); meterV(c, th, mx0 + 12, P.py, 10, hh, f(st.ndR));
    [-120, -100, -80].forEach(d => { const y = P.py + hh * (1 - f(d)); txt(c, mx0 + 26, y + 3, String(d), { color: th.scale, size: 8.5, align: "left" }); });
    txt(c, mx0 + 5, base + 9, "L", { color: th.dispText, size: 8.5 }); txt(c, mx0 + 17, base + 9, "R", { color: th.dispText, size: 8.5 });
    const sy = P.py + P.ph - 28, sh = 24;
    c.fillStyle = th.dline; c.fillRect(P.px, sy - 2, P.pw, 1);
    clipTo(c, P.px, sy, P.pw, sh);
    c.strokeStyle = th.orange; c.lineWidth = 1.5; c.beginPath();
    const n = Math.min(st.nh.length, Math.floor(P.pw));
    for (let i = 0; i < n; i++) { const e = st.nh[st.nh.length - 1 - i], x = P.px + P.pw - i, y = sy + sh - (sh - 11) * Math.min(1, Math.max(0, (e + 130) / 70));
      i ? c.lineTo(x, y) : c.moveTo(x, y); }
    c.stroke(); c.restore();
    txt(c, P.px + 2, sy + 8, "Noise floor over time", { color: th.dispText, size: 8.5, align: "left" });
  }

  // ---------- shared layout
  // the shared gain strip (its meters explain themselves on hover)
  function gs(c, th, x, st) { gainStrip(c, th, x, st); }
  function step(st, dt) {
    if (!st.pre) { st.pre = true; for (let i = 0; i < 560; i++) { st.t += 0.016; step0(st, 0.016); } }
    step0(st, dt);
    const d = drums(st.t), a = db(d.env * 0.8 + 0.03);
    st.inL = Math.max(a, st.inL - 24 * dt); st.outL = Math.max(a - 0.2, st.outL - 24 * dt);
  }

  function dials(c, th, ps, vals, W) {
    const n = ps.length, y = HEAD_H + 4, h = DEVICE_H - 8;
    if (!n) { tile(c, th, W - 98, y, 96, h); txt(c, W - 50, HEAD_H + 88, "No controls", { color: th.dim });
      return 96; }
    const rows = n <= 5 ? 1 : n <= 10 ? 2 : 3, cols = Math.ceil(n / rows), w = cols * 52;
    const tw = w + 8;
    tile(c, th, W - 2 - tw, y, tw, h);
    knobGrid(c, th, ps, { x: W - 2 - tw + 4, y, w, h }, cols, vals);
    return tw;
  }
  function panel(c, th, w, readouts, dTitle, dText, bot = 0) {
    const x = 4, y = HEAD_H + 4, h = DEVICE_H - 8;
    screen(c, th, x, y, w, h);
    menu(c, th, x + 4, y + 3, 104, "BuildATPDF"); arrows(c, th, x + 112, y + 3);
    strip(c, th, x, y, w, 22);
    if (bot) strip(c, th, x, y + h - bot, w, bot, true);
    let rx = x + w - 6;
    hint(x, y, w, h, dTitle || "Display", dText || "Shows what the effect does to the sound, measured from the input and the output.");
    readouts.slice().reverse().forEach(r => {
      const r0 = rx;
      txt(c, rx, y + 14, r[1], { color: r[2], align: "right" }); rx -= r[1].length * 5 + 4;
      txt(c, rx, y + 14, r[0], { color: th.dispText, align: "right" }); rx -= r[0].length * 5 + 10;
      hint(rx + 6, y + 3, r0 - rx, 15, r[3] || r[0], r[4] || "");
    });
    return { x, y, w, h, px: x + 6, py: y + 26, pw: w - 12, ph: h - 32 - bot, lx: x + 146, ly: y + 14 };
  }
  // zoom readout in the bottom strip (RUBRIC 2.6)
  const zoomNote = (c, th, P, g) => {
    if (g <= 1.05) return;
    txt(c, P.x + 86, P.y + P.h - 4, zoomText(g), { color: th.dispText, size: 8.5, align: "left" });
    hint(P.x + 84, P.y + P.h - 13, 62, 11, "Zoom", "The waveform is enlarged so the loudest part fills the scope. The number says by how much; quiet signals get a larger zoom.");
  };
  const clipTo = (c, x, y, w, h) => { c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); };
  const fm = v => (v >= 0 ? "+" : "") + v.toFixed(1);

  // ---------- A: zoomed waveform
  function drawA(c, th, st, ps, vals) {
    const W = 600, dw = dials(c, th, ps, vals, W);
    gs(c, th, W, st);
    const P = panel(c, th, W - dw - 8, st.real ? [["Noise", ndTxt(st), th.orange, "Noise Level", "How loud the added noise is, in dBFS. Measured as output minus input."], ["Level", `${(st.lvl === undefined ? -120 : st.lvl).toFixed(1)} dBFS`, th.cyan, "Signal Level", "The average (RMS) level of the output, in dBFS."]]
      : [["Noise", `${st.nd.toFixed(1)} dBFS`, th.orange, "Noise Level", "How loud the added noise is, in dBFS. Measured as output minus input."], ["Level", `${st.amp.toFixed(1)} LSB`, th.cyan, "Signal Level", "The size of the test tone, in 16-bit steps (LSB)."]],
      "Zoomed Waveform", "Shows the input and the output zoomed in to single 16-bit steps, so you can see what dither adds.", 15);
    if (!st.s) return;
    if (st.real) return drawAReal(c, th, st, P);
    const mid = P.py + P.ph / 2;
    let pkS = 0; for (let i = 0; i < N; i++) pkS = Math.max(pkS, Math.abs(st.s[i]), Math.abs(st.y[i]));
    const g = fit(st, "waveA", pkS / 7), sc = P.ph / 14 * g;     // grid lines stay 1 LSB apart; the zoom moves them
    clipTo(c, P.px, P.py, P.pw, P.ph);
    c.lineWidth = 1;
    for (let l = -Math.ceil(7 / g); l <= Math.ceil(7 / g); l++) { c.strokeStyle = l === 0 ? th.scale : th.dline; c.beginPath(); c.moveTo(P.px, mid - l * sc); c.lineTo(P.px + P.pw, mid - l * sc); c.stroke(); }
    c.strokeStyle = th.cyan; c.lineWidth = 1.5; c.beginPath();
    for (let i = 0; i < N; i++) { const x = P.px + i / (N - 1) * P.pw, y = mid - st.s[i] * sc; i ? c.lineTo(x, y) : c.moveTo(x, y); }
    c.stroke();
    c.strokeStyle = th.orange; c.lineWidth = 1.5; c.beginPath();
    for (let i = 0; i < N; i++) { const x0 = P.px + i / N * P.pw, x1 = P.px + (i + 1) / N * P.pw, y = mid - st.y[i] * sc;
      i ? c.lineTo(x0, y) : c.moveTo(x0, y); c.lineTo(x1, y); }
    c.stroke(); c.restore();
    [-4, 0, 4].forEach(l => txt(c, P.px + 1, mid - l * sc - 2, l ? fm(l) : "0", { color: th.scale, size: 8.5, align: "left" }));
    legend(c, th, P.x + 6, P.y + P.h - 4, [[th.cyan, "In", "The sound going into the effect, measured at its input."], [th.orange, "Out", "The sound coming out of the effect, measured at its output."]], { line: true });
    zoomNote(c, th, P, g);
    hint(P.px, P.py, P.pw, P.ph, "Input And Output Waveform", "A short piece of the sound, zoomed in to single 16-bit steps. Cyan is the input, orange is the output. Measured from the audio going in and out.");
    txt(c, P.x + P.w - 6, P.y + P.h - 4, "grid = 1 LSB", { color: th.scale, size: 8.5, align: "right" });
    hint(P.x + P.w - 70, P.y + P.h - 13, 66, 10, "Grid Size", "Each grid line is 1 step (LSB) of the 16-bit sample. A step is the smallest level a 16-bit file can store.");
  }

  // ---------- B: spectrum of the output
  function drawB(c, th, st, ps, vals) {
    const W = 620, dw = dials(c, th, ps, vals, W);
    gs(c, th, W, st);
    const P = panel(c, th, W - dw - 8, [["Floor", st.real ? (st.nd === undefined || st.nd <= -119 ? "<-119 dB" : `${st.nd.toFixed(0)} dB`) : `${(st.floor || -130).toFixed(0)} dB`, th.orange, "Noise Floor", "The average level of the noise the effect adds, in dB. Measured as output minus input."]],
      "Noise Spectrum", "Shows how loud the output is at each pitch, so you can see where the dither noise sits.");
    if (!st.spec) return;
    if (st.real) return drawBReal(c, th, st, P);
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
    legend(c, th, P.lx, P.ly, [[th.cyan, "Output", "The loudness of the output at each pitch (frequency). Measured from the output audio."], [th.orange, "Noise floor", "The dashed line: the average level of the added noise."]], { line: true });
    hint(P.px, P.py, P.pw, P.ph, "Output Spectrum", "Loudness at each pitch, low pitches on the left. The cyan peak is the test tone. Measured from the output audio.");
    hint(P.px, yOf(st.floor) - 3, P.pw, 6, "Noise Floor Line", "The dashed orange line is the average level of the noise, in dB.");
  }

  // ---------- C: error histogram + noise meters + history
  function drawC(c, th, st, ps, vals) {
    const W = 560, dw = dials(c, th, ps, vals, W);
    gs(c, th, W, st);
    const P0 = panel(c, th, W - dw - 8, [["SNR", st.real ? (st.snrTxt || "-") : `${st.snr.toFixed(0)} dB`, th.cyan, "Signal To Noise Ratio", "How far the signal is above the added noise, in dB. Measured as output level minus noise level."], ["Peak", `${(st.peak || 0).toFixed(1)} LSB`, th.orange, "Error Peak", "The biggest single error between output and input, in 16-bit steps (LSB)."]],
      "Error Meter", "Shows the error the effect adds (output minus input) as a histogram, noise meters and a trace over time.", 15);
    const P = P0;
    if (!st.hist) return;
    if (st.real) return drawCReal(c, th, st, P);
    const hh = P.ph - 44, hw = P.pw - 62, base = P.py + hh;
    const mx = Math.max(1, ...st.hist);
    clipTo(c, P.px, P.py, hw, hh + 12);
    c.fillStyle = th.cyan;
    for (let b = 0; b < 31; b++) { const bh = (st.hist[b] / mx) * (hh - 6), bw = hw / 31; c.fillRect(P.px + b * bw + 0.5, base - bh, bw - 1, bh); }
    c.restore();
    c.fillStyle = th.scale; c.fillRect(P.px, base, hw, 1);
    [-2, -1, 0, 1, 2].forEach(l => txt(c, P.px + hw / 2 + l * hw / 6, base + 9, l ? fm(l) : "0", { color: th.scale, size: 8.5 }));
    txt(c, P.px + 2, P.py + 8, "Error  (out - in), LSB", { color: th.dispText, size: 8.5, align: "left" });
    cHints(c, th, P, hw, hh, base);
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

  // Before the first measurement arrives (real audio still loading) the state is empty: start it with silence.
  const SILENT = { inPkDb: [-120, -120], outPkDb: [-120, -120], inRmsDb: -120, outRmsDb: -120, gainDb: 0, corr: 0 };
  const wrap = f => (c, th, st, ps, vals) => { if (!st.dz && !st.lz) live(st, SILENT, 0); return f(c, th, st, ps, vals); };

  DESIGNS["Dithers"] = {
    effect: "BuildATPDF",
    refs: [["SaturatorL12.png", "Saturator (waveform + curve display)"], ["EQEightL12.png", "EQ Eight (spectrum)"], ["UtilityL12.png", "Utility (meters)"]],
    lead: "Visual cue: the tiny error a dither adds, measured as output minus input, shown as a zoomed waveform, a noise spectrum and a noise-floor meter.",
    options: [
      { id: "A", name: "Zoomed waveform", short: "Waveform", width: 668, step, live,
        why: "A very quiet sine zoomed to bit level: the input line in cyan, the stepped output in orange, like the waveform view of Saturator.",
        bullets: ["Input and output waveform, grid = 1 LSB step", "Readouts: noise floor (dBFS) and signal level", "Driven by the audio in and the audio out of the device",
          "Live: input and output scope (m.inScope/scope), error strip = out - in in 16-bit steps, Noise = diffRmsDb, Level = outRmsDb (dBFS)"],
        draw: wrap(drawA) },
      { id: "B", name: "Noise spectrum", short: "Spectrum", width: 688, step, live,
        why: "FFT spectrum of the output with a dashed line at the measured noise floor, in the style of EQ Eight's analyser.",
        bullets: ["FFT of the output, 0–20 kHz, -140 to -60 dB", "Dashed line = average noise floor", "Shows where the noise sits, so noise shaping is visible",
          "Live: cyan = specOut, orange = specDiff (added part), dashed = diffRmsDb; axis -120..0 dB, log frequency (48 bands, not a 128-bin FFT)"],
        draw: wrap(drawB) },
      { id: "C", name: "Error meter", short: "Error", width: 628, step, live,
        why: "Histogram of the error (output minus input) beside two noise meters and a scrolling noise-floor trace.",
        bullets: ["Histogram of the difference between output and input", "Left/right noise meters and SNR readout", "Driven by the in-vs-out difference of each sample",
          "Live: histogram and L/R noise meters from scope out - in (64 samples per frame), SNR = outRmsDb - diffRmsDb, history = diffRmsDb"],
        draw: wrap(drawC) },
    ],
  };
})();
