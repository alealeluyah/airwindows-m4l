// Tone Color: design options. Helpers (knob, menu, meterV, …) come from app.js.
(() => {
  // ---- shared helpers (private to this file) ----
  const NB = 96, fq = i => 20 * Math.pow(1100, i / (NB - 1));
  const lx = (f, x, w) => x + w * Math.log(f / 20) / Math.log(1100);
  const gs = (o, s) => Math.exp(-o * o / (2 * s * s));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sgm = v => 1 / (1 + Math.exp(-v));
  const sY = (v, y, h) => y + h * (1 - (clamp(v, -90, -6) + 90) / 84);
  const f1 = v => (v >= 0 ? "+" : "") + v.toFixed(1);
  const greyF = () => S.theme === "light" ? "#6e6e6e" : "#3c3c3c";
  const L2 = Math.log2;
  const iOf = f => Math.round(Math.log(f / 20) / Math.log(1100) * (NB - 1));
  // simulated FFT magnitude (dB) of the drum loop, 96 log-spaced bins 20 Hz..22 kHz
  function inSpec(t) {
    const d = drums(t), n = Math.floor(t * 40), a = new Array(NB);
    for (let i = 0; i < NB; i++) {
      const o = L2(fq(i));
      const v = -68 + 34 * d.kick * gs(o - L2(60), 0.75) + 36 * d.sn * gs(o - L2(220), 0.9) + 30 * d.sn * gs(o - L2(4500), 1.6)
        + 38 * d.hat * gs(o - L2(9500), 1.3) + 12 * d.env * gs(o - L2(800), 2.5) - 1.8 * (o - L2(50)) + 3 * noise(i * 7 + n);
      a[i] = clamp(v, -90, -6);
    }
    return a;
  }
  function smoothSpec(p, v, dt) { for (let i = 0; i < NB; i++) p[i] = v[i] > p[i] ? p[i] + (v[i] - p[i]) * 0.6 : Math.max(v[i], p[i] - 50 * dt); }
  function powAvg(a, i0, i1) { let s = 0; for (let i = i0; i <= i1; i++) s += Math.pow(10, a[i] / 10); return 10 * Math.log10(s / (i1 - i0 + 1) + 1e-12); }
  function specPath(c, a, x, y, w, h, close) {
    c.beginPath(); if (close) c.moveTo(x, y + h);
    for (let i = 0; i < NB; i++) { const X = lx(fq(i), x, w), Y = sY(a[i], y, h); (i || close) ? c.lineTo(X, Y) : c.moveTo(X, Y); }
    if (close) { c.lineTo(x + w, y + h); c.closePath(); }
  }
  function clipTo(c, x, y, w, h) { c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); }
  function dispHead(c, th, dx, dy, name) { menu(c, th, dx + 6, dy + 4, 100, name); arrows(c, th, dx + 110, dy + 4); }
  function ctl(c, th, ps, area, cols, vals, cw) {
    if (!ps.length) { rr(c, area.x + 4, area.y + 4, area.w - 8, area.h - 8, 3, th.panel);
      txt(c, area.x + area.w / 2, area.y + area.h / 2 + 3, "No controls", { color: th.dim }); return; }
    knobGrid(c, th, ps, area, cols, vals, cw);
  }
  // ---- Tone Color simulation: a sine through an asymmetric soft saturator, measured sample by sample ----
  const N = 160, W0 = 0.4, HK = [1, 2, 3, 4, 5, 6, 7];
  const hann = Array.from({ length: N }, (_, n) => 0.5 - 0.5 * Math.cos(2 * Math.PI * n / (N - 1)));
  const sumW = hann.reduce((a, b) => a + b, 0);
  const CS = HK.map(k => hann.map((w, n) => w * Math.cos(k * W0 * n))), SN = HK.map(k => hann.map((w, n) => w * Math.sin(k * W0 * n)));
  const sat = x => Math.tanh(2.2 * x + 0.35 * x * x) * 0.9;
  function mags(buf) { return HK.map((_, k) => { let a = 0, b = 0; for (let n = 0; n < N; n++) { a += buf[n] * CS[k][n]; b += buf[n] * SN[k][n]; } return 2 * Math.hypot(a, b) / sumW; }); }
  function stepTone(st, dt) {
    if (!st.wi) { st.wi = []; st.wo = []; st.ph = 0; st.hi = HK.map(() => -90); st.ho = HK.map(() => -90); st.pk = 0; st.thd = 0; st.eo = 0; st.rI = -60; st.rO = -60; st.pI = -60; st.pO = -60; st.cnt = 0; }
    const d = drums(st.t), amp = 0.1 + 0.85 * Math.pow(d.env, 0.8);
    for (let k = 0; k < 8; k++) {
      st.ph += W0; const x = clamp(amp * Math.sin(st.ph) + 0.004 * noise(st.cnt++), -1, 1);
      st.wi.push(x); st.wo.push(sat(x)); if (st.wi.length > N) { st.wi.shift(); st.wo.shift(); }
    }
    if (st.wi.length < N) return;
    const mi = mags(st.wi), mo = mags(st.wo);
    HK.forEach((_, k) => { st.hi[k] += (db(mi[k]) - st.hi[k]) * 0.35; st.ho[k] += (db(mo[k]) - st.ho[k]) * 0.35; });
    const thd = 100 * Math.sqrt(mo.slice(1).reduce((s, m) => s + m * m, 0)) / Math.max(mo[0], 1e-4);
    st.thd += (thd - st.thd) * 0.3;
    const ev = mo[1] ** 2 + mo[3] ** 2 + mo[5] ** 2, od = mo[2] ** 2 + mo[4] ** 2 + mo[6] ** 2;
    st.eo += (10 * Math.log10((ev + 1e-9) / (od + 1e-9)) - st.eo) * 0.3;
    const rms = b => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length), pk = b => b.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    st.rI = db(rms(st.wi)); st.rO = db(rms(st.wo)); st.pI = db(pk(st.wi)); st.pO = db(pk(st.wo));
    st.pk += (amp - st.pk) * 0.4;
    st.inL = Math.max(st.pI, st.inL - 24 * dt); st.outL = Math.max(st.pO, st.outL - 24 * dt);
  }
  const NAME = "Luxor";

  DESIGNS["Tone Color"] = {
    effect: "Luxor",
    refs: [["SaturatorL12.png", "Saturator"], ["RoarL12.png", "Roar"], ["DrumBussL12.png", "Drum Buss"]],
    lead: "Visual cue: what the colour does to the signal — the transfer curve (output vs input level) and the harmonics it adds, measured live from the audio.",
    options: [
      { id: "A", name: "Saturator curve", width: 450, step: stepTone,
        why: "A transfer-curve display: input level across, output level up; the live signal swing is the teal band — like Saturator.",
        bullets: ["Driven by plotting each output sample against its input sample (measured curve)", "Straight dashed line = no change; bend = colour; teal band = live level swing", "Peak in/out and gain at the peak below the curve"],
        draw(c, th, st, ps, vals) {
          gainStrip(c, th, this.width - GAIN_W - 4, st);
          const dx = 6, dy = HEAD_H + 6, dw = 252, dh = DEVICE_H - 12;
          rr(c, dx, dy, dw, dh, 3, th.display); dispHead(c, th, dx, dy, NAME);
          txt(c, dx + dw - 8, dy + 15, "Transfer curve", { color: th.dispText, align: "right" });
          const px = dx + 10, py = dy + 26, pw = dw - 20, ph = 94, X = x => px + pw * (x + 1) / 2, Y = y => py + ph * (1 - (y + 1) / 2);
          ctl(c, th, ps, { x: 262, y: HEAD_H + 6, w: 112, h: DEVICE_H - 12 }, 2, vals);
          c.strokeStyle = th.dline; c.lineWidth = 1; c.strokeRect(px + 0.5, py + 0.5, pw, ph);
          c.beginPath(); c.moveTo(X(0), py); c.lineTo(X(0), py + ph); c.moveTo(px, Y(0)); c.lineTo(px + pw, Y(0)); c.stroke();
          if (!st.wi || st.wi.length < N) return;
          c.globalAlpha = 0.28; c.fillStyle = th.cyan; c.fillRect(X(-st.pk), py + 1, X(st.pk) - X(-st.pk), ph - 1); c.globalAlpha = 1;
          c.setLineDash && c.setLineDash([3, 3]); c.strokeStyle = th.scale; c.beginPath(); c.moveTo(X(-1), Y(-1)); c.lineTo(X(1), Y(1)); c.stroke(); c.setLineDash && c.setLineDash([]);
          c.beginPath(); for (let i = 0; i <= 64; i++) { const x = -1 + i / 32; i ? c.lineTo(X(x), Y(sat(x))) : c.moveTo(X(x), Y(sat(x))); }
          c.strokeStyle = th.cyan; c.lineWidth = 1.5; c.stroke();
          c.fillStyle = th.orange; for (let i = 0; i < N; i++) c.fillRect(X(st.wi[i]) - 0.8, Y(st.wo[i]) - 0.8, 1.8, 1.8);
          txt(c, dx + 8, dy + dh - 20, `Peak  in ${st.pI.toFixed(1)} dB   out ${st.pO.toFixed(1)} dB`, { color: th.dispText, align: "left" });
          txt(c, dx + 8, dy + dh - 7, `Gain at peak ${f1(st.pO - st.pI)} dB`, { color: th.orange, align: "left" });
        } },
      { id: "B", name: "Harmonics", width: 568, step: stepTone,
        why: "A harmonic-bars display: fundamental plus the 2nd to 7th harmonics, input against output; even harmonics orange, odd cyan — like Roar's analysis.",
        bullets: ["Driven by an FFT of input and output at the fundamental and its multiples", "THD % and even/odd balance are measured, not read from dials", "Dials in a 2-column block on the right"],
        draw(c, th, st, ps, vals) {
          gainStrip(c, th, this.width - GAIN_W - 4, st);
          const dx = 6, dy = HEAD_H + 6, dw = 370, dh = DEVICE_H - 12;
          rr(c, dx, dy, dw, dh, 3, th.display); dispHead(c, th, dx, dy, NAME);
          txt(c, dx + dw - 8, dy + 15, "Out", { color: th.cyan, align: "right" }); txt(c, dx + dw - 36, dy + 15, "In", { color: th.dispText, align: "right" });
          ctl(c, th, ps, { x: 382, y: HEAD_H + 6, w: 112, h: DEVICE_H - 12 }, 2, vals);
          const px = dx + 30, py = dy + 28, pw = dw - 38, ph = 84, fy = v => py + ph * (1 - (clamp(v, -90, 0) + 90) / 90);
          c.strokeStyle = th.dline; c.lineWidth = 1;
          [0, -20, -40, -60, -80].forEach(v => { c.beginPath(); c.moveTo(px, fy(v)); c.lineTo(px + pw, fy(v)); c.stroke(); txt(c, dx + 4, fy(v) + 3, String(v), { color: th.scale, size: 8.5, align: "left" }); });
          if (!st.ho) return;
          const gw = pw / 7;
          HK.forEach((k, i) => {
            const cx = px + gw * i + gw / 2, even = k % 2 === 0;
            const hi = fy(st.hi[i]), ho = fy(st.ho[i]);
            c.fillStyle = th.dispText; c.fillRect(cx - 13, hi, 11, py + ph - hi);
            c.fillStyle = even ? th.orange : th.cyan; c.fillRect(cx + 2, ho, 11, py + ph - ho);
            txt(c, cx, py + ph + 11, k === 1 ? "f" : k + "f", { color: th.scale, size: 9 });
          });
          txt(c, dx + 8, dy + dh - 8, `THD ${st.thd.toFixed(1)} %`, { color: th.cyan, align: "left" });
          txt(c, dx + dw / 2, dy + dh - 8, `Even vs odd ${f1(st.eo)} dB`, { color: th.orange });
          txt(c, dx + dw - 8, dy + dh - 8, `Level ${st.ho[0].toFixed(1)} dB`, { color: th.dispText, align: "right" });
        } },
      { id: "C", name: "Waveform scope", width: 548, step: stepTone,
        why: "A zoomed oscilloscope: input and output waves on top of each other, with the added part drawn below — you see the rounding and the extra edge directly.",
        bullets: ["Driven by the raw input and output samples; lower trace = out − in", "RMS and crest factor (peak vs average) in and out as numbers", "Menu and arrows in the display strip, dials on the right"],
        draw(c, th, st, ps, vals) {
          gainStrip(c, th, this.width - GAIN_W - 4, st);
          const dx = 6, dy = HEAD_H + 6, dw = 350, dh = DEVICE_H - 12;
          rr(c, dx, dy, dw, dh, 3, th.display); dispHead(c, th, dx, dy, NAME);
          txt(c, dx + dw - 8, dy + 15, "Out", { color: th.cyan, align: "right" }); txt(c, dx + dw - 34, dy + 15, "In", { color: th.dispText, align: "right" });
          ctl(c, th, ps, { x: 362, y: HEAD_H + 6, w: 112, h: DEVICE_H - 12 }, 2, vals);
          const wx = dx + 8, ww = dw - 16, wy = dy + 24, wh = 78, ry = dy + 106, rh = 26;
          c.fillStyle = th.dline; c.fillRect(wx, wy + wh / 2, ww, 1); c.fillRect(wx, ry + rh / 2, ww, 1);
          txt(c, dx + dw - 8, ry - 1, "Added (out − in)", { color: th.orange, size: 8.5, align: "right" });
          if (!st.wi || st.wi.length < N) return;
          const M = 80, off = N - M;
          [[st.wi, th.dispText, 1.3], [st.wo, th.cyan, 2]].forEach(([b, col, lw]) => {
            c.beginPath(); for (let i = 0; i < M; i++) { const X = wx + i * ww / (M - 1), Y = wy + wh / 2 - b[off + i] * wh * 0.46; i ? c.lineTo(X, Y) : c.moveTo(X, Y); }
            c.strokeStyle = col; c.lineWidth = lw; c.stroke(); });
          c.beginPath(); for (let i = 0; i < M; i++) { const X = wx + i * ww / (M - 1), Y = ry + rh / 2 - (st.wo[off + i] - st.wi[off + i]) * rh * 0.9; i ? c.lineTo(X, Y) : c.moveTo(X, Y); }
          c.strokeStyle = th.orange; c.lineWidth = 1.5; c.stroke();
          txt(c, dx + 8, dy + dh - 6, `RMS ${st.rI.toFixed(1)} → ${st.rO.toFixed(1)} dB`, { color: th.dispText, align: "left" });
          txt(c, dx + dw - 8, dy + dh - 6, `Crest ${(st.pI - st.rI).toFixed(1)} → ${(st.pO - st.rO).toFixed(1)} dB`, { color: th.orange, align: "right" });
        } },
    ],
  };
})();
