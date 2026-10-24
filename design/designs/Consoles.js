(function () {
  // ---- local helpers (this file only) ----
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const mean = v => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0.5);
  const lin = d => Math.pow(10, d / 20);
  const sq = x => x * x;
  const l2 = Math.log2;
  const TOP = HEAD_H, BOT = HEAD_H + DEVICE_H;
  const greyFill = () => (S.theme === "light" ? "#5e5e5e" : "#575757");
  const panel = (c, th, x, y, w, h) => rr(c, x, y, w, h, 3, th.display);
  // effect menu + step arrows; the name is shortened to fit the box (menu() in lib.js does not)
  const chrome = (c, th, x, y, mw, label) => {
    let s = S.effName || label; c.font = `400 9.5px ${FONT}`;
    const maxW = mw - 20;
    if (c.measureText(s).width > maxW) { while (s.length > 1 && c.measureText(s + "..").width > maxW) s = s.slice(0, -1); s += ".."; }
    const keep = S.effName; S.effName = s; menu(c, th, x, y, mw, s); S.effName = keep;
    arrows(c, th, x + mw + 4, y);
  };
  const gs = gainStrip;
  // controls split into a left and a right area; 0 controls shows a note
  function place(c, th, ps, vals, L, R) {
    if (!ps.length) {
      txt(c, L.x + L.w / 2, L.y + L.h / 2 - 2, "No controls", { color: th.text, size: 10 });
      txt(c, L.x + L.w / 2, L.y + L.h / 2 + 11, "this effect has no dials", { color: th.dim, size: 8.5 });
      return;
    }
    const half = Math.ceil(ps.length / 2);
    knobGrid(c, th, ps.slice(0, half), L, 2, vals);
    if (ps.length > half) knobGrid(c, th, ps.slice(half), R, 2, vals);
  }
  // test signal: fundamental plus a little 3rd harmonic, peak about a
  const wave = (tau, a) => a * (Math.sin(tau) + 0.25 * Math.sin(3 * tau + 0.6)) / 1.1;
  // input tracking shared by every option
  function base(st, dt) {
    const d = drums(st.t), a = d.env * 0.9 + 0.02;
    if (!st.pre) { st.pre = 1; for (let i = 700; i > 0; i--) st.hist.push({ a: drums(Math.max(0, st.t - i / 120)).env * 0.9 + 0.02 }); }
    st.a = a; st.d = d;
    st.inL = Math.max(db(a), st.inL - 24 * dt);
    st.hist.push({ a }); if (st.hist.length > 700) st.hist.shift();
    return d;
  }
  // input spectrum, 72 log-spaced bins 20 Hz .. 20 kHz, peak-hold with fall
  const NB = 72, fOf = i => 20 * Math.pow(1000, i / (NB - 1));
  const gauss = (f, f0, w) => Math.exp(-sq(l2(f / f0)) / w);
  function specIn(f, d, i, k) {
    const tilt = -22 - 12 * Math.log10(Math.max(f, 20) / 100);
    return Math.max(-84, tilt + 20 * d.kick * gauss(f, 65, 0.7) + 16 * d.sn * gauss(f, 1500, 2)
      + 24 * (d.hat / 0.35) * gauss(f, 9000, 1.5) + 2.5 * noise(i * 7.3 + k) - (f < 40 ? 12 * l2(40 / f) : 0));
  }
  function specStep(st, dt, d) {
    if (!st.spI) st.spI = new Array(NB).fill(-90);
    const k = Math.floor(st.t * 18);
    for (let i = 0; i < NB; i++) st.spI[i] = Math.max(specIn(fOf(i), d, i, k), st.spI[i] - 50 * dt);
  }
  const fx = (f, x, w) => x + w * Math.log10(f / 20) / 3;
  function hzLabels(c, th, x, y, w) {
    [[50, "50"], [100, "100"], [500, "500"], [1000, "1k"], [5000, "5k"], [10000, "10k"]].forEach(([f, s]) =>
      txt(c, fx(f, x, w), y, s, { color: th.scale, size: 8.5 }));
  }
  const vgrid = (c, th, x, y, w, h) => {
    c.strokeStyle = th.dline; c.lineWidth = 1;
    [50, 100, 500, 1000, 5000, 10000].forEach(f => { const xx = Math.round(fx(f, x, w)) + 0.5; c.beginPath(); c.moveTo(xx, y); c.lineTo(xx, y + h); c.stroke(); });
  };
  const sgn = v => (v >= 0 ? "+" : "-") + Math.abs(v).toFixed(1);

  // ---- console model: unity small-signal gain, soft ceiling, slightly narrower image, gentle tilt ----
  const kOf = vals => 1 + 2 * mean(vals);
  const csat = (x, k) => x / Math.sqrt(1 + 0.5 * (k - 1) * x * x);
  const wOf = vals => 1 - 0.3 * mean(vals);
  const cresp = (f, m) => 3 * m * (1.5 / (1 + sq(f / 150)) - 1.0 * gauss(f, 2500, 1.2) + 2 / (1 + sq(6000 / f)));
  const NAME = "ConsoleMCChannel";
  const init = (st, k) => { st.k = k; if (st.pkO === undefined) { st.pkO = -60; st.hO = -60; st.hT = 0; st.hI = -60; st.hTI = 0; st.rms = 0; st.side = 0.2; st.bal = 0; } };
  function stepC(st, dt) {
    init(st, st.k || 2);
    const d = base(st, dt); specStep(st, dt, d);
    st.side = clamp(0.12 + 0.28 * d.hat / 0.35 + 0.22 * d.sn + 0.1 * Math.sin(st.t * 0.7), 0.03, 0.9);
    st.bal = 0.12 * Math.sin(st.t * 0.4);
    st.rms += (st.a * 0.7 - st.rms) * Math.min(1, dt * 6);
    const o = db(csat(st.a, st.k));
    st.pkO = Math.max(o, st.pkO - 24 * dt); st.outL = Math.max(o, st.outL - 24 * dt);
    if (o >= st.hO) { st.hO = o; st.hT = st.t; } else if (st.t - st.hT > 1.2) st.hO = Math.max(o, st.hO - 30 * dt);
    if (st.inL >= st.hI) { st.hI = st.inL; st.hTI = st.t; } else if (st.t - st.hTI > 1.2) st.hI = Math.max(st.inL, st.hI - 30 * dt);
  }
  const hbar = (c, th, x, y, w, h, v, col) => { c.fillStyle = th.meterBg; c.fillRect(x, y, w, h); c.fillStyle = col; c.fillRect(x, y, w * clamp(v, 0, 1), h); };

  DESIGNS["Consoles"] = {
    effect: NAME,
    refs: [["UtilityL12.png", "Utility"], ["LimiterL12.png", "Limiter (meters)"], ["ChannelEQL12.png", "Channel EQ"]],
    lead: "Visual cue: what the console stage does to the signal between its input and output: stereo image, level, or tone per band.",
    options: [
      { id: "A", name: "Stereo image", width: 592, step: stepC,
        why: "Vectorscope with correlation, mid and side levels and a width readout, like Utility's stereo tools.",
        bullets: ["Vectorscope: grey = input, cyan = output (left/right samples plotted on a diamond)",
          "Correlation bar -1 to +1, mid and side level bars, width % (side vs mid)",
          "Driven by the audio: left/right output samples, so any console shows its own width change"],
        draw(c, th, st, ps, vals) {
          gs(c, th, 592 - GAIN_W - 4, st);
          const k = kOf(vals), w = wOf(vals); init(st, k);
          const a = st.a, s = st.side;
          chrome(c, th, 6, TOP + 4, 84, NAME);
          place(c, th, ps, vals, { x: 4, y: TOP + 19, w: 108, h: 147 }, { x: 418, y: TOP + 4, w: 104, h: 163 });
          const px = 124, py = TOP + 6, pw = 292, ph = 157;
          panel(c, th, px, py, pw, ph);
          const bs = 118, bx = px + 8, by = py + 16, hs = bs / 2, cx = bx + hs, cy = by + hs;
          rr(c, bx + 0.5, by + 0.5, bs, bs, 0, null, th.dline);
          c.strokeStyle = th.dline; c.lineWidth = 1; c.beginPath();
          c.moveTo(cx, by); c.lineTo(cx, by + bs); c.moveTo(bx, cy); c.lineTo(bx + bs, cy);
          c.moveTo(bx, by + bs); c.lineTo(bx + bs, by); c.moveTo(bx, by); c.lineTo(bx + bs, by + bs); c.stroke();
          txt(c, bx + 9, by + 10, "L", { color: th.scale, size: 8.5 }); txt(c, bx + bs - 9, by + 10, "R", { color: th.scale, size: 8.5 });
          txt(c, cx, py + 11, "Vectorscope", { color: th.scale, size: 8.5 });
          let sLR = 0, sLL = 0, sRR = 0, sM = 0, sS = 0;
          const N = 140, sc = hs / 1.4;
          const line = (col, lw, f) => {
            c.strokeStyle = col; c.lineWidth = lw; c.beginPath();
            for (let i = 0; i < N; i++) {
              const tau = i / N * 2 * Math.PI * 3 + st.t * 4;
              const mid = wave(tau, a), sd = 5 * s * a * (Math.sin(tau * 1.7 + 1.1) + 0.5 * Math.sin(tau * 2.9)) / 1.5;
              const [L, R] = f(mid, sd);
              const x = clamp(cx + (L - R) * 0.707 * sc, bx, bx + bs), y = clamp(cy - (L + R) * 0.707 * sc, by, by + bs);
              i ? c.lineTo(x, y) : c.moveTo(x, y);
              if (col === th.cyan) { sLR += L * R; sLL += L * L; sRR += R * R; sM += sq((L + R) / 2); sS += sq((L - R) / 2); }
            }
            c.stroke();
          };
          line(th.dispText, 1.5, (m, sd) => [m + sd, m - sd]);
          line(th.cyan, 1.5, (m, sd) => [csat(m + sd * w, k), csat(m - sd * w, k)]);
          const corr = sLR / Math.sqrt(Math.max(sLL * sRR, 1e-9));
          const mDb = db(Math.sqrt(sM / N)), sDb = db(Math.sqrt(sS / N));
          const rx = px + 142, rw = pw - 150;
          txt(c, rx, py + 18, "Mid", { color: th.dispText, align: "left" });
          txt(c, rx + rw, py + 18, `${mDb.toFixed(1)} dB`, { color: th.cyan, align: "right" });
          hbar(c, th, rx, py + 22, rw, 6, 1 + mDb / 60, th.cyan);
          txt(c, rx, py + 46, "Side", { color: th.dispText, align: "left" });
          txt(c, rx + rw, py + 46, `${sDb.toFixed(1)} dB`, { color: th.orange, align: "right" });
          hbar(c, th, rx, py + 50, rw, 6, 1 + sDb / 60, th.orange);
          txt(c, rx, py + 76, "Width", { color: th.dispText, align: "left" });
          txt(c, rx + rw, py + 98, `${Math.round(100 * Math.sqrt(sS / Math.max(sM, 1e-9)))} %`, { color: th.cyan, size: 18, bold: true, align: "right" });
          txt(c, rx, py + 118, "Balance", { color: th.dispText, align: "left" });
          txt(c, rx + rw, py + 118, `${sgn(20 * Math.log10((1 + st.bal) / (1 - st.bal)))} dB`, { color: th.orange, align: "right" });
          const cbx = px + 8, cbw = pw - 16, cby = py + 139;
          c.fillStyle = th.meterBg; c.fillRect(cbx, cby, cbw, 7);
          c.fillStyle = corr >= 0 ? th.green : th.orange;
          c.fillRect(corr >= 0 ? cbx + cbw / 2 : cbx + cbw / 2 + corr * cbw / 2, cby, Math.abs(corr) * cbw / 2, 7);
          c.fillStyle = th.scale; c.fillRect(cbx + cbw / 2 - 0.5, cby - 2, 1, 11);
          txt(c, cbx, py + ph - 3, "-1", { color: th.scale, size: 8.5, align: "left" });
          txt(c, cbx + cbw, py + ph - 3, "+1", { color: th.scale, size: 8.5, align: "right" });
          txt(c, cbx + cbw / 2, py + ph - 3, `Correlation ${sgn(corr).replace("+", "+")}`, { color: th.dispText, size: 8.5 });
        } },
      { id: "B", name: "Channel strip", width: 608, step: stepC,
        why: "Stereo input and output meters with RMS, peak and peak hold, plus a level history, like a Live mixer strip or Limiter.",
        bullets: ["Left pair = input meters, right pair = output meters: RMS bar, peak tick, orange hold line, clip lamp",
          "History: input level in grey, output level in cyan; readouts for gain change and crest factor",
          "Driven by the audio: peak and RMS of the input and the output signal"],
        draw(c, th, st, ps, vals) {
          gs(c, th, 608 - GAIN_W - 4, st);
          const k = kOf(vals); init(st, k);
          const a = st.a, o = csat(a, k);
          chrome(c, th, 6, TOP + 4, 84, NAME);
          place(c, th, ps, vals, { x: 4, y: TOP + 19, w: 108, h: 147 }, { x: 430, y: TOP + 4, w: 108, h: 163 });
          const px = 124, py = TOP + 6, pw = 300, ph = 157;
          panel(c, th, px, py, pw, ph);
          const f = d => clamp(1 + d / 54, 0, 1), my = py + 22, mh = 110;
          const rmsI = db(st.rms), rmsO = db(csat(st.rms, k));
          const bar = (x, rmsDb, pk, hold, lbal) => {
            meterV(c, th, x, my, 10, mh, f(rmsDb + lbal));
            c.fillStyle = th.cyan; c.fillRect(x, my + mh * (1 - f(pk + lbal)), 10, 2);
            c.fillStyle = th.orange; c.fillRect(x, my + mh * (1 - f(hold + lbal)), 10, 1);
          };
          const bi = 20 * Math.log10(1 + st.bal) * 1;
          bar(px + 12, rmsI, st.inL, st.hI, bi); bar(px + 24, rmsI, st.inL, st.hI, -bi);
          bar(px + 76, rmsO, st.pkO, st.hO, bi); bar(px + 88, rmsO, st.pkO, st.hO, -bi);
          [0, -6, -12, -24, -48].forEach(d => {
            const yy = my + mh * (1 - f(d));
            txt(c, px + 56, yy + 3, String(d), { color: th.dispText, size: 8.5 });
            c.fillStyle = th.scale; c.fillRect(px + 38, yy, 4, 1); c.fillRect(px + 70, yy, 4, 1);
          });
          txt(c, px + 23, py + 11, "In", { color: th.dispText }); txt(c, px + 87, py + 11, "Out", { color: th.dispText });
          c.fillStyle = st.hO > -1 ? th.orange : th.meterBg; c.fillRect(px + 76, py + 14, 22, 3);
          txt(c, px + 23, py + ph - 6, st.hI.toFixed(1), { color: th.cyan, size: 9 });
          txt(c, px + 87, py + ph - 6, st.hO.toFixed(1), { color: th.cyan, size: 9 });
          // level history
          const hx = px + 112, hw = pw - 120, hy = py + 22, hh = 70;
          txt(c, hx, py + 11, "Level history", { color: th.scale, size: 8.5, align: "left" });
          rr(c, hx, hy, hw, hh, 2, th.meterBg);
          c.save(); c.beginPath(); c.rect(hx, hy, hw, hh); c.clip();
          const Y = v => hy + hh * (1 - clamp(1 + v / 48, 0, 1)), n = Math.min(st.hist.length, hw);
          c.fillStyle = greyFill(); c.beginPath(); c.moveTo(hx + hw, hy + hh);
          for (let i = 0; i < n; i++) c.lineTo(hx + hw - i, Y(db(st.hist[st.hist.length - 1 - i].a)));
          c.lineTo(hx + hw - n, hy + hh); c.fill();
          c.strokeStyle = th.cyan; c.lineWidth = 1.5; c.beginPath();
          for (let i = 0; i < n; i++) { const yy = Y(db(csat(st.hist[st.hist.length - 1 - i].a, k))); i ? c.lineTo(hx + hw - i, yy) : c.moveTo(hx + hw - i, yy); }
          c.stroke(); c.restore();
          const rows = [["Gain change", sgn(db(o / a)) + " dB", th.orange], ["Crest in", (st.inL - rmsI).toFixed(1) + " dB", th.cyan],
            ["Crest out", (st.pkO - rmsO).toFixed(1) + " dB", th.cyan], ["Headroom", (-st.hO).toFixed(1) + " dB", th.cyan]];
          rows.forEach(([l, v, col], i) => {
            txt(c, hx, py + 107 + i * 13, l, { color: th.dispText, size: 9, align: "left" });
            txt(c, hx + hw, py + 107 + i * 13, v, { color: col, size: 9, align: "right" });
          });
        } },
      { id: "C", name: "Tone bands", width: 560, step: stepC,
        why: "24 frequency bands, input against output, with a small difference strip, like Channel EQ's analyser.",
        bullets: ["Grey bar = input band level, cyan bar = output band level (FFT in 24 bands)",
          "Orange strip: output minus input per band, +/-4 dB, so you see the console's tone change",
          "Driven by the audio: FFT of input and output; Low / Mid / High readouts are measured differences"],
        draw(c, th, st, ps, vals) {
          gs(c, th, 560 - GAIN_W - 4, st);
          const m = mean(vals), a = st.a; init(st, kOf(vals));
          const R = { x: 376, y: TOP + 4, w: 110, h: 163 };
          if (!ps.length) { txt(c, R.x + R.w / 2, R.y + R.h / 2 - 2, "No controls", { color: th.text, size: 10 }); txt(c, R.x + R.w / 2, R.y + R.h / 2 + 11, "this effect has no dials", { color: th.dim, size: 8.5 }); }
          else knobGrid(c, th, ps, R, 2, vals);
          const px = 4, py = TOP + 6, pw = 368, ph = 157;
          panel(c, th, px, py, pw, ph);
          chrome(c, th, px + 4, py + 3, 84, NAME);
          const sp = st.spI || new Array(NB).fill(-90), NBd = 24;
          const inB = [], dB = [], outB = [];
          for (let b = 0; b < NBd; b++) {
            const i0 = b * 3, v = (sp[i0] + sp[i0 + 1] + sp[i0 + 2]) / 3, fc = fOf(i0 + 1);
            const d = cresp(fc, m) + 0.4 * a * noise(b * 5 + Math.floor(st.t * 18));
            inB.push(v); dB.push(d); outB.push(v + d);
          }
          const avg = (lo, hi) => { let s = 0, n = 0; dB.forEach((d, b) => { const f = fOf(b * 3 + 1); if (f >= lo && f < hi) { s += d; n++; } }); return n ? s / n : 0; };
          [["Low", avg(0, 250), 140], ["Mid", avg(250, 4000), 206], ["High", avg(4000, 1e5), 278]].forEach(([l, v, o]) => {
            txt(c, px + o, py + 13, l, { color: th.dispText, size: 9, align: "left" });
            txt(c, px + o + 24, py + 13, sgn(v), { color: th.orange, size: 9, align: "left" });
          });
          const gx = px + 8, gw = pw - 16, pitch = gw / NBd, gy = py + 22, gh = 82;
          const Y = v => gy + gh * (1 - clamp((v + 80) / 74, 0, 1));
          c.strokeStyle = th.dline; c.lineWidth = 1;
          [-20, -40, -60].forEach(v => { c.beginPath(); c.moveTo(gx, Math.round(Y(v)) + 0.5); c.lineTo(gx + gw, Math.round(Y(v)) + 0.5); c.stroke(); });
          for (let b = 0; b < NBd; b++) {
            const x = gx + b * pitch + 1.5;
            c.fillStyle = greyFill(); c.fillRect(x, Y(inB[b]), 5, gy + gh - Y(inB[b]));
            c.fillStyle = th.cyan; c.fillRect(x + 5.5, Y(outB[b]), 5, gy + gh - Y(outB[b]));
          }
          const dy = py + 117, dh = 30, mid = dy + dh / 2;
          txt(c, gx, py + 113, "Output - input (dB)", { color: th.scale, size: 8.5, align: "left" });
          txt(c, gx + gw, py + 113, "+/-4", { color: th.scale, size: 8.5, align: "right" });
          c.fillStyle = th.meterBg; c.fillRect(gx, dy, gw, dh);
          c.fillStyle = th.orange;
          dB.forEach((d, b) => { const hgt = clamp(d, -4, 4) / 4 * dh / 2; c.fillRect(gx + b * pitch + 2, hgt >= 0 ? mid - hgt : mid, pitch - 4, Math.max(1, Math.abs(hgt))); });
          c.fillStyle = th.scale; c.fillRect(gx, mid, gw, 1);
          [[50, "50"], [200, "200"], [1000, "1k"], [5000, "5k"], [15000, "15k"]].forEach(([f, s]) =>
            txt(c, gx + pitch * (Math.log10(f / 20) / 3 * NBd), py + ph - 4, s, { color: th.scale, size: 8.5 }));
        } },
    ],
  };
})();
