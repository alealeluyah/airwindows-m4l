// Effects: design options. A mixed bag (tremolo, exciters, pitch, sag, ring mod…), so every cue compares input with output.
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
  const MENU = "Energy";
  const Y0 = HEAD_H + 4, FH = DEVICE_H - 8;

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


  // ---- real measurements -> the fields the displays read (see lib.js "real measurements")
  const fin = (v, d) => (Number.isFinite(v) ? v : d);
  function fxLive(st, m, dt) {
    if (!st.fx) st.fx = { n: 0, pts: [], h: [], pk: [-120, -120], rm: [-120, -120], dg: 0, dgS: 0, live: true, xf: new Array(32).fill(null), si: [], so: [], sc: { i: [], o: [], g: 1 }, shape: () => null };
    const s = st.fx; s.live = true;
    const pkI = Math.max(...(m.inPkDb || [-120, -120]).map(v => fin(v, -120))), pkO = Math.max(...(m.outPkDb || [-120, -120]).map(v => fin(v, -120)));
    s.pk[0] = Math.max(clamp(pkI, -120, 6), s.pk[0] - 24 * dt); s.pk[1] = Math.max(clamp(pkO, -120, 6), s.pk[1] - 24 * dt);
    s.rm[0] = Math.max(clamp(fin(m.inRmsDb, -120), -120, 6), s.rm[0] - 18 * dt); s.rm[1] = Math.max(clamp(fin(m.outRmsDb, -120), -120, 6), s.rm[1] - 18 * dt);
    st.inL = s.pk[0]; st.outL = s.pk[1];
    s.dg = clamp(fin(m.gainDb, 0), -24, 24);
    s.dgS += (s.dg - s.dgS) * 0.2;
    s.h.push({ dg: s.dgS }); if (s.h.length > 700) s.h.shift();
    // transfer curve: mean output per input bin (32 bins over -1..1), kept per bin; -9 = no data this frame
    const xf = m.xfer || [];
    for (let i = 0; i < 32; i++) { const v = xf[i]; if (Number.isFinite(v) && v > -2) s.xf[i] = s.xf[i] === null ? v : s.xf[i] + (v - s.xf[i]) * 0.3; }
    const xs = i => -1 + (i + 0.5) / 16;
    const xf2 = s.xf;
    let hi = -1; for (let i = 31; i >= 0; i--) if (xf2[i] !== null) { hi = i; break; }
    s.xmax = hi < 0 ? 0 : xs(hi);
    s.shape = v => {
      // linear interpolation between neighbouring bins that have data; null outside the measured range
      const f = (v + 1) * 16 - 0.5, i0 = Math.floor(f);
      let a = -1, b = -1;
      for (let i = Math.min(31, i0); i >= 0; i--) if (xf2[i] !== null) { a = i; break; }
      for (let i = Math.max(0, i0 + 1); i < 32; i++) if (xf2[i] !== null) { b = i; break; }
      if (a < 0 && b < 0) return null;
      if (a < 0 || b < 0) { const k = a < 0 ? b : a; return Math.abs(v - xs(k)) <= 1 / 32 ? xf2[k] : null; }
      if (i0 < 0 || i0 > 30) return null;
      if (a === b) return xf2[a];
      if (b - a > 3) return null;                              // gap in the data: do not bridge it
      return xf2[a] + (xf2[b] - xf2[a]) * (v - xs(a)) / (xs(b) - xs(a));
    };
    // scatter of input/output sample pairs (left channel), 10 per frame
    const iL = m.inScopeL || [], oL = m.scopeL || [], n = Math.min(iL.length, oL.length);
    for (let j = 0; j < 10 && n > 0; j++) { const i = Math.min(n - 1, Math.floor(j * n / 10 + 1)); s.pts.push([clamp(fin(iL[i], 0), -1, 1), clamp(fin(oL[i], 0), -1.3, 1.3)]); }
    while (s.pts.length > 90) s.pts.shift();
    // spectra, 48 bands: fast attack, 24 dB/s release
    for (let i = 0; i < 48; i++) {
      s.si[i] = Math.max(clamp(fin((m.specIn || [])[i], -120), -120, 6), (s.si[i] === undefined ? -120 : s.si[i]) - 24 * dt);
      s.so[i] = Math.max(clamp(fin((m.specOut || [])[i], -120), -120, 6), (s.so[i] === undefined ? -120 : s.so[i]) - 24 * dt);
    }
    // scope: left channel, 64 samples; scope() draws it at true level (1x)
    const sc = s.sc; sc.i = []; sc.o = [];
    for (let k = 0; k < n; k++) { sc.i.push(fin(iL[k], 0)); sc.o.push(fin(oL[k], 0)); }
  }

  function ctl(c, th, ps, vals, a, noTile) {
    if (!noTile) tile(c, th, a.x, a.y, a.w, a.h);
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
    screen(c, th, x, y, w, h);
    strip(c, th, x, y, w, 22);
    const side = Math.min(w - 112, h - 41), gx = x + 22, gy = y + 27, cx = gx + side / 2, cy = gy + side / 2;
    hint(x, y + 22, w, h - 22, "Transfer Curve Display", "Shows what the effect does to each input level. A straight diagonal means no change. A bend means the effect shapes the sound. Measured from input and output samples.");
    hint(gx, gy, side, side, "Transfer Curve Graph", "Across: input level. Up: output level. The orange line is the measured curve, the cyan dots are recent samples. The dashed diagonal is no change.");
    hint(gx, gy + side + 1, side, 11, "Input Axis", "The input level, from -1 (left) to +1 (right).");
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    c.fillStyle = th.meterBg; c.fillRect(gx, gy, side, side);
    c.strokeStyle = th.dline; c.lineWidth = 1;
    c.strokeRect(gx + 0.5, gy + 0.5, side, side);
    for (let i = 1; i < 4; i++) { if (i === 2) continue; const o = side * i / 4; c.beginPath(); c.moveTo(gx + o, gy); c.lineTo(gx + o, gy + side); c.moveTo(gx, gy + o); c.lineTo(gx + side, gy + o); c.stroke(); }
    c.strokeStyle = th.scale; c.beginPath(); c.moveTo(gx, cy); c.lineTo(gx + side, cy); c.moveTo(cx, gy); c.lineTo(cx, gy + side); c.stroke();
    c.setLineDash([3, 3]); c.beginPath(); c.moveTo(gx, gy + side); c.lineTo(gx + side, gy); c.stroke(); c.setLineDash([]);   // unity line
    const px = v => cx + v * side / 2 / 1.3, py = v => cy - clamp(v, -1.3, 1.3) * side / 2 / 1.3;
    c.strokeStyle = th.orange; c.lineWidth = 2.2; c.beginPath();
    let pen = false;
    for (let i = 0; i <= 60; i++) {
      const v = -1 + i / 30, sv = s.shape(v);
      if (sv === null) { pen = false; continue; }               // no measurement at this input level
      const X = px(v), Y = py(sv); pen ? c.lineTo(X, Y) : c.moveTo(X, Y); pen = true;
    }
    c.stroke();
    s.pts.forEach(([a, b], i) => { c.globalAlpha = 0.25 + 0.75 * i / s.pts.length; c.fillStyle = th.cyan; c.fillRect(px(a) - 1.25, py(b) - 1.25, 2.5, 2.5); });
    c.globalAlpha = 1; c.restore();
    legR(c, th, x + w - 8, y + 15, [[th.orange, "Curve", "Orange line: the measured curve, output level against input level."], [th.cyan, "Samples", "Cyan dots: the latest input and output sample pairs. Newer dots are brighter."], [th.scale, "Unity", "Dashed diagonal: output equals input, so the effect changes nothing."]]);
    txt(c, gx + side / 2, gy + side + 9, "In", { color: th.scale, size: 8.5 });
    const rx = gx + side + 22;
    const sl = (a, b) => { const p = s.shape(a), q = s.shape(b); return p === null || q === null ? null : (q - p) / (b - a); };
    const slope0 = sl(-0.02, 0.02), slopeP = s.live ? sl(s.xmax - 0.15, s.xmax) : sl(0.85, 0.95);
    const rows = [["Peak change", sg(s.pk[1] - s.pk[0]) + " dB", th.cyan], ["RMS change", sg(s.rm[1] - s.rm[0]) + " dB", th.cyan],
      ["Slope at 0", slope0 === null ? "-" : slope0.toFixed(2), th.dispText], ["Slope at peak", slopeP === null ? "-" : slopeP.toFixed(2), th.orange]];
    const rinfo = [["Peak Change", "How much louder or quieter the peaks get, in dB. Measured from input and output peak levels."], ["RMS Change", "How much louder or quieter the average level gets, in dB. Measured from input and output RMS levels."],
      ["Slope at Zero", "How steep the curve is for quiet sound. 1.00 means no change, higher means boost, lower means squash."], ["Slope at Peak", "How steep the curve is near the loudest level. Lower than 1.00 means the peaks are squashed."]];
    rows.forEach(([a, b, col], i) => {
      hint(rx - 3, y + 27 + i * 26, w - (rx - x) - 2, 25, rinfo[i][0], rinfo[i][1]);
      txt(c, rx, y + 36 + i * 26, a, { color: th.scale, align: "left", size: 9 });
      txt(c, rx, y + 48 + i * 26, b, { color: col, align: "left", size: 11, bold: true });
    });
  }

  // ---- B: spectrum in vs out, added/removed shading
  function spec(c, th, x, y, w, h, st) {
    const s = st.fx, d = s.live ? { env: 0 } : dr(st.t);
    screen(c, th, x, y, w, h);
    strip(c, th, x, y, w, 22);
    hint(x, y + 22, w, h - 22, "Spectrum Change Display", "Loudness at each pitch, low pitch on the left. The grey area is the input, the cyan line is the output. Shading between them shows what the effect adds or removes. Measured from 48 bands.");
    hint(x + 8, y + h - 13, w - 16, 12, "Frequency Scale", "Pitch from 20 Hz on the left to 20 kHz on the right, marked at 100 Hz, 1 kHz and 10 kHz.");
    hint(x + w - 28, y + 28, 26, h - 42, "Level Scale", "Loudness in dB. -20 is louder than -40.");
    const N = s.live ? 48 : 72, top = y + 28, base = y + h - 14, hh = base - top, bw = (w - 16) / N;
    const X = u => x + 8 + (w - 16) * u;
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    c.strokeStyle = th.dline; c.lineWidth = 1;
    [100, 1000, 10000].forEach(f => { c.beginPath(); c.moveTo(X(lg(f)), top); c.lineTo(X(lg(f)), base); c.stroke(); });
    [-20, -40].forEach(v => { const yy = top + hh * (-v / 60); c.beginPath(); c.moveTo(x, yy); c.lineTo(x + w, yy); c.stroke(); });
    const Y = v => clamp(top + hh * (-v / 60), top, base);
    const A = [], B = [];
    if (s.live) for (let i = 0; i < N; i++) { A.push(s.si[i]); B.push(s.so[i]); }
    else for (let i = 0; i < N; i++) {
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
    const s = st.fx, d = s.live ? { env: 0 } : dr(st.t);
    screen(c, th, x, y, w, h);
    strip(c, th, x, y, w, 22);                                 // top strip: menu and readouts (drawn by the caller)
    const by = strip(c, th, x, y + h - 16, w, 16, true);       // bottom strip: legend
    hint(x, y + 22, w, h - 38, "Scope Display", "Top: the input and output waveforms on top of each other. Bottom: how much louder or quieter the output is than the input over time. Measured from input and output.");
    const gh = 34, gy = y + h - 16 - 5 - gh;                   // level-change lane
    const wy = y + 26, wh = gy - 16 - 3 - wy, mid = wy + wh / 2, amp = wh / 2 - 1;
    // samples of the two waveforms in the range -1..1
    const f = xx => (0.25 + 0.75 * d.env) * 0.95 * Math.sin((xx / w * 2.5 + st.t * 0.6) * 6.283) + 0.2 * d.env * Math.sin((xx / w * 7.5 + st.t * 1.1) * 6.283);
    let ai, ao;
    if (s.live) { ai = s.sc.i; ao = s.sc.o; }
    else { ai = []; ao = []; for (let i = 0; i <= w; i += 2) { ai.push(clamp(f(i), -1, 1)); ao.push(clamp(s.shape(f(i)), -1.3, 1.3) / 1.3); } }
    // RUBRIC 2.6: fixed scale, true level (1x): full scale = plot half-height
    const g = 1;
    c.save(); c.beginPath(); c.rect(x, wy - 2, w, wh + 4); c.clip();
    c.fillStyle = th.dline; c.fillRect(x + 3, mid, w - 6, 1);
    const px = (j, n) => x + 4 + (w - 8) * j / Math.max(1, n - 1);
    c.strokeStyle = th.dispText; c.lineWidth = 1.4; c.beginPath();
    ai.forEach((v, j) => { const yy = mid - clamp(v * g, -1, 1) * amp; j ? c.lineTo(px(j, ai.length), yy) : c.moveTo(px(j, ai.length), yy); }); c.stroke();
    c.strokeStyle = th.cyan; c.lineWidth = 2; c.beginPath();
    ao.forEach((v, j) => { const yy = mid - clamp(v * g, -1, 1) * amp; j ? c.lineTo(px(j, ao.length), yy) : c.moveTo(px(j, ao.length), yy); }); c.stroke();
    c.restore();
    // level-change history (dB, fixed scale)
    strip(c, th, x, gy - 16, w, 16, true);
    c.save();
    c.fillStyle = th.meterBg; c.fillRect(x + 6, gy, w - 12, gh);
    c.fillStyle = th.dline; c.fillRect(x + 6, gy + gh / 2, w - 12, 1);
    c.beginPath(); c.rect(x + 6, gy, w - 12, gh); c.clip();
    c.strokeStyle = th.orange; c.lineWidth = 1.8; c.beginPath();
    const n = Math.min(s.h.length, w - 40);
    for (let i = 0; i < n; i++) { const e = s.h[s.h.length - 1 - i], yy = gy + gh / 2 - clamp(e.dg / 12, -1, 1) * (gh / 2 - 2); i ? c.lineTo(x + w - 8 - i, yy) : c.moveTo(x + w - 8, yy); }
    c.stroke();
    c.restore();
    hint(x + 4, wy, w - 8, wh, "Waveform Area", "The input and output signals, drawn over each other for a short moment. Where the lines differ, the effect changed the sound.");
    legend(c, th, x + 8, by, [[th.dispText, "In", "Grey line: the waveform going into the effect."], [th.cyan, "Out", "Cyan line: the waveform coming out of the effect."], [th.orange, "Change", "Orange line (lane below the waveform): output level minus input level over time."]], { line: true });
    hint(x + 6, gy, w - 12, gh, "Level Change Strip", "The orange line shows output level minus input level, now at the right edge. Above the middle line the effect is louder, below it is quieter. Range +12 to -12 dB.");
    hint(x + w - 80, gy - 14, 74, 12, "Level Change", "Output level minus input level right now, in dB. Measured from the input and output RMS levels.");
    txt(c, x + 8, gy - 5, "Level change (Out − In)", { color: th.scale, size: 8.5, align: "left" });
    txt(c, x + w - 8, gy - 5, `${sg(s.dg)} dB`, { color: th.orange, align: "right", size: 11, bold: true });
    txt(c, x + 9, gy + 9, "+12", { color: th.scale, size: 8, align: "left" });
    txt(c, x + 9, gy + gh - 3, "-12", { color: th.scale, size: 8, align: "left" });
  }

  DESIGNS["Effects"] = {
    effect: "Energy",
    refs: [["SaturatorL12.png", "Saturator"], ["EQEightL12.png", "EQ Eight"], ["DrumBussL12.png", "Drum Buss"]],
    lead: "Visual cue: how the effect changes the sound, whatever it is — a transfer curve, a spectrum of what was added or removed, or a scope with level change — all measured from input vs output. Every option has the Input / Output gain strip on the right.",
    options: [
      { id: "A", name: "Transfer curve", short: "Curve", width: 688, step, live: fxLive,
        why: "A curve of output level against input level, drawn as Saturator does: straight line when untouched, bent when the effect shapes the signal.",
        bullets: ["Driven by: scope sample pairs (dots) and the measured transfer curve xfer (orange, drawn only where data exists; slopes show - without data)", "Peak and RMS change, and curve slope at zero and at the peak, as readouts", "Dials in a wide block on the right (up to 10 handled); Input / Output gain strip at the far right"],
        draw(c, th, st, ps, vals) {
          const s = st.fx; if (!s) return;
          transfer(c, th, 4, Y0, 300, FH, s);
          head(c, th, 9, Y0 + 4, 100);
          ctl(c, th, ps, vals, { x: 306, y: Y0, w: 312, h: FH });
          gainStrip(c, th, 688 - GAIN_W - 4, st);
        } },
      { id: "B", name: "Spectrum change", short: "Spectrum", width: 700, step, live: fxLive,
        why: "A live spectrum with the difference between output and input shaded, so you see which frequencies the effect adds (orange) or takes away (cyan) — like EQ Eight.",
        bullets: ["Driven by: 48 log-spaced bands of input and output; shading = output minus input", "Works for any effect, from tremolo to pitch shift, with no parameter knowledge", "Menu and legend above the spectrum; dials on the right; Input / Output gain strip at the far right"],
        draw(c, th, st, ps, vals) {
          if (!st.fx) return;
          spec(c, th, 4, Y0, 390, FH, st);
          head(c, th, 9, Y0 + 4, 100);
          legend(c, th, 150, Y0 + 15, [[th.dispText, "In", "Grey line: the spectrum of the signal going into the effect."], [th.cyan, "Out", "Cyan line: the spectrum of the signal coming out."], [th.orange, "Added", "Orange shading: pitches where the output is louder than the input."], [th.cyan, "Removed", "Cyan shading: pitches where the output is quieter than the input."]]);
          ctl(c, th, ps, vals, { x: 396, y: Y0, w: 234, h: FH });
          gainStrip(c, th, 700 - GAIN_W - 4, st);
        } },
      { id: "C", name: "Scope + level change", short: "Scope", width: 648, step, live: fxLive,
        why: "A scope overlays input and output waveforms, with a trace of the level difference beneath — a mix of Drum Buss's meters and Utility's readouts.",
        bullets: ["Driven by: sample waveform of input and output, plus peak and RMS levels", "Orange strip: output level minus input level over time (gain change)", "Peak and RMS change next to the menu; dials on the right; Input / Output gain strip at the far right"],
        draw(c, th, st, ps, vals) {
          const s = st.fx; if (!s) return;
          scope(c, th, 4, Y0, 330, FH, st);
          head(c, th, 9, Y0 + 4, 92);
          const e = ph(c, th, 146, Y0 + 15, "Peak", sg(s.pk[1] - s.pk[0]), th.cyan, "Peak Change", "How much louder or quieter the peaks are after the effect, in dB. Measured from input and output peak levels.");
          ph(c, th, e + 10, Y0 + 15, "RMS", sg(s.rm[1] - s.rm[0]), th.cyan, "RMS Change", "How much louder or quieter the average level is after the effect, in dB. Measured from input and output RMS levels.");
          ctl(c, th, ps, vals, { x: 336, y: Y0, w: 242, h: FH });
          gainStrip(c, th, 648 - GAIN_W - 4, st);
        } },
    ],
  };
})();
