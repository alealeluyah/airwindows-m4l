// Ambience: design options. Delay, chorus, ensemble and small-room effects; cues come from input vs output.
// Every option ends with the standard Input / Output gain strip on the right edge.
(() => {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // readout with a hover hint over label + value
  const ph = (c, th, x, y, label, val, col, title, text, size) => { const e = pair(c, th, x, y, label, val, col, size); hint(x - 2, y - 10, e - x + 4, 14, title, text); return e; };
  // legend that ends at x = right
  const legR = (c, th, right, y, items, o = {}) => {
    c.font = `400 8.5px ${FONT}`;
    let w = 0; for (const it of items) w += Math.ceil(c.measureText(it[1]).width) + (o.line ? 11 : 9) + 8;
    return legend(c, th, right - (w - 8), y, items, o);
  };
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


  // ---- real measurements -> the fields the displays read (see lib.js "real measurements")
  const fin = (v, d) => (Number.isFinite(v) ? v : d);
  const BIN_S = 32 / 48000, XT = 64 * BIN_S;             // one xcorr bin in seconds (48 kHz), whole xcorr span
  function amLive(st, m, dt) {
    if (!st.am) st.am = { h: [], tau: 0, fb: 0, ms: 0, mod: 0, live: true, bins: [], taps: [], wet: 0, si: [], so: [], sc: { i: [], o: [], d: [], g: 1, gd: 1 } };
    const s = st.am; s.live = true;
    st.inL = Math.max(st.inL === undefined ? -120 : st.inL - 24 * dt, Math.max(...(m.inPkDb || [-120, -120]).map(v => fin(v, -120))));
    st.outL = Math.max(st.outL === undefined ? -120 : st.outL - 24 * dt, Math.max(...(m.outPkDb || [-120, -120]).map(v => fin(v, -120))));
    // wet share = level of (out - in) against the output level
    const dd = fin(m.diffRmsDb, -120), orms = fin(m.outRmsDb, -120);
    if (orms > -90) s.wet += (clamp(Math.pow(10, (dd - orms) / 20), 0, 1) - s.wet) * 0.2;
    s.mod = s.wet;
    // echo profile: |xcorr| per ~0.67 ms bin; instant attack, quick release
    const x = m.xcorr || [];
    for (let i = 0; i < 64; i++) { const v = clamp(fin(x[i], 0), 0, 1); s.bins[i] = Math.max(v, (s.bins[i] || 0) * 0.85); }
    // taps = local maxima after the dry hit, only when the output really differs from the input
    s.taps = [];
    if (s.wet > 0.03) {
      const b = s.bins;
      for (let i = 2; i < 63 && s.taps.length < 7; i++) if (b[i] > 0.15 && b[i] > b[i - 1] && b[i] >= b[i + 1]) s.taps.push({ t: (i + 0.5) * BIN_S, a: b[i] });
    }
    s.tau = s.taps.length ? s.taps[0].t : 0;
    s.ms = s.tau * 1000;
    s.fb = s.taps.length > 1 ? clamp(s.taps[1].a / Math.max(0.01, s.taps[0].a), 0, 1) : 0;
    s.h.push({ i: fin(m.inPk, 0), o: fin(m.outPk, 0), w: s.wet });
    if (s.h.length > 900) s.h.shift();
    // zoomed scopes (mono = mean of L and R): in, out, out - in; slow common gain, own gain for the difference
    const iL = m.inScopeL || [], iR = m.inScopeR || [], oL = m.scopeL || [], oR = m.scopeR || [];
    const n = Math.min(iL.length, iR.length, oL.length, oR.length), sc = s.sc;
    sc.i = []; sc.o = []; sc.d = [];
    let pk = 0, pd = 0;
    for (let k = 0; k < n; k++) {
      const a = (iL[k] + iR[k]) / 2, o = (oL[k] + oR[k]) / 2;
      sc.i.push(a); sc.o.push(o); sc.d.push(o - a);
      pk = Math.max(pk, Math.abs(a), Math.abs(o)); pd = Math.max(pd, Math.abs(o - a));
    }
    sc.pk = Math.max(pk, (sc.pk || 0) - 0.5 * dt); sc.pd = Math.max(pd, (sc.pd || 0) - 0.5 * dt);
    sc.g += (clamp(0.8 / Math.max(0.02, sc.pk), 1, 10) - sc.g) * 0.1;
    sc.gd += (clamp(0.8 / Math.max(0.0005, sc.pd), 1, 100) - sc.gd) * 0.1;
    // spectra: 48 bands, fast attack, 24 dB/s release
    for (let i = 0; i < 48; i++) {
      s.si[i] = Math.max(clamp(fin((m.specIn || [])[i], -120), -120, 6), (s.si[i] === undefined ? -120 : s.si[i]) - 24 * dt);
      s.so[i] = Math.max(clamp(fin((m.specOut || [])[i], -120), -120, 6), (s.so[i] === undefined ? -120 : s.so[i]) - 24 * dt);
    }
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
    hint(x, y, w, h, "Echo Taps Display", "Each bar is one echo, placed at its delay time. Taller means louder. Measured by comparing the output with the input.");
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    const T = s.live ? XT : 1.6, px = t => x + 12 + (w - 24) * t / T, base = y + h - 17, top = y + 30;
    c.strokeStyle = th.dline; c.lineWidth = 1;
    for (let i = 1; i < 4; i++) { const yy = top + (base - top) * i / 4; c.beginPath(); c.moveTo(x, yy); c.lineTo(x + w, yy); c.stroke(); }
    // dry hit at 0, then repeats at k * tau decaying by the measured ratio; small cluster of early taps
    const bars = [{ t: 0, a: 1, dry: true }];
    if (s.live) {
      // measured: one thin bar per cross-correlation bin; the detected echoes are numbered
      s.bins.forEach((v, i) => { if (i) bars.push({ t: (i + 0.5) * BIN_S, a: v, small: !s.taps.length, thin: true }); });
      s.taps.forEach((tp, k) => bars.push({ t: tp.t, a: tp.a, n: k + 1 }));
    } else {
    for (let k = 1; k <= 7; k++) bars.push({ t: k * s.tau, a: Math.pow(s.fb, k - 1) * 0.8, n: k });
    for (let k = 0; k < 4; k++) bars.push({ t: 0.016 + k * 0.026, a: 0.18 * Math.abs(noise(k * 5 + 1)) + 0.12, small: true });
    }
    bars.forEach(b => {
      if (b.t > T) return;
      const bh = (base - top) * Math.min(1, b.a);
      c.fillStyle = b.dry ? th.dispText : (b.small ? th.cyan + "55" : (b.thin ? th.cyan + "88" : th.cyan));
      c.fillRect(px(b.t) - (b.thin ? 1 : 2), base - bh, b.thin ? 2 : 4, bh);
      if (b.n || b.dry) txt(c, px(b.t) + (b.dry ? 7 : 0), base - bh - 3, b.dry ? "dry" : String(b.n), { color: b.dry ? th.dispText : th.cyan, size: 8.5, bold: true });
    });
    // playhead: time since the last kick
    if (!s.live) {
      c.strokeStyle = th.orange; c.lineWidth = 1.5;
      const hx = px((st.t % 2) % T); c.beginPath(); c.moveTo(hx, top - 4); c.lineTo(hx, base); c.stroke();
    }
    c.fillStyle = th.scale; c.fillRect(x + 8, base, w - 16, 1);
    c.restore();
    hint(x + 8, top, w - 16, base - top, "Echo Bars", "Bars further right are later echoes. Numbers count the echoes. A flat display means the output equals the input.");
    hint(x + 8, top, 9, base - top, "Dry Hit", "The original sound, at time zero. All echoes are placed relative to it.");
    hint(x + 8, y + h - 14, w - 16, 12, "Time Axis", s.live ? "Time after the dry hit, 0 to 43 ms. Longer echoes cannot be measured." : "Time after the dry hit.");
    txt(c, x + 8, y + 13, "Echo taps", { color: th.scale, align: "left" });
    const e = ph(c, th, x + 84, y + 13, "Delay", s.live && !s.taps.length ? "-" : (s.live ? `${s.ms.toFixed(1)} ms` : `${(s.tau * 1000).toFixed(0)} ms`), th.orange, "Echo Delay", "The time of the first echo after the original sound. Measured from the peak in the cross-correlation of output against input.");
    ph(c, th, e + 14, y + 13, "Repeat", s.live && s.taps.length < 2 ? "-" : `${(s.fb * 100).toFixed(0)}%`, th.orange, "Echo Repeat Level", "How loud each echo is compared with the one before. Higher means a longer tail. Measured from the first two echo peaks.");
    legR(c, th, x + w - 8, y + 13, [[th.dispText, "Dry", "Grey bar: the original sound at time zero."], [th.cyan, "Echo", "Cyan bars: the echoes the effect adds."]].concat(s.live ? [] : [[th.orange, "Now", "Orange line: the position of the sound in the loop right now."]]));
    if (s.live) {
      [0, 10, 20, 30, 40].forEach((ms, i) => txt(c, px(ms / 1000), y + h - 5, i ? `${ms} ms` : "0", { color: th.scale, size: 8.5, align: i ? "center" : "left" }));
      if (!s.taps.length) txt(c, x + w / 2, y + h / 2 + 4, s.wet > 0.03 ? "no echo peak found" : "output equals input: no echo added", { color: th.dim, size: 10 });
    } else
    ["0", "0.4 s", "0.8 s", "1.2 s", "1.6 s"].forEach((l, i) => txt(c, px(0.4 * i), y + h - 5, l, { color: th.scale, size: 8.5, align: i ? (i === 4 ? "right" : "center") : "left" }));
  }

  // ---- B: zoomed waveform lanes in / out / difference
  function lanes(c, th, x, y, w, h, st) {
    const s = st.am, env = s.live ? 1 : Math.min(1, dr(st.t).env + 0.15);
    rr(c, x, y, w, h, 3, th.display);
    hint(x, y, w, h, "Wet Signal Display", "Three zoomed waveforms, about 5 ms wide: the input, the output, and what the effect added. Measured from the input and output signals.");
    legend(c, th, x + 8, y + 10, [[th.dispText, "In", "Grey line: the signal going into the effect."], [th.cyan, "Out", "Cyan line: the signal coming out of the effect."], [th.orange, "Out−In", "Orange line: output minus input. This is only what the effect added, magnified."]], { line: true });
    const lh = (h - 18) / 3, gx = x + 34, gw = w - 40;
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
      const ly = y + 15 + k * lh, mid = ly + lh / 2;
      hint(x + 2, ly + 1, w - 4, lh - 2, ["Input Waveform", "Output Waveform", "Added Signal Waveform"][k], ["The signal going into the effect, zoomed in.", "The signal coming out of the effect, zoomed in.", "Output minus input: only what the effect added. It is magnified so small changes show."][k] + " Measured from the last 64 samples.");
      c.save(); c.beginPath(); c.rect(gx, ly + 1, gw, lh - 2); c.clip();
      c.fillStyle = th.meterBg; c.fillRect(gx, ly + 1, gw, lh - 2);
      c.fillStyle = th.dline; c.fillRect(gx, mid, gw, 1);
      c.strokeStyle = col; c.lineWidth = 1.8; c.beginPath();
      if (s.live) {
        const arr = s.sc[["i", "o", "d"][k]], gg = k === 2 ? s.sc.gd : s.sc.g;
        arr.forEach((v0, j) => { const v = clamp(v0 * gg * 0.9, -1, 1) * (lh / 2 - 3), xx = gx + gw * j / Math.max(1, arr.length - 1); j ? c.lineTo(xx, mid - v) : c.moveTo(xx, mid - v); });
      } else
      for (let i = 0; i <= gw; i += 2) { const v = clamp(fn(i) * env * 0.9 * gain, -1, 1) * (lh / 2 - 3); i ? c.lineTo(gx + i, mid - v) : c.moveTo(gx, mid - v); }
      c.stroke();
      c.restore();
      if (s.live) { txt(c, x + 5, mid + 3, `×${(k === 2 ? s.sc.gd : s.sc.g).toFixed(k === 2 ? 0 : 1)}`, { color: th.scale, align: "left", size: 8 }); hint(x + 3, mid - 5, 28, 11, "Zoom Gain", "How much this lane is magnified so quiet sound stays visible."); }
    });
  }

  // ---- C: spectrum, input vs output, comb filtering
  function spectrum(c, th, x, y, w, h, st) {
    const s = st.am, d = s.live ? { env: 0 } : dr(st.t);
    rr(c, x, y, w, h, 3, th.display);
    const top = y + 8, base = y + h - 14, hh = base - top;
    hint(x, y, w, h, "Comb Spectrum Display", "Loudness at each pitch, low pitch on the left. The grey line is the input, the cyan area is the output. Dips in the output are comb filter notches. Measured from 48 bands of input and output.");
    hint(x + 8, y + h - 13, w - 16, 12, "Frequency Scale", "Pitch from 20 Hz on the left to 20 kHz on the right, marked at 100 Hz, 1 kHz and 10 kHz.");
    hint(x + w - 28, top, 26, hh, "Level Scale", "Loudness in dB. -20 is louder than -40.");
    const X = u => x + 8 + (w - 16) * u;
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    c.strokeStyle = th.dline; c.lineWidth = 1;
    [100, 1000, 10000].forEach(f => { c.beginPath(); c.moveTo(X(lg(f)), top); c.lineTo(X(lg(f)), base); c.stroke(); });
    [-20, -40].forEach(v => { const yy = top + hh * (-v / 60); c.beginPath(); c.moveTo(x, yy); c.lineTo(x + w, yy); c.stroke(); });
    const N = s.live ? 48 : 96, tauMs = s.ms * 0.5 + 1;
    const inD = [], outD = [];
    if (s.live) for (let i = 0; i < N; i++) { inD.push(s.si[i]); outD.push(s.so[i]); }
    else for (let i = 0; i < N; i++) {
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
      { id: "A", name: "Echo taps", short: "Taps", width: 608, step, live: amLive,
        why: "A time view of the repeats: one bar per echo, placed at its delay — like the delay display in Echo.",
        bullets: ["Driven by: cross-correlation of output against input (peaks show delay times and repeat level)", "Real device: bars = cross-correlation bins over 0-43 ms only (longer echoes are not measurable); numbered peaks appear only when out differs from in", "Dials fill the left; Input / Output gain strip on the right"],
        draw(c, th, st, ps, vals) {
          if (!st.am) return;
          head(c, th, 6, Y0, 112);
          ctl(c, th, ps, vals, { x: 4, y: Y0 + 20, w: 158, h: FH - 20 });
          taps(c, th, 166, Y0, 366, FH, st);
          gainStrip(c, th, 608 - GAIN_W - 4, st);
        } },
      { id: "B", name: "Wet signal scope", short: "Scope", width: 588, step, live: amLive,
        why: "Three zoomed waveforms — in, out and what the effect added — show chorus and ensemble movement as it happens.",
        bullets: ["Driven by: 64-sample scopes of input, output and out minus in (about 5 ms, mono, auto gain shown as ×N)", "Added-signal lane (orange, magnified) shows how much and how fast the effect moves", "Menu and readouts above the display, dials on the right; Input / Output gain strip at the far right"],
        draw(c, th, st, ps, vals) {
          if (!st.am) return;
          const s = st.am;
          head(c, th, 6, Y0, 112);
          rr(c, 164, Y0, 166, 14, 2, th.display);
          const e = ph(c, th, 170, Y0 + 11, "Delay", s.live && !s.taps.length ? "-" : `${s.ms.toFixed(1)} ms`, th.orange, "Short Delay", "The delay of the added signal, in ms. Short values mean chorus or ensemble. Measured from the first echo peak.");
          ph(c, th, e + 10, Y0 + 11, "Wet", `${(s.mod * 100).toFixed(0)}%`, th.orange, "Wet Share", "How much of the output is added signal. 0% is the dry sound only. Measured from the level of output minus input against the output level.");
          lanes(c, th, 6, Y0 + 20, 324, FH - 20, st);
          ctl(c, th, ps, vals, { x: 336, y: Y0, w: 178, h: FH });
          gainStrip(c, th, 588 - GAIN_W - 4, st);
        } },
      { id: "C", name: "Comb spectrum", short: "Spectrum", width: 628, step, live: amLive,
        why: "A live spectrum of input (line) and output (filled) with the dips that short delays and chorus create — like Spectrum.",
        bullets: ["Driven by: 48-band spectra of input and output, 20 Hz to 20 kHz; comb spacing = 1000 / first echo delay", "Notches in the filled curve show the comb filter; readout gives the spacing", "Menu above the spectrum, dials in one row under it; Input / Output gain strip on the right"],
        draw(c, th, st, ps, vals) {
          if (!st.am) return;
          const s = st.am, dh = 80;
          head(c, th, 6, Y0, 112);
          rr(c, 164, Y0, 390, 14, 2, th.display);
          legend(c, th, 170, Y0 + 11, [[th.dispText, "In", "Grey line and light fill: the spectrum of the signal going into the effect."], [th.cyan, "Out", "Cyan line and fill: the spectrum of the signal coming out. Dips are comb notches."]]);
          ph(c, th, 400, Y0 + 11, "Comb spacing", s.live ? (s.taps.length ? `${(1000 / s.ms).toFixed(0)} Hz` : "-") : `${(1000 / (s.ms * 0.5 + 1)).toFixed(0)} Hz`, th.orange, "Comb Spacing", "The distance between notches in the output, in Hz. It is 1000 divided by the delay in ms. Measured from the first echo.");
          spectrum(c, th, 6, Y0 + 20, 548, dh, st);
          ctl(c, th, ps, vals, { x: 6, y: Y0 + 20 + dh + 4, w: 548, h: FH - 20 - dh - 4 });
          gainStrip(c, th, 628 - GAIN_W - 4, st);
        } },
    ],
  };
})();
