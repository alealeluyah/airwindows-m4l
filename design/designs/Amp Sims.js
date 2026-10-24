// Amp Sims: design options. Helpers (knob, menu, meterV, …) come from app.js.
// Visual cue: what the amp does to the signal — measured from the input vs the output.
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

  DESIGNS["Amp Sims"] = {
    effect: "ChimeyGuitar",
    refs: [["SaturatorL12.png", "Saturator"], ["AmpL12.png", "Amp"], ["EQEightL12.png", "EQ Eight (spectrum)"], ["RoarL12.png", "Roar"]],
    lead: "Visual cue: the distortion itself — how the output differs from the input, drawn live as a transfer curve, a harmonic spectrum or an in/out scope.",
    options: [
      { id: "A", name: "Transfer curve", width: 632, step,
        why: "A big measured in-versus-out curve plus harmonic bars show how hard the amp bends the signal — like Saturator.",
        bullets: ["Measured: output level plotted against input level (curve bends when the amp saturates), teal band = current input range",
                  "Measured: size of harmonics 1–10 by DFT of the output, with THD readout",
                  "Menu, arrows and all dials at the right"],
        draw(c, th, st, ps, vals) {
          const x0 = 6, y0 = HEAD_H + 4, w0 = 150, h0 = DEVICE_H - 8;
          box(c, th, x0, y0, w0, h0);
          const px = x0 + 8, py = y0 + 18, pw = w0 - 16, ph = h0 - 36;
          c.save(); c.beginPath(); c.rect(px, py, pw, ph); c.clip();
          c.fillStyle = th.cyan + "33"; c.fillRect(px + pw * (1 - st.A) / 2, py, pw * st.A, ph);
          c.fillStyle = th.dline; c.fillRect(px, py + ph / 2, pw, 1); c.fillRect(px + pw / 2, py, 1, ph);
          line(c, [[px, py + ph * (0.5 + 1 / 3.4)], [px + pw, py + ph * (0.5 - 1 / 3.4)]], th.scale, 1);
          line(c, st.bins.map((v, i) => [px + pw * i / 40, py + ph * (0.5 - v / 3.4)]), th.orange, 2);
          const xi = st.A * Math.sin(TAU * st.t * 55), yo = proc(xi, st.drive, 0.25);
          c.fillStyle = th.cyan; c.beginPath(); c.arc(px + pw * (xi + 1) / 2, py + ph * (0.5 - yo / 3.4), 2.5, 0, TAU); c.fill();
          c.restore();
          txt(c, x0 + 6, y0 + 12, "Transfer", { color: th.scale, align: "left" });
          txt(c, x0 + w0 - 6, y0 + 12, "Out vs In", { color: th.dispText, align: "right" });
          txt(c, x0 + 6, y0 + h0 - 5, `In ${db(st.A).toFixed(1)} dB`, { color: th.cyan, align: "left" });
          txt(c, x0 + w0 - 6, y0 + h0 - 5, `Out ${db(Math.abs(proc(st.A, st.drive, 0.25))).toFixed(1)} dB`, { color: th.orange, align: "right" });

          const hx = 162, hw = 150;
          box(c, th, hx, y0, hw, h0);
          txt(c, hx + 6, y0 + 12, "Harmonics", { color: th.scale, align: "left" });
          txt(c, hx + hw - 6, y0 + 12, `THD ${st.thd.toFixed(1)}%`, { color: th.orange, align: "right" });
          const by = y0 + h0 - 16, bh = h0 - 40;
          [0, -20, -40, -60].forEach(g => { const yy = by - bh * (-g / 60 > 1 ? 1 : 1 - (-g / 60)); c.fillStyle = th.dline; c.fillRect(hx + 4, Math.round(yy), hw - 8, 1); });
          st.h.forEach((v, k) => {
            const f = cl(1 + db(v) / 60, 0, 1), bx = hx + 8 + k * 14;
            c.fillStyle = k === 0 ? th.cyan : th.orange; c.fillRect(bx, by - bh * f, 10, bh * f);
            txt(c, bx + 5, y0 + h0 - 5, String(k + 1), { color: th.dispText, size: 8.5 });
          });
          menu(c, th, 320, HEAD_H + 4, 130, "ChimeyGuitar"); arrows(c, th, 456, HEAD_H + 4);
          ctl(c, th, ps, { x: 322, y: HEAD_H + 22, w: 304, h: 146 }, 5, vals, 60);
        } },

      { id: "B", name: "Spectrum", width: 600, step,
        why: "A wide spectrum shows the input in grey and the amp output in orange, so added harmonics and tone shaping are visible — like EQ Eight and Amp.",
        bullets: ["Measured: FFT spectrum of input (grey) and output (orange line), log frequency",
                  "Readouts: input peak level and gain of the output over the input",
                  "Menu and arrows inside the display, dials in one row below"],
        draw(c, th, st, ps, vals) {
          const x = 6, y = HEAD_H + 6, w = 588;
          box(c, th, x, y, w, 96);
          spec(c, th, x, y + 22, w, 74, f => L(st, f, false), f => L(st, f, true), 40, 12000, 6, -66, [100, 1000, 10000]);
          menu(c, th, x + 6, y + 5, 120, "ChimeyGuitar"); arrows(c, th, x + 130, y + 5);
          txt(c, x + w - 8, y + 15, `Peak ${db(st.A).toFixed(1)} dB`, { color: th.cyan, align: "right" });
          txt(c, x + w - 78, y + 15, `Gain +${db(st.gain).toFixed(1)} dB`, { color: th.orange, align: "right" });
          c.fillStyle = greyFill(); c.fillRect(x + 172, y + 8, 8, 8); txt(c, x + 184, y + 15, "Input", { color: th.dispText, align: "left" });
          c.fillStyle = th.orange; c.fillRect(x + 218, y + 8, 8, 8); txt(c, x + 230, y + 15, "Output", { color: th.dispText, align: "left" });
          ctl(c, th, ps, { x: 6, y: HEAD_H + 106, w: 588, h: DEVICE_H - 108 }, 10, vals, 58);
        } },

      { id: "C", name: "Scope", width: 632, step,
        why: "A zoomed oscilloscope lays the output over the input so flattened peaks show at once, with meters for the added signal — like Roar and Drum Buss.",
        bullets: ["Measured: waveform of input (cyan) and output (orange), clip lines at full scale",
                  "Readouts: THD and crest factor in and out; meters for In, Out and the difference (added signal)",
                  "Menu on top, dials at the right"],
        draw(c, th, st, ps, vals) {
          menu(c, th, 6, HEAD_H + 4, 120, "ChimeyGuitar"); arrows(c, th, 130, HEAD_H + 4);
          txt(c, 170, HEAD_H + 15, `THD ${st.thd.toFixed(1)} %    Crest ${st.crIn.toFixed(1)} \u2192 ${st.crOut.toFixed(1)} dB`, { color: th.text, align: "left" });
          const x = 6, y = HEAD_H + 24, w = 250, h = 141, mid = y + h / 2, sc = h * 0.29;
          box(c, th, x, y, w, h);
          c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
          [-1, 0, 1].forEach(v => { c.fillStyle = v ? th.scale : th.dline; c.fillRect(x, Math.round(mid - v * sc), w, 1); });
          const a = [], b = [];
          for (let px = 0; px <= w - 8; px += 2) {
            const xi = st.A * Math.sin(TAU * (px / (w - 8) * 2.5 + st.t * 0.4));
            a.push([x + 4 + px, mid - xi * sc]); b.push([x + 4 + px, mid - proc(xi, st.drive, 0.25) * sc]);
          }
          line(c, a, th.cyan, 1.2); line(c, b, th.orange, 2);
          c.restore();
          txt(c, x + 6, y + 12, "In", { color: th.cyan, align: "left" }); txt(c, x + 22, y + 12, "Out", { color: th.orange, align: "left" });
          txt(c, x + w - 6, y + 12, "full scale", { color: th.scale, size: 8.5, align: "right" });
          txt(c, 268, HEAD_H + 36, "Δ", { color: th.text, size: 10 });
          meterV(c, th, 263, HEAD_H + 42, 10, 100, fl(db(st.dRms)), false, th.orange);
          txt(c, 268, HEAD_H + 154, `${db(st.dRms).toFixed(0)}`, { color: th.text, size: 8.5 });
          ctl(c, th, ps, { x: 284, y: HEAD_H + 22, w: 340, h: 146 }, 5, vals, 62);
        } },
    ],
  };
  // Input / Output gain strip at the right edge of every option (required on all devices)
  DESIGNS["Amp Sims"].options.forEach(o => {
    const base = o.width, inner = o.draw;
    o.width = base + GAIN_W + 4;
    o.draw = (c, th, st, ps, vals) => { inner(c, th, st, ps, vals); gainStrip(c, th, o.width - GAIN_W - 4, st); };
  });
})();
