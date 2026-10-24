// Effects: design options. A mixed bag (tremolo, exciters, pitch, sag, ring mod…), so every cue compares input with output.
// Every option ends with the standard Input / Output gain strip on the right edge.
(() => {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dr = t => drums(((t % 2) + 2) % 2);
  const MENU = "Energy";
  const Y0 = HEAD_H + 6, FH = DEVICE_H - 12;

  function core(st, t, dt) {
    const d = dr(t), s = st.fx;
    s.k = 1.2 + 2.4 * (0.5 + 0.5 * Math.sin(t * 0.37));        // how hard the effect bends the signal
    s.g = 1 + 0.25 * Math.sin(t * 0.9);                        // overall gain change
    s.asym = 0.12 * Math.sin(t * 0.5);
    const k = s.k, g = s.g, asym = s.asym;
    s.shape = x => clamp(g * (Math.tanh(k * (x + asym)) - Math.tanh(k * asym)) / Math.tanh(k), -1.3, 1.3);
    let pi = 0, po = 0, ri = 0, ro = 0;
    for (let j = 0; j < 10; j++) {
      s.n++;
      const x = clamp(d.env * 0.95 * Math.sin(s.n * 0.37 + t * 40) + 0.15 * d.env * noise(s.n), -1, 1);
      const y = s.shape(x);
      s.pts.push([x, y]); pi = Math.max(pi, Math.abs(x)); po = Math.max(po, Math.abs(y)); ri += x * x; ro += y * y;
    }
    while (s.pts.length > 90) s.pts.shift();
    ri = Math.sqrt(ri / 10); ro = Math.sqrt(ro / 10);
    s.pk[0] = Math.max(db(pi + 1e-3), s.pk[0] - 24 * dt); s.pk[1] = Math.max(db(po + 1e-3), s.pk[1] - 24 * dt);
    s.rm[0] = Math.max(db(ri + 1e-3), s.rm[0] - 18 * dt); s.rm[1] = Math.max(db(ro + 1e-3), s.rm[1] - 18 * dt);
    st.inL = s.pk[0]; st.outL = s.pk[1];
    s.dg = clamp(db(ro + 1e-3) - db(ri + 1e-3), -24, 24);
    s.dgS += (s.dg - s.dgS) * 0.2;                              // smoothed for the history strip
    s.h.push({ dg: s.dgS, i: d.env, o: ro });
    if (s.h.length > 700) s.h.shift();
  }
  function step(st, dt) {
    if (!st.fx) {
      st.fx = { n: 0, pts: [], h: [], k: 2, g: 1, asym: 0, pk: [-60, -60], rm: [-60, -60], dgS: 0 };
      for (let i = 560; i > 0; i--) core(st, st.t - i / 120, 1 / 120);
    }
    core(st, st.t, dt);
  }

  function ctl(c, th, ps, vals, a) {
    rr(c, a.x, a.y, a.w, a.h, 3, th.panel);
    if (!ps.length) {
      txt(c, a.x + a.w / 2, a.y + a.h / 2 - 1, "No controls", { color: th.dim, size: 10.5 });
      txt(c, a.x + a.w / 2, a.y + a.h / 2 + 11, "this effect has no dials", { color: th.dim, size: 8.5 });
      return;
    }
    const n = ps.length, rows = (n > 3 && a.h >= 104) ? 2 : 1, cols = Math.ceil(n / rows);
    const cw = Math.min(56, a.w / cols), pitch = rows === 1 ? 50 : Math.min(58, (a.h - 6) / 2);
    const y0 = a.y + (a.h - (pitch * (rows - 1) + 50)) / 2;
    ps.forEach((p, i) => {
      const r = Math.floor(i / cols), k = i % cols, inRow = Math.min(cols, n - r * cols);
      knob(c, th, a.x + (a.w - inRow * cw) / 2 + k * cw, y0 + r * pitch, cw, p, vals[p._i]);
    });
  }
  function head(c, th, x, y, mw) { menu(c, th, x, y, mw, MENU); arrows(c, th, x + mw + 5, y); }
  function pair(c, th, x, y, label, val, col) {
    c.font = `400 9.5px ${FONT}`;
    const w = c.measureText(label).width;
    txt(c, x, y, label, { color: th.scale, align: "left" });
    txt(c, x + w + 5, y, val, { color: col, align: "left", size: 10.5, bold: true });
    c.font = `700 10.5px ${FONT}`;
    return x + w + 5 + c.measureText(val).width;
  }
  const sg = v => (v >= 0 ? "+" : "-") + Math.abs(v).toFixed(1);
  const lg = f => (Math.log10(f) - 1.3) / 3;

  // ---- A: measured transfer curve
  function transfer(c, th, x, y, w, h, s) {
    rr(c, x, y, w, h, 3, th.display);
    const side = Math.min(w - 112, h - 34), gx = x + 14, gy = y + 18, cx = gx + side / 2, cy = gy + side / 2;
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    c.fillStyle = th.meterBg; c.fillRect(gx, gy, side, side);
    c.strokeStyle = th.dline; c.lineWidth = 1;
    c.strokeRect(gx + 0.5, gy + 0.5, side, side);
    for (let i = 1; i < 4; i++) { if (i === 2) continue; const o = side * i / 4; c.beginPath(); c.moveTo(gx + o, gy); c.lineTo(gx + o, gy + side); c.moveTo(gx, gy + o); c.lineTo(gx + side, gy + o); c.stroke(); }
    c.strokeStyle = th.scale; c.beginPath(); c.moveTo(gx, cy); c.lineTo(gx + side, cy); c.moveTo(cx, gy); c.lineTo(cx, gy + side); c.stroke();
    c.setLineDash([3, 3]); c.beginPath(); c.moveTo(gx, gy + side); c.lineTo(gx + side, gy); c.stroke(); c.setLineDash([]);   // unity line
    const px = v => cx + v * side / 2 / 1.3, py = v => cy - clamp(v, -1.3, 1.3) * side / 2 / 1.3;
    c.strokeStyle = th.orange; c.lineWidth = 2.2; c.beginPath();
    for (let i = 0; i <= 60; i++) { const v = -1 + i / 30, X = px(v), Y = py(s.shape(v)); i ? c.lineTo(X, Y) : c.moveTo(X, Y); }
    c.stroke();
    s.pts.forEach(([a, b], i) => { c.globalAlpha = 0.25 + 0.75 * i / s.pts.length; c.fillStyle = th.cyan; c.fillRect(px(a) - 1.25, py(b) - 1.25, 2.5, 2.5); });
    c.globalAlpha = 1; c.restore();
    txt(c, gx, y + 12, "Transfer curve", { color: th.scale, align: "left" });
    txt(c, gx + side / 2, gy + side + 9, "In", { color: th.scale, size: 8.5 });
    const rx = gx + side + 16;
    const slope0 = (s.shape(0.02) - s.shape(-0.02)) / 0.04, slopeP = (s.shape(0.95) - s.shape(0.85)) / 0.1;
    const rows = [["Peak change", sg(s.pk[1] - s.pk[0]) + " dB", th.cyan], ["RMS change", sg(s.rm[1] - s.rm[0]) + " dB", th.cyan],
      ["Slope at 0", slope0.toFixed(2), th.dispText], ["Slope at peak", slopeP.toFixed(2), th.orange]];
    rows.forEach(([a, b, col], i) => {
      txt(c, rx, y + 30 + i * 28, a, { color: th.scale, align: "left", size: 9 });
      txt(c, rx, y + 43 + i * 28, b, { color: col, align: "left", size: 11, bold: true });
    });
  }

  // ---- B: spectrum in vs out, added/removed shading
  function spec(c, th, x, y, w, h, st) {
    const d = dr(st.t), s = st.fx;
    rr(c, x, y, w, h, 3, th.display);
    const top = y + 8, base = y + h - 14, hh = base - top, N = 72, bw = (w - 16) / N;
    const X = u => x + 8 + (w - 16) * u;
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    c.strokeStyle = th.dline; c.lineWidth = 1;
    [100, 1000, 10000].forEach(f => { c.beginPath(); c.moveTo(X(lg(f)), top); c.lineTo(X(lg(f)), base); c.stroke(); });
    [-20, -40].forEach(v => { const yy = top + hh * (-v / 60); c.beginPath(); c.moveTo(x, yy); c.lineTo(x + w, yy); c.stroke(); });
    const Y = v => clamp(top + hh * (-v / 60), top, base);
    const A = [], B = [];
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1);
      const a = -10 - 24 * u - 12 * Math.max(0, u - 0.7) + 8 * d.env + 3.5 * noise(i * 3 + Math.floor(st.t * 14)) + 5 * Math.exp(-((u - 0.18) ** 2) / 0.002) + 4 * Math.exp(-((u - 0.5) ** 2) / 0.002);
      const delta = 5 * Math.sin(u * 7 + st.t * 0.7) * (0.6 + 0.4 * Math.sin(st.t * 0.37)) + (s.k - 1.2) * 3.6 * Math.max(0, u - 0.45) - 2.2 * (1 - u) * (s.k - 2.4) / 1.2;
      A.push(a); B.push(a + delta);
    }
    c.fillStyle = th.dispText + "28"; c.beginPath(); c.moveTo(x + 8 + bw / 2, base);
    A.forEach((v, i) => c.lineTo(x + 8 + i * bw + bw / 2, Y(v))); c.lineTo(x + 8 + (N - 1) * bw + bw / 2, base); c.fill();
    for (let i = 0; i < N; i++) {
      const ya = Y(A[i]), yb = Y(B[i]);
      c.fillStyle = B[i] >= A[i] ? th.orange + "bb" : th.cyan + "99";
      c.fillRect(x + 8 + i * bw, Math.min(ya, yb), bw + 0.5, Math.abs(ya - yb) + 1);
    }
    c.strokeStyle = th.dispText; c.lineWidth = 1.2; c.beginPath();
    A.forEach((v, i) => i ? c.lineTo(x + 8 + i * bw + bw / 2, Y(v)) : c.moveTo(x + 8 + bw / 2, Y(v))); c.stroke();
    c.strokeStyle = th.cyan; c.lineWidth = 2; c.beginPath();
    B.forEach((v, i) => i ? c.lineTo(x + 8 + i * bw + bw / 2, Y(v)) : c.moveTo(x + 8 + bw / 2, Y(v))); c.stroke();
    c.restore();
    [["100", 100], ["1k", 1000], ["10k", 10000]].forEach(([l, f]) => txt(c, X(lg(f)), y + h - 3, l, { color: th.scale, size: 8.5 }));
    [["-20", -20], ["-40", -40]].forEach(([l, v]) => { const yy = top + hh * (-v / 60); c.fillStyle = th.display; c.fillRect(x + w - 26, yy - 10, 22, 11); txt(c, x + w - 6, yy - 2, l, { color: th.scale, size: 8, align: "right" }); });
  }

  // ---- C: scope + level change
  function scope(c, th, x, y, w, h, st) {
    const s = st.fx, d = dr(st.t);
    rr(c, x, y, w, h, 3, th.display);
    const wy = y + 22, wh = h - 22 - 62, mid = wy + wh / 2, amp = wh / 2 - 1;
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    c.fillStyle = th.dline; c.fillRect(x, mid, w, 1);
    const f = xx => (0.25 + 0.75 * d.env) * 0.95 * Math.sin((xx / w * 2.5 + st.t * 0.6) * 6.283) + 0.2 * d.env * Math.sin((xx / w * 7.5 + st.t * 1.1) * 6.283);
    c.strokeStyle = th.dispText; c.lineWidth = 1.4; c.beginPath();
    for (let i = 0; i <= w; i += 2) { const v = clamp(f(i), -1, 1) * amp; i ? c.lineTo(x + i, mid - v) : c.moveTo(x, mid - v); } c.stroke();
    c.strokeStyle = th.cyan; c.lineWidth = 2; c.beginPath();
    for (let i = 0; i <= w; i += 2) { const v = clamp(s.shape(f(i)), -1.3, 1.3) / 1.3 * amp; i ? c.lineTo(x + i, mid - v) : c.moveTo(x, mid - v); } c.stroke();
    // level-change history
    const gy = y + h - 44, gh = 34;
    c.fillStyle = th.meterBg; c.fillRect(x + 6, gy, w - 12, gh);
    c.fillStyle = th.dline; c.fillRect(x + 6, gy + gh / 2, w - 12, 1);
    const trace = () => { const n = Math.min(s.h.length, w - 40); for (let i = 0; i < n; i++) { const e = s.h[s.h.length - 1 - i], yy = gy + gh / 2 - clamp(e.dg / 12, -1, 1) * (gh / 2 - 2); i ? c.lineTo(x + w - 8 - i, yy) : c.moveTo(x + w - 8, yy); } return n; };
    c.beginPath(); c.rect(x + 6, gy, w - 12, gh); c.clip();
    c.strokeStyle = th.orange; c.lineWidth = 1.8; c.beginPath(); trace(); c.stroke();
    c.restore();
    txt(c, x + 8, y + 13, "In", { color: th.dispText, align: "left", bold: true }); txt(c, x + 26, y + 13, "Out", { color: th.cyan, align: "left", bold: true });
    txt(c, x + 8, gy - 4, "Level change (Out − In)", { color: th.scale, size: 8.5, align: "left" });
    txt(c, x + w - 8, gy - 4, `${sg(s.dg)} dB`, { color: th.orange, align: "right", size: 11, bold: true });
    txt(c, x + 9, gy + 9, "+12", { color: th.scale, size: 8, align: "left" });
    txt(c, x + 9, gy + gh - 3, "-12", { color: th.scale, size: 8, align: "left" });
  }

  DESIGNS["Effects"] = {
    effect: "Energy",
    refs: [["SaturatorL12.png", "Saturator"], ["EQEightL12.png", "EQ Eight"], ["DrumBussL12.png", "Drum Buss"]],
    lead: "Visual cue: how the effect changes the sound, whatever it is — a transfer curve, a spectrum of what was added or removed, or a scope with level change — all measured from input vs output. Every option has the Input / Output gain strip on the right.",
    options: [
      { id: "A", name: "Transfer curve", width: 688,  step,
        why: "A curve of output level against input level, drawn as Saturator does: straight line when untouched, bent when the effect shapes the signal.",
        bullets: ["Driven by: input and output sample pairs plotted as dots; the orange curve is their running average", "Peak and RMS change, and curve slope at zero and at the peak, as readouts", "Dials in a wide block on the right (up to 10 handled); Input / Output gain strip at the far right"],
        draw(c, th, st, ps, vals) {
          const s = st.fx; if (!s) return;
          head(c, th, 6, Y0, 112);
          transfer(c, th, 6, Y0 + 20, 270, FH - 20, s);
          ctl(c, th, ps, vals, { x: 282, y: Y0, w: 332, h: FH });
          gainStrip(c, th, 688 - GAIN_W - 4, st);
        } },
      { id: "B", name: "Spectrum change", width: 700, step,
        why: "A live spectrum with the difference between output and input shaded, so you see which frequencies the effect adds (orange) or takes away (cyan) — like EQ Eight.",
        bullets: ["Driven by: FFT of input and output, 72 log-spaced bands; shading = output minus input", "Works for any effect, from tremolo to pitch shift, with no parameter knowledge", "Menu and legend above the spectrum; dials on the right; Input / Output gain strip at the far right"],
        draw(c, th, st, ps, vals) {
          if (!st.fx) return;
          head(c, th, 6, Y0, 112);
          rr(c, 164, Y0, 222, 14, 2, th.display);
          txt(c, 170, Y0 + 11, "In", { color: th.dispText, align: "left", bold: true });
          txt(c, 190, Y0 + 11, "Out", { color: th.cyan, align: "left", bold: true });
          c.fillStyle = th.orange; c.fillRect(224, Y0 + 4, 8, 7); txt(c, 236, Y0 + 11, "added", { color: th.scale, align: "left" });
          c.fillStyle = th.cyan; c.fillRect(278, Y0 + 4, 8, 7); txt(c, 290, Y0 + 11, "removed", { color: th.scale, align: "left" });
          spec(c, th, 6, Y0 + 20, 380, FH - 20, st);
          ctl(c, th, ps, vals, { x: 392, y: Y0, w: 234, h: FH });
          gainStrip(c, th, 700 - GAIN_W - 4, st);
        } },
      { id: "C", name: "Scope + level change", width: 648, step,
        why: "A scope overlays input and output waveforms, with a trace of the level difference beneath — a mix of Drum Buss's meters and Utility's readouts.",
        bullets: ["Driven by: sample waveform of input and output, plus peak and RMS levels", "Orange strip: output level minus input level over time (gain change)", "Peak and RMS change next to the menu; dials on the right; Input / Output gain strip at the far right"],
        draw(c, th, st, ps, vals) {
          const s = st.fx; if (!s) return;
          head(c, th, 6, Y0, 112);
          rr(c, 164, Y0, 166, 14, 2, th.display);
          const e = pair(c, th, 170, Y0 + 11, "Peak", sg(s.pk[1] - s.pk[0]), th.cyan);
          pair(c, th, e + 10, Y0 + 11, "RMS", sg(s.rm[1] - s.rm[0]), th.cyan);
          scope(c, th, 6, Y0 + 20, 324, FH - 20, st);
          ctl(c, th, ps, vals, { x: 336, y: Y0, w: 238, h: FH });
          gainStrip(c, th, 648 - GAIN_W - 4, st);
        } },
    ],
  };
})();
