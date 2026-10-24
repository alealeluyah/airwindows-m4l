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
  // Fixed magnification of the lower "Added" lane (out - in is tiny for most material). Never computed from the signal.
  const ADDED_MAG = 16;
  // loudest absolute value over the newest n samples of several arrays
  function absPeak(arrs, n) { let p = 0; for (const a of arrs) for (let i = Math.max(0, a.length - n); i < a.length; i++) p = Math.max(p, Math.abs(a[i])); return p; }
  function ctl(c, th, ps, area, cols, vals, cw) {
    tile(c, th, area.x, area.y, area.w, area.h);
    if (!ps.length) { txt(c, area.x + area.w / 2, area.y + area.h / 2 + 3, "No controls", { color: th.dim }); return; }
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
  // ---- real measurements ----
  const fin = (v, d) => Number.isFinite(v) ? v : d;
  const dbl = v => 20 * Math.log10(Math.max(Math.abs(v), 1e-6));
  const pkOf = a => Math.max(fin(a && a[0], -120), fin(a && a[1], -120));
  function liveTone(st, m, dt) {
    if (!st.lv) { st.lv = true; st.wi = []; st.wo = []; st.xf = Array(32).fill(null); st.hi = HK.map(() => -90); st.ho = HK.map(() => -90);
      st.pk = 0; st.thd = 0; st.eo = 0; st.rI = -60; st.rO = -60; st.pI = -60; st.pO = -60; st.f0 = 14; }
    const sm = (p, v, k) => p + (fin(v, -120) - p) * k;
    // levels
    st.inL = Math.max(pkOf(m.inPkDb), (Number.isFinite(st.inL) ? st.inL : -60) - 24 * dt);
    st.outL = Math.max(pkOf(m.outPkDb), (Number.isFinite(st.outL) ? st.outL : -60) - 24 * dt);
    st.rI = sm(st.rI, m.inRmsDb, 0.3); st.rO = sm(st.rO, m.outRmsDb, 0.3);
    st.pI = sm(st.pI, dbl(m.inPk || 0), 0.4); st.pO = sm(st.pO, dbl(m.outPk || 0), 0.4);
    st.pk += (clamp(fin(m.inPk, 0), 0, 1) - st.pk) * (m.inPk > st.pk ? 0.6 : 0.15);
    // scope samples (about 5 ms): input and output, left channel
    const a = m.inScopeL || [], b = m.scopeL || [];
    if (a.length >= 16 && a.length === b.length) {
      st.wi = a.map(v => clamp(fin(v, 0), -1, 1)); st.wo = b.map(v => clamp(fin(v, 0), -1, 1));
    }
    // measured transfer curve: mean output per input-amplitude bin, kept per bin
    const xf = m.xfer || [];
    for (let i = 0; i < 32; i++) if (i < xf.length && Number.isFinite(xf[i]) && xf[i] > -8) st.xf[i] = st.xf[i] === null ? xf[i] : st.xf[i] + (xf[i] - st.xf[i]) * 0.4;
    // harmonics: fundamental = strongest input band between 40 Hz and 500 Hz (kept unless another is 3 dB higher)
    const sI = m.specIn || [], sO = m.specOut || [], sD = m.specDiff || [];
    if (sI.length >= 48 && sO.length >= 48) {
      let best = -999, bi = -1; for (let j = 0; j < 48; j++) { const f = bandHz(j); if (f >= 40 && f <= 500 && fin(sI[j], -120) > best) { best = fin(sI[j], -120); bi = j; } }
      if (bi >= 0 && fin(sI[st.f0], -120) < best - 3) st.f0 = bi;
      const at = (arr, k, wide) => { const c = st.f0 + 48 * Math.log(k) / Math.log(1000); if (c > 47.4) return -120;
        let v = -120; for (let j = Math.max(0, Math.round(c) - 1); j <= Math.min(47, Math.round(c) + 1); j++) v = Math.max(v, fin(arr[j], -120)); return v; };
      const upd = (arr, src) => HK.forEach((k, i) => { const v = at(src, k), p = arr[i]; arr[i] = v > p ? p + (v - p) * 0.6 : Math.max(v, p - 50 * dt); });
      upd(st.hi, sI); upd(st.ho, sO);
      // added harmonics: from the difference spectrum (what the effect adds), relative to the output fundamental
      if (sD.length >= 48) {
        const pw = k => Math.pow(10, at(sD, k) / 10);
        let ev = 0, od = 0, sum = 0; HK.forEach(k => { if (k > 1) { sum += pw(k); (k % 2 ? (od += pw(k)) : (ev += pw(k))); } });
        const thd = 100 * Math.sqrt(sum / (Math.pow(10, Math.max(st.ho[0], -120) / 10) + 1e-12));
        st.thd += (clamp(thd, 0, 999) - st.thd) * 0.3;
        st.eo += (clamp(10 * Math.log10((ev + 1e-13) / (od + 1e-13)), -30, 30) - st.eo) * 0.3;
      }
    }
  }
  const NAME = "Luxor";

  DESIGNS["Tone Color"] = {
    effect: "Luxor",
    refs: [["SaturatorL12.png", "Saturator"], ["RoarL12.png", "Roar"], ["DrumBussL12.png", "Drum Buss"]],
    lead: "Visual cue: what the colour does to the signal — the transfer curve (output vs input level) and the harmonics it adds, measured live from the audio.",
    options: [
      { id: "A", name: "Saturator curve", short: "Curve", width: 450, step: stepTone, live: liveTone,
        why: "A transfer-curve display: input level across, output level up; the live signal swing is the teal band — like Saturator.",
        bullets: ["Driven by plotting each output sample against its input sample (measured curve)", "Straight dashed line = no change; bend = colour; teal band = live level swing", "Peak in/out and gain at the peak below the curve"],
        draw(c, th, st, ps, vals) {
          gainStrip(c, th, this.width - GAIN_W - 4, st);
          const dx = 4, dy = HEAD_H + 4, dw = 262, dh = DEVICE_H - 8;
          screen(c, th, dx, dy, dw, dh); dispHead(c, th, dx, dy + 2, NAME);
          strip(c, th, dx, dy, dw, 22); strip(c, th, dx, dy + 116, dw, 16, true); strip(c, th, dx, dy + 132, dw, dh - 132, true);
          txt(c, dx + dw - 8, dy + 15, "Transfer curve", { color: th.dispText, align: "right" });
          const px = dx + 10, py = dy + 26, pw = dw - 20, ph = 86, X = x => px + pw * (x + 1) / 2, Y = y => py + ph * (1 - (y + 1) / 2);
          ctl(c, th, ps, { x: 268, y: HEAD_H + 4, w: 112, h: DEVICE_H - 8 }, 2, vals);
          legend(c, th, dx + 8, dy + 128, [
            [th.cyan, "Curve", "Cyan line: the output level the effect gives for each input level. A straight diagonal line means no change; a bend is the colour added."],
            [th.orange, "Samples", "Orange dots: the live signal, one dot per sample, input level across and output level up."],
            [th.cyan.length === 7 ? th.cyan + "66" : th.cyan, "Swing", "Cyan band: the range of input levels the signal reaches right now."],
            [th.scale, "No change", "Dashed line: where the curve would lie if the effect left the level unchanged."]], { gap: 5 });
          hint(dx, dy, dw, dh, "Transfer Curve Display", "Shows how the effect changes the level. Input level goes across, output level goes up. Measured from the input and output samples.");
          hint(px, py, pw, ph, "Curve Plot", "Both axes run from -1 to +1 (full scale). The farther the cyan curve bends from the diagonal, the more colour the effect adds.");
          hint(dx + 8, dy + 135, 170, 12, "Peak Readout", "The highest level of the input and of the output right now, in dB.");
          hint(dx + 8, dy + 147, 170, 12, "Gain At Peak", "How much louder or quieter the effect makes the peaks, in dB. Measured as output peak minus input peak.");
          c.strokeStyle = th.dline; c.lineWidth = 1;
          c.beginPath(); c.moveTo(X(0), py); c.lineTo(X(0), py + ph); c.moveTo(px, Y(0)); c.lineTo(px + pw, Y(0)); c.stroke();
          if (!st.wi || st.wi.length < 16) return;
          c.globalAlpha = 0.28; c.fillStyle = th.cyan; c.fillRect(X(-st.pk), py + 1, X(st.pk) - X(-st.pk), ph - 1); c.globalAlpha = 1;
          c.setLineDash && c.setLineDash([3, 3]); c.strokeStyle = th.scale; c.beginPath(); c.moveTo(X(-1), Y(-1)); c.lineTo(X(1), Y(1)); c.stroke(); c.setLineDash && c.setLineDash([]);
          c.beginPath(); let pen = false;
          if (st.xf) { for (let i = 0; i < 32; i++) { if (st.xf[i] === null) { pen = false; continue; } const x = -1 + (i + 0.5) / 16; pen ? c.lineTo(X(x), Y(st.xf[i])) : c.moveTo(X(x), Y(st.xf[i])); pen = true; } }
          else for (let i = 0; i <= 64; i++) { const x = -1 + i / 32; i ? c.lineTo(X(x), Y(sat(x))) : c.moveTo(X(x), Y(sat(x))); }
          c.strokeStyle = th.cyan; c.lineWidth = 1.5; c.stroke();
          c.fillStyle = th.orange; for (let i = 0; i < st.wi.length; i++) c.fillRect(X(st.wi[i]) - 0.8, Y(st.wo[i]) - 0.8, 1.8, 1.8);
          txt(c, dx + 8, dy + 144, `Peak  in ${st.pI.toFixed(1)} dB   out ${st.pO.toFixed(1)} dB`, { color: th.dispText, align: "left" });
          txt(c, dx + 8, dy + 156, `Gain at peak ${f1(st.pO - st.pI)} dB`, { color: th.dispText, align: "left" });
        } },
      { id: "B", name: "Harmonics", short: "Harmonics", width: 568, step: stepTone, live: liveTone,
        why: "A harmonic-bars display: fundamental plus the 2nd to 7th harmonics, input against output; even harmonics orange, odd cyan — like Roar's analysis.",
        bullets: ["Driven by an FFT of input and output at the fundamental and its multiples", "THD % and even/odd balance are measured, not read from dials", "Dials in a 2-column block on the right"],
        draw(c, th, st, ps, vals) {
          gainStrip(c, th, this.width - GAIN_W - 4, st);
          const dx = 4, dy = HEAD_H + 4, dw = 374, dh = DEVICE_H - 8;
          screen(c, th, dx, dy, dw, dh); dispHead(c, th, dx, dy + 2, NAME);
          strip(c, th, dx, dy, dw, 22); strip(c, th, dx, dy + dh - 18, dw, 18, true);
          legend(c, th, dx + dw - 116, dy + 15, [
            [th.dispText, "In", "Grey bars: the level of the input at the main pitch and its multiples."],
            [th.orange, "Even", "Orange bars: output level at the even harmonics (2f, 4f, 6f). They sound warm and soft."],
            [th.cyan, "Odd", "Cyan bars: output level at the main pitch and the odd harmonics (3f, 5f, 7f). They sound hard and edgy."]]);
          hint(dx, dy, dw, dh, "Harmonics Display", "Shows the main pitch (f) and the harmonics above it, 2f to 7f. Input is on the left of each pair, output on the right. Measured with a spectrum analysis.");
          hint(dx + 30, dy + 26, dw - 38, 96, "Harmonic Bars", "Bar height is level in dB, from -90 (bottom) to 0 (top). A taller output bar than input bar means the effect added that harmonic.");
          hint(dx + 2, dy + 26, 26, 96, "Level Scale", "Level in dB for the harmonic bars.");
          hint(dx + 30, dy + 122, dw - 38, 12, "Harmonic Labels", "f is the main pitch. 2f, 3f and so on are multiples of it.");
          hint(dx + 8, dy + dh - 16, 100, 14, "THD Readout", "Total harmonic distortion in %: the added harmonics compared with the main pitch. Higher means more colour.");
          hint(dx + dw / 2 - 60, dy + dh - 16, 120, 14, "Even Versus Odd", "Level of the even harmonics minus the odd ones, in dB. Above 0 sounds warmer; below 0 sounds harder.");
          hint(dx + dw - 100, dy + dh - 16, 94, 14, "Level Readout", "Output level of the main pitch, in dB.");
          ctl(c, th, ps, { x: 380, y: HEAD_H + 4, w: 118, h: DEVICE_H - 8 }, 2, vals);
          const px = dx + 30, py = dy + 26, pw = dw - 38, ph = 96, fy = v => py + ph * (1 - (clamp(v, -90, 0) + 90) / 90);
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
          txt(c, dx + 8, dy + dh - 5, `${st.lv ? "Added THD" : "THD"} ${st.thd.toFixed(1)} %`, { color: th.dispText, align: "left" });
          txt(c, dx + dw / 2, dy + dh - 5, `Even vs odd ${f1(st.eo)} dB`, { color: th.orange });
          txt(c, dx + dw - 8, dy + dh - 5, `Level ${st.ho[0].toFixed(1)} dB`, { color: th.dispText, align: "right" });
        } },
      { id: "C", name: "Waveform scope", short: "Scope", width: 548, step: stepTone, live: liveTone,
        why: "An oscilloscope at a fixed scale: input and output waves on top of each other, with the added part drawn below at a fixed ×16 magnification — you see the rounding and the extra edge directly.",
        bullets: ["Driven by the raw input and output samples; lower trace = out − in", "RMS and crest factor (peak vs average) in and out as numbers", "Menu and arrows in the display strip, dials on the right"],
        draw(c, th, st, ps, vals) {
          gainStrip(c, th, this.width - GAIN_W - 4, st);
          const dx = 4, dy = HEAD_H + 4, dw = 360, dh = DEVICE_H - 8;
          screen(c, th, dx, dy, dw, dh); dispHead(c, th, dx, dy + 2, NAME);
          strip(c, th, dx, dy, dw, 22); strip(c, th, dx, dy + dh - 18, dw, 18, true);
          legend(c, th, dx + dw - 114, dy + 15, [
            [th.dispText, "In", "Grey wave: the sound going into the effect."],
            [th.cyan, "Out", "Cyan wave: the sound coming out of the effect."],
            [th.orange, "Added", "Orange wave in the lower strip: output minus input, which is what the effect adds to the sound."]], { line: true });
          hint(dx, dy, dw, dh, "Waveform Display", "Shows a few milliseconds of the sound as a wave. Measured from the input and output samples.");
          hint(dx + 8, dy + 25, dw - 16, 80, "Input And Output Waves", "Grey is the input wave, cyan is the output wave. If the cyan wave looks rounder or sharper than the grey one, the effect is adding colour.");
          hint(dx + 8, dy + 109, dw - 16, 32, "Added Signal", "Output minus input, drawn 16 times larger (a fixed magnification) so you can see it. A flat line means the effect adds nothing.");
          hint(dx + 8, dy + dh - 15, 140, 12, "RMS Readout", "Average level of the input, then of the output, in dB.");
          hint(dx + dw - 150, dy + dh - 15, 142, 12, "Crest Readout", "Peak level minus average level, input then output, in dB. A lower number means the peaks are rounder.");
          ctl(c, th, ps, { x: 366, y: HEAD_H + 4, w: 112, h: DEVICE_H - 8 }, 2, vals);
          const wx = dx + 8, ww = dw - 16, wy = dy + 26, wh = 78, ry = dy + 110, rh = 30;
          c.fillStyle = th.dline; c.fillRect(wx, wy + wh / 2, ww, 1); c.fillRect(wx, ry + rh / 2, ww, 1);
          strip(c, th, dx, dy + 106, dw, 0, true);
          txt(c, wx + 2, ry + 8, `Added ×${ADDED_MAG}`, { color: th.scale, size: 8.5, align: "left" });
          hint(wx, ry, 60, 12, "Added Magnification", "The added signal in the lower lane is always magnified 16 times. This is a fixed value, not set by the signal.");
          if (!st.wi || st.wi.length < 16) return;
          const M = Math.min(80, st.wi.length), off = st.wi.length - M, dg = ADDED_MAG;
          // fixed scale (RUBRIC 2.6): true level, 1x, input and output on the same scale
          const g = 1;
          [[st.wi, th.dispText, 1.3], [st.wo, th.cyan, 2]].forEach(([b, col, lw]) => {
            c.beginPath(); for (let i = 0; i < M; i++) { const X = wx + i * ww / (M - 1), Y = wy + wh / 2 - b[off + i] * g * wh * 0.5; i ? c.lineTo(X, Y) : c.moveTo(X, Y); }
            c.strokeStyle = col; c.lineWidth = lw; c.stroke(); });
          c.beginPath(); for (let i = 0; i < M; i++) { const X = wx + i * ww / (M - 1), Y = ry + rh / 2 - clamp((st.wo[off + i] - st.wi[off + i]) * 0.9 * dg, -1, 1) * rh * 0.5; i ? c.lineTo(X, Y) : c.moveTo(X, Y); }
          c.strokeStyle = th.orange; c.lineWidth = 1.5; c.stroke();
          txt(c, dx + 8, dy + dh - 5, `RMS ${st.rI.toFixed(1)} → ${st.rO.toFixed(1)} dB`, { color: th.dispText, align: "left" });
          txt(c, dx + dw - 8, dy + dh - 5, `Crest ${(st.pI - st.rI).toFixed(1)} → ${(st.pO - st.rO).toFixed(1)} dB`, { color: th.dispText, align: "right" });
        } },
    ],
  };
})();
