// Unclassified: design options. All helpers are private to this IIFE.
(() => {
  const NB = 56, FLO = 30, FHI = 20000, TPTS = 220;
  const bandF = b => FLO * Math.pow(FHI / FLO, b / (NB - 1));
  const bell = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));

  // Simulated band spectrum of the drum loop at the input; the output differs by a
  // slowly moving curve (so the measured in-vs-out response is alive). A transfer
  // scatter is measured from the input and output peak level of each moment.
  function step0(st, dt) {
    if (!st.zz) Object.assign(st, { zz: true, n: 0, inS: new Float32Array(NB).fill(-90), outS: new Float32Array(NB).fill(-90), resp: new Float32Array(NB),
      pts: [], bins: new Float32Array(14).fill(NaN), h: [], inDb: -60, outDb: -60, thd: 0, pkI: -60, pkO: -60 });
    const d = drums(st.t);
    for (let b = 0; b < NB; b++) {
      const x = b / (NB - 1);
      const v = -34 - 26 * x + 8 * d.kick * bell(x, 0.12, 0.14) + 14 * d.sn * bell(x, 0.45, 0.2) + 16 * d.hat * bell(x, 0.85, 0.2) + 5 * noise(b * 7.3 + st.n * 0.9);
      const lvl = v + 20 * Math.log10(0.15 + d.env * 0.85);
      st.inS[b] = Math.max(lvl, st.inS[b] - 40 * dt);
      const c1 = 0.3 + 0.25 * Math.sin(st.t * 0.5), c2 = 0.7 + 0.15 * Math.sin(st.t * 0.37 + 1);
      const r = 9 * bell(x, c1, 0.1) - 7 * bell(x, c2, 0.08) + 3 * (1 - x) * Math.sin(st.t * 0.23) - 4 * Math.max(0, 0.12 - x) / 0.12;
      st.resp[b] += (r - st.resp[b]) * 0.2;
      st.outS[b] = Math.max(lvl + st.resp[b], st.outS[b] - 40 * dt);
    }
    // transfer curve: soft compression above -20 dB and tanh-like saturation near 0
    const inDb = db(d.env * 0.95 * (0.7 + 0.3 * Math.abs(noise(st.n * 0.77))) + 0.002);
    const sat = 0.5 + 0.5 * Math.sin(st.t * 0.31);
    const outDb = inDb - Math.max(0, inDb + 20) * (0.3 + 0.3 * sat) + 4 * (1 - sat) - 6 * Math.max(0, inDb + 4) * 0.3 * sat;
    st.inDb = inDb; st.outDb = outDb;
    st.pkI = Math.max(inDb, st.pkI - 24 * dt); st.pkO = Math.max(outDb, st.pkO - 24 * dt);
    st.pts.push([inDb, outDb]); if (st.pts.length > TPTS) st.pts.shift();
    st.bins.fill(NaN); const cnt = new Float32Array(14), sum = new Float32Array(14);
    st.pts.forEach(([a, b]) => { const k = Math.floor(Math.min(0.999, Math.max(0, (a + 56) / 56)) * 14); sum[k] += b; cnt[k]++; });
    for (let k = 0; k < 14; k++) if (cnt[k]) st.bins[k] = sum[k] / cnt[k];
    st.thd += ((Math.abs(outDb - inDb - (4 * (1 - sat))) / 14) - st.thd) * 0.1;
    st.h.push({ i: inDb, o: outDb }); if (st.h.length > 500) st.h.shift();
    st.n++;
  }

  // ---------- live(): measurements from airwin~ (about 30 per second)
  // Fills: inS/outS (48-band spectra, held), resp (specOut - specIn, held where specIn < -80 dB), chg (largest |resp|),
  // xf (32 held transfer bins), h (level history), inDb/outDb, inL/outL, bf (band centre function), flo/fhi, slo/ssp.
  const fin = (v, d) => (Number.isFinite(v) ? v : d);
  const hold = (prev, v, rate, dt) => Math.max(fin(v, -120), fin(prev, -120) - rate * dt);
  function live(st, m, dt) {
    const NR = 48;
    if (!st.lz) Object.assign(st, { lz: true, real: true, inS: new Float32Array(NR).fill(-120), outS: new Float32Array(NR).fill(-120), resp: new Float32Array(NR),
      xf: new Float32Array(32).fill(NaN), h: [], inDb: -120, outDb: -120, chg: 0, bf: bandHz, flo: bandHz(0), fhi: bandHz(NR - 1), slo: -100, ssp: 80, inL: -60, outL: -60 });
    const si = m.specIn || [], so = m.specOut || [];
    for (let b = 0; b < NR; b++) {
      st.inS[b] = hold(st.inS[b], si[b], 40, dt); st.outS[b] = hold(st.outS[b], so[b], 40, dt);
      if (Number.isFinite(si[b]) && Number.isFinite(so[b]) && si[b] > -80) st.resp[b] += (so[b] - si[b] - st.resp[b]) * 0.3;
    }
    st.chg = 0; for (let b = 0; b < NR; b++) st.chg = Math.max(st.chg, Math.abs(st.resp[b]));
    const xf = m.xfer || [];
    for (let k = 0; k < 32; k++) if (Number.isFinite(xf[k]) && xf[k] > -8) st.xf[k] = Number.isNaN(st.xf[k]) ? xf[k] : st.xf[k] + (xf[k] - st.xf[k]) * 0.3;
    const inPk = Math.max(fin(m.inPkDb[0], -120), fin(m.inPkDb[1], -120)), outPk = Math.max(fin(m.outPkDb[0], -120), fin(m.outPkDb[1], -120));
    st.inL = Math.max(inPk, fin(st.inL, -60) - 24 * dt); st.outL = Math.max(outPk, fin(st.outL, -60) - 24 * dt);
    st.inDb = st.inL; st.outDb = st.outL;
    st.h.push({ i: st.inL, o: st.outL }); if (st.h.length > 500) st.h.shift();
  }
  const xfDev = (st, lo, hi) => { let s = 0, n = 0; for (let k = 0; k < 32; k++) { const x = -1 + (k + 0.5) / 16;
    if (!Number.isNaN(st.xf[k]) && Math.abs(x) >= lo && Math.abs(x) < hi) { s += Math.abs(st.xf[k] - x); n++; } } return n ? s / n : 0; };

  // the shared gain strip (its meters explain themselves on hover)
  function gs(c, th, x, st) { gainStrip(c, th, x, st); }
  function step(st, dt) {
    if (!st.pre) { st.pre = true; for (let i = 0; i < 520; i++) { st.t += 0.016; step0(st, 0.016); } }
    step0(st, dt);
    st.inL = Math.max(st.inDb, st.inL - 24 * dt); st.outL = Math.max(st.outDb, st.outL - 24 * dt);
  }

  function dials(c, th, ps, vals, W) {
    const n = ps.length;
    if (!n) { rr(c, W - 92, HEAD_H + 4, 88, DEVICE_H - 8, 3, th.panel); txt(c, W - 48, HEAD_H + 88, "No controls", { color: th.dim });
      return 96; }
    const rows = n <= 5 ? 1 : 2, cols = Math.ceil(n / rows), cw = n > 10 ? 51 : 52, w = cols * cw;
    knobGrid(c, th, ps, { x: W - w - 4, y: HEAD_H + 4, w, h: DEVICE_H - 8 }, cols, vals, cw);
    return w + 8;
  }
  function panel(c, th, w, readouts, dTitle, dText) {
    const x = 4, y = HEAD_H + 4, h = DEVICE_H - 8;
    rr(c, x, y, w, h, 3, th.display);
    menu(c, th, x + 4, y + 3, 104, "CStrip"); arrows(c, th, x + 112, y + 3);
    c.fillStyle = th.dline; c.fillRect(x, y + 21, w, 1);
    let rx = x + w - 6;
    hint(x, y, w, h, dTitle || "Display", dText || "Shows what the effect does to the sound, measured by comparing the input and the output.");
    readouts.slice().reverse().forEach(r => {
      const r0 = rx;
      txt(c, rx, y + 14, r[1], { color: r[2], align: "right" }); rx -= r[1].length * 5.6 + 6;
      txt(c, rx, y + 14, r[0], { color: th.dispText, align: "right" }); rx -= r[0].length * 5.6 + 12;
      hint(rx + 8, y + 3, r0 - rx, 15, r[3] || r[0], r[4] || "");
    });
    return { x, y, w, h, px: x + 6, py: y + 26, pw: w - 12, ph: h - 32, lx: x + 146, ly: y + 14 };
  }
  const clipTo = (c, x, y, w, h) => { c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); };
  const sgn = (v, p = 1) => (v >= 0 ? "+" : "") + v.toFixed(p);
  const fAxis = (c, th, px, py, pw, ph, st) => {
    const lo = (st && st.flo) || FLO, hi = (st && st.fhi) || FHI;
    [[100, "100"], [1000, "1k"], [10000, "10k"]].forEach(([f, s]) => {
      const x = px + pw * Math.log(f / lo) / Math.log(hi / lo);
      c.fillStyle = th.dline; c.fillRect(x, py, 1, ph - 10); txt(c, x, py + ph - 1, s, { color: th.scale, size: 8.5 }); });
  };
  // legend row at the top of the display; returns the display area below it
  const lgRow = (c, th, P0, items, o) => { legend(c, th, P0.px + 1, P0.py + 8, items, o); return Object.assign({}, P0, { py: P0.py + 12, ph: P0.ph - 12 }); };
  const fx = (px, pw, b, n) => px + pw * b / ((n || NB) - 1);

  // ---------- A: spectrum in vs out
  function drawA(c, th, st, ps, vals) {
    const W = 632, dw = dials(c, th, ps, vals, W);
    gs(c, th, W, st);
    const P = panel(c, th, W - dw - 8, [], "Spectrum In / Out", "Loudness at each pitch, low pitches on the left. Compares the input and the output of the effect.");
    legend(c, th, P.lx, P.ly, [[S.theme === "light" ? "#5e5e5e" : "#3a3a3a", "In", "Spectrum of the sound going into the effect (grey area)."], [th.cyan, "Out", "Spectrum of the sound coming out of the effect (cyan line)."], [th.orange, "Changed", "The gap between output and input: what the effect changed at each pitch."]]);
    if (!st.inS) return;
    const NN = st.inS.length, slo = st.slo === undefined ? -85 : st.slo, ssp = st.ssp || 65;
    const yOf = d => P.py + (P.ph - 12) * (1 - Math.min(1, Math.max(0, (d - slo) / ssp)));
    clipTo(c, P.px, P.py, P.pw, P.ph);
    fAxis(c, th, P.px, P.py, P.pw, P.ph, st);
    c.fillStyle = S.theme === "light" ? "#5e5e5e" : "#3a3a3a"; c.beginPath(); c.moveTo(P.px, P.py + P.ph - 12);
    for (let b = 0; b < NN; b++) c.lineTo(fx(P.px, P.pw, b, NN), yOf(st.inS[b]));
    c.lineTo(P.px + P.pw, P.py + P.ph - 12); c.fill();
    // difference shading between in and out
    c.globalAlpha = 0.7; c.fillStyle = th.orange; c.beginPath();
    for (let b = 0; b < NN; b++) c.lineTo(fx(P.px, P.pw, b, NN), yOf(st.outS[b]));
    for (let b = NN - 1; b >= 0; b--) c.lineTo(fx(P.px, P.pw, b, NN), yOf(st.inS[b]));
    c.fill(); c.globalAlpha = 1;
    c.strokeStyle = th.cyan; c.lineWidth = 1.5; c.beginPath();
    for (let b = 0; b < NN; b++) b ? c.lineTo(fx(P.px, P.pw, b, NN), yOf(st.outS[b])) : c.moveTo(fx(P.px, P.pw, b, NN), yOf(st.outS[b]));
    c.stroke(); c.restore();
    hint(P.px, P.py, P.pw, P.ph - 10, "Spectrum Plot", "Loudness at each pitch. Grey area is the input, cyan line is the output, orange is the difference. Measured from the input and output audio.");
    hint(P.px, P.py + P.ph - 10, P.pw, 10, "Pitch Scale", "Pitch in Hz, on a log scale: each step to the right is a multiple of the last.");
    if (st.real && st.chg < 0.1) txt(c, P.px + 3, P.py + 9, "no change measured", { color: th.orange, size: 8.5, align: "left" });
  }

  // ---------- B: measured transfer curve
  function drawB(c, th, st, ps, vals) {
    const W = 632, dw = dials(c, th, ps, vals, W);
    gs(c, th, W, st);
    const P0 = panel(c, th, W - dw - 8, [["In", `${Math.max(-60, st.inDb || -60).toFixed(0)} dB`, th.cyan, "Input Level", "The peak level going in, in dB. Measured at the input of the device."], ["Out", `${Math.max(-60, st.outDb || -60).toFixed(0)} dB`, th.orange, "Output Level", "The peak level coming out, in dB. Measured at the output of the device."]],
      "Transfer Curve", "Plots output level against input level. A straight diagonal line means the effect changes nothing; a bent line means it compresses or saturates.");
    const P = lgRow(c, th, P0, [[th.cyan, "Samples", "Each cyan dot is one measurement of input against output."], [th.orange, "Curve", "The average output for each input level: the transfer curve the effect has right now."], [th.scale, "No change", "The straight diagonal line: output equals input."]]);
    if (st.real) return drawBReal(c, th, st, P);
    if (!st.pts) return;
    const sz = P.ph - 12, gx = P.px + 20, gy = P.py;
    const X = d => gx + sz * (Math.min(0, Math.max(-56, d)) + 56) / 56, Y = d => gy + sz * (1 - (Math.min(0, Math.max(-56, d)) + 56) / 56);
    c.fillStyle = th.panel; c.fillRect(gx, gy, sz, sz);
    clipTo(c, gx, gy, sz, sz);
    c.strokeStyle = th.dline; c.lineWidth = 1;
    [-48, -36, -24, -12].forEach(d => { c.beginPath(); c.moveTo(X(d), gy); c.lineTo(X(d), gy + sz); c.moveTo(gx, Y(d)); c.lineTo(gx + sz, Y(d)); c.stroke(); });
    c.strokeStyle = th.scale; c.lineWidth = 1; c.beginPath(); c.moveTo(gx, gy + sz); c.lineTo(gx + sz, gy); c.stroke();    // unity line
    c.fillStyle = th.cyan; st.pts.forEach(([a, b], i) => { c.globalAlpha = 0.3 + 0.7 * i / st.pts.length; c.fillRect(X(a) - 1.25, Y(b) - 1.25, 2.5, 2.5); }); c.globalAlpha = 1;
    c.strokeStyle = th.orange; c.lineWidth = 2.5; c.beginPath(); let first = true;
    for (let k = 0; k < 14; k++) if (!Number.isNaN(st.bins[k])) { const a = -56 + (k + 0.5) * 4; first ? c.moveTo(X(a), Y(st.bins[k])) : c.lineTo(X(a), Y(st.bins[k])); first = false; }
    c.stroke(); c.restore();
    c.strokeStyle = th.scale; c.strokeRect(gx + 0.5, gy + 0.5, sz - 1, sz - 1);
    [-48, -24, 0].forEach(d => { txt(c, X(d) + (d === 0 ? -1 : 0), gy + sz + 9, String(d), { color: th.scale, size: 8, align: d === 0 ? "right" : "center" });
      txt(c, gx - 3, Y(d) + (d === 0 ? 7 : 3), String(d), { color: th.scale, size: 8, align: "right" }); });
    txt(c, gx + sz * 0.8, gy + sz + 9, "In dB", { color: th.dispText, size: 8 });
    txt(c, gx - 3, Y(-12) + 3, "Out", { color: th.dispText, size: 8, align: "right" });
    // bars: how much the curve bends away from the straight line
    const x0 = gx + sz + 16, bw = P.x + P.w - x0 - 6;
    txt(c, x0, P.py + 8, "Curve bend", { color: th.dispText, size: 8.5, align: "left" });
    hint(gx, gy, sz, sz, "Transfer Graph", "Input level across, output level up. Points on the diagonal are unchanged; points off it show how the effect bends the level. Measured from the input and output peaks.");
    hint(x0, P.py, bw, P.ph - 4, "Curve Bend Bars", "How far the curve bends away from the straight line, shown for harmonics H2 to H7. Higher bars mean more distortion.");
    hint(gx - 20, gy, 20, sz + 10, "Output Scale", "Output level in dB, from -48 up to 0.");
    hint(gx, gy + sz + 1, sz, 10, "Input Scale", "Input level in dB, from -48 up to 0.");
    const bars = [1, 0.62, 0.38, 0.22, 0.13, 0.08], bh = P.ph - 34;
    bars.forEach((f, i) => { const v = Math.min(1, 0.08 + (st.thd || 0) * 9 * f); const bx = x0 + i * (bw / 6);
      meterV(c, th, bx + 1, P.py + 16, bw / 6 - 4, bh, v, false, th.orange);
      txt(c, bx + 1 + (bw / 6 - 4) / 2, P.py + P.ph - 6, "H" + (i + 2), { color: th.dispText, size: 8.5 }); });
  }

  // B, real: output against input amplitude (-1..1, from m.xfer), straight line = no change
  function drawBReal(c, th, st, P) {
    const sz = P.ph - 12, gx = P.px + 20, gy = P.py;
    const X = v => gx + sz * (Math.max(-1, Math.min(1, v)) + 1) / 2, Y = v => gy + sz * (1 - (Math.max(-1, Math.min(1, v)) + 1) / 2);
    c.fillStyle = th.panel; c.fillRect(gx, gy, sz, sz);
    clipTo(c, gx, gy, sz, sz);
    c.strokeStyle = th.dline; c.lineWidth = 1;
    [-0.5, 0, 0.5].forEach(v => { c.beginPath(); c.moveTo(X(v), gy); c.lineTo(X(v), gy + sz); c.moveTo(gx, Y(v)); c.lineTo(gx + sz, Y(v)); c.stroke(); });
    c.strokeStyle = th.scale; c.beginPath(); c.moveTo(gx, gy + sz); c.lineTo(gx + sz, gy); c.stroke();
    c.fillStyle = th.cyan;
    for (let k = 0; k < 32; k++) if (!Number.isNaN(st.xf[k])) c.fillRect(X(-1 + (k + 0.5) / 16) - 1.25, Y(st.xf[k]) - 1.25, 2.5, 2.5);
    c.strokeStyle = th.orange; c.lineWidth = 2.5; c.beginPath(); let first = true;
    for (let k = 0; k < 32; k++) if (!Number.isNaN(st.xf[k])) { const x = -1 + (k + 0.5) / 16; first ? c.moveTo(X(x), Y(st.xf[k])) : c.lineTo(X(x), Y(st.xf[k])); first = false; }
    c.stroke(); c.restore();
    c.strokeStyle = th.scale; c.strokeRect(gx + 0.5, gy + 0.5, sz - 1, sz - 1);
    [-1, 0, 1].forEach(v => { txt(c, X(v) + (v === 1 ? -1 : v === -1 ? 1 : 0), gy + sz + 9, String(v), { color: th.scale, size: 8, align: v === 1 ? "right" : v === -1 ? "left" : "center" });
      txt(c, gx - 3, Y(v) + (v === 1 ? 7 : 3), String(v), { color: th.scale, size: 8, align: "right" }); });
    txt(c, gx + sz * 0.8, gy + sz + 9, "In (amplitude)", { color: th.dispText, size: 8 });
    txt(c, gx - 3, Y(0.5) + 3, "Out", { color: th.dispText, size: 8, align: "right" });
    const x0 = gx + sz + 16, bw = P.x + P.w - x0 - 6;
    txt(c, x0, P.py + 8, "Curve bend", { color: th.dispText, size: 8.5, align: "left" });
    hint(gx, gy, sz, sz, "Transfer Graph", "Input amplitude across, output amplitude up (-1 to +1). Points on the diagonal are unchanged; points off it show how the effect bends the signal. Measured from the audio in and out.");
    hint(x0, P.py, bw, P.ph - 4, "Curve Bend Bars", "How far the curve is from the straight line, for six input zones (the number is the percent of full scale). Higher bars mean more bend.");
    hint(gx - 20, gy, 20, sz + 10, "Output Scale", "Output amplitude, from -1 to +1.");
    hint(gx, gy + sz + 1, sz, 10, "Input Scale", "Input amplitude, from -1 to +1.");
    const bh = P.ph - 34, edges = [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1.0001];
    for (let i = 0; i < 6; i++) { const dev = xfDev(st, edges[i], edges[i + 1]), v = Math.min(1, dev * 8), bx = x0 + i * (bw / 6);
      meterV(c, th, bx + 1, P.py + 16, bw / 6 - 4, bh, v, false, th.orange);
      txt(c, bx + 1 + (bw / 6 - 4) / 2, P.py + P.ph - 6, String(Math.round(edges[i + 1] * 100)), { color: th.dispText, size: 8.5 }); }
    txt(c, x0 + bw / 2, P.py + 16 + bh / 2, st.chg < 0.1 && xfDev(st, 0, 1.01) < 0.002 ? "straight line: no bend" : "", { color: th.orange, size: 8.5 });
  }

  // ---------- C: measured response + level history
  function drawC(c, th, st, ps, vals) {
    const W = 632, dw = dials(c, th, ps, vals, W);
    gs(c, th, W, st);
    const NN = st.resp ? st.resp.length : NB, bf = st.bf || bandF;
    let peakB = 0; if (st.resp) for (let b = 1; b < NN; b++) if (Math.abs(st.resp[b]) > Math.abs(st.resp[peakB])) peakB = b;
    const P0 = panel(c, th, W - dw - 8, [["Max change", st.resp ? `${sgn(st.resp[peakB])} dB @ ${Math.round(bf(peakB))} Hz` : "", th.orange, "Largest Change", "The biggest boost or cut the effect makes, in dB, and the pitch where it happens. Measured as output spectrum minus input spectrum."]],
      "Measured Response", "Shows how the effect changes each pitch right now: above the centre line it boosts, below it cuts. A level strip below compares input and output over time.");
    const P = lgRow(c, th, P0, [[th.cyan, "Response", "Output spectrum minus input spectrum, per pitch. Above the middle line is a boost, below is a cut."], [th.orange, "Peak or dip", "Dots on the biggest boosts and cuts (more than 3 dB)."], [th.scale, "In level", "Input level over time, grey area in the strip below."], [th.orange, "Out level", "Output level over time, orange line in the strip below."]]);
    if (!st.resp) return;
    const rh = P.ph - 38, mid = P.py + rh / 2, yOf = g => mid - Math.max(-15, Math.min(15, g)) / 15 * (rh / 2 - 2);
    clipTo(c, P.px, P.py, P.pw, rh + 10);
    fAxis(c, th, P.px, P.py, P.pw, rh + 10, st);
    c.strokeStyle = th.dline; c.lineWidth = 1;
    [-10, -5, 5, 10].forEach(g => { c.beginPath(); c.moveTo(P.px, yOf(g)); c.lineTo(P.px + P.pw, yOf(g)); c.stroke(); });
    c.strokeStyle = th.scale; c.beginPath(); c.moveTo(P.px, mid); c.lineTo(P.px + P.pw, mid); c.stroke();
    c.globalAlpha = 0.3; c.fillStyle = th.cyan; c.beginPath(); c.moveTo(P.px, mid);
    for (let b = 0; b < NN; b++) c.lineTo(fx(P.px, P.pw, b, NN), yOf(st.resp[b]));
    c.lineTo(P.px + P.pw, mid); c.fill(); c.globalAlpha = 1;
    c.strokeStyle = th.cyan; c.lineWidth = 2; c.beginPath();
    for (let b = 0; b < NN; b++) b ? c.lineTo(fx(P.px, P.pw, b, NN), yOf(st.resp[b])) : c.moveTo(fx(P.px, P.pw, b, NN), yOf(st.resp[b]));
    c.stroke(); c.restore();
    // handles on the local peaks and dips, like EQ Eight nodes
    for (let b = 2; b < NN - 2; b++) {
      const r = st.resp[b];
      if (Math.abs(r) > 3 && ((r > st.resp[b - 1] && r > st.resp[b + 1]) || (r < st.resp[b - 1] && r < st.resp[b + 1]))) {
        c.beginPath(); c.arc(fx(P.px, P.pw, b, NN), yOf(r), 3, 0, Math.PI * 2); c.fillStyle = th.orange; c.fill(); }
    }
    ["+12", "0", "-12"].forEach((s, i) => txt(c, P.px + 1, yOf(12 - i * 12) - 2 + (i === 2 ? 10 : 0), s, { color: th.scale, size: 8.5, align: "left" }));
    // level history strip
    const sy = P.py + P.ph - 22, sh = 22, f = d => Math.max(0, Math.min(1, 1 + d / 48));
    c.fillStyle = th.dline; c.fillRect(P.px, sy - 3, P.pw, 1);
    clipTo(c, P.px, sy, P.pw, sh);
    const n = Math.min(st.h.length, Math.floor(P.pw));
    c.fillStyle = S.theme === "light" ? "#6a6a6a" : "#4a4a4a"; c.beginPath(); c.moveTo(P.px + P.pw, sy + sh);
    for (let i = 0; i < n; i++) c.lineTo(P.px + P.pw - i, sy + sh * (1 - f(st.h[st.h.length - 1 - i].i)));
    c.lineTo(P.px + P.pw - n, sy + sh); c.fill();
    c.strokeStyle = th.orange; c.lineWidth = 1.5; c.beginPath();
    for (let i = 0; i < n; i++) { const y = sy + sh * (1 - f(st.h[st.h.length - 1 - i].o)); i ? c.lineTo(P.px + P.pw - i, y) : c.moveTo(P.px + P.pw - i, y); }
    c.stroke(); c.restore();
    hint(P.px, P.py, P.pw, rh + 10, "Response Curve", "How much the effect boosts or cuts at each pitch, from -15 to +15 dB. Measured as output spectrum minus input spectrum.");
    hint(P.px, sy - 3, P.pw, sh + 3, "Level Strip", "Input level (grey area) and output level (orange line) over time, newest on the right. Measured from the peak levels.");
    hint(P.px, P.py, 22, rh, "Gain Scale", "Boost or cut in dB. 0 is no change.");
  }

  DESIGNS["Unclassified"] = {
    effect: "CStrip",
    refs: [["EQEightL12.png", "EQ Eight"], ["SaturatorL12.png", "Saturator"], ["CompressorTransferCurveL12.png", "Compressor transfer curve"]],
    lead: "Visual cue: what the device does to the sound, measured by comparing input and output as a spectrum, a level-to-level curve and a frequency response.",
    options: [
      { id: "A", name: "Spectrum in / out", short: "Spectrum", width: 700, step, live,
        why: "Live spectrum analyser with the input in grey, the output in cyan and the change shaded orange, like EQ Eight.",
        bullets: ["FFT spectrum of input and output, 30 Hz to 20 kHz", "Orange area = difference between output and input", "Driven by the audio in and the audio out",
          "Live: grey = specIn, cyan = specOut (48 bands, 22 Hz to 18 kHz, -100..-20 dB, release 40 dB/s); orange shading = out - in"],
        draw: drawA },
      { id: "B", name: "Transfer curve", short: "Curve", width: 700, step, live,
        why: "A measured plot of output level against input level, with scattered live points and a fitted curve, like Compressor's transfer curve and Saturator.",
        bullets: ["Scatter of input peak vs output peak, orange fitted curve", "Bars show how much the curve bends away from the straight line", "Driven by input and output peak levels (the In / Out meters are in the gain strip)",
          "Live: changed to amplitude in (-1..1) vs mean output per bin (m.xfer, linear, not dB), held where a bin has no data; no scatter. Bars = mean |out - in| per input-amplitude zone (curve bend), not harmonic levels"],
        draw: drawB },
      { id: "C", name: "Measured response", short: "Response", width: 700, step, live,
        why: "The frequency response the device has right now (output divided by input), with nodes at peaks and dips, plus a level strip.",
        bullets: ["Response curve = output spectrum minus input spectrum, ±15 dB", "Dots mark the biggest boosts and cuts, readout of the largest", "Level history strip below, in vs out",
          "Live: response = specOut - specIn per band (held where specIn < -80 dB); level strip = held channel peaks"],
        draw: drawC },
    ],
  };
})();
