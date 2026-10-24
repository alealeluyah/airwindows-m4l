// Clipping: design options. Own helpers live inside this IIFE; shared helpers come from app.js.
(function () {
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const GREY = () => (S.theme === "light" ? "#5e5e5e" : "#3a3a3a");
  // nominal drive 0..1 from the generic dial values (the real device measures in vs out instead)
  const drive = vals => (vals.length ? 0.25 + 0.5 * clamp(vals.reduce((a, b) => a + b, 0) / vals.length, 0, 1) : 0.5);
  const sigAt = (ph, a) => a * (0.78 * Math.sin(TAU * ph) + 0.22 * Math.sin(TAU * 3 * ph + 0.6));
  // st.inL / st.outL: held peaks in dB with 24 dB/s release. st.f (set by model) is the measured in->out map.
  function step(st, dt) {
    const d = drums(st.t), a = 0.08 + d.env * 0.82, f = st.f || (x => shape(x, 0.5));
    st.a = a;
    st.inL = Math.max(db(a), st.inL - 24 * dt);
    st.outL = Math.max(db(Math.abs(f(a)) + 1e-4), st.outL - 24 * dt);
    st.aPk = Math.pow(10, st.inL / 20); st.aV = Math.min(0.95, st.aPk);   // held peak drives the scope so it stays readable
    st.gr = Math.max(Math.max(0, db(a) - db(Math.abs(f(a)) + 1e-4)), (st.gr || 0) - 24 * dt);
    st.hist.push({ a }); if (st.hist.length > 700) st.hist.shift();
  }
  // model: f = measured in->out sample map, plus level numbers derived from it
  function model(st, vals) {
    if (st.isLive) {   // real measurements: curve, ceiling and levels come from live(), not from the dials
      const inL = Math.max(-60, st.inL), outL = Math.max(-60, st.outL);
      return { d: 0, f: liveCurve(st), curve: livePts(st), ceil: LIVE_CEIL ? st.ceil : null, st, inL, outL, diff: outL - inL, gr: st.gr || 0, clipPct: st.clipP || 0, live: true };
    }
    const d = drive(vals), f = x => shape(x, d), ceil = ceilOf(d);
    st.f = f;
    const inL = Math.max(-60, st.inL), outL = Math.max(-60, st.outL);
    let clipped = 0; const N = 64;
    for (let i = 0; i < N; i++) if (ceil && Math.abs(f(sigAt(i / N, st.aV))) >= ceil - 1e-6) clipped++;
    const dtm = st.t - (st.tm === undefined ? st.t : st.tm); st.tm = st.t;
    st.clipP = Math.max(100 * clipped / N, (st.clipP || 0) - 100 * Math.max(0, dtm));   // clip lamp holds ~1 s
    return { d, f, ceil, st, inL, outL, diff: outL - inL, gr: st.gr || 0, clipPct: st.clipP, curve: simCurve(f) };
  }
  // A panel is a SCREEN with a strip on top (title, legend, readout, zoom). RUBRIC 2.1 / 2.3.
  const SH = 19;
  const box = (c, th, x, y, w, h, title, right, zt) => {
    screen(c, th, x, y, w, h);
    strip(c, th, x, y, w, SH);
    c.font = `400 9.5px ${FONT}`;
    let rx = x + w - 6;
    if (right) { txt(c, rx, y + 13, right, { color: th.orange, align: "right" }); rx -= Math.ceil(c.measureText(right).width) + 10; }
    if (zt) {   // auto zoom (RUBRIC 2.6)
      const zw = Math.ceil(c.measureText(zt).width);
      txt(c, rx, y + 13, zt, { color: th.dispText, align: "right" });
      hint(rx - zw - 2, y + 3, zw + 4, 13, "Zoom", "The waveform is enlarged so the loudest part fills the screen. The number says by how much; quiet signals get a larger zoom. It follows the signal level automatically.");
    }
  };
  // legend in a display header row: starts after the title, stops before the right-hand text, drops items that do not fit
  const SCG = () => (S.theme === "light" ? "#9a9a9a" : "#6a6a6a");
  function hdrLegend(c, th, x, y, w, title, right, items, o = {}) {
    c.font = `400 9.5px ${FONT}`;
    const tw = title ? Math.ceil(c.measureText(title).width) + 10 : 0;
    const maxEnd = x + w - 6 - (right ? Math.ceil(c.measureText(right).width) + 8 : 0);
    c.font = `400 8.5px ${FONT}`;
    const sw = o.line ? 11 : 9, gap = o.gap || 8;
    const count = x0 => { let end = x0, n = 0; for (const it of items) { const e = end + sw + Math.ceil(c.measureText(it[1]).width) + (n ? gap : 0); if (e > maxEnd) break; end = e; n++; } return n; };
    const nT = count(x + 6 + tw), n0 = count(x + 6);
    const showT = !!title && nT >= n0, x0 = x + 6 + (showT ? tw : 0), n = showT ? nT : n0;   // the title gives way to the legend
    if (showT) txt(c, x + 6, y + 13, title, { color: th.scale, align: "left" });
    if (n) legend(c, th, x0, y + 13, items.slice(0, n), o);
  }
  const sgn = v => (v >= 0 ? "+" : "") + v.toFixed(1);
  function dials(c, th, ps, area, cols, vals, cw) {
    if (!ps.length) { txt(c, area.x + area.w / 2, area.y + area.h / 2 + 3, "No controls", { color: th.dim }); return; }
    const rows = Math.ceil(ps.length / cols);
    if (rows < 2 || area.h / rows < 48) { knobGrid(c, th, ps, area, cols, vals, cw); return; }
    // one knobGrid call per row, so rows keep their own breathing room
    const rh = Math.min(58, area.h / rows), y0 = area.y + (area.h - rows * rh) / 2;
    for (let r = 0; r < rows; r++) knobGrid(c, th, ps.slice(r * cols, (r + 1) * cols), { x: area.x, y: y0 + r * rh, w: area.w, h: rh }, cols, vals, cw);
  }
  // In / Out / Diff as label + value pairs, for a screen strip (grey label, coloured value)
  const readouts = (c, th, x, y, m) => {
    const items = [["In", m.inL.toFixed(1), th.cyan], ["Out", m.outL.toFixed(1), th.cyan], ["Diff", `${m.diff >= 0 ? "+" : ""}${m.diff.toFixed(1)} dB`, th.orange]];
    c.font = `400 9.5px ${FONT}`;
    const lws = items.map(it => c.measureText(it[0]).width), vws = items.map(it => c.measureText(it[1]).width);
    let cx = x;
    items.forEach(([l, v, col], i) => {
      txt(c, cx, y, l, { color: th.dispText, align: "left" });
      txt(c, cx + lws[i] + 4, y, v, { color: col, align: "left" });
      hint(cx - 2, y - 10, lws[i] + 4 + vws[i] + 4, 14, ["Input Peak", "Output Peak", "Level Difference"][i], [
        "Loudest input level in dB, held and falling slowly. Measured before the effect, after the Input gain.",
        "Loudest output level in dB, held and falling slowly. Measured after the effect, before the Output gain.",
        "Output peak minus input peak, in dB. Above zero means the effect made the peaks louder. Below zero means it made them quieter."][i]);
      cx += lws[i] + 4 + vws[i] + 10;
    });
  };
  // bottom strip of a screen (height fh) with the In / Out / Diff readouts
  const footer = (c, th, x, y, w, h, fh, m) => {
    const ty = y + h - fh;
    strip(c, th, x, ty, w, fh, true);
    readouts(c, th, x + 8, ty + fh / 2 + 3.5, m);
  };
  // transfer curve measured as output sample vs input sample; orange dot = live input peak
  function transferPanel(c, th, x, y, w, h, m, title, right, foot = 0) {
    box(c, th, x, y, w, h, "", right);
    hdrLegend(c, th, x, y, w, title, right, [
      [th.cyan, "Output", "The curve shows the output level for every input level. The more it bends away from the diagonal, the more the effect changes the sound."],
      [th.orange, "Peak", "The orange dot marks the current input peak and its output level. In clipping effects the orange lines mark the ceiling."],
      [th.scale, "No change", "The grey diagonal is a straight line: output equal to input. Where the curve leaves it, the effect changes the level."]], { line: true, gap: 6 });
    const avail = h - SH - 7 - foot, s = Math.min(w - 12, avail), px = x + (w - s) / 2, py = y + SH + 3 + (avail - s) / 2;
    const X = v => px + (clamp(v, -1.1, 1.1) + 1.1) / 2.2 * s, Y = v => py + s - (clamp(v, -1.1, 1.1) + 1.1) / 2.2 * s;
    const a = Math.min(1, m.st.aPk);
    c.fillStyle = th.cyan + "33"; c.fillRect(X(-a), py, X(a) - X(-a), s);
    c.fillStyle = th.dline; c.fillRect(px, py + s / 2, s, 1); c.fillRect(px + s / 2, py, 1, s);
    c.strokeStyle = th.scale; c.lineWidth = 1; c.beginPath(); c.moveTo(X(-1), Y(-1)); c.lineTo(X(1), Y(1)); c.stroke();
    c.strokeStyle = th.cyan; c.lineWidth = 2; c.beginPath();
    m.curve.forEach(([v, w], i) => { i ? c.lineTo(X(v), Y(w)) : c.moveTo(X(v), Y(w)); });
    c.stroke();
    if (m.curve.length < 2) txt(c, px + s / 2, py + s / 2 + 14, "waiting for signal", { color: th.scale, size: 8.5 });
    if (m.ceil) { c.strokeStyle = th.orange; c.lineWidth = 1; c.beginPath(); c.moveTo(px, Y(m.ceil)); c.lineTo(px + s, Y(m.ceil)); c.moveTo(px, Y(-m.ceil)); c.lineTo(px + s, Y(-m.ceil)); c.stroke(); }
    c.fillStyle = th.orange; c.beginPath(); c.arc(X(a), Y(m.f(a)), 3, 0, TAU); c.fill();
    txt(c, px + 3, py + 9, "Out", { color: th.dispText, size: 8.5, align: "left" });
    txt(c, px + s - 3, py + s / 2 - 3, "In", { color: th.dispText, size: 8.5, align: "right" });
    hint(x, y, w, h - foot, "Transfer Curve", "Shows the output level (up) for each input level (right). A straight diagonal means no change. Measured from the input and output samples.");
    if (right) hint(x + w - 52, y + 2, 48, 12, "Level Change", "Output peak minus input peak, in dB. Above zero means louder, below zero means quieter.");
    hint(X(-a), py, Math.max(2, X(a) - X(-a)), s, "Input Range", "The blue band covers the input levels in use right now. It widens when the input gets louder.");
    if (m.ceil) { hint(px, Y(m.ceil) - 3, s, 6, "Ceiling Line", "The level where the effect stops the signal. Estimated from the top of the measured curve."); hint(px, Y(-m.ceil) - 3, s, 6, "Ceiling Line", "The level where the effect stops the signal. Estimated from the top of the measured curve."); }
    hint(X(a) - 5, Y(m.f(a)) - 5, 10, 10, "Input Peak Dot", "Marks the current input peak on the curve. Its height is the output level for that peak.");
  }
  function scopeExtras(c, th, x, y, w, h, m, title, right, px, pw, py, ph, mid, amp, zt) {
    hdrLegend(c, th, x, y, w, title, [zt, right].filter(Boolean).join("   "), [
      [SCG(), "Input", "The grey line is the signal going into the effect."],
      [th.cyan, "Output", "The cyan line is the signal coming out of the effect."],
      [th.orange, "Change", "The orange fill is the difference between input and output. Orange dots mark samples cut at the ceiling."]], { line: true });
    hint(x, y, w, h, "Waveform Display", "Shows a few milliseconds of the audio as it moves in time, input against output. Measured from the input and output samples.");
    if (right) hint(x + w - 100, y + 2, 96, 12, "Ceiling Readout", "The level where the effect cuts the peaks, in dB. Shows none when the signal has not reached a ceiling.");
    if (m.ceil) for (const s of [-1, 1]) hint(px, mid - s * m.ceil * amp - 3, pw, 6, "Ceiling Line", "The level where the effect cuts the peaks. Estimated from the measured curve.");
  }
  // zoomed oscilloscope: input (grey), output (cyan), difference filled orange
  function scopePanel(c, th, x, y, w, h, m, title, right, foot = 0) {
    if (m.live) return scopeLive(c, th, x, y, w, h, m, title, right, foot);
    const px = x + 4, pw = w - 8, py = y + SH + 3, ph = h - SH - 7 - foot, mid = py + ph / 2;
    const ph0 = m.st.t * 0.35, n = Math.max(8, Math.floor(pw / 2));
    const xi = [], yo = [];
    for (let i = 0; i <= n; i++) { const v = sigAt(ph0 + i / n * 2, m.st.aV); xi.push(v); yo.push(m.f(v)); }
    let pk = 0; for (let i = 0; i <= n; i++) pk = Math.max(pk, Math.abs(xi[i]), Math.abs(yo[i]));
    const g = fit(m.st, "scope", pk), amp = ph / 2 * g, zt = zoomText(g);   // loudest point fills ~90 % (RUBRIC 2.6)
    box(c, th, x, y, w, h, "", right, zt);
    c.save(); c.beginPath(); c.rect(px, py, pw, ph); c.clip();
    c.fillStyle = th.dline; c.fillRect(px, mid, pw, 1);
    if (m.ceil) { c.fillRect(px, mid - m.ceil * amp, pw, 1); c.fillRect(px, mid + m.ceil * amp, pw, 1); }
    c.fillStyle = th.orange + "55"; c.beginPath();
    for (let i = 0; i <= n; i++) { const X = px + i / n * pw; i ? c.lineTo(X, mid - yo[i] * amp) : c.moveTo(X, mid - yo[i] * amp); }
    for (let i = n; i >= 0; i--) c.lineTo(px + i / n * pw, mid - xi[i] * amp);
    c.fill();
    c.strokeStyle = S.theme === "light" ? "#9a9a9a" : "#6a6a6a"; c.lineWidth = 1; c.beginPath();
    xi.forEach((v, i) => { const X = px + i / n * pw; i ? c.lineTo(X, mid - v * amp) : c.moveTo(X, mid - v * amp); }); c.stroke();
    c.strokeStyle = th.cyan; c.lineWidth = 1.5; c.beginPath();
    yo.forEach((v, i) => { const X = px + i / n * pw; i ? c.lineTo(X, mid - v * amp) : c.moveTo(X, mid - v * amp); }); c.stroke();
    if (m.ceil) { c.fillStyle = th.orange; yo.forEach((v, i) => { if (Math.abs(v) >= m.ceil - 1e-6) c.fillRect(px + i / n * pw - 1, mid - v * amp - 1, 2, 2); }); }
    c.restore();
    scopeExtras(c, th, x, y, w, h - foot, m, title, right, px, pw, py, ph, mid, amp, zt);
  }
  // FFT-style harmonic display: input spectrum (grey), output (cyan), content the effect ADDED (orange)
  function specExtras(c, th, x, y, w, h, m, title) {
    const right = `Added ${m.added.toFixed(1)} %`;
    hdrLegend(c, th, x, y, w, title, right, [
      [GREY(), "Input", "Grey bars show the level of the input in each frequency band."],
      [th.cyan, "Output", "Cyan bars show the level of the output in each frequency band."],
      [th.orange, "Added", "Orange marks content the effect created: bands where the output is louder than the input."]]);
    hint(x, y, w, h, "Spectrum Display", "Shows how loud each frequency band is, low pitch on the left and high pitch on the right. Measured from the input and output, in dB.");
    hint(x + w - 84, y + 2, 80, 12, "Added Readout", "How much of the output power is new content, not in the input. Higher means a stronger effect on the tone.");
    hint(x, y + 16, 22, h - 30, "Level Scale", "Level in dB. 0 dB is the top and is the loudest.");
    hint(x + 22, y + h - 11, w - 28, 11, "Frequency Scale", "Frequency in Hz. Low pitch is on the left, high pitch on the right.");
  }
  function specPanel(c, th, x, y, w, h, m, title, foot = 0) {
    if (m.live) return specLive(c, th, x, y, w, h, m, title, foot);
    box(c, th, x, y, w, h, "");
    const px = x + 22, pw = w - 28, py = y + SH + 3, ph = h - SH - 16 - foot, K = 24, N = 64;
    const inS = [], outS = [];
    for (let i = 0; i < N; i++) { const v = sigAt(i / N, m.st.aV); inS.push(v); outS.push(m.f(v)); }
    const mag = (arr, k) => { let re = 0, im = 0; for (let i = 0; i < N; i++) { re += arr[i] * Math.cos(TAU * k * i / N); im -= arr[i] * Math.sin(TAU * k * i / N); } return Math.hypot(re, im) * 2 / N; };
    const lx = k => Math.log(k) / Math.log(K), yy = d => py + ph * clamp(-d / 72, 0, 1);
    [0, -24, -48, -72].forEach(g => { c.fillStyle = th.dline; c.fillRect(px, yy(g), pw, 1); txt(c, x + 18, yy(g) + 3, String(g), { color: th.scale, size: 8, align: "right" }); });
    let added = 0, fund = 0;
    for (let k = 1; k <= K; k++) {
      const mi = mag(inS, k), mo = mag(outS, k), di = db(mi), dout = db(mo + 1e-4);
      const x0 = px + lx(k - 0.4 < 1 ? 1 : k - 0.4) * pw, x1 = px + lx(k + 0.4) * pw, bw = Math.max(2, x1 - x0 - 1);
      if (k === 1 || k === 3) fund += mi * mi; else added += mo * mo;
      if (di > -70) { c.fillStyle = GREY(); c.fillRect(x0, yy(di), bw, py + ph - yy(di)); }
      c.fillStyle = di < -60 && dout > -70 ? th.orange : th.cyan; c.fillRect(x0 + (bw > 3 ? 1 : 0), yy(dout), Math.max(1.5, bw - 2), py + ph - yy(dout));
    }
    [[1, "110"], [3, "330"], [9, "1k"], [24, "2.6k"]].forEach(([k, s]) => txt(c, px + lx(k) * pw, y + h - 3 - foot, s, { color: th.scale, size: 8, align: k === 24 ? "right" : "center" }));
    m.added = 100 * Math.sqrt(added / Math.max(fund, 1e-6));
    txt(c, x + w - 6, y + 13, `Added ${m.added.toFixed(1)} %`, { color: th.orange, align: "right" });
    specExtras(c, th, x, y, w, h - foot, m, title);
  }
  // scrolling level history: input (grey), output (cyan line), difference between them (orange)
  function histPanel(c, th, x, y, w, h, m, title, right, foot = 0) {
    box(c, th, x, y, w, h, "", right);
    const px = x + 4, pw = w - 8, py = y + SH + 3, ph = h - SH - 7 - foot, hs = m.st.hist, n = Math.min(hs.length, pw);
    const Y = d => py + ph * clamp(-d / 40, 0, 1), top = (e, o) => Y(db((o ? (m.live ? e.o : Math.abs(m.f(e.a))) : e.a) + 0.005));
    c.save(); c.beginPath(); c.rect(px, py, pw, ph); c.clip();
    [-10, -20, -30].forEach(g => { c.fillStyle = th.dline; c.fillRect(px, Y(g), pw, 1); });
    c.fillStyle = GREY(); c.beginPath(); c.moveTo(px + pw, py + ph);
    for (let i = 0; i < n; i++) c.lineTo(px + pw - i, top(hs[hs.length - 1 - i], false)); c.lineTo(px + pw - n, py + ph); c.fill();
    c.fillStyle = th.orange + "88"; c.beginPath();
    for (let i = 0; i < n; i++) { const yy = top(hs[hs.length - 1 - i], true); i ? c.lineTo(px + pw - i, yy) : c.moveTo(px + pw - i, yy); }
    for (let i = n - 1; i >= 0; i--) c.lineTo(px + pw - i, top(hs[hs.length - 1 - i], false)); c.fill();
    c.strokeStyle = th.cyan; c.lineWidth = 1.5; c.beginPath();
    for (let i = 0; i < n; i++) { const yy = top(hs[hs.length - 1 - i], true); i ? c.lineTo(px + pw - i, yy) : c.moveTo(px + pw - i, yy); } c.stroke();
    c.restore();
    txt(c, px + 2, py + ph - 3, "-40 dB", { color: th.scale, size: 8, align: "left" });
    hdrLegend(c, th, x, y, w, title, right, [
      [GREY(), "Input", "The grey area is the input level over the last moments."],
      [th.cyan, "Output", "The cyan line is the output level over the same time."],
      [th.orange, "Change", "The orange fill is the gap between input and output: the level the effect added or took away."]]);
    hint(x, y, w, h - foot, "Level History", "Shows the level of the sound over the last moments, in dB. New sound enters on the right. Measured from the input and output peaks.");
    hint(px, py + ph - 12, 40, 10, "Floor Label", "The bottom of the display is -40 dB. Faint lines mark -10, -20 and -30 dB.");
  }
  // horizontal gain-change bar: centre = 0 dB, orange right = louder out, left = quieter out
  function diffBar(c, th, x, y, w, m, label) {
    txt(c, x, y + 9, label, { color: th.text, align: "left" });
    const bx = x + 44, bw = w - 44 - 40;
    rr(c, bx, y + 1, bw, 9, 2, th.meterBg);
    const v = clamp(m.diff / 12, -1, 1), cx = bx + bw / 2;
    c.fillStyle = th.orange; c.fillRect(Math.min(cx, cx + v * bw / 2), y + 1, Math.abs(v) * bw / 2, 9);
    c.fillStyle = th.text; c.fillRect(cx, y, 1, 11);
    txt(c, x + w, y + 9, `${m.diff >= 0 ? "+" : ""}${m.diff.toFixed(1)}`, { color: th.text, align: "right" });
    hint(x, y, w, 12, "Gain Change Bar", "How much louder or quieter the output is than the input, in dB. The orange bar grows right for louder and left for quieter. Full scale is 12 dB.");
  }
  const M = (c, th, x, y, w, name) => { menu(c, th, x, y, w, name); arrows(c, th, x + w + 4, y); };
  const GX = W => W - GAIN_W - 4;

  const ceilOf = d => 0.85 - 0.7 * d;
  const shape = (x, d) => clamp(x * (1 + 1.5 * d), -ceilOf(d), ceilOf(d));
  // ---- real measurements (airwin~ frames, about 30 per second): live(st, m, dt) fills what draw() reads
  const LIVE_CEIL = true;   // only the clipping designs derive a ceiling line from the measured curve
  const fin = (v, d) => (Number.isFinite(v) ? v : d);
  const lin = v => Math.pow(10, v / 20);
  function livePts(st) {   // measured transfer curve: bin centre -> held mean output (bins with no data are skipped)
    const out = [];
    (st.xb || []).forEach((y, i) => { if (Number.isFinite(y)) out.push([-1 + (i + 0.5) / 16, y]); });
    return out;
  }
  function liveCurve(st) {
    const pts = livePts(st);
    return x => {
      if (!pts.length) return x;
      if (x <= pts[0][0]) return pts[0][1];
      for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const a = pts[i - 1], b = pts[i]; return a[1] + (b[1] - a[1]) * (x - a[0]) / Math.max(1e-9, b[0] - a[0]); }
      return pts[pts.length - 1][1];
    };
  }
  function live(st, m, dt) {
    st.isLive = true;
    const pk = (a, d) => Math.max(fin(a && a[0], d), fin(a && a[1], d));
    const inP = pk(m.inPkDb, -120), outP = pk(m.outPkDb, -120);
    // peak meters: fast attack, 24 dB/s release
    st.inL = Math.max(inP, Math.max(-120, fin(st.inL, -120) - 24 * dt));
    st.outL = Math.max(outP, Math.max(-120, fin(st.outL, -120) - 24 * dt));
    st.aPk = lin(st.inL); st.aV = Math.min(0.95, st.aPk);
    // level change: how far the output peak sits below the input peak (0 when the effect adds level)
    const grNow = inP > -100 ? Math.max(0, inP - outP) : 0;
    st.gr = Math.max(grNow, Math.max(0, fin(st.gr, 0) - 24 * dt));
    st.hist = st.hist || [];
    st.hist.push({ a: fin(m.inPk, 0), o: fin(m.outPk, 0) }); if (st.hist.length > 700) st.hist.shift();
    // transfer curve: mean output per input-amplitude bin, kept per bin once seen, smoothed
    const xf = m.xfer || [];
    st.xb = st.xb || new Array(32).fill(NaN);
    for (let i = 0; i < 32; i++) { const v = xf[i]; if (Number.isFinite(v) && v > -8) st.xb[i] = Number.isFinite(st.xb[i]) ? st.xb[i] + (v - st.xb[i]) * 0.3 : v; }
    // ceiling: only when the top of the measured curve is clearly below the identity line
    const pts = livePts(st);
    let cl = null;
    if (LIVE_CEIL && pts.length >= 6) {
      const mx = Math.max(...pts.map(p => Math.abs(p[0]))), cmax = Math.max(...pts.map(p => Math.abs(p[1])));
      if (mx >= 0.25 && cmax < 0.85 * mx) cl = cmax;
    }
    st.ceil = cl === null ? null : (st.ceil == null ? cl : st.ceil + (cl - st.ceil) * 0.3);
    // scopes (left channel, about 5 ms), with an automatic zoom so quiet material stays readable
    const sI = Array.from(m.inScopeL || []).map(v => fin(v, 0)), sO = Array.from(m.scopeL || []).map(v => fin(v, 0));
    const n = Math.min(sI.length, sO.length);
    st.scIn = sI.slice(0, n); st.scOut = sO.slice(0, n);
    let sp = 0; for (let i = 0; i < n; i++) sp = Math.max(sp, Math.abs(sI[i]), Math.abs(sO[i]));
    st.sPk = Math.max(sp, fin(st.sPk, 0) * Math.pow(10, -12 * dt / 20));
    st.sg = clamp(0.9 / Math.max(st.sPk, 1e-4), 1, 16);
    // share of samples the effect cut (output smaller than input; at the ceiling when one is known), lamp holds ~1 s
    let cut = 0, tot = 0;
    for (const [a, b] of [[m.inScopeL, m.scopeL], [m.inScopeR, m.scopeR]]) {
      const k = Math.min((a || []).length, (b || []).length);
      for (let i = 0; i < k; i++) {
        const xi = Math.abs(fin(a[i], 0)), yo = Math.abs(fin(b[i], 0));
        if (xi > 0.02 && yo < xi * 0.95 && (st.ceil == null || yo >= 0.9 * st.ceil)) cut++;
        tot++;
      }
    }
    st.clipP = Math.max(tot ? 100 * cut / tot : 0, fin(st.clipP, 0) - 100 * dt);
    // 48-band spectra: held bars, and what the effect added (output above input), held the same way
    const sIn = m.specIn || [], sOut = m.specOut || [];
    if (sIn.length >= 48 && sOut.length >= 48) {
      st.bIn = st.bIn || new Array(48).fill(-120); st.bOut = st.bOut || new Array(48).fill(-120); st.bAdd = st.bAdd || new Array(48).fill(0);
      let pExc = 0, pOut = 1e-12;
      for (let i = 0; i < 48; i++) {
        const si = fin(sIn[i], -120), so = fin(sOut[i], -120);
        st.bIn[i] = Math.max(si, st.bIn[i] - 24 * dt); st.bOut[i] = Math.max(so, st.bOut[i] - 24 * dt);
        const add = so > -100 ? Math.max(0, so - Math.max(si, -100)) : 0;
        st.bAdd[i] = Math.max(add, st.bAdd[i] - 24 * dt);
        pOut += Math.pow(10, so / 10); pExc += Math.max(0, Math.pow(10, so / 10) - Math.pow(10, si / 10));
      }
      st.addPct = fin(st.addPct, 0) + (100 * Math.sqrt(pExc / pOut) - fin(st.addPct, 0)) * 0.3;
    }
  }
  const simCurve = f => { const o = []; for (let i = 0; i <= 48; i++) { const v = -1.1 + i / 48 * 2.2; o.push([v, f(v)]); } return o; };
  const hzFrac = hz => Math.log(hz / 20) / Math.log(1000);
  // live scope: measured input (grey) and output (cyan) samples, orange = difference, zoomed automatically
  function scopeLive(c, th, x, y, w, h, m, title, right, foot = 0) {
    const st = m.st, xi = st.scIn || [], yo = st.scOut || [], n = Math.min(xi.length, yo.length) - 1;
    const px = x + 4, pw = w - 8, py = y + SH + 3, ph = h - SH - 7 - foot, mid = py + ph / 2;
    let pk = 0; for (let i = 0; i <= n; i++) pk = Math.max(pk, Math.abs(xi[i]), Math.abs(yo[i]));
    const g = fit(st, "scope", pk), amp = ph / 2 * g, zt = zoomText(g);   // one zoom for input and output (RUBRIC 2.6)
    box(c, th, x, y, w, h, "", right, zt);
    c.save(); c.beginPath(); c.rect(px, py, pw, ph); c.clip();
    c.fillStyle = th.dline; c.fillRect(px, mid, pw, 1);
    if (m.ceil) { c.fillRect(px, mid - m.ceil * amp, pw, 1); c.fillRect(px, mid + m.ceil * amp, pw, 1); }
    if (n >= 1) {
      const X = i => px + i / n * pw, Y = v => clamp(mid - v * amp, py - 2, py + ph + 2);
      c.fillStyle = th.orange + "55"; c.beginPath();
      for (let i = 0; i <= n; i++) i ? c.lineTo(X(i), Y(yo[i])) : c.moveTo(X(i), Y(yo[i]));
      for (let i = n; i >= 0; i--) c.lineTo(X(i), Y(xi[i]));
      c.fill();
      c.strokeStyle = S.theme === "light" ? "#9a9a9a" : "#6a6a6a"; c.lineWidth = 1; c.beginPath();
      xi.forEach((v, i) => { i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v)); }); c.stroke();
      c.strokeStyle = th.cyan; c.lineWidth = 1.5; c.beginPath();
      yo.forEach((v, i) => { i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v)); }); c.stroke();
      if (m.ceil) { c.fillStyle = th.orange; yo.forEach((v, i) => { if (Math.abs(v) >= m.ceil * 0.97 && Math.abs(xi[i]) > Math.abs(v) * 1.05) c.fillRect(X(i) - 1, Y(v) - 1, 2, 2); }); }
    }
    c.restore();
    scopeExtras(c, th, x, y, w, h - foot, m, title, right, px, pw, py, ph, mid, amp, zt);
  }
  // live spectrum: 48 bands, grey = input, cyan = output, orange = output above input (added by the effect)
  function specLive(c, th, x, y, w, h, m, title, foot = 0) {
    box(c, th, x, y, w, h, "");
    const st = m.st, px = x + 22, pw = w - 28, py = y + SH + 3, ph = h - SH - 16 - foot, N = 48;
    const yy = d => py + ph * clamp(-d / 96, 0, 1);
    [0, -24, -48, -72, -96].forEach(gd => { c.fillStyle = th.dline; c.fillRect(px, yy(gd), pw, 1); txt(c, x + 18, yy(gd) + 3, String(gd), { color: th.scale, size: 8, align: "right" }); });
    if (st.bIn && st.bOut) {
      const bw = Math.max(1.5, pw / N - 1);
      for (let i = 0; i < N; i++) {
        const x0 = px + i / N * pw, di = st.bIn[i], dout = st.bOut[i];
        if (di > -95) { c.fillStyle = GREY(); c.fillRect(x0, yy(di), bw, py + ph - yy(di)); }
        if (dout > -95) {
          c.fillStyle = th.cyan; c.fillRect(x0, yy(dout), bw, py + ph - yy(dout));
          if (st.bAdd[i] > 1.5) { c.fillStyle = th.orange; const t = yy(dout), b = yy(Math.max(di, -96)); if (b > t) c.fillRect(x0, t, bw, b - t); }
        }
      }
    }
    [[100, "100"], [1000, "1k"], [10000, "10k"]].forEach(([hz, s]) => txt(c, px + hzFrac(hz) * pw, y + h - 3 - foot, s, { color: th.scale, size: 8, align: "center" }));
    m.added = fin(st.addPct, 0);
    txt(c, x + w - 6, y + 13, `Added ${m.added.toFixed(1)} %`, { color: th.orange, align: "right" });
    specExtras(c, th, x, y, w, h - foot, m, title);
  }
  const NAME = "ADClip9", Y0 = HEAD_H;
  const T0 = Y0 + 4, TH = DEVICE_H - 8;   // tiles start 4 px from the top and bottom (RUBRIC 1.4)
  const lamp = (c, th, x, y, w, m) => {
    toggle(c, th, x, y, w, `Clip ${m.clipPct.toFixed(0)}%`, m.clipPct > 0);
    hint(x, y, w + 1, 15, "Clip Lamp", "Lights when the effect is cutting peaks. The number is the share of recent samples that were cut. It holds for about one second.");
  };
  // Limiter-style meters from lib.js plus a colour key and hints
  const limMeters = (c, th, x, y, w, h, m) => {
    limiterMeters(c, th, x, y, w, h, { inL: m.inL, gr: m.gr });
    legend(c, th, x + (w - 50) / 2, y + h - 5, [[th.green, "In", "The green meter shows the input level. It is held and falls slowly."], [th.orange, "GR", "The orange meter shows the peak reduction: how many dB the effect takes off the top. It grows downward from the top."]]);
    hint(x, y, w, h, "Limiter Meters", "Left: input level. Right: peak reduction, the dB the effect takes off the loudest peaks. Measured from the input and output peaks.");
    hint(x + 10, y + 18, 24, h - 34, "Input Meter", "Input level on a dB scale, 0 dB at the top. Held and falling slowly.");
    hint(x + w - 34, y + 18, 24, h - 34, "Peak Reduction Meter", "How far the effect turns the peaks down, in dB, from the top. Measured as input peak minus output peak.");
    hint(x + 10, y + h - 17, 36, 12, "Input Readout", "Input peak level in dB.");
    hint(x + w - 46, y + h - 17, 36, 12, "Reduction Readout", "Peak reduction in dB. Zero means the effect did not cut the peaks.");
    strip(c, th, x, y + h - 15, w, 15, true);
  };
  const clipBar = (c, th, x, y, w, m) => {
    txt(c, x, y + 9, "Clipped", { color: th.text, align: "left" });
    rr(c, x + 44, y + 1, w - 44 - 34, 9, 2, th.meterBg);
    c.fillStyle = th.orange; c.fillRect(x + 44, y + 1, (w - 78) * m.clipPct / 100, 9);
    txt(c, x + w, y + 9, `${m.clipPct.toFixed(0)}%`, { color: th.text, align: "right" });
    hint(x, y, w, 12, "Clipped Share Bar", "The share of recent samples the effect cut, in percent. The orange bar grows to the right as more samples are cut.");
  };
  DESIGNS["Clipping"] = {
    effect: "ADClip9",
    refs: [["LimiterL12.png", "Limiter"], ["CompressorTransferCurveL12.png", "Compressor curve"], ["SaturatorL12.png", "Saturator"]],
    lead: "Visual cue: where the peaks are being cut — clipped peaks marked on the waveform, and the share of the signal that is clipped, measured live. Every option has the Input / Output gain strip on the right.",
    options: [
      { id: "A", name: "Limiter", short: "Limiter", width: 548, step, live,
        why: "Tall level meters in the middle: input on the left, peak reduction on the right, dials at both sides — like Limiter.",
        bullets: ["Input meter = held input peak; orange bars = max(0, input peak - output peak), the real peak reduction","Clip lamp = share of the 128 scope samples where the output is lower than the input (and at the ceiling when one is known), held 1 s","Ceiling is taken from the measured curve (m.xfer) only when its top is clearly flat"],
        draw(c, th, st, ps, vals) {
          const m = model(st, vals), half = Math.ceil(ps.length / 2), hasR = ps.length > half, dw = 128;
          tile(c, th, 4, T0, dw, TH);   // selector + left dials
          M(c, th, 8, T0 + 4, 86, NAME); lamp(c, th, 8, T0 + 23, 80, m);
          divider(c, th, 8, T0 + 41, 0, true, dw - 8);
          dials(c, th, ps.slice(0, half), { x: 6, y: T0 + 44, w: dw - 4, h: TH - 46 }, 2, vals, 60);
          const mx = 4 + dw + 2, mr = hasR ? GX(548) - 2 - dw - 2 : GX(548) - 2;
          limMeters(c, th, mx, T0, mr - mx, TH, m);
          if (hasR) {
            tile(c, th, GX(548) - 2 - dw, T0, dw, TH);   // right dials
            dials(c, th, ps.slice(half), { x: GX(548) - 2 - dw + 2, y: T0 + 2, w: dw - 4, h: TH - 4 }, 2, vals, 60);
          }
          gainStrip(c, th, GX(548), st);
        } },
      { id: "B", name: "Scope", short: "Scope", width: 608, step, live,
        why: "A wide waveform display with the ceiling drawn as lines and clipped peaks marked, dials in a row under it.",
        bullets: ["Waveform = measured input / output samples, orange = removed part, dots = samples where output is cut below input at the ceiling","Ceiling line = top of the measured transfer curve (m.xfer), shown only when the curve is clearly flattened ('Ceiling: none' otherwise); clip lamp % as in A","Not derivable: a true ceiling when the signal never reaches it — then none is shown"],
        draw(c, th, st, ps, vals) {
          const m = model(st, vals), cw = GX(608) - 6, sh = 101, ty = T0 + sh + 2;
          scopePanel(c, th, 4, T0, cw, sh, m, "Waveform", (m.ceil ? `Ceiling ${db(m.ceil).toFixed(1)} dB` : "Ceiling: none"), 21);
          footer(c, th, 4, T0, cw, sh, 21, m);
          lamp(c, th, 4 + cw - 4 - 88, T0 + sh - 18, 88, m);
          tile(c, th, 4, ty, cw, TH - sh - 2);   // selector + dials
          M(c, th, 8, ty + 4, 104, NAME);
          wrapText(c, 8, ty + 31, 138, S.effWhat, { color: th.dim, maxLines: 3, size: 9, lh: 11 });
          divider(c, th, 150, ty + 6, 46);
          dials(c, th, ps, { x: 154, y: ty + 2, w: cw - 154, h: 54 }, ps.length || 1, vals, Math.min(64, (cw - 154) / Math.max(1, ps.length)));
          gainStrip(c, th, GX(608), st);
        } },
      { id: "C", name: "Curve", short: "Curve", width: 568, step, live,
        why: "The hard-knee curve and a level history side by side, with a clipped-share bar — like Compressor's curve view.",
        bullets: ["Curve = held mean output per input bin (m.xfer); flat top = clipping; orange lines = ceiling when found","Level history = m.inPk (grey) / m.outPk (cyan), orange = removed level","Bars: gain change (held peak out - in) and share of samples cut"],
        draw(c, th, st, ps, vals) {
          const m = model(st, vals), tw = 164, tx = GX(568) - 2 - tw, lw = tx - 6, bh = 38, sh = TH - bh - 2;
          transferPanel(c, th, 4, T0, 150, sh, m, "Curve");
          histPanel(c, th, 156, T0, lw - 152, sh, m, "Level", undefined, 15);
          footer(c, th, 156, T0, lw - 152, sh, 15, m);
          tile(c, th, 4, T0 + sh + 2, lw, bh);   // gain change and clipped share
          diffBar(c, th, 8, T0 + sh + 8, lw - 8, m, "Gain Δ"); clipBar(c, th, 8, T0 + sh + 22, lw - 8, m);
          tile(c, th, tx, T0, tw, TH);   // selector + dials
          M(c, th, tx + 4, T0 + 4, 100, NAME);
          dials(c, th, ps, { x: tx + 2, y: T0 + 23, w: tw - 4, h: TH - 25 }, 3, vals, 52);
          gainStrip(c, th, GX(568), st);
        } },
    ],
  };
})();
