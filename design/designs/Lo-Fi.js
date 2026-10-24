// Lo-Fi: design options. Helpers (knob, menu, meterV, …) come from app.js.
// Visual cue: what the effect takes away or adds — steps in the waveform, lost highs, noise floor, pitch wobble; all in vs out.
(() => {
  // ---- local helpers (inside this file's IIFE) ----
  const TAU = Math.PI * 2;
  const cl = (v, a, b) => Math.max(a, Math.min(b, v));
  const greyFill = () => S.theme === "light" ? "#6e6e6e" : "#4a4a4a";
  const greyLine = () => S.theme === "light" ? "#5e5e5e" : "#8c8c8c";
  const box = (c, th, x, y, w, h) => rr(c, x, y, w, h, 3, th.display);
  function ctl(c, th, ps, area, cols, vals, cellW) {
    if (!ps.length) {
      rr(c, area.x, area.y, area.w, Math.min(area.h, 60), 3, th.panel);
      txt(c, area.x + area.w / 2, area.y + Math.min(area.h, 60) / 2 + 3, "No controls", { color: th.dim });
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
  const fk = f => f >= 1000 ? (f / 1000) + "k" : String(f);
  // spectrum display: grey fill = input, orange line = output, log frequency axis
  function spec(c, th, x, y, w, h, fin, fout, f0, f1, dTop, dBot, ticks) {
    box(c, th, x, y, w, h);
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

  DESIGNS["Lo-Fi"] = {
    effect: "DeRez5",
    refs: [["ReduxL12.png", "Redux"], ["SpectrumL12.png", "Spectrum"], ["TunerL12.png", "Tuner"], ["EchoL12.png", "Echo"]],
    lead: "Visual cue: the damage itself — steps in the waveform, lost highs, noise floor and pitch wobble, measured as output against input.",
    options: [
      { id: "A", name: "Redux scope", width: 632, step,
        why: "A zoomed waveform shows the smooth input and the stepped output, with an error strip underneath — like Redux.",
        bullets: ["Measured: waveform of input (cyan) and output (orange), quantising steps visible; level lines appear when steps are coarse",
                  "Measured: error strip (output minus input), noise-floor readout, number of distinct levels and level changes",
                  "Menu on top, dials at the right"],
        draw(c, th, st, ps, vals) {
          if (!st.wIn) return;
          menu(c, th, 6, HEAD_H + 4, 120, "DeRez5"); arrows(c, th, 130, HEAD_H + 4);
          txt(c, 176, HEAD_H + 15, `Levels ${st.levelsN}   Steps ${st.changes}`, { color: th.text, align: "left" });
          const x = 6, y = HEAD_H + 24, w = 330, h = 141, wh = 104, mid = y + wh / 2, sc = wh * 0.42;
          box(c, th, x, y, w, h);
          c.save(); c.beginPath(); c.rect(x, y, w, wh); c.clip();
          const Lq = Math.pow(2, st.bits - 1);
          if (Lq <= 24) for (let k = -Math.floor(Lq); k <= Math.floor(Lq); k++) { c.fillStyle = k ? th.dline : th.scale; c.fillRect(x, Math.round(mid - k / Lq * sc / 1), w, 1); }
          else { c.fillStyle = th.scale; c.fillRect(x, Math.round(mid), w, 1); }
          line(c, st.wIn.map((v, i) => [x + 4 + i, mid - v * sc]), th.cyan, 1.2);
          const pts = []; st.wOut.forEach((v, i) => { pts.push([x + 4 + i, mid - v * sc]); });
          line(c, pts, th.orange, 1.8);
          c.restore();
          txt(c, x + 6, y + 12, "In", { color: th.cyan, align: "left" }); txt(c, x + 22, y + 12, "Out", { color: th.orange, align: "left" });
          c.fillStyle = th.dline; c.fillRect(x + 4, y + wh + 2, w - 8, 1);
          const ey = y + wh + 4, eh = h - wh - 6, em = ey + eh / 2;
          c.save(); c.beginPath(); c.rect(x, ey, w, eh); c.clip();
          line(c, st.err.map((v, i) => [x + 4 + i, em - cl(v * 4, -1, 1) * (eh / 2 - 2)]), th.cyan, 1);
          c.restore();
          txt(c, x + 6, ey + 9, "Error", { color: th.scale, size: 8.5, align: "left" });
          txt(c, x + w - 6, ey + 9, `Floor ${st.errDb.toFixed(0)} dB`, { color: th.orange, size: 8.5, align: "right" });
          ctl(c, th, ps, { x: 342, y: HEAD_H + 22, w: 284, h: 146 }, 5, vals, 56);
        } },

      { id: "B", name: "Bandwidth", width: 600, step,
        why: "A full-range spectrum shows lost highs as the orange line falling away from the grey input, with the noise floor marked — like Spectrum and EQ Eight.",
        bullets: ["Measured: FFT spectrum of input (grey) and output (orange line), log frequency 20 Hz–20 kHz",
                  "Measured: bandwidth (where output is 6 dB under input) as a cyan marker, noise floor as a dashed line",
                  "Menu and arrows in the display, dials in one row below"],
        draw(c, th, st, ps, vals) {
          if (!st.wIn) return;
          const x = 6, y = HEAD_H + 6, w = 588, h = 96;
          box(c, th, x, y, w, 96);
          spec(c, th, x, y + 22, w, 74, f => lofiIn(st, f), f => lofiOut(st, f), 20, 20000, 0, -80, [100, 1000, 10000]);
          const bx = x + w * Math.log(st.bw / 20) / Math.log(1000), ny = y + 22 + 74 * (0 - st.nf) / 80;
          c.save(); c.beginPath(); c.rect(x, y + 22, w, 74); c.clip();
          c.setLineDash([3, 3]); line(c, [[x, ny], [x + w, ny]], th.cyan, 1); c.setLineDash([]);
          line(c, [[bx, y + 22], [bx, y + h]], th.cyan, 1.5);
          c.restore();
          menu(c, th, x + 6, y + 5, 120, "DeRez5"); arrows(c, th, x + 130, y + 5);
          txt(c, x + w - 8, y + 15, `Bandwidth ${st.bw >= 1000 ? (st.bw / 1000).toFixed(1) + " kHz" : Math.round(st.bw) + " Hz"}`, { color: th.cyan, align: "right" });
          txt(c, x + w - 120, y + 15, `Floor ${st.nf.toFixed(0)} dB`, { color: th.orange, align: "right" });
          c.fillStyle = greyFill(); c.fillRect(x + 172, y + 8, 8, 8); txt(c, x + 184, y + 15, "Input", { color: th.dispText, align: "left" });
          c.fillStyle = th.orange; c.fillRect(x + 218, y + 8, 8, 8); txt(c, x + 230, y + 15, "Output", { color: th.dispText, align: "left" });
          ctl(c, th, ps, { x: 6, y: HEAD_H + 106, w: 588, h: DEVICE_H - 108 }, 10, vals, 58);
        } },

      { id: "C", name: "Wear & wobble", width: 632, step,
        why: "A scrolling view of input, output and the damage left over, plus a pitch-wobble trace in cents — like Echo's activity display and Tuner.",
        bullets: ["Measured: level history of input (grey), output (orange); meters for In, Out and the difference (what the effect changed)",
                  "Measured: pitch drift of output against input from zero-crossing times, in cents, scrolling trace with ±50 scale",
                  "Menu on top, dials at the right"],
        draw(c, th, st, ps, vals) {
          if (!st.wIn) return;
          menu(c, th, 6, HEAD_H + 4, 120, "DeRez5"); arrows(c, th, 130, HEAD_H + 4);
          const x = 6, y = HEAD_H + 24, w = 290, h = 141, th1 = 82;
          box(c, th, x, y, w, h);
          waveScroll(c, th, x + 4, y + 16, w - 8, th1 - 18, st.hist, "inE", greyFill());
          waveScroll(c, th, x + 4, y + 16, w - 8, th1 - 18, st.hist, "outE", th.orange);
          waveScroll(c, th, x + 4, y + 16, w - 8, th1 - 18, st.hist, "dE", th.cyan);
          txt(c, x + 6, y + 12, "In", { color: th.dispText, align: "left" }); txt(c, x + 24, y + 12, "Out", { color: th.orange, align: "left" });
          txt(c, x + 48, y + 12, "Diff", { color: th.cyan, align: "left" });
          txt(c, x + w - 6, y + 12, `Δ ${db(st.dRms).toFixed(0)} dB`, { color: th.dispText, align: "right" });
          c.fillStyle = th.dline; c.fillRect(x + 4, y + th1, w - 8, 1);
          const py = y + th1 + 2, ph = h - th1 - 4, pm = py + ph / 2;
          c.save(); c.beginPath(); c.rect(x, py, w, ph); c.clip();
          [-50, 0, 50].forEach(v => { c.fillStyle = v ? th.dline : th.scale; c.fillRect(x + 4, Math.round(pm - v / 50 * (ph / 2 - 6)), w - 8, 1); });
          const n = Math.min(st.hist.length, w - 8), pts = [];
          for (let i = 0; i < n; i++) pts.push([x + w - 4 - i, pm - cl(st.hist[st.hist.length - 1 - i].cents, -50, 50) / 50 * (ph / 2 - 6)]);
          if (pts.length) line(c, pts, th.cyan, 1.5);
          c.restore();
          txt(c, x + 6, py + 20, "Pitch", { color: th.scale, size: 8.5, align: "left" });
          txt(c, x + w - 6, py + 10, `${st.cents >= 0 ? "+" : ""}${st.cents.toFixed(0)} ¢`, { color: th.orange, size: 8.5, align: "right" });
          txt(c, 308, HEAD_H + 36, "Δ", { color: th.text, size: 10 });
          meterV(c, th, 303, HEAD_H + 42, 10, 100, fl(db(st.dRms) + 12), false, th.cyan);
          txt(c, 308, HEAD_H + 154, `${db(st.dRms).toFixed(0)}`, { color: th.text, size: 8.5 });
          ctl(c, th, ps, { x: 328, y: HEAD_H + 22, w: 298, h: 146 }, 5, vals, 58);
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
