// Subtlety: design options. Helpers (knob, menu, meterV, …) come from app.js.
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
  // Fixed magnification of the difference wave (output minus input). The difference is tiny, so it is drawn
  // 16x (+24 dB) larger than the true level; chosen for typical material, never computed from the signal.
  const DIFF_GAIN = 16;
  function ctl(c, th, ps, area, cols, vals, cw) {
    tile(c, th, area.x, area.y, area.w, area.h);
    if (!ps.length) { txt(c, area.x + area.w / 2, area.y + area.h / 2 + 3, "No controls", { color: th.dim }); return; }
    knobGrid(c, th, ps, area, cols, vals, cw);
  }
  // ---- Subtlety simulation: a very small, level-dependent change (out = in + a little) ----
  const M = 120, SQ = Math.SQRT1_2;
  const proc = v => v + 0.05 * v * v * v + 0.018 * (v * v - 0.2);
  function stepSub(st, dt) {
    if (!st.xl) { st.xl = []; st.xr = []; st.yl = []; st.yr = []; st.ph = 0; st.cnt = 0; st.nul = -30; st.rmsI = -20; st.cI = 0.8; st.cO = 0.8;
      st.mI = -20; st.mO = -20; st.sI = -26; st.sO = -26; st.sp = Array(NB).fill(-90); st.rp = Array(NB).fill(-90); st.peakBin = 60; st.prev = 0; }
    const d = drums(st.t), amp = 0.12 + 0.7 * Math.pow(d.env, 0.8);
    for (let k = 0; k < 6; k++) {
      st.ph += 0.35;
      const mid = amp * (0.7 * Math.sin(st.ph) + 0.3 * Math.sin(2.7 * st.ph + 0.8)) + 0.12 * d.hat * noise(st.cnt++);
      const side = 0.5 * amp * Math.sin(1.3 * st.ph + 1) * (0.6 + 0.4 * Math.sin(st.t * 0.9));
      const l = (mid + side) * 0.8, r = (mid - side) * 0.8;
      const ro = 0.97 * r + 0.03 * st.prev; st.prev = r;
      st.xl.push(l); st.xr.push(r); st.yl.push(proc(l)); st.yr.push(proc(ro));
      if (st.xl.length > M) { st.xl.shift(); st.xr.shift(); st.yl.shift(); st.yr.shift(); }
    }
    if (st.xl.length < M) return;
    const rms = a => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length), pk = a => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    const res = st.yl.map((v, i) => v - st.xl[i]);
    const rI = db(rms(st.xl)), rR = db(rms(res));
    st.rmsI = rI; st.nul += ((rR - rI) - st.nul) * 0.25;
    const corr = (a, b) => { let s = 0, p = 0, q = 0; for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; p += a[i] * a[i]; q += b[i] * b[i]; } return s / Math.sqrt(p * q + 1e-9); };
    st.cI += (corr(st.xl, st.xr) - st.cI) * 0.3; st.cO += (corr(st.yl, st.yr) - st.cO) * 0.3;
    const mid = (a, b) => a.map((v, i) => (v + b[i]) / 2), sid = (a, b) => a.map((v, i) => (v - b[i]) / 2);
    st.mI = db(rms(mid(st.xl, st.xr))); st.mO = db(rms(mid(st.yl, st.yr))); st.sI = db(rms(sid(st.xl, st.xr))); st.sO = db(rms(sid(st.yl, st.yr)));
    const a = inSpec(st.t), rp = a.map((v, i) => clamp(v - 26 + 13 * gs(L2(fq(i)) - L2(2500), 1.3) + 2 * noise(i * 3 + Math.floor(st.t * 8)), -90, -6));
    smoothSpec(st.sp, a, dt); smoothSpec(st.rp, rp, dt);
    let best = -99, bi = 0; for (let i = 0; i < NB; i++) { const dd = st.rp[i] - st.sp[i]; if (st.sp[i] > -80 && dd > best) { best = dd; bi = i; } }
    st.peakBin = bi;
    st.inL = Math.max(rI + 3, st.inL - 24 * dt); st.outL = Math.max(db(pk(st.yl)), st.outL - 24 * dt);
  }
  // ---- real measurements ----
  const fin = (v, d) => Number.isFinite(v) ? v : d;
  const pkOf = a => Math.max(fin(a && a[0], -120), fin(a && a[1], -120));
  const toBins = (a48, def) => {
    const o = new Array(NB);
    for (let i = 0; i < NB; i++) {
      const pos = clamp(Math.log(fq(i) / 20) / Math.log(1000) * 48 - 0.5, 0, 47), j = Math.floor(pos), u = pos - j, j2 = Math.min(47, j + 1);
      const a = a48 && a48.length > j2 ? fin(a48[j], def) : def, b = a48 && a48.length > j2 ? fin(a48[j2], def) : def;
      o[i] = a + (b - a) * u;
    }
    return o;
  };
  function liveSub(st, m, dt) {
    if (!st.lv) { st.lv = true; st.xl = []; st.xr = []; st.yl = []; st.yr = []; st.nul = -60; st.rmsI = -60; st.cI = 1; st.cO = 1;
      st.mI = -120; st.mO = -120; st.sI = -120; st.sO = -120; st.sp = Array(NB).fill(-90); st.rp = Array(NB).fill(-90); st.peakBin = -1; }
    const sm = (p, v, k) => p + (fin(v, -120) - p) * k;
    // scopes: about 5 ms of input and output samples, both channels
    const a = m.inScopeL || [], b = m.inScopeR || [], c2 = m.scopeL || [], d2 = m.scopeR || [];
    const n = Math.min(a.length, b.length, c2.length, d2.length);
    if (n >= 16) {
      const cl = v => clamp(fin(v, 0), -1.5, 1.5);
      st.xl = a.slice(0, n).map(cl); st.xr = b.slice(0, n).map(cl); st.yl = c2.slice(0, n).map(cl); st.yr = d2.slice(0, n).map(cl);
    }
    // residual level relative to the input (null test), from the RMS of out - in
    st.rmsI = sm(st.rmsI, m.inRmsDb, 0.3);
    st.nul = clamp(sm(st.nul, fin(m.diffRmsDb, -120) - fin(m.inRmsDb, -120), 0.25), -120, 20);
    // stereo field: input correlation from mid/side (M and S are uncorrelated: (M2 - S2) / (M2 + S2)), output correlation measured
    const ms = m.ms || [], pw = v => Math.pow(10, fin(v, -120) / 10);
    const cs = (mm, ss) => (pw(mm) - pw(ss)) / (pw(mm) + pw(ss) + 1e-12);
    if (ms.length >= 4) {
      st.cI += (clamp(cs(ms[0], ms[1]), -1, 1) - st.cI) * 0.3;
      st.mI = sm(st.mI, ms[0], 0.3); st.sI = sm(st.sI, ms[1], 0.3); st.mO = sm(st.mO, ms[2], 0.3); st.sO = sm(st.sO, ms[3], 0.3);
    }
    st.cO += (clamp(fin(m.corr, 1), -1, 1) - st.cO) * 0.3;
    // spectra: input, and the difference (out - in) itself
    if ((m.specIn || []).length >= 48 && (m.specDiff || []).length >= 48) {
      smoothSpec(st.sp, toBins(m.specIn, -120), dt); smoothSpec(st.rp, toBins(m.specDiff, -120), dt);
      let best = -999, bi = -1;
      for (let i = 0; i < NB; i++) { const dd = st.rp[i] - st.sp[i]; if (st.sp[i] > -80 && st.rp[i] > -100 && dd > best) { best = dd; bi = i; } }
      st.peakBin = bi;
    }
    st.inL = Math.max(pkOf(m.inPkDb), (Number.isFinite(st.inL) ? st.inL : -60) - 24 * dt);
    st.outL = Math.max(pkOf(m.outPkDb), (Number.isFinite(st.outL) ? st.outL : -60) - 24 * dt);
  }
  const NAME = "Mastering2";

  DESIGNS["Subtlety"] = {
    effect: "Mastering2",
    refs: [["UtilityL12.png", "Utility"], ["SaturatorL12.png", "Saturator"], ["EQEightL12.png", "EQ Eight"]],
    lead: "Visual cue: the effect is quiet, so the display shows only what changed — output minus input, magnified so you can see it.",
    options: [
      { id: "A", name: "Difference scope", short: "Null test", width: 638, step: stepSub, live: liveSub,
        why: "Input and output waves on top of each other, with the small difference between them drawn large underneath — a live null test.",
        bullets: ["Driven by output minus input samples (null test), difference drawn at a fixed ×16 magnification", "Readout: residual level in dB below the input; the difference lane is labelled ×16", "Dials in a block on the left (up to 7 fit)"],
        draw(c, th, st, ps, vals) {
          gainStrip(c, th, this.width - GAIN_W - 4, st);
          ctl(c, th, ps, { x: 4, y: HEAD_H + 4, w: 160, h: DEVICE_H - 8 }, 2, vals);
          const dx = 166, dy = HEAD_H + 4, dw = 402, dh = DEVICE_H - 8;
          screen(c, th, dx, dy, dw, dh); dispHead(c, th, dx, dy + 2, NAME);
          strip(c, th, dx, dy, dw, 22); strip(c, th, dx, dy + dh - 18, dw, 18, true);
          legend(c, th, dx + dw - 140, dy + 15, [
            [th.dispText, "In", "Thick grey wave: the sound going into the effect."],
            [th.cyan, "Out", "Thin cyan wave: the sound coming out of the effect. It lies almost on top of the grey wave."],
            [th.orange, "Difference", "Orange wave in the lower panel: output minus input, drawn 16 times larger (fixed) so you can see it. A flat line means the effect changed nothing."]], { line: true });
          hint(dx, dy, dw, dh, "Null Test Display", "Subtracts the input from the output, so you see only what the effect changed. Measured from the input and output samples.");
          hint(dx + 8, dy + 25, dw - 16, 51, "Input And Output Waves", "A few milliseconds of the input (grey) and the output (cyan), drawn on top of each other.");
          hint(dx + 8, dy + 81, dw - 16, 58, "Difference Wave", "Output minus input, drawn 16 times larger than the true level (a fixed magnification, not adjusted to the signal). The bigger the wave, the more the effect changes the sound.");
          hint(dx + 6, dy + dh - 15, 190, 12, "Residual Readout", "How loud the difference is compared with the input, in dB. A lower number means a more subtle effect.");
          hint(dx + dw - 150, dy + dh - 15, 142, 12, "Input Level Readout", "Average (RMS) level of the input, in dB.");
          const wx = dx + 8, ww = dw - 16, wy = dy + 25, wh = 51, ry = dy + 81, rh = 58;
          strip(c, th, dx, dy + 78, dw, 0, true);
          c.fillStyle = th.dline; c.fillRect(wx, wy + wh / 2, ww, 1); c.fillRect(wx, ry + rh / 2, ww, 1);
          if (!st.xl || st.xl.length < 16) return;
          const M = st.xl.length;
          // fixed scale (RUBRIC 2.6): input and output at true level, 1x
          const g = 1;
          const line = (b, mid, hh, k, col, lw) => { c.beginPath(); for (let i = 0; i < M; i++) { const X = wx + i * ww / (M - 1), Y = mid - b(i) * k * hh; i ? c.lineTo(X, Y) : c.moveTo(X, Y); }
            c.strokeStyle = col; c.lineWidth = lw; c.stroke(); };
          clipTo(c, wx, wy, ww, wh);
          line(i => st.xl[i], wy + wh / 2, wh, 0.5 * g, th.dispText, 3); line(i => st.yl[i], wy + wh / 2, wh, 0.5 * g, th.cyan, 1.3);
          c.restore(); clipTo(c, wx, ry, ww, rh);
          line(i => st.yl[i] - st.xl[i], ry + rh / 2, rh, 0.46 * DIFF_GAIN, th.orange, 1.8);
          c.restore();
          txt(c, wx + 4, ry + 9, `Difference ×${DIFF_GAIN} (+${(20 * Math.log10(DIFF_GAIN)).toFixed(0)} dB, fixed)`, { color: th.orange, size: 8.5, align: "left" });
          txt(c, dx + 10, dy + dh - 5, `Residual ${st.nul.toFixed(1)} dB re input`, { color: th.orange, align: "left" });
          txt(c, dx + dw - 8, dy + dh - 5, `Input ${st.rmsI.toFixed(1)} dB RMS`, { color: th.dispText, align: "right" });
        } },
      { id: "B", name: "Residual spectrum", short: "Residual", width: 608, step: stepSub, live: liveSub,
        why: "The spectrum of the difference signal sits over the spectrum of the input, so you see where the effect is working, plus a 'how big' bar — like EQ Eight's analyser.",
        bullets: ["Driven by FFT of (output − input) against FFT of the input", "Marker shows the frequency where the change is largest compared to the input", "Bar = residual level relative to input, scale −60 to 0 dB"],
        draw(c, th, st, ps, vals) {
          gainStrip(c, th, this.width - GAIN_W - 4, st);
          const dx = 4, dy = HEAD_H + 4, dw = 386, dh = DEVICE_H - 8;
          screen(c, th, dx, dy, dw, dh); dispHead(c, th, dx, dy + 2, NAME);
          strip(c, th, dx, dy, dw, 22); strip(c, th, dx, dy + dh - 38, dw, 38, true);
          ctl(c, th, ps, { x: 392, y: HEAD_H + 4, w: 146, h: DEVICE_H - 8 }, 2, vals);
          const px = dx + 30, py = dy + 26, pw = dw - 38, ph = 86;
          c.strokeStyle = th.dline; c.lineWidth = 1;
          [-20, -40, -60, -80].forEach(v => { const Y = sY(v, py, ph); c.beginPath(); c.moveTo(px, Y); c.lineTo(px + pw, Y); c.stroke(); txt(c, dx + 4, Y + 3, String(v), { color: th.scale, size: 8.5, align: "left" }); });
          [100, 1000, 10000].forEach((f, k) => { const X = lx(f, px, pw); c.beginPath(); c.moveTo(X, py); c.lineTo(X, py + ph); c.stroke(); txt(c, X, py + ph + 10, ["100", "1k", "10k"][k], { color: th.scale, size: 8.5 }); });
          legend(c, th, dx + dw - 138, dy + 15, [
            [greyF(), "Input", "Grey area: the spectrum of the sound going into the effect."],
            [th.orange, "Difference", "Orange area: the spectrum of output minus input. It shows where the effect works. The orange bar below uses the same colour."],
            [th.cyan, "Peak", "Cyan vertical line: the frequency where the change is largest compared with the input."]], { gap: 5 });
          hint(dx, dy, dw, dh, "Residual Spectrum Display", "Shows by frequency what the effect changed. Low is on the left, high on the right. Measured from the input and from output minus input.");
          hint(px, py, pw, ph, "Spectrum Plot", "Orange is the change, grey is the input. Where orange comes close to grey, the effect changes that frequency strongly.");
          hint(dx + 2, py, 26, ph, "Level Scale", "Level in dB for both spectra.");
          hint(px, py + ph, pw, 12, "Frequency Scale", "Frequency in Hz, low on the left and high on the right (100, 1k = 1000 Hz, 10k = 10000 Hz).");
          hint(dx + 145, dy + 4, 80, 14, "Peak Readout", "The frequency where the change is largest compared with the input. Shown as a cyan line in the plot.");
          hint(dx + 8, dy + dh - 33, dw - 16, 28, "Residual Bar", "How loud the change is compared with the input, from -60 to 0 dB. A short bar means a subtle effect.");
          txt(c, dx + 8, dy + dh - 26, "Residual vs input", { color: th.scale, size: 8.5, align: "left" });
          const bx = dx + 8, bw = dw - 16, by = dy + dh - 21;
          rr(c, bx, by, bw, 7, 2, th.meterBg);
          [-60, -40, -20, 0].forEach(v => { txt(c, bx + bw * (v + 60) / 60, dy + dh - 5, v === 0 ? "0 dB" : String(v), { color: th.scale, size: 8, align: v === 0 ? "right" : v === -60 ? "left" : "center" }); });
          if (!st.sp) return;
          clipTo(c, px, py, pw, ph);
          specPath(c, st.sp, px, py, pw, ph, true); c.fillStyle = greyF(); c.fill();
          specPath(c, st.rp, px, py, pw, ph, true); c.globalAlpha = 0.45; c.fillStyle = th.orange; c.fill(); c.globalAlpha = 1;
          specPath(c, st.rp, px, py, pw, ph, false); c.strokeStyle = th.orange; c.lineWidth = 1.2; c.stroke();
          if (st.peakBin >= 0) { const mx = lx(fq(st.peakBin), px, pw); c.strokeStyle = th.cyan; c.beginPath(); c.moveTo(mx, py); c.lineTo(mx, py + ph); c.stroke(); }
          c.restore();
          txt(c, dx + 150, dy + 15, st.peakBin < 0 ? "No change" : `Peak ${(fq(st.peakBin) / 1000).toFixed(2)} kHz`, { color: th.cyan, align: "left" });
          c.fillStyle = th.orange; c.fillRect(bx, by, bw * clamp((st.nul + 60) / 60, 0, 1), 7);
          txt(c, dx + dw - 8, dy + dh - 26, `${st.nul.toFixed(1)} dB`, { color: th.orange, align: "right" });
        } },
      { id: "C", name: "Stereo field", short: "Stereo", width: 588, step: stepSub, live: liveSub,
        why: "A vectorscope with correlation and mid/side meters, input against output — shows if the effect changes the width or phase of the stereo image.",
        bullets: ["Driven by the left and right samples, in and out: vectorscope, correlation, mid and side level", "Grey dots = input, cyan dots = output; tall line = mono, wide cloud = wide", "Dials in a block on the left (up to 7 fit)"],
        draw(c, th, st, ps, vals) {
          gainStrip(c, th, this.width - GAIN_W - 4, st);
          ctl(c, th, ps, { x: 4, y: HEAD_H + 4, w: 160, h: DEVICE_H - 8 }, 2, vals);
          const dx = 166, dy = HEAD_H + 4, dw = 352, dh = DEVICE_H - 8;
          screen(c, th, dx, dy, dw, dh); dispHead(c, th, dx, dy + 2, NAME);
          strip(c, th, dx, dy, dw, 22); strip(c, th, dx, dy + dh - 18, dw, 18, true);
          const sx = dx + 10, sy = dy + 27, sz = 112, cx = sx + sz / 2, cy = sy + sz / 2;
          c.strokeStyle = th.dline; c.lineWidth = 1; c.strokeRect(sx + 0.5, sy + 0.5, sz - 1, sz - 1);
          c.strokeStyle = th.dline; c.lineWidth = 1;
          c.beginPath(); c.moveTo(cx, sy); c.lineTo(cx, sy + sz); c.moveTo(sx, cy); c.lineTo(sx + sz, cy); c.moveTo(sx, sy); c.lineTo(sx + sz, sy + sz); c.moveTo(sx + sz, sy); c.lineTo(sx, sy + sz); c.stroke();
          txt(c, cx, sy + 9, "M", { color: th.scale, size: 8.5 }); txt(c, sx + sz - 7, cy - 2, "S", { color: th.scale, size: 8.5 });
          const rx = dx + 134, rw = 140, tx = dx + dw - 8;
          legend(c, th, dx + dw - 74, dy + 15, [
            [th.dispText, "In", "Grey: the stereo signal going into the effect."],
            [th.cyan, "Out", "Cyan: the stereo signal coming out of the effect."]]);
          hint(dx, dy, dw, dh, "Stereo Display", "Shows how wide the stereo image is, before and after the effect. Measured from the left and right samples.");
          hint(sx, sy, sz, sz, "Vectorscope", "Each dot is one moment of the sound. A tall thin line means mono. A wide cloud means wide stereo. M is mid (centre), S is side.");
          hint(rx, dy + 24, 200, 36, "Correlation Meters", "Shows how alike left and right are, from -1 to +1. +1 is mono, 0 is wide, below 0 means the channels cancel each other.");
          hint(rx, dy + 66, 200, 56, "Mid / Side Level", "Level of the centre (mid) and the sides, in dB, input (grey) and output (cyan).");
          hint(dx + 8, dy + dh - 15, 200, 12, "Width Change Readout", "Side level minus mid level, input then output, in dB. A higher number means a wider sound.");
          txt(c, rx, dy + 33, "Correlation  −1 … +1", { color: th.scale, size: 8.5, align: "left" });
          txt(c, rx, dy + 77, "Mid / Side level", { color: th.scale, size: 8.5, align: "left" });
          const row = (y, lab, col) => { txt(c, rx, y + 7, lab, { color: col, size: 8.5, align: "left" }); rr(c, rx + 32, y, rw, 8, 2, th.meterBg); };
          row(dy + 37, "In", th.dispText); row(dy + 49, "Out", th.cyan);
          row(dy + 81, "M in", th.dispText); row(dy + 91, "M out", th.cyan); row(dy + 105, "S in", th.dispText); row(dy + 115, "S out", th.cyan);
          c.fillStyle = th.dline; c.fillRect(rx + 32 + rw / 2, dy + 37, 1, 20);
          if (!st.xl || st.xl.length < 16) return;
          const M = st.xl.length;
          // fixed scale (RUBRIC 2.6): true level, 1x
          const g = 1;
          clipTo(c, sx, sy, sz, sz);
          [[st.xl, st.xr, th.dispText], [st.yl, st.yr, th.cyan]].forEach(([a, b, col]) => { c.fillStyle = col;
            for (let i = 0; i < M; i++) c.fillRect(cx + (a[i] - b[i]) * SQ * g * sz * 0.5 - 1, cy - (a[i] + b[i]) * SQ * g * sz * 0.5 - 1, 2, 2); });
          c.restore();
          const cm = v => rx + 32 + rw * (clamp(v, -1, 1) + 1) / 2;
          c.fillStyle = th.dispText; c.fillRect(cm(st.cI) - 1.5, dy + 36, 3, 10); c.fillStyle = th.cyan; c.fillRect(cm(st.cO) - 1.5, dy + 48, 3, 10);
          txt(c, tx, dy + 45, f1(st.cI), { color: th.dispText, align: "right" }); txt(c, tx, dy + 57, f1(st.cO), { color: th.cyan, align: "right" });
          const lv = v => rw * (clamp(v, -60, 0) + 60) / 60;
          [[dy + 81, st.mI, th.dispText], [dy + 91, st.mO, th.cyan], [dy + 105, st.sI, th.dispText], [dy + 115, st.sO, th.cyan]].forEach(([y, v, col]) => {
            c.fillStyle = col; c.fillRect(rx + 32, y, lv(v), 8); txt(c, tx, y + 8, v.toFixed(1), { color: col, align: "right" }); });
          txt(c, dx + 8, dy + dh - 5, `Side vs mid  ${f1(st.sI - st.mI)} → ${f1(st.sO - st.mO)} dB`, { color: th.dispText, align: "left" });
        } },
    ],
  };
})();
