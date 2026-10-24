// Brightness: design options. Helpers (knob, menu, meterV, …) come from app.js.
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
  // ---- Brightness simulation: an air/slew/de-ess style response measured as out / in ----
  function resp(f, t, d) {
    const o = L2(f);
    return 5 * sgm((o - L2(9000)) * 1.8) * (0.85 + 0.15 * Math.sin(t * 0.7)) - 20 * d.hat * gs(o - L2(6500), 0.45)
      - 18 * sgm((o - L2(21000)) * 4) - 12 * (1 - sgm((o - L2(30)) * 2.5));
  }
  function stepBright(st, dt) {
    if (!st.si) { st.si = Array(NB).fill(-90); st.so = Array(NB).fill(-90); st.rs = Array(NB).fill(0); st.bi = [-90, -90, -90]; st.bo = [-90, -90, -90]; st.cen = [1, 1]; }
    const d = drums(st.t), a = inSpec(st.t), res = a.map((_, i) => resp(fq(i), st.t, d));
    smoothSpec(st.si, a, dt); smoothSpec(st.so, a.map((v, i) => clamp(v + res[i], -90, -6)), dt);
    for (let i = 0; i < NB; i++) st.rs[i] += (res[i] - st.rs[i]) * 0.35;
    const i250 = iOf(250), i4k = iOf(4000);
    st.bi = [powAvg(st.si, 0, i250), powAvg(st.si, i250 + 1, i4k), powAvg(st.si, i4k + 1, NB - 1)];
    st.bo = [powAvg(st.so, 0, i250), powAvg(st.so, i250 + 1, i4k), powAvg(st.so, i4k + 1, NB - 1)];
    const cen = a2 => { let s = 0, p = 0; for (let i = 0; i < NB; i++) { const w = Math.pow(10, a2[i] / 10); s += fq(i) * w; p += w; } return s / p / 1000; };
    st.cen = [cen(st.si), cen(st.so)];
    const tin = powAvg(st.si, 0, NB - 1), tout = powAvg(st.so, 0, NB - 1), inNow = db(d.env * 0.8 + 0.02);
    st.inL = Math.max(inNow, st.inL - 24 * dt); st.outL = Math.max(inNow + tout - tin, st.outL - 24 * dt);
    st.hist.push({ i: st.bi[2], o: st.bo[2] }); if (st.hist.length > 400) st.hist.shift();
  }
  // ---- real measurements: 48 airwin~ bands -> the 96 display bins this file draws ----
  const fin = (v, d) => Number.isFinite(v) ? v : d;
  const toBins = (a48, def) => {
    const o = new Array(NB);
    for (let i = 0; i < NB; i++) {
      const pos = clamp(Math.log(fq(i) / 20) / Math.log(1000) * 48 - 0.5, 0, 47), j = Math.floor(pos), u = pos - j;
      const a = a48 && a48.length > j ? fin(a48[j], def) : def, b = a48 && a48.length > Math.min(47, j + 1) ? fin(a48[Math.min(47, j + 1)], def) : def;
      o[i] = a + (b - a) * u;
    }
    return o;
  };
  function liveBright(st, m, dt) {
    if (!st.si) { st.si = Array(NB).fill(-90); st.so = Array(NB).fill(-90); st.rs = Array(NB).fill(0); st.r48 = Array(48).fill(0);
      st.bi = [-90, -90, -90]; st.bo = [-90, -90, -90]; st.cen = [1, 1]; st.hist = []; }
    const sIn = m.specIn || [], sOut = m.specOut || [];
    if (sIn.length >= 48 && sOut.length >= 48) {
      smoothSpec(st.si, toBins(sIn, -120), dt); smoothSpec(st.so, toBins(sOut, -120), dt);
      // response = out - in per band; where the input is nearly silent keep the previous value
      for (let b = 0; b < 48; b++) if (fin(sIn[b], -120) > -80) st.r48[b] = clamp(fin(sOut[b], -120) - sIn[b], -24, 24);
      const r = toBins(st.r48, 0); for (let i = 0; i < NB; i++) st.rs[i] += (r[i] - st.rs[i]) * 0.35;
    }
    const i250 = iOf(250), i4k = iOf(4000);
    st.bi = [powAvg(st.si, 0, i250), powAvg(st.si, i250 + 1, i4k), powAvg(st.si, i4k + 1, NB - 1)];
    st.bo = [powAvg(st.so, 0, i250), powAvg(st.so, i250 + 1, i4k), powAvg(st.so, i4k + 1, NB - 1)];
    const cen = a2 => { let s = 0, p = 0; for (let i = 0; i < NB; i++) { const w = Math.pow(10, a2[i] / 10); s += fq(i) * w; p += w; } return s / p / 1000; };
    st.cen = [cen(st.si), cen(st.so)];
    const pk = a => Math.max(fin(a && a[0], -120), fin(a && a[1], -120));
    st.inL = Math.max(pk(m.inPkDb), (Number.isFinite(st.inL) ? st.inL : -60) - 24 * dt);
    st.outL = Math.max(pk(m.outPkDb), (Number.isFinite(st.outL) ? st.outL : -60) - 24 * dt);
    st.hist.push({ i: st.bi[2], o: st.bo[2] }); if (st.hist.length > 400) st.hist.shift();
  }
  const NAME = "Air";

  DESIGNS["Brightness"] = {
    effect: "Air",
    refs: [["EQEightL12.png", "EQ Eight"], ["ChannelEQL12.png", "Channel EQ"], ["AutoFilterL12.png", "Auto Filter"]],
    lead: "Visual cue: the brightness change itself — a live spectrum (FFT) of the input and output, and the out ÷ in curve showing which frequencies the effect lifts or cuts.",
    options: [
      { id: "A", name: "EQ Eight", short: "Spectrum", width: 668, step: stepBright, live: liveBright,
        why: "One big spectrum display with the measured out ÷ in response drawn as an orange curve over it — like EQ Eight.",
        bullets: ["Driven by FFT of input and output; curve = out ÷ in per frequency", "Grey = input spectrum, cyan = output spectrum", "Effect menu and arrows inside the display; dials in a left block"],
        draw(c, th, st, ps, vals) {
          gainStrip(c, th, this.width - GAIN_W - 4, st);
          ctl(c, th, ps, { x: 2, y: HEAD_H + 4, w: 112, h: DEVICE_H - 8 }, 2, vals);
          const dx = 118, dy = HEAD_H + 6, dw = 476, dh = DEVICE_H - 12;
          rr(c, dx, dy, dw, dh, 3, th.display); dispHead(c, th, dx, dy, NAME);
          const r12 = st.rs ? st.rs[iOf(12000)] : 0;
          txt(c, dx + 150, dy + 15, `Change at 12 kHz ${f1(r12)} dB`, { color: th.dispText, align: "left" });
          legend(c, th, dx + dw - 116, dy + 15, [
            [greyF(), "In", "Grey area: the spectrum of the sound going into the effect."],
            [th.cyan, "Out", "Cyan area and line: the spectrum of the sound coming out of the effect."],
            [th.orange, "Out ÷ In", "Orange curve: how much each frequency is raised or lowered, in dB. Read it on the scale at the left."]]);
          const px = dx + 28, py = dy + 26, pw = dw - 36, ph = dh - 26 - 14;
          hint(dx, dy, dw, dh, "Spectrum Display", "Shows the sound by frequency, low on the left and high on the right. Measured from the input and the output of the effect.");
          hint(dx + 150, dy + 4, 150, 14, "Change Readout", "How many dB the effect raises or lowers the level at 12 kHz. Measured as output level minus input level.");
          hint(px, py, pw, ph, "Response Curve", "The orange line shows the change at each frequency, in dB, on the scale at the left. Above the middle line the effect adds level; below it, the effect takes level away.");
          hint(dx + 1, py, 24, ph, "Change Scale", "Scale for the orange curve, in dB. 0 means no change.");
          hint(px, dy + dh - 12, pw, 12, "Frequency Scale", "Frequency in Hz, low on the left and high on the right (100, 1k = 1000 Hz, 10k = 10000 Hz).");
          c.strokeStyle = th.dline; c.lineWidth = 1;
          [100, 1000, 10000].forEach((f, k) => { const X = lx(f, px, pw); c.beginPath(); c.moveTo(X, py); c.lineTo(X, py + ph); c.stroke();
            txt(c, X, dy + dh - 3, ["100", "1k", "10k"][k], { color: th.scale, size: 9 }); });
          const ry = v => py + ph / 2 - clamp(v, -12, 12) / 12 * ph / 2;
          [12, 0, -12].forEach(v => { c.beginPath(); c.moveTo(px, ry(v)); c.lineTo(px + pw, ry(v)); c.stroke();
            txt(c, dx + 5, ry(v) + 3, (v > 0 ? "+" : "") + v, { color: th.scale, size: 9, align: "left" }); });
          if (!st.si) return;
          clipTo(c, px, py, pw, ph);
          specPath(c, st.si, px, py, pw, ph, true); c.fillStyle = greyF(); c.fill();
          specPath(c, st.so, px, py, pw, ph, true); c.globalAlpha = 0.28; c.fillStyle = th.cyan; c.fill(); c.globalAlpha = 1;
          specPath(c, st.so, px, py, pw, ph, false); c.strokeStyle = th.cyan; c.lineWidth = 1; c.stroke();
          c.beginPath(); for (let i = 0; i < NB; i++) { const X = lx(fq(i), px, pw), Y = ry(st.rs[i]); i ? c.lineTo(X, Y) : c.moveTo(X, Y); }
          c.strokeStyle = th.orange; c.lineWidth = 2; c.stroke();
          c.restore();
        } },
      { id: "B", name: "Spectrum bars", short: "Bars", width: 608, step: stepBright, live: liveBright,
        why: "A band analyser: output level as bars with the input as a cap, and under it a strip of boost/cut bars per band — like the Spectrum device.",
        bullets: ["Driven by FFT of input and output in 48 bands; lower strip = out − in", "Orange bars = boosted, cyan bars = cut, centre line = no change", "Dials in one row under the display, so 0 to 13 controls fit"],
        draw(c, th, st, ps, vals) {
          gainStrip(c, th, this.width - GAIN_W - 4, st);
          const dx = 6, dy = HEAD_H + 6, dw = 528, dh = 108;
          rr(c, dx, dy, dw, dh, 3, th.display); dispHead(c, th, dx, dy, NAME);
          legend(c, th, dx + dw - 190, dy + 15, [
            [th.dispText, "Input cap", "The short grey line on top of each bar: the input level of that frequency band."],
            [th.cyan, "Output", "Cyan bars: the output level of each frequency band."],
            [th.orange, "Boost", "Orange bars in the lower strip: bands the effect raises, in dB."],
            [th.cyan, "Cut", "Cyan bars in the lower strip: bands the effect lowers, in dB."]], { gap: 6 });
          hint(dx, dy, dw, dh, "Band Analyser", "Shows 48 frequency bands, low on the left and high on the right. Measured from the input and the output of the effect.");
          hint(dx + 34, dy + 24, dw - 42, 46, "Level Bars", "Cyan bar: the output level of the band. Grey cap: the input level of the band. Scale from -90 to -6 dB.");
          hint(dx + 34, dy + 74, dw - 42, 26, "Change Strip", "How much the effect raises (orange, up) or lowers (cyan, down) each band, in dB. Up to 6 dB either way. The centre line means no change. Measured as output minus input.");
          hint(dx + 2, dy + 74, 30, 26, "Change Scale", "Scale for the change strip, in dB.");
          hint(dx + 34, dy + dh - 10, dw - 42, 10, "Frequency Scale", "Frequency in Hz, low on the left and high on the right.");
          ctl(c, th, ps, { x: 6, y: HEAD_H + 118, w: 528, h: 49 }, Math.max(1, ps.length), vals);
          const px = dx + 34, pw = dw - 42, K = 48, pitch = pw / K, y1 = dy + 24, h1 = 46, y2 = dy + 74, h2 = 26, mid = y2 + h2 / 2;
          txt(c, dx + 6, y1 + 9, "Out", { color: th.scale, size: 9, align: "left" });
          txt(c, dx + 6, mid - 5, "+6", { color: th.scale, size: 8.5, align: "left" }); txt(c, dx + 6, mid + 4, "0", { color: th.scale, size: 8.5, align: "left" }); txt(c, dx + 6, mid + 13, "-6", { color: th.scale, size: 8.5, align: "left" });
          c.fillStyle = th.dline; c.fillRect(px, mid, pw, 1);
          [100, 1000, 10000].forEach((f, k) => { const X = lx(f, px, pw); c.fillRect(X, y1, 1, h1); c.fillRect(X, y2, 1, h2); txt(c, X, dy + dh - 1, ["100", "1k", "10k"][k], { color: th.scale, size: 8.5 }); });
          if (!st.si) return;
          for (let j = 0; j < K; j++) {
            const x = px + j * pitch, bw = Math.max(1, pitch - 1.5), i0 = 2 * j;
            const vo = (st.so[i0] + st.so[i0 + 1]) / 2, vi = (st.si[i0] + st.si[i0 + 1]) / 2;
            const ho = (clamp(vo, -90, -6) + 90) / 84 * h1, hi = (clamp(vi, -90, -6) + 90) / 84 * h1;
            c.fillStyle = th.cyan; c.fillRect(x, y1 + h1 - ho, bw, ho);
            c.fillStyle = th.dispText; c.fillRect(x, y1 + h1 - hi - 1, bw, 1.5);
            const r = (st.rs[i0] + st.rs[i0 + 1]) / 2, hh = clamp(r, -6, 6) / 6 * (h2 / 2);
            c.fillStyle = r >= 0 ? th.orange : th.cyan; c.fillRect(x, hh >= 0 ? mid - hh : mid, bw, Math.max(1, Math.abs(hh)));
          }
        } },
      { id: "C", name: "Band meters", short: "Bands", width: 508, step: stepBright, live: liveBright,
        why: "Three level bands (low, mid, high) with input vs output side by side, plus the high-band history — a channel-strip way to see 'is it brighter?'.",
        bullets: ["Driven by FFT of input and output, summed into Low / Mid / High", "Orange number = how many dB the band moved; line graph = high band over time", "Spectral centroid readout (average pitch of the sound) in and out"],
        draw(c, th, st, ps, vals) {
          gainStrip(c, th, this.width - GAIN_W - 4, st);
          ctl(c, th, ps, { x: 2, y: HEAD_H + 4, w: 108, h: DEVICE_H - 8 }, 2, vals);
          const dx = 114, dy = HEAD_H + 6, dw = 320, dh = DEVICE_H - 12;
          rr(c, dx, dy, dw, dh, 3, th.display); dispHead(c, th, dx, dy, NAME);
          legend(c, th, dx + dw - 128, dy + 15, [
            [th.orange, "Change", "Orange number under a pair of meters: how many dB the effect moved that band, output minus input."],
            [th.dispText, "In", "Grey: the level of the sound going into the effect."],
            [th.cyan, "Out", "Cyan: the level of the sound coming out of the effect."]]);
          hint(dx, dy, dw, dh, "Band Display", "Splits the sound into low, mid and high bands and shows input and output level side by side. Measured with a spectrum analysis of both signals.");
          [0, 1, 2].forEach(k => hint(dx + k * dw / 3 + 6, dy + 24, dw / 3 - 12, 86, ["Low Band", "Mid Band", "High Band"][k] + " Meters",
            ["Level of sounds below 250 Hz, input (grey) and output (cyan). The number below is the change in dB.",
             "Level of sounds between 250 Hz and 4 kHz, input (grey) and output (cyan). The number below is the change in dB.",
             "Level of sounds above 4 kHz, input (grey) and output (cyan). The number below is the change in dB."][k]));
          hint(dx + 8, dy + 111, dw - 16, 27, "High Band History", "The high band level over the last moments, input (grey) and output (cyan). Newest on the right.");
          hint(dx + 6, dy + dh - 16, 180, 12, "Centroid Readout", "The average pitch of the sound in kHz, input then output. A higher number means a brighter sound. Measured from the spectrum.");
          if (!st.si) return;
          const names = ["Low < 250 Hz", "Mid", "High > 4 kHz"], gw = dw / 3, by = dy + 38, bh = 58, fr = v => (clamp(v, -80, -35) + 80) / 45, hr = v => (clamp(v, -90, -55) + 90) / 35;
          names.forEach((n, k) => {
            const gx = dx + k * gw + gw / 2;
            txt(c, gx, dy + 31, n, { color: th.scale, size: 9 });
            meterV(c, th, gx - 17, by, 12, bh, fr(st.bi[k]), false, th.dispText);
            meterV(c, th, gx + 5, by, 12, bh, fr(st.bo[k]), false, th.cyan);
            const dl = st.bo[k] - st.bi[k]; txt(c, gx, by + bh + 11, `${f1(dl)} dB`, { color: Math.abs(dl) < 0.05 ? th.dispText : th.orange });
          });
          const hx = dx + 8, hy = dy + 111, hw = dw - 16, hh = 27;
          rr(c, hx, hy, hw, hh, 2, th.panel); txt(c, dx + dw - 8, dy + dh - 6, "High band over time", { color: th.scale, size: 8.5, align: "right" });
          clipTo(c, hx, hy, hw, hh);
          [["i", th.dispText], ["o", th.cyan]].forEach(([k, col]) => {
            c.beginPath(); const n = Math.min(st.hist.length, hw);
            for (let i = 0; i < n; i++) { const e = st.hist[st.hist.length - 1 - i], Y = hy + hh - 2 - (hh - 4) * hr(e[k]); i ? c.lineTo(hx + hw - i, Y) : c.moveTo(hx + hw - i, Y); }
            c.strokeStyle = col; c.lineWidth = 1.2; c.stroke(); });
          c.restore();
          txt(c, dx + 8, dy + dh - 6, `Centroid ${st.cen[0].toFixed(2)} → ${st.cen[1].toFixed(2)} kHz`, { color: th.dispText, align: "left" });
        } },
    ],
  };
})();
