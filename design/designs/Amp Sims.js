// Amp Sims: design options. Helpers (knob, menu, meterV, …) come from app.js.
// Visual cue: what the amp does to the signal — measured from the input vs the output.
(() => {
  // ---- local helpers (inside this file's IIFE) ----
  const TAU = Math.PI * 2;
  const cl = (v, a, b) => Math.max(a, Math.min(b, v));
  const greyFill = () => S.theme === "light" ? "#6e6e6e" : "#4a4a4a";
  const greyLine = () => S.theme === "light" ? "#5e5e5e" : "#8c8c8c";
    function ctl(c, th, ps, area, cols, vals, cellW) {
    if (!ps.length) {
      txt(c, area.x + area.w / 2, area.y + 30, "No controls", { color: th.dim });
    } else if (ps.length > cols) {
      if (ps.length <= 2 * cols) cols = Math.ceil(ps.length / 2);                    // rows with a clear gap, so a value never touches the next label
      const rows = Math.ceil(ps.length / cols), pitch = Math.min(60, area.h / rows), y0 = area.y + (area.h - rows * pitch) / 2 + (pitch - 50) / 2;
      for (let r = 0; r < rows; r++) knobGrid(c, th, ps.slice(r * cols, (r + 1) * cols), { x: area.x, y: y0 + r * pitch, w: area.w, h: 50 }, cols, vals, cellW);
    } else knobGrid(c, th, ps, area, cols, vals, cellW);
  }
  const amp = st => 0.12 + 0.85 * drums(st.t).env;
  function levels(st, dt, a, b) {
    st.inL = Math.max(db(a), st.inL - 24 * dt); st.outL = Math.max(db(b), st.outL - 24 * dt);
  }
  function line(c, pts, color, lw) {
    c.strokeStyle = color; c.lineWidth = lw; c.beginPath();
    pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.stroke();
  }
  function hbar(c, th, x, y, w, h, v, color) {
    c.fillStyle = th.meterBg; c.fillRect(x, y, w, h);
    c.fillStyle = color || th.green; c.fillRect(x, y, Math.max(0, Math.min(1, v)) * w, h);
  }
  const fl = db0 => cl(1 + db0 / 48, 0, 1);   // dB -> 0..1 for 48 dB meters
  // width of a legend() row, to right-align it; and a right-aligned readout with its own hover hint
  const lgW = (c, items, o = {}) => { c.font = `400 ${o.size || 8.5}px ${FONT}`; return items.reduce((a, it) => a + Math.ceil(c.measureText(it[1]).width) + (o.line ? 11 : 9) + (o.gap || 8), 0) - (o.gap || 8); };
  function rtxt(c, xr, yb, s, color, title, info, al) {
    c.font = `400 9.5px ${FONT}`; const w = Math.ceil(c.measureText(s).width);
    txt(c, xr, yb, s, { color, align: "right" }); hint(xr - w - 1, yb - 10, w + 2, 13, title, info);
  }
  function ltxt(c, x, yb, s, color, title, info) {
    c.font = `400 9.5px ${FONT}`; const w = Math.ceil(c.measureText(s).width);
    txt(c, x, yb, s, { color, align: "left" }); hint(x - 1, yb - 10, w + 2, 13, title, info);
  }
  const fk = f => f >= 1000 ? (f / 1000) + "k" : String(f);
  // spectrum display: grey fill = input, orange line = output, log frequency axis
  function spec(c, th, x, y, w, h, fin, fout, f0, f1, dTop, dBot, ticks) {
    const lg = Math.log(f1 / f0), ly = d => y + h * cl((dTop - d) / (dTop - dBot), 0, 1);
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    ticks.forEach(f => { c.fillStyle = th.dline; c.fillRect(Math.round(x + w * Math.log(f / f0) / lg), y, 1, h); });
    for (let i = 1; i < 4; i++) { c.fillStyle = th.dline; c.fillRect(x, Math.round(y + h * i / 4), w, 1); }
    c.fillStyle = greyFill(); c.beginPath(); c.moveTo(x, y + h);
    const ptsO = [];
    for (let px = 0; px <= w; px += 3) {
      const f = f0 * Math.exp(lg * px / w);
      c.lineTo(x + px, ly(fin(f))); ptsO.push([x + px, ly(fout(f))]);
    }
    c.lineTo(x + w, y + h); c.fill();
    line(c, ptsO, th.orange, 1.5);
    c.restore();
    ticks.forEach(f => txt(c, x + w * Math.log(f / f0) / lg + 2, y + h - 3, fk(f), { color: th.scale, size: 8.5, align: "left" }));
  }

  // ---- simulated amp: a generic waveshaper stands in for any effect; the display only uses in vs out ----
  const proc = (x, d, b) => (Math.tanh(d * x + b) - Math.tanh(b)) / (Math.tanh(d + b) - Math.tanh(b));
  function harmonics(A, d, b) {           // one cycle, 64 samples, DFT bins 1..10
    const N = 64, y = [], h = [];
    for (let n = 0; n < N; n++) y.push(proc(A * Math.sin(TAU * n / N), d, b));
    for (let k = 1; k <= 10; k++) {
      let re = 0, im = 0;
      for (let n = 0; n < N; n++) { re += y[n] * Math.cos(TAU * k * n / N); im += y[n] * Math.sin(TAU * k * n / N); }
      h.push(2 / N * Math.hypot(re, im));
    }
    return h;
  }
  function step(st, dt) {
    const A = amp(st), d = 3.2 + 2.2 * Math.sin(st.t * 0.7), b = 0.25;
    st.A = A; st.drive = d;
    if (!st.bins) { st.bins = Array.from({ length: 41 }, (_, i) => (i - 20) / 20); st.h = new Array(10).fill(0); st.thd = 0; st.crIn = 3; st.crOut = 3; st.dRms = 0.01; }
    for (let i = 0; i <= 40; i++) st.bins[i] += (proc((i - 20) / 20, d, b) - st.bins[i]) * 0.5;   // transfer curve, smoothed
    const h = harmonics(A, d, b);
    h.forEach((v, k) => st.h[k] += (v - st.h[k]) * 0.3);
    st.thd = 100 * Math.hypot(...st.h.slice(1)) / Math.max(1e-4, st.h[0]);
    let s2 = 0, s2d = 0, pk = 0;
    for (let n = 0; n < 32; n++) { const x = A * Math.sin(TAU * n / 32), y = proc(x, d, b); s2 += y * y; s2d += (y - x) * (y - x); pk = Math.max(pk, Math.abs(y)); }
    st.crOut = db(pk / Math.sqrt(s2 / 32)); st.crIn = 3.01; st.dRms += (Math.sqrt(s2d / 32) - st.dRms) * 0.3;
    st.gain = Math.max(1, proc(A, d, b) / A);
    st.kIn = []; st.kOut = [];
    for (let k = 1; k <= 40; k++) {
      const a = A * 0.9 / Math.pow(k, 1.1), hk = k <= 10 ? st.h[k - 1] : st.h[9] * Math.pow(10 / k, 1.3);
      st.kIn.push(a); st.kOut.push(Math.hypot(a * st.gain, k === 1 ? 0 : hk * 0.8));
    }
    levels(st, dt, A, Math.abs(proc(A, d, b)));
  }
  // ---- live: state from the real measurements m (airwin~ frames, ~30 per second) ----
  const fnum = (v, d) => Number.isFinite(v) ? v : d;
  const lin = d => Math.pow(10, d / 20);
  const rel = (prev, v, dt, r = 24) => Math.max(fnum(v, -120), fnum(prev, -120) - r * dt);   // fast attack, release r dB/s
  const hasN = (a, n) => Array.isArray(a) && a.length >= n;
  function bandAt(a, f) {                         // level of 48 log bands at frequency f (linear interpolation)
    if (!hasN(a, 48)) return -120;
    const p = 48 * Math.log(f / 20) / Math.log(1000) - 0.5, i = cl(Math.floor(p), 0, 46), t = cl(p - i, 0, 1);
    return fnum(a[i], -120) * (1 - t) + fnum(a[i + 1], -120) * t;
  }
  function liveGain(st, m, dt) {
    st.inL = rel(st.inL, Math.max(fnum(m.inPkDb[0], -120), fnum(m.inPkDb[1], -120)), dt);
    st.outL = rel(st.outL, Math.max(fnum(m.outPkDb[0], -120), fnum(m.outPkDb[1], -120)), dt);
  }
  const mono = (a, b) => { const o = []; for (let i = 0; i < 64; i++) o.push(fnum(a && a[i], 0) * 0.5 + fnum(b && b[i], 0) * 0.5); return o; };
  const crest = (pk, rmsDb) => (rmsDb > -100 && pk > 0) ? Math.max(0, db(pk) - rmsDb) : 0;
  function liveHarm(st, m, dt) {                  // harmonics 1..10 of the strongest low band, from ADDED energy in specOut
    if (!st.h) st.h = new Array(10).fill(0);
    if (hasN(m.specIn, 48) && hasN(m.specOut, 48)) {
      let bi = -1, bv = -90;
      for (let i = 0; i < 48; i++) { const f = bandHz(i); if (f >= 60 && f <= 800 && m.specIn[i] > bv) { bv = m.specIn[i]; bi = i; } }
      if (bi >= 0) st.f0i = bi;
      if (st.f0i !== undefined) {
        const f0 = bandHz(st.f0i), P = (a, i) => Math.pow(10, fnum(a[i], -120) / 10), p0 = Math.max(1e-12, P(m.specOut, st.f0i));
        for (let k = 2; k <= 10; k++) {
          const idx = Math.round(48 * Math.log(f0 * k / 20) / Math.log(1000) - 0.5);
          const add = idx <= 47 ? Math.max(0, P(m.specOut, idx) - P(m.specIn, idx)) : 0;
          const nd = 10 * Math.log10(Math.max(add / p0, 1e-10)), pd = db(st.h[k - 1]);
          st.h[k - 1] = lin(Math.max(nd, pd - 24 * dt));
        }
        st.h[0] = 1;
      }
    }
    st.thd = Math.min(999, 100 * Math.hypot(...st.h.slice(1)) / Math.max(1e-4, st.h[0]));
  }
  function liveAmp(st, m, dt) {
    st.live = true;
    liveGain(st, m, dt);
    const inPk = fnum(m.inPk, 0), outPk = fnum(m.outPk, 0);
    st.A = Math.max(inPk, fnum(st.A, 0) * lin(-24 * dt)); st.outA = Math.max(outPk, fnum(st.outA, 0) * lin(-24 * dt));
    st.R = 1;                                                    // plot half-range: fixed, full scale
    // transfer curve: 32 bins of mean output per input amplitude; a bin without data keeps its last value
    if (!st.xs) st.xs = new Array(32).fill(null);
    if (hasN(m.xfer, 32)) for (let j = 0; j < 32; j++) { const v = m.xfer[j]; if (Number.isFinite(v) && v > -8) st.xs[j] = st.xs[j] === null ? v : st.xs[j] + (v - st.xs[j]) * 0.4; }
    st.xf = st.xs.map((v, j) => { if (v === null) return null; const fx = 0.5 + (-1 + (j + 0.5) / 16) / (2 * st.R); return (fx < -0.02 || fx > 1.02) ? null : [fx, 0.5 - v / (2 * st.R)]; });
    // scatter of the latest input/output sample pairs
    const si = mono(m.inScopeL, m.inScopeR), so = mono(m.scopeL, m.scopeR);
    st.dots = si.map((u, i) => [0.5 + u / (2 * st.R), 0.5 - so[i] / (2 * st.R)]);
    // waveform window for the scope (option C), fixed scale
    st.sc = { i: si, o: so };
    liveHarm(st, m, dt);
    st.crIn += (crest(inPk, m.inRmsDb) - st.crIn) * 0.2; st.crOut += (crest(outPk, m.outRmsDb) - st.crOut) * 0.2;
    st.dDb = rel(st.dDb, m.diffRmsDb, dt); st.dRms = lin(st.dDb);
    st.gdb += (fnum(m.gainDb, 0) - st.gdb) * 0.15; st.gain = lin(st.gdb);
    // spectra for option B
    if (!st.sIn) { st.sIn = new Array(48).fill(-120); st.sOut = new Array(48).fill(-120); }
    for (let i = 0; i < 48; i++) {
      st.sIn[i] = rel(st.sIn[i], hasN(m.specIn, 48) ? m.specIn[i] : -120, dt);
      st.sOut[i] = rel(st.sOut[i], hasN(m.specOut, 48) ? m.specOut[i] : -120, dt);
    }
  }
  const L = (st, f, out) => {
    const lf = Math.log2(f / 100);
    let bed = -36 - 8 * lf + 6 * Math.exp(-((Math.log2(f / 900)) ** 2) / 1.2) + 20 * Math.log10(st.A / 0.5);
    if (out) bed += 6 + 1.2 * st.drive;
    let P = Math.pow(10, bed / 10);
    const k0 = Math.round(f / 110), arr = out ? st.kOut : st.kIn;
    for (let k = Math.max(1, k0 - 1); k <= Math.min(40, k0 + 1); k++)
      P += Math.pow(arr[k - 1], 2) * 4 * Math.exp(-((Math.log(f / (k * 110))) ** 2) / (2 * 0.03 * 0.03));
    return 10 * Math.log10(P);
  };

  const liveInit = (st, m, dt) => {
    if (!st.liveOn) Object.assign(st, { liveOn: true, h: new Array(10).fill(0), thd: 0, crIn: 0, crOut: 0, gdb: 0, dDb: -120, dRms: 1e-6, A: 0, outA: 0, scPk: 0.02, scFull: 0.023 });
    liveAmp(st, m, dt);
  };
  DESIGNS["Amp Sims"] = {
    effect: "ChimeyGuitar",
    refs: [["SaturatorL12.png", "Saturator"], ["AmpL12.png", "Amp"], ["EQEightL12.png", "EQ Eight (spectrum)"], ["RoarL12.png", "Roar"]],
    lead: "Visual cue: the distortion itself — how the output differs from the input, drawn live as a transfer curve, a harmonic spectrum or an in/out scope.",
    options: [
      { id: "A", name: "Transfer curve", short: "Curve", width: 632, step, live: liveInit,
        why: "A big measured in-versus-out curve plus harmonic bars show how hard the amp bends the signal — like Saturator.",
        bullets: ["Measured: output level plotted against input level (curve bends when the amp saturates), teal band = current input range; real audio adds the latest in/out sample pairs as cyan dots",
                  "Measured: size of harmonics 1–10 (simulated: DFT of the output; real audio: energy the amp added at multiples of the strongest low band, so tone changes also count), with THD readout",
                  "Menu, arrows and all dials at the right"],
        draw(c, th, st, ps, vals) {
          const y0 = HEAD_H + 4, H = DEVICE_H - 8;
          // screen 1: transfer curve (title + legend in the top strip, levels in the bottom strip)
          const x0 = 4, w0 = 150;
          screen(c, th, x0, y0, w0, H);
          strip(c, th, x0, y0, w0, 18);
          strip(c, th, x0, y0 + H - 16, w0, 16, true);
          const px = x0 + 6, py = y0 + 21, pw = w0 - 12, ph = H - 21 - 19;
          c.save(); c.beginPath(); c.rect(px, py, pw, ph); c.clip();
          if (st.live) {                       // real audio: plot range is fixed (+-R = full scale)
            const hb = pw * st.A / (2 * st.R);
            c.fillStyle = th.cyan + "33"; c.fillRect(px + pw / 2 - hb, py, 2 * hb, ph);
            c.fillStyle = th.dline; c.fillRect(px, py + ph / 2, pw, 1); c.fillRect(px + pw / 2, py, 1, ph);
            line(c, [[px, py + ph], [px + pw, py]], th.scale, 1);
            c.fillStyle = th.cyan; st.dots.forEach(d => c.fillRect(px + pw * d[0] - 0.75, py + ph * d[1] - 0.75, 1.5, 1.5));
            let seg = [];
            st.xf.forEach(p => { if (p) seg.push([px + pw * p[0], py + ph * p[1]]); else { if (seg.length > 1) line(c, seg, th.orange, 2); seg = []; } });
            if (seg.length > 1) line(c, seg, th.orange, 2);
          } else {
            c.fillStyle = th.cyan + "33"; c.fillRect(px + pw * (1 - st.A) / 2, py, pw * st.A, ph);
            c.fillStyle = th.dline; c.fillRect(px, py + ph / 2, pw, 1); c.fillRect(px + pw / 2, py, 1, ph);
            line(c, [[px, py + ph * (0.5 + 1 / 3.4)], [px + pw, py + ph * (0.5 - 1 / 3.4)]], th.scale, 1);
            line(c, st.bins.map((v, i) => [px + pw * i / 40, py + ph * (0.5 - v / 3.4)]), th.orange, 2);
            const xi = st.A * Math.sin(TAU * st.t * 55), yo = proc(xi, st.drive, 0.25);
            c.fillStyle = th.cyan; c.beginPath(); c.arc(px + pw * (xi + 1) / 2, py + ph * (0.5 - yo / 3.4), 2.5, 0, TAU); c.fill();
          }
          c.restore();
          txt(c, x0 + 6, y0 + 12, "Transfer", { color: th.scale, align: "left" });
          const tl = [[th.cyan, "In", "The cyan band and dots show the input signal. The band is the range of input levels now; the dots are single input and output samples."],
                      [th.orange, "Out", "The orange curve is the output level for each input level. A straight line means the amp changes nothing; a bend means it squashes or boosts."],
                      [th.scale, "Even", "The grey diagonal is the no-change line, where the output equals the input. Where the orange curve leaves it, the amp adds distortion."]];
          legend(c, th, x0 + w0 - 6 - lgW(c, tl), y0 + 12, tl);
          hint(px, py, pw, ph, "Transfer Curve", `Output level against input level, measured from the input and output audio.${st.live ? ` The plot edge is full scale, 0 dBFS.` : ""} The farther the orange curve bends from the grey diagonal, the more the amp distorts.`);
          ltxt(c, x0 + 6, y0 + H - 5, `In ${db(st.A).toFixed(1)} dB`, th.dispText, "Input Level Readout", "Peak level of the input signal now, in dB. Measured before the amp effect.");
          rtxt(c, x0 + w0 - 6, y0 + H - 5, `Out ${db(st.live ? st.outA : Math.abs(proc(st.A, st.drive, 0.25))).toFixed(1)} dB`, th.dispText, "Output Level Readout", "Peak level of the amp output now, in dB. Measured after the amp effect.");

          // screen 2: harmonics (title + THD + legend in the top strip, bar numbers in the bottom strip)
          const hx = 156, hw = 150;
          screen(c, th, hx, y0, hw, H);
          strip(c, th, hx, y0, hw, 30);
          strip(c, th, hx, y0 + H - 16, hw, 16, true);
          txt(c, hx + 6, y0 + 12, "Harmonics", { color: th.scale, align: "left" });
          rtxt(c, hx + hw - 6, y0 + 12, `THD ${st.thd.toFixed(1)}%`, th.dispText, "THD Readout", "Total harmonic distortion: how strong the added overtones are, as a percent of the main tone. Higher means a more distorted sound. Measured from the output.");
          legend(c, th, hx + 6, y0 + 25, [[th.cyan, "Tone", "Cyan bar 1 is the main tone. It sets the 0 dB reference for the other bars."], [th.orange, "Added", "Orange bars 2 to 10 are overtones (harmonics) the amp adds. Taller bars mean more of that overtone."]]);
          const by = y0 + H - 19, bh = H - 19 - 35;
          [0, -20, -40, -60].forEach(g => { const yy = by - bh * (-g / 60 > 1 ? 1 : 1 - (-g / 60)); c.fillStyle = th.dline; c.fillRect(hx + 4, Math.round(yy), hw - 8, 1); });
          st.h.forEach((v, k) => {
            const f = cl(1 + db(v) / 60, 0, 1), bx = hx + 8 + k * 14;
            c.fillStyle = k === 0 ? th.cyan : th.orange; c.fillRect(bx, by - bh * f, 10, bh * f);
            txt(c, bx + 5, y0 + H - 5, String(k + 1), { color: th.dispText, size: 8.5 });
          });
          hint(hx, y0, hw, H, "Harmonics Display", `Bars for the first 10 harmonics (overtones) of the main tone, from 0 dB down to -60 dB. ${st.live ? "Measured from the energy the amp added at multiples of the strongest low band." : "Measured from the output of the simulated amp."}`);

          // dial tile: menu and arrows on the top row, dials below
          tile(c, th, 308, y0, 322, H);
          menu(c, th, 312, y0 + 4, 130, "ChimeyGuitar"); arrows(c, th, 446, y0 + 4);
          ctl(c, th, ps, { x: 312, y: y0 + 22, w: 314, h: H - 26 }, 5, vals, 60);
        } },

      { id: "B", name: "Spectrum", short: "Spectrum", width: 600, step, live: liveInit,
        why: "A wide spectrum shows the input in grey and the amp output in orange, so added harmonics and tone shaping are visible — like EQ Eight and Amp.",
        bullets: ["Measured: FFT spectrum of input (grey) and output (orange line), log frequency",
                  "Readouts: input peak level and gain of the output over the input",
                  "Menu and arrows inside the display, dials in one row below"],
        draw(c, th, st, ps, vals) {
          const y0 = HEAD_H + 4, H = DEVICE_H - 8;
          const x = 4, y = y0, w = 594;
          screen(c, th, x, y, w, 98);
          strip(c, th, x, y, w, 22);
          if (st.live) spec(c, th, x + 3, y + 22, w - 6, 73, f => bandAt(st.sIn, f), f => bandAt(st.sOut, f), 40, 12000, 6, -90, [100, 1000, 10000]);
          else spec(c, th, x + 3, y + 22, w - 6, 73, f => L(st, f, false), f => L(st, f, true), 40, 12000, 6, -66, [100, 1000, 10000]);
          menu(c, th, x + 6, y + 3, 120, "ChimeyGuitar"); arrows(c, th, x + 130, y + 3);
          rtxt(c, x + w - 8, y + 15, `Peak ${db(st.A).toFixed(1)} dB`, th.dispText, "Input Peak Readout", "Highest level of the input signal now, in dB. Measured before the amp effect.");
          rtxt(c, x + w - 78, y + 15, `Gain ${db(st.gain) >= 0 ? "+" : ""}${db(st.gain).toFixed(1)} dB`, th.dispText, "Gain Readout", "How much louder (+) or quieter (-) the output is than the input, in dB. Measured from the input and output levels.");
          legend(c, th, x + 172, y + 15, [[greyFill(), "Input", "The grey area is the spectrum of the signal going into the amp: how loud each frequency is."], [th.orange, "Output", "The orange line is the spectrum of the amp output. Where it rises above the grey area, the amp added tone or harmonics."]]);
          hint(x, y + 22, w, 76, "Spectrum Display", "Level at each frequency, from 40 Hz to 12 kHz (left to right) and from loud to quiet (top to bottom). Measured from the input and output audio.");
          tile(c, th, x, y0 + 100, w, H - 100);
          ctl(c, th, ps, { x: x, y: y0 + 102, w: w, h: H - 104 }, 10, vals, 58);
        } },

      { id: "C", name: "Scope", short: "Scope", width: 632, step, live: liveInit,
        why: "An oscilloscope lays the output over the input so flattened peaks show at once, with meters for the added signal — like Roar and Drum Buss.",
        bullets: ["Measured: waveform of input (cyan) and output (orange); real audio shows the last few ms, drawn at a fixed scale (full scale = plot edge)",
                  "Readouts: THD and crest factor in and out; meters for In, Out and the difference (added signal)",
                  "Menu on top, dials at the right"],
        draw(c, th, st, ps, vals) {
          const y0 = HEAD_H + 4, H = DEVICE_H - 8;
          // screen: scope with legend in the top strip, THD and crest in the bottom strip
          const x = 4, w = 252;
          screen(c, th, x, y0, w, H);
          strip(c, th, x, y0, w, 18);
          strip(c, th, x, y0 + H - 16, w, 16, true);
          const px = x + 3, pw = w - 6, py = y0 + 20, ph = H - 20 - 19, mid = py + ph / 2, hh = ph / 2;
          const a = [], b = [], av = [], bv = [];
          const at = (arr, u) => { const q = u * 63, i = Math.min(62, Math.floor(q)), t = q - i; return arr[i] * (1 - t) + arr[i + 1] * t; };
          for (let q = 0; q <= pw; q += 2) {
            if (st.live) { av.push(at(st.sc.i, q / pw)); bv.push(at(st.sc.o, q / pw)); continue; }
            const xi = st.A * Math.sin(TAU * (q / pw * 2.5 + st.t * 0.4));
            av.push(xi); bv.push(proc(xi, st.drive, 0.25));
          }
          // fixed scale, true level (RUBRIC 2.6)
          const g = 1;
          av.forEach((v, i) => { a.push([px + i * 2, mid - v * g * hh]); b.push([px + i * 2, mid - bv[i] * g * hh]); });
          c.save(); c.beginPath(); c.rect(px, py, pw, ph); c.clip();
          [-0.5, 0, 0.5].forEach(v => { c.fillStyle = th.dline; c.fillRect(px, Math.round(mid - v * hh), pw, 1); });
          line(c, a, th.cyan, 1.2); line(c, b, th.orange, 2);
          c.restore();
          legend(c, th, x + 6, y0 + 12, [[th.cyan, "In", "The cyan wave is the signal going into the amp."], [th.orange, "Out", "The orange wave is the amp output. Flat tops on it mean the amp is clipping the peaks."]], { line: true });
          hint(px, py, pw, ph, "Scope Display", "Shape of the input and output waves over a few milliseconds. Measured from the input and output audio. The thin lines mark half of the plot height.");
          ltxt(c, x + 6, y0 + H - 5, `THD ${st.thd.toFixed(1)} %   Crest ${st.crIn.toFixed(1)} → ${st.crOut.toFixed(1)} dB`, th.dispText, "THD and Crest Readout", "THD is how strong the added overtones are, in percent. Crest is the gap between peak and average level, input then output, in dB. A lower crest on the output means flattened peaks.");
          // tile: difference meter
          tile(c, th, 258, y0, 26, H);
          txt(c, 271, y0 + 16, "Δ", { color: th.text, size: 10 });
          hint(258, y0, 26, H, "Added Signal Meter", "How loud the difference between output and input is, in dB. It shows how much the amp added or removed. Measured from the input and output audio.");
          meterV(c, th, 266, y0 + 24, 10, H - 52, fl(db(st.dRms)), false, th.orange);
          txt(c, 271, y0 + H - 10, `${db(st.dRms).toFixed(0)}`, { color: th.text, size: 8.5 });
          // dial tile
          tile(c, th, 286, y0, 344, H);
          menu(c, th, 290, y0 + 4, 120, "ChimeyGuitar"); arrows(c, th, 414, y0 + 4);
          ctl(c, th, ps, { x: 290, y: y0 + 22, w: 336, h: H - 26 }, 5, vals, 62);
        } },
    ],
  };
  // Input / Output gain strip at the right edge of every option (required on all devices)
  DESIGNS["Amp Sims"].options.forEach(o => {
    const base = o.width, inner = o.draw;
    o.width = base + GAIN_W + 4;
    o.draw = (c, th, st, ps, vals) => { if (!st.bins && !st.live) return; inner(c, th, st, ps, vals); gainStrip(c, th, o.width - GAIN_W - 4, st); };
  });
})();
