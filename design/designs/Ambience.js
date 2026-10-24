// Ambience: design options. Delay, chorus, ensemble and small-room effects; cues come from input vs output.
// Every option ends with the standard Input / Output gain strip on the right edge.
(() => {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dr = t => drums(((t % 2) + 2) % 2);
  const MENU = "TapeDelay";
  const Y0 = HEAD_H + 6, FH = DEVICE_H - 12;

  // Simulated effect: a delayed, decaying copy (tap time moves slowly) plus a short modulated delay.
  function core(st, t, dt) {
    const s = st.am, d = dr(t);
    s.tau = 0.3 + 0.08 * Math.sin(t * 0.4);              // measured delay (s) from cross-correlation peak
    s.fb = 0.5 + 0.12 * Math.sin(t * 0.23);              // measured echo-to-echo ratio
    s.ms = 8 + 5 * Math.sin(t * 0.9);                    // short chorus delay in ms
    s.mod = 0.5 + 0.5 * Math.sin(t * 1.7);
    let wet = 0;                                         // wet = past input, scaled by the repeats
    for (let k = 1; k <= 5; k++) wet += dr(t - k * s.tau).env * Math.pow(s.fb, k - 1) * 0.7;
    s.wet = clamp(wet, 0, 1.2); s.dry = d.env;
    const o = clamp(d.env + s.wet * 0.6, 0, 1.3);
    s.h.push({ i: d.env, o, w: s.wet });
    if (s.h.length > 900) s.h.shift();
    st.inL = Math.max(db(d.env * 0.8 + 0.01), st.inL - 24 * dt);
    st.outL = Math.max(db(o * 0.8 + 0.01), st.outL - 24 * dt);
  }
  function step(st, dt) {
    if (!st.am) {
      st.am = { h: [], tau: 0.3, fb: 0.5, ms: 8, mod: 0.5 };
      for (let i = 240; i > 0; i--) core(st, st.t - i / 120, 1 / 120);
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
  // label then value, value placed after the measured label width; returns end x
  function pair(c, th, x, y, label, val, col) {
    c.font = `400 9.5px ${FONT}`;
    const w = c.measureText(label).width;
    txt(c, x, y, label, { color: th.scale, align: "left" });
    txt(c, x + w + 5, y, val, { color: col, align: "left", size: 10.5, bold: true });
    c.font = `700 10.5px ${FONT}`;
    return x + w + 5 + c.measureText(val).width;
  }
  const lg = f => (Math.log10(f) - 1.3) / 3;             // 20 Hz .. 20 kHz as 0..1

  // ---- A: echo taps (cross-correlation of output against input)
  function taps(c, th, x, y, w, h, st) {
    const s = st.am;
    rr(c, x, y, w, h, 3, th.display);
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    const T = 1.6, px = t => x + 12 + (w - 24) * t / T, base = y + h - 17, top = y + 30;
    c.strokeStyle = th.dline; c.lineWidth = 1;
    for (let i = 1; i < 4; i++) { const yy = top + (base - top) * i / 4; c.beginPath(); c.moveTo(x, yy); c.lineTo(x + w, yy); c.stroke(); }
    // dry hit at 0, then repeats at k * tau decaying by the measured ratio; small cluster of early taps
    const bars = [{ t: 0, a: 1, dry: true }];
    for (let k = 1; k <= 7; k++) bars.push({ t: k * s.tau, a: Math.pow(s.fb, k - 1) * 0.8, n: k });
    for (let k = 0; k < 4; k++) bars.push({ t: 0.016 + k * 0.026, a: 0.18 * Math.abs(noise(k * 5 + 1)) + 0.12, small: true });
    bars.forEach(b => {
      if (b.t > T) return;
      const bh = (base - top) * Math.min(1, b.a);
      c.fillStyle = b.dry ? th.dispText : (b.small ? th.cyan + "99" : th.cyan);
      c.fillRect(px(b.t) - 2, base - bh, 4, bh);
      if (b.n || b.dry) txt(c, px(b.t) + (b.dry ? 7 : 0), base - bh - 3, b.dry ? "dry" : String(b.n), { color: b.dry ? th.dispText : th.cyan, size: 8.5, bold: true });
    });
    // playhead: time since the last kick
    c.strokeStyle = th.orange; c.lineWidth = 1.5;
    const hx = px((st.t % 2) % T); c.beginPath(); c.moveTo(hx, top - 4); c.lineTo(hx, base); c.stroke();
    c.fillStyle = th.scale; c.fillRect(x + 8, base, w - 16, 1);
    c.restore();
    txt(c, x + 8, y + 13, "Echo taps", { color: th.scale, align: "left" });
    const e = pair(c, th, x + 84, y + 13, "Delay", `${(s.tau * 1000).toFixed(0)} ms`, th.orange);
    pair(c, th, e + 14, y + 13, "Repeat", `${(s.fb * 100).toFixed(0)}%`, th.orange);
    ["0", "0.4 s", "0.8 s", "1.2 s", "1.6 s"].forEach((l, i) => txt(c, px(0.4 * i), y + h - 5, l, { color: th.scale, size: 8.5, align: i ? (i === 4 ? "right" : "center") : "left" }));
  }

  // ---- B: zoomed waveform lanes in / out / difference
  function lanes(c, th, x, y, w, h, st) {
    const s = st.am, env = Math.min(1, dr(st.t).env + 0.15);
    rr(c, x, y, w, h, 3, th.display);
    const lh = (h - 8) / 3, gx = x + 46, gw = w - 52;
    const src = u => 0.6 * Math.sin(u * 6.28) + 0.3 * Math.sin(u * 6.28 * 2.7 + 1) + 0.15 * Math.sin(u * 6.28 * 5.1);
    const span = 3, cyc = st.t * 0.4;
    const f = (xx, wet) => {
      const u = xx / gw * span + cyc;
      const tau = (s.ms / 1000) * 220 * (1 + 0.5 * Math.sin(st.t * 3 + xx * 0.01)) / 10;
      return wet ? src(u - tau * 0.12) : src(u);
    };
    const defs = [["In", th.dispText, xx => f(xx, 0), 1], ["Out", th.cyan, xx => 0.6 * f(xx, 0) + 0.7 * f(xx, 1), 1],
      ["Out − In", th.orange, xx => 0.7 * f(xx, 1) - 0.4 * f(xx, 0), 2.4]];
    defs.forEach(([name, col, fn, gain], k) => {
      const ly = y + 4 + k * lh, mid = ly + lh / 2;
      c.save(); c.beginPath(); c.rect(gx, ly + 1, gw, lh - 2); c.clip();
      c.fillStyle = th.meterBg; c.fillRect(gx, ly + 1, gw, lh - 2);
      c.fillStyle = th.dline; c.fillRect(gx, mid, gw, 1);
      c.strokeStyle = col; c.lineWidth = 1.8; c.beginPath();
      for (let i = 0; i <= gw; i += 2) { const v = clamp(fn(i) * env * 0.9 * gain, -1, 1) * (lh / 2 - 3); i ? c.lineTo(gx + i, mid - v) : c.moveTo(gx, mid - v); }
      c.stroke(); c.restore();
      txt(c, x + 5, mid + 3, name, { color: col, align: "left", size: 8.5, bold: true });
    });
  }

  // ---- C: spectrum, input vs output, comb filtering
  function spectrum(c, th, x, y, w, h, st) {
    const s = st.am, d = dr(st.t);
    rr(c, x, y, w, h, 3, th.display);
    const top = y + 8, base = y + h - 14, hh = base - top;
    const X = u => x + 8 + (w - 16) * u;
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    c.strokeStyle = th.dline; c.lineWidth = 1;
    [100, 1000, 10000].forEach(f => { c.beginPath(); c.moveTo(X(lg(f)), top); c.lineTo(X(lg(f)), base); c.stroke(); });
    [-20, -40].forEach(v => { const yy = top + hh * (-v / 60); c.beginPath(); c.moveTo(x, yy); c.lineTo(x + w, yy); c.stroke(); });
    const N = 96, tauMs = s.ms * 0.5 + 1;
    const inD = [], outD = [];
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1), f = Math.pow(10, 1.3 + 3 * u);
      const lvl = -10 - 22 * u - 14 * Math.max(0, u - 0.6) + 9 * d.env - 6 * (1 - d.env) + 3.5 * noise(i * 3 + Math.floor(st.t * 14));
      const comb = Math.sqrt(1 + 0.8 * 0.8 + 2 * 0.8 * Math.cos(2 * Math.PI * f * tauMs / 1000));
      inD.push(lvl); outD.push(lvl + 20 * Math.log10(Math.max(0.06, comb / 1.3)));
    }
    const yy = v => clamp(top + hh * (-v / 60), top, base);
    const xi = i => X(i / (N - 1));
    c.fillStyle = th.dispText + "30"; c.beginPath(); c.moveTo(xi(0), base);
    inD.forEach((v, i) => c.lineTo(xi(i), yy(v))); c.lineTo(xi(N - 1), base); c.fill();
    c.fillStyle = th.cyan + "55"; c.beginPath(); c.moveTo(xi(0), base);
    outD.forEach((v, i) => c.lineTo(xi(i), yy(v))); c.lineTo(xi(N - 1), base); c.fill();
    c.strokeStyle = th.dispText; c.lineWidth = 1.2; c.beginPath();
    inD.forEach((v, i) => i ? c.lineTo(xi(i), yy(v)) : c.moveTo(xi(i), yy(v))); c.stroke();
    c.strokeStyle = th.cyan; c.lineWidth = 2; c.beginPath();
    outD.forEach((v, i) => i ? c.lineTo(xi(i), yy(v)) : c.moveTo(xi(i), yy(v))); c.stroke();
    c.restore();
    [["100", 100], ["1k", 1000], ["10k", 10000]].forEach(([l, f]) => txt(c, X(lg(f)), y + h - 3, l, { color: th.scale, size: 8.5 }));
    [["-20", -20], ["-40", -40]].forEach(([l, v]) => { c.fillStyle = th.display; c.fillRect(x + w - 26, top + hh * (-v / 60) - 10, 22, 11); txt(c, x + w - 6, top + hh * (-v / 60) - 2, l, { color: th.scale, size: 8, align: "right" }); });
  }

  DESIGNS["Ambience"] = {
    effect: "TapeDelay",
    refs: [["EchoL12.png", "Echo"], ["ChorusEnsembleL12.png", "Chorus-Ensemble"], ["SpectrumL12.png", "Spectrum"]],
    lead: "Visual cue: what the effect adds to the sound — echoes in time, the added wet signal, or the change in the spectrum — measured by comparing input and output. Every option has the Input / Output gain strip on the right.",
    options: [
      { id: "A", name: "Echo taps", width: 608, step,
        why: "A time view of the repeats: one bar per echo, placed at its delay — like the delay display in Echo.",
        bullets: ["Driven by: cross-correlation of output against input (peaks show delay times and repeat level)", "Delay time and repeat ratio shown as live readouts; echoes are numbered", "Dials fill the left; Input / Output gain strip on the right"],
        draw(c, th, st, ps, vals) {
          if (!st.am) return;
          head(c, th, 6, Y0, 112);
          ctl(c, th, ps, vals, { x: 4, y: Y0 + 20, w: 158, h: FH - 20 });
          taps(c, th, 166, Y0, 366, FH, st);
          gainStrip(c, th, 608 - GAIN_W - 4, st);
        } },
      { id: "B", name: "Wet signal scope", width: 588, step,
        why: "Three zoomed waveforms — in, out and what the effect added — show chorus and ensemble movement as it happens.",
        bullets: ["Driven by: waveform of input, output and out minus in, zoomed to a few cycles", "Added-signal lane (orange, magnified) shows how much and how fast the effect moves", "Menu and readouts above the display, dials on the right; Input / Output gain strip at the far right"],
        draw(c, th, st, ps, vals) {
          if (!st.am) return;
          const s = st.am;
          head(c, th, 6, Y0, 112);
          rr(c, 164, Y0, 166, 14, 2, th.display);
          const e = pair(c, th, 170, Y0 + 11, "Delay", `${s.ms.toFixed(1)} ms`, th.orange);
          pair(c, th, e + 10, Y0 + 11, "Wet", `${(s.mod * 100).toFixed(0)}%`, th.orange);
          lanes(c, th, 6, Y0 + 20, 324, FH - 20, st);
          ctl(c, th, ps, vals, { x: 336, y: Y0, w: 178, h: FH });
          gainStrip(c, th, 588 - GAIN_W - 4, st);
        } },
      { id: "C", name: "Comb spectrum", width: 628, step,
        why: "A live spectrum of input (line) and output (filled) with the dips that short delays and chorus create — like Spectrum.",
        bullets: ["Driven by: FFT of input and output, 96 bands from 20 Hz to 20 kHz", "Notches in the filled curve show the comb filter; readout gives the spacing", "Menu above the spectrum, dials in one row under it; Input / Output gain strip on the right"],
        draw(c, th, st, ps, vals) {
          if (!st.am) return;
          const s = st.am, dh = 80;
          head(c, th, 6, Y0, 112);
          rr(c, 164, Y0, 390, 14, 2, th.display);
          txt(c, 170, Y0 + 11, "In", { color: th.dispText, align: "left", bold: true });
          txt(c, 190, Y0 + 11, "Out", { color: th.cyan, align: "left", bold: true });
          pair(c, th, 400, Y0 + 11, "Comb spacing", `${(1000 / (s.ms * 0.5 + 1)).toFixed(0)} Hz`, th.orange);
          spectrum(c, th, 6, Y0 + 20, 548, dh, st);
          ctl(c, th, ps, vals, { x: 6, y: Y0 + 20 + dh + 4, w: 548, h: FH - 20 - dh - 4 });
          gainStrip(c, th, 628 - GAIN_W - 4, st);
        } },
    ],
  };
})();
