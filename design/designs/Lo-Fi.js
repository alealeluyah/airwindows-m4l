// Lo-Fi: design options. Helpers (knob, menu, meterV, …) come from app.js.
// Visual cue: what the effect takes away or adds — steps in the waveform, lost highs, noise floor, pitch wobble; all in vs out.
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
  // width of a legend() row; right- and left-aligned readouts with their own hover hint
  const lgW = (c, items, o = {}) => { c.font = `400 ${o.size || 8.5}px ${FONT}`; return items.reduce((a, it) => a + Math.ceil(c.measureText(it[1]).width) + (o.line ? 11 : 9) + (o.gap || 8), 0) - (o.gap || 8); };
  function rtxt(c, xr, yb, s, color, title, info, size) {
    c.font = `400 ${size || 9.5}px ${FONT}`; const w = Math.ceil(c.measureText(s).width);
    txt(c, xr, yb, s, { color, align: "right", size }); hint(xr - w - 1, yb - 10, w + 2, 13, title, info);
  }
  function ltxt(c, x, yb, s, color, title, info, size) {
    c.font = `400 ${size || 9.5}px ${FONT}`; const w = Math.ceil(c.measureText(s).width);
    txt(c, x, yb, s, { color, align: "left", size }); hint(x - 1, yb - 10, w + 2, 13, title, info);
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

  // ---- simulated lo-fi degradation. A generic crusher/filter/wobble stands in for any effect; displays only compare in vs out ----
  const W_A = 322;                                   // waveform pixels in option A
  const srcV = (st, px, n) => st.A * (0.8 * Math.sin(TAU * (px / n * 1.5 + st.t * 0.2)) + 0.25 * Math.sin(TAU * (px / n * 4.5) + 1)) / 1.05;
  const lofiIn = (st, f) => 10 * Math.log10(Math.pow(10, (-12 - 2.4 * Math.log2(f / 100) + 20 * Math.log10(st.A)) / 10) + 1e-10);
  const lofiOut = (st, f) => 10 * Math.log10(Math.pow(10, (lofiIn(st, f) - 10 * Math.log10(1 + Math.pow(f / st.fc, 6))) / 10) + Math.pow(10, st.nf / 10));
  function step(st, dt) {
    const A = amp(st), t = st.t;
    st.A = A; st.bits = 4 + 2.5 * Math.sin(t * 0.5); st.holdPx = 4 + 5 * (0.5 + 0.5 * Math.sin(t * 0.35));
    st.fc = 4800 + 2400 * Math.sin(t * 0.3); st.nf = -66 + 8 * Math.sin(t * 0.45);
    const Lq = Math.pow(2, st.bits - 1);
    st.wIn = []; st.wOut = []; st.err = []; const lv = new Set(); let e2 = 0, ch = 0, prev = null;
    for (let px = 0; px < W_A; px++) {
      const v = srcV(st, px, W_A), vh = srcV(st, Math.floor(px / st.holdPx) * st.holdPx, W_A), q = Math.round(vh * Lq) / Lq;
      st.wIn.push(v); st.wOut.push(q); st.err.push(q - v); lv.add(q); e2 += (q - v) * (q - v);
      if (prev !== null && q !== prev) ch++; prev = q;
    }
    st.levelsN = lv.size; st.changes = ch; st.errDb = db(Math.sqrt(e2 / W_A));
    let bw = 20000; for (let k = 0; k < 80; k++) { const f = 100 * Math.pow(200, k / 79); if (lofiOut(st, f) < lofiIn(st, f) - 6) { bw = f; break; } }
    st.bw = bw;
    const d = drums(t), n = st.hist.length;
    const cents = (18 * Math.sin(t * 5.3) + 10 * Math.sin(t * 1.7)) * (0.5 + 0.5 * Math.sin(t * 0.4)) + 2 * noise(n);
    st.cents += (cents - st.cents) * 0.5;
    st.hist.push({ inE: d.env, outE: d.env * 0.9, dE: 0.12 * d.env * (0.5 + 0.5 * Math.abs(noise(n * 0.7))) + 0.02, cents: st.cents });
    if (st.hist.length > 800) st.hist.shift();
    st.dRms = Math.sqrt(e2 / W_A) + 0.01;
    levels(st, dt, A, A * 0.9);
  }

  // ---- live: state from the real measurements m (airwin~ frames, ~30 per second) ----
  const fnum = (v, d) => Number.isFinite(v) ? v : d;
  const lin = d => Math.pow(10, d / 20);
  const rel = (prev, v, dt, r = 24) => Math.max(fnum(v, -120), fnum(prev, -120) - r * dt);   // fast attack, release r dB/s
  const hasN = (a, n) => Array.isArray(a) && a.length >= n;
  function bandAt(a, f) {                         // level of the 48 log bands at frequency f (linear interpolation)
    if (!hasN(a, 48)) return -120;
    const p = 48 * Math.log(f / 20) / Math.log(1000) - 0.5, i = cl(Math.floor(p), 0, 46), t = cl(p - i, 0, 1);
    return fnum(a[i], -120) * (1 - t) + fnum(a[i + 1], -120) * t;
  }
  const mono = (a, b) => { const o = []; for (let i = 0; i < 64; i++) o.push(fnum(a && a[i], 0) * 0.5 + fnum(b && b[i], 0) * 0.5); return o; };
  const at64 = (arr, u) => { const q = cl(u, 0, 1) * 63, i = Math.min(62, Math.floor(q)), t = q - i; return arr[i] * (1 - t) + arr[i + 1] * t; };
  const lvl01 = d => cl((fnum(d, -120) + 60) / 60, 0, 1);       // dB -> 0..1 for the scrolling envelopes
  function liveLofi(st, m, dt) {
    if (!st.liveOn) Object.assign(st, { liveOn: true, live: true, hist: [], cents: 0, dRms: 1e-6, dDb: -120, scPk: 0.02, bw: 20000, nf: -120, match: 1, lagMs: 0,
      sIn: new Array(48).fill(-120), sOut: new Array(48).fill(-120), dTop: 0, dBot: -110, bits: 24 });
    st.inL = rel(st.inL, Math.max(fnum(m.inPkDb[0], -120), fnum(m.inPkDb[1], -120)), dt);
    st.outL = rel(st.outL, Math.max(fnum(m.outPkDb[0], -120), fnum(m.outPkDb[1], -120)), dt);
    // option A: the last few ms of input and output, auto-scaled with a slow peak hold
    const mi = mono(m.inScopeL, m.inScopeR), mo = mono(m.scopeL, m.scopeR);
    st.scPk = Math.max(0.02, ...mi.map(Math.abs), ...mo.map(Math.abs), st.scPk * lin(-6 * dt));
    st.wIn = []; st.wOut = []; st.err = [];
    for (let px = 0; px < W_A; px++) {
      const u = px / (W_A - 1), a = at64(mi, u), b = at64(mo, u);
      st.wIn.push(a); st.wOut.push(b); st.err.push(b - a);
    }
    const lv = new Set(); let ch = 0;
    mo.forEach((v, i) => { lv.add(Math.round(v * 1e5)); if (i && Math.abs(v - mo[i - 1]) > 1e-6) ch++; });
    st.levelsN = lv.size; st.changes = ch;
    st.dDb = rel(st.dDb, m.diffRmsDb, dt); st.dRms = lin(st.dDb); st.errDb = st.dDb;
    // option B: spectra, bandwidth (first band above 100 Hz where output is 6 dB under input) and noise floor (median of the difference spectrum)
    if (hasN(m.specIn, 48) && hasN(m.specOut, 48)) {
      for (let i = 0; i < 48; i++) { st.sIn[i] = rel(st.sIn[i], m.specIn[i], dt); st.sOut[i] = rel(st.sOut[i], m.specOut[i], dt); }
      let bw = 20000;
      for (let i = 0; i < 48; i++) if (bandHz(i) >= 100 && m.specIn[i] > -100 && fnum(m.specOut[i], -120) < m.specIn[i] - 6) { bw = bandHz(i); break; }
      st.bw = Math.exp(Math.log(st.bw) + (Math.log(bw) - Math.log(st.bw)) * 0.3);
    }
    if (hasN(m.specDiff, 48)) { const d = m.specDiff.map(v => fnum(v, -120)).sort((a, b) => a - b); st.nf += (d[24] - st.nf) * 0.3; }
    // option C: level history; match = peak of the out-vs-in cross-correlation (1 = output follows input exactly), lag of that peak
    if (hasN(m.xcorr, 64) && fnum(m.inRmsDb, -120) > -100) {
      let bi = 0; for (let i = 1; i < 64; i++) if (m.xcorr[i] > m.xcorr[bi]) bi = i;
      st.match += (cl(fnum(m.xcorr[bi], 0), 0, 1) - st.match) * 0.4; st.lagMs = bi * 32 / 48;
    }
    st.hist.push({ inE: lvl01(Math.max(m.inPkDb[0], m.inPkDb[1])), outE: lvl01(Math.max(m.outPkDb[0], m.outPkDb[1])), dE: lvl01(m.diffRmsDb), match: st.match });
    if (st.hist.length > 800) st.hist.shift();
  }

  DESIGNS["Lo-Fi"] = {
    effect: "DeRez5",
    refs: [["ReduxL12.png", "Redux"], ["SpectrumL12.png", "Spectrum"], ["TunerL12.png", "Tuner"], ["EchoL12.png", "Echo"]],
    lead: "Visual cue: the damage itself — steps in the waveform, lost highs, noise floor and pitch wobble, measured as output against input.",
    options: [
      { id: "A", name: "Redux scope", short: "Scope", width: 632, step, live: liveLofi,
        why: "A zoomed waveform shows the smooth input and the stepped output, with an error strip underneath — like Redux.",
        bullets: ["Measured: waveform of input (cyan) and output (orange), quantising steps visible; real audio shows the last few ms, auto-zoomed so the loudest point fills the plot (level lines only in the simulated preview)",
                  "Measured: error strip (output minus input, zoomed on its own), noise-floor readout (level of output minus input), number of distinct sample values and value changes in the window",
                  "Menu on top, dials at the right"],
        draw(c, th, st, ps, vals) {
          if (!st.wIn) return;
          const y0 = HEAD_H + 4, H = DEVICE_H - 8;
          const x = 4, w = 330, pw = w - 6, py = y0 + 20, wh = 84, mid = py + wh / 2, hh = wh / 2;
          screen(c, th, x, y0, w, H);
          strip(c, th, x, y0, w, 18);
          // one zoom for input and output (RUBRIC 2.6)
          const g = fit(st, "scope", Math.max(...st.wIn.map(Math.abs), ...st.wOut.map(Math.abs)));
          c.save(); c.beginPath(); c.rect(x + 3, py, pw, wh); c.clip();
          const Lq = Math.pow(2, st.bits - 1);
          if (Lq <= 24) for (let k = -Math.floor(Lq); k <= Math.floor(Lq); k++) { c.fillStyle = k ? th.dline : th.scale; c.fillRect(x + 3, Math.round(mid - k / Lq * g * hh), pw, 1); }
          else { c.fillStyle = th.scale; c.fillRect(x + 3, Math.round(mid), pw, 1); }
          line(c, st.wIn.map((v, i) => [x + 4 + i, mid - v * g * hh]), th.cyan, 1.2);
          line(c, st.wOut.map((v, i) => [x + 4 + i, mid - v * g * hh]), th.orange, 1.8);
          c.restore();
          legend(c, th, x + 6, y0 + 12, [[th.cyan, "In", "The cyan wave is the smooth signal going into the effect."], [th.orange, "Out", "The orange wave is the effect output. Its steps are the rounding in level and time that the effect adds."]], { line: true });
          ltxt(c, x + 76, y0 + 12, `Levels ${st.levelsN}   Steps ${st.changes}`, th.dispText, "Levels and Steps Readout", "Levels is how many different sample values the output uses. Steps is how often the value changes in the window. Few levels means a coarse, crunchy sound. Measured from the output audio.");
          txt(c, x + w - 6, y0 + 12, zoomText(g), { color: th.dispText, align: "right", size: 8.5 });
          hint(x + w - 80, y0 + 2, 76, 14, "Zoom", "The waves are enlarged so the loudest point fills the plot. The number says by how much; quiet signals get a larger zoom. Input and output share one zoom.");
          hint(x + 3, py, pw, wh, "Redux Scope", "Shape of the input and output waves over a few milliseconds. The output shows stair steps when the effect lowers bit depth or sample rate. Measured from the input and output audio.");
          strip(c, th, x, py + wh + 2, w, 0, true);
          strip(c, th, x, y0 + H - 16, w, 16, true);
          const ey = py + wh + 4, eh = y0 + H - 18 - ey, em = ey + eh / 2;
          const ge = fit(st, "err", Math.max(...st.err.map(Math.abs)));
          c.save(); c.beginPath(); c.rect(x + 3, ey, pw, eh); c.clip();
          line(c, st.err.map((v, i) => [x + 4 + i, em - cl(v * ge, -1, 1) * (eh / 2 - 2)]), greyLine(), 1);
          c.restore();
          legend(c, th, x + 6, y0 + H - 5, [[greyLine(), "Error", "The grey line is the output minus the input: the damage the effect adds, zoomed on its own so it fills its strip."]], { line: true });
          txt(c, x + 60, y0 + H - 5, zoomText(ge), { color: th.dispText, align: "left", size: 8.5 });
          hint(x + 58, y0 + H - 15, 70, 14, "Error Zoom", "The error line is enlarged so its loudest point fills its strip. The error is small, so it needs its own zoom.");
          hint(x + 3, ey, pw, eh, "Error Strip", "The difference between output and input, zoomed to fill the strip. A flat line means the effect changed nothing. Measured from the input and output audio.");
          rtxt(c, x + w - 6, y0 + H - 5, st.errDb <= -100 ? "Floor < -100 dB" : `Floor ${st.errDb.toFixed(0)} dB`, th.dispText, "Noise Floor Readout", "Level of the error in dB: how loud the added noise and rounding are. Lower is cleaner. Measured as the output minus the input.", 8.5);
          tile(c, th, 336, y0, 294, H);
          menu(c, th, 340, y0 + 4, 120, "DeRez5"); arrows(c, th, 464, y0 + 4);
          ctl(c, th, ps, { x: 340, y: y0 + 22, w: 286, h: H - 26 }, 5, vals, 56);
        } },

      { id: "B", name: "Bandwidth", short: "Bandwidth", width: 600, step, live: liveLofi,
        why: "A full-range spectrum shows lost highs as the orange line falling away from the grey input, with the noise floor marked — like Spectrum and EQ Eight.",
        bullets: ["Measured: FFT spectrum of input (grey) and output (orange line), log frequency 20 Hz–20 kHz",
                  "Measured: bandwidth (first band above 100 Hz where output is 6 dB under input) as a cyan marker, noise floor (median of the output-minus-input spectrum) as a dashed line",
                  "Menu and arrows in the display, dials in one row below"],
        draw(c, th, st, ps, vals) {
          if (!st.wIn) return;
          const y0 = HEAD_H + 4, H = DEVICE_H - 8;
          const x = 4, y = y0, w = 594;
          const sx = x + 3, sw = w - 6, sy = y + 22, sh = 73;
          screen(c, th, x, y, w, 98);
          strip(c, th, x, y, w, 22);
          const dB0 = st.live ? st.dBot : -80;
          if (st.live) spec(c, th, sx, sy, sw, sh, f => bandAt(st.sIn, f), f => bandAt(st.sOut, f), 20, 20000, 0, dB0, [100, 1000, 10000]);
          else spec(c, th, sx, sy, sw, sh, f => lofiIn(st, f), f => lofiOut(st, f), 20, 20000, 0, -80, [100, 1000, 10000]);
          const bx = sx + sw * Math.log(st.bw / 20) / Math.log(1000), ny = sy + sh * (0 - st.nf) / -dB0;
          c.save(); c.beginPath(); c.rect(sx, sy, sw, sh); c.clip();
          c.setLineDash([3, 3]); line(c, [[sx, ny], [sx + sw, ny]], th.cyan, 1); c.setLineDash([]);
          line(c, [[bx, sy], [bx, sy + sh]], th.cyan, 1.5);
          c.restore();
          menu(c, th, x + 6, y + 3, 120, "DeRez5"); arrows(c, th, x + 130, y + 3);
          rtxt(c, x + w - 8, y + 15, `Bandwidth ${st.bw >= 1000 ? (st.bw / 1000).toFixed(1) + " kHz" : Math.round(st.bw) + " Hz"}`, th.dispText, "Bandwidth Readout", "The frequency above which the output is at least 6 dB quieter than the input. Lower means more highs are lost. Measured from the input and output spectrum.");
          rtxt(c, x + w - 120, y + 15, st.nf <= -100 ? "Floor < -100 dB" : `Floor ${st.nf.toFixed(0)} dB`, th.dispText, "Noise Floor Readout", "Level of the noise the effect adds, in dB. Taken as the middle value of the output-minus-input spectrum.");
          legend(c, th, x + 172, y + 15, [[greyFill(), "Input", "The grey area is the spectrum of the signal going into the effect: how loud each frequency is."], [th.orange, "Output", "The orange line is the spectrum of the effect output. Where it falls away from the grey area, highs are lost."], [th.cyan, "Bandwidth", "The solid cyan vertical line marks the bandwidth: where the output drops 6 dB under the input."], [th.cyan, "Floor", "The dashed cyan horizontal line marks the noise floor the effect adds."]]);
          hint(sx, sy, sw, sh, "Spectrum Display", "Level at each frequency, from 20 Hz to 20 kHz (left to right, log scale). Measured from the input and output audio.");
          hint(bx - 4, sy, 8, sh, "Bandwidth Marker", "Where the output falls 6 dB under the input, above 100 Hz. Everything to its right is dulled.");
          hint(sx, ny - 3, sw, 6, "Noise Floor Line", "Level of the noise the effect adds. Measured as the middle value of the output-minus-input spectrum.");
          tile(c, th, x, y0 + 100, w, H - 100);
          ctl(c, th, ps, { x: x, y: y0 + 102, w: w, h: H - 104 }, 10, vals, 58);
        } },

      { id: "C", name: "Wear & wobble", short: "Wear", width: 632, step, live: liveLofi,
        why: "A scrolling view of input, output and the damage left over, plus a pitch-wobble trace in cents — like Echo's activity display and Tuner.",
        bullets: ["Measured: level history of input (grey), output (orange); meters for In, Out and the difference (what the effect changed)",
                  "Simulated preview: pitch drift in cents. Real audio cannot measure pitch, so the trace shows Match instead: how closely the output follows the input (peak of the out-vs-in cross-correlation, 100 % = identical) with the lag of that peak in ms",
                  "Menu on top, dials at the right"],
        draw(c, th, st, ps, vals) {
          if (!st.wIn) return;
          const y0 = HEAD_H + 4, H = DEVICE_H - 8;
          const x = 4, w = 290, th1 = 66;
          screen(c, th, x, y0, w, H);
          strip(c, th, x, y0, w, 18);
          // level history is a dB scale in real audio (fixed, labelled): no zoom there; the simulated preview is linear and auto-fits
          const gl = st.live ? 1 : fit(st, "lvl", histPeak(st.hist, ["inE", "outE", "dE"], w - 8));
          const wy = y0 + 19, wh = th1;
          waveScroll(c, th, x + 4, wy, w - 8, wh, st.hist, "inE", greyFill(), gl);
          waveScroll(c, th, x + 4, wy, w - 8, wh, st.hist, "outE", th.orange, gl);
          waveScroll(c, th, x + 4, wy, w - 8, wh, st.hist, "dE", th.cyan, gl);
          legend(c, th, x + 6, y0 + 12, [[greyFill(), "In", "The grey shape is the level of the signal going into the effect over the last seconds."], [th.orange, "Out", "The orange shape is the level of the effect output."], [th.cyan, "Diff", "The cyan shape is the difference between output and input: what the effect changed."]]);
          if (!st.live) { txt(c, x + 130, y0 + 12, zoomText(gl), { color: th.dispText, align: "left", size: 8.5 }); hint(x + 128, y0 + 2, 60, 14, "Zoom", "The level shapes are enlarged so the loudest part fills the plot. The number says by how much."); }
          hint(x + 4, wy, w - 8, wh, "Level History", "Loudness over time, newest at the right. Grey: input. Orange: output. Cyan: the difference. Measured from the input and output audio.");
          rtxt(c, x + w - 6, y0 + 12, `Δ ${st.dRms < 1e-4 ? "< -80" : db(st.dRms).toFixed(0)} dB`, th.dispText, "Difference Readout", "Level of the difference between output and input, in dB. Lower means the effect changes less.");
          strip(c, th, x, wy + wh + 1, w, 0, true);
          strip(c, th, x, y0 + H - 16, w, 16, true);
          const py = wy + wh + 3, ph = y0 + H - 18 - py, pm = py + ph / 2;
          c.save(); c.beginPath(); c.rect(x + 3, py, w - 6, ph); c.clip();
          if (st.live) [0, 0.5, 1].forEach(v => { c.fillStyle = v === 0.5 ? th.dline : th.scale; c.fillRect(x + 4, Math.round(pm - (v * 2 - 1) * (ph / 2 - 4)), w - 8, 1); });
          else [-50, 0, 50].forEach(v => { c.fillStyle = v ? th.dline : th.scale; c.fillRect(x + 4, Math.round(pm - v / 50 * (ph / 2 - 4)), w - 8, 1); });
          const n = Math.min(st.hist.length, w - 8), pts = [];
          for (let i = 0; i < n; i++) pts.push([x + w - 4 - i, st.live ? pm - (cl(st.hist[st.hist.length - 1 - i].match, 0, 1) * 2 - 1) * (ph / 2 - 4) : pm - cl(st.hist[st.hist.length - 1 - i].cents, -50, 50) / 50 * (ph / 2 - 4)]);
          if (pts.length) line(c, pts, th.cyan, 1.5);
          c.restore();
          legend(c, th, x + 6, y0 + H - 5, [[th.cyan, st.live ? "Match" : "Pitch", st.live ? "The cyan trace shows how closely the output follows the input. The top is identical, the bottom is unrelated. It dips when the effect smears or wobbles the sound." : "The cyan trace shows how far the pitch drifts, from -50 to +50 cents. A cent is one hundredth of a semitone."]], { line: true });
          hint(x + 3, py, w - 6, ph, st.live ? "Match Trace" : "Pitch Trace", st.live ? "How closely the output follows the input over time, newest at the right. Measured from the cross-correlation of output against input." : "Pitch drift over time in cents, newest at the right. This is a simulated preview; real audio cannot measure pitch.");
          if (st.live) rtxt(c, x + w - 6, y0 + H - 5, `${Math.round(st.match * 100)} %   lag ${st.lagMs.toFixed(1)} ms`, th.dispText, "Match Readout", "Match is how much the output looks like the input, 100 % being identical. Lag is the delay of the best fit, in ms.", 8.5);
          else rtxt(c, x + w - 6, y0 + H - 5, `${st.cents >= 0 ? "+" : ""}${st.cents.toFixed(0)} ¢`, th.dispText, "Pitch Readout", "Pitch drift now, in cents (hundredths of a semitone). Plus is sharp, minus is flat.", 8.5);
          // tile: difference meter
          tile(c, th, 296, y0, 30, H);
          txt(c, 311, y0 + 16, "Δ", { color: th.text, size: 10 });
          hint(296, y0, 30, H, "Difference Meter", "How loud the difference between output and input is, in dB. It shows how much the effect changed. Measured from the input and output audio.");
          meterV(c, th, 306, y0 + 24, 10, H - 52, fl(db(st.dRms) + 12), false, th.cyan);
          txt(c, 311, y0 + H - 10, st.dRms < 1e-4 ? "-inf" : `${db(st.dRms).toFixed(0)}`, { color: th.text, size: 8.5 });
          tile(c, th, 328, y0, 302, H);
          menu(c, th, 332, y0 + 4, 120, "DeRez5"); arrows(c, th, 456, y0 + 4);
          ctl(c, th, ps, { x: 332, y: y0 + 22, w: 294, h: H - 26 }, 5, vals, 58);
        } },
    ],
  };
  DESIGNS["Lo-Fi"].options.forEach(o => { const orig = o.step; o.step = (st, dt) => { if (st.cents === undefined) Object.assign(st, { cents: 0, dRms: 0.01 }); orig(st, dt); }; });
  // Input / Output gain strip at the right edge of every option (required on all devices)
  DESIGNS["Lo-Fi"].options.forEach(o => {
    const base = o.width, inner = o.draw;
    o.width = base + GAIN_W + 4;
    o.draw = (c, th, st, ps, vals) => { inner(c, th, st, ps, vals); gainStrip(c, th, o.width - GAIN_W - 4, st); };
  });
})();
