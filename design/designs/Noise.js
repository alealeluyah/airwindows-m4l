(function () {
  // ---- local helpers (this file only) ----
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const mean = v => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0.5);
  const lin = d => Math.pow(10, d / 20);
  const sq = x => x * x;
  const l2 = Math.log2;
  const TOP = HEAD_H, BOT = HEAD_H + DEVICE_H;
  const greyFill = () => (S.theme === "light" ? "#5e5e5e" : "#575757");
  // effect menu + step arrows; the name is shortened to fit the box (menu() in lib.js does not)
  const chrome = (c, th, x, y, mw, label) => {
    let s = S.effName || label; c.font = `400 9.5px ${FONT}`;
    const maxW = mw - 20;
    if (c.measureText(s).width > maxW) { while (s.length > 1 && c.measureText(s + "..").width > maxW) s = s.slice(0, -1); s += ".."; }
    const keep = S.effName; S.effName = s; menu(c, th, x, y, mw, s); S.effName = keep;
    arrows(c, th, x + mw + 4, y);
  };
  const gs = gainStrip;
  // ---- structure (RUBRIC 1, 8): tiles for selector and dials, a screen between them ----
  const Y0 = HEAD_H + 4, HH = DEVICE_H - 8;
  const noCtl = (c, th, x, y, w, h) => {
    txt(c, x + w / 2, y + h / 2 - 2, "No controls", { color: th.text, size: 10 });
    txt(c, x + w / 2, y + h / 2 + 11, "this effect has no dials", { color: th.dim, size: 8.5 });
  };
  // Left tile (menu + half the dials; Lw 0 = none), right tile (other half), gain strip at W - GAIN_W - 4.
  // menuInTile false: the caller puts the menu in the screen strip. Returns the screen rect.
  function frame(c, th, ps, vals, W, Lw, Rw, menuInTile) {
    const gx = W - GAIN_W - 4, half = Math.ceil(ps.length / 2);
    const L = Lw ? ps.slice(0, half) : [], R = Lw ? ps.slice(half) : ps;
    const hasR = R.length > 0 || !Lw, rtx = hasR ? gx - 2 - Rw : gx;
    const sx = Lw ? 4 + Lw + 2 : 4;
    if (Lw) {
      tile(c, th, 4, Y0, Lw, HH);
      const top = menuInTile ? 20 : 0;
      if (menuInTile) chrome(c, th, 8, Y0 + 4, Lw - 42, NAME);
      if (L.length) knobGrid(c, th, L, { x: 4, y: Y0 + top, w: Lw, h: HH - top + (menuInTile ? 4 : 0) }, 2, vals);
      else if (!ps.length) noCtl(c, th, 4, Y0, Lw, HH);
    }
    if (hasR) {
      tile(c, th, rtx, Y0, Rw, HH);
      if (R.length) knobGrid(c, th, R, { x: rtx, y: Y0, w: Rw, h: HH }, 2, vals);
      else noCtl(c, th, rtx, Y0, Rw, HH);
    }
    return { x: sx, y: Y0, w: rtx - 2 - sx, h: HH };
  }
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

  // ---- live (real measurement) helpers ----
  const lvArr = a => Array.isArray(a) && a.length >= 48;
  const lvF = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const lvPk = (a) => Math.max(lvF(a && a[0], -120), lvF(a && a[1], -120));
  const lvSm = (prev, v, up, dn) => (typeof prev !== "number" || !Number.isFinite(prev) ? v : prev + (v - prev) * (v > prev ? up : dn));
  // 48 measured bands -> the 72 display bins of this file
  function lvRes(a) {
    const o = new Array(NB);
    for (let i = 0; i < NB; i++) {
      const p = clamp(Math.log10(fOf(i) / 20) / 3 * 48 - 0.5, 0, 47), i0 = Math.floor(p), i1 = Math.min(47, i0 + 1), f = p - i0;
      o[i] = lvF(a[i0], -120) * (1 - f) + lvF(a[i1], -120) * f;
    }
    return o;
  }
  // peak level of the two channels with 24 dB/s release: feeds gainStrip
  function lvIO(st, m, dt) {
    st.inL = Math.max(lvPk(m.inPkDb), lvF(st.inL, -120) - 24 * dt);
    st.outL = Math.max(lvPk(m.outPkDb), lvF(st.outL, -120) - 24 * dt);
  }
  // per-band peak hold with a fall in dB/s; result kept in st[key]
  function lvHold(st, key, src, dt, rate) {
    const prev = st[key], o = new Array(48);
    for (let i = 0; i < 48; i++) o[i] = Math.max(lvF(src[i], -120), (prev ? prev[i] : -120) - rate * dt);
    return (st[key] = o);
  }
  // output minus input per band; held where the input is too quiet to compare
  function lvResp(st, key, mi, mo) {
    const prev = st[key] || new Array(48).fill(0), o = new Array(48);
    for (let i = 0; i < 48; i++) {
      const a = lvF(mi[i], -120), b = lvF(mo[i], -120);
      o[i] = a < -80 ? prev[i] : prev[i] + (clamp(b - a, -40, 40) - prev[i]) * 0.35;
    }
    return (st[key] = o);
  }
  const lvPow = v => Math.pow(10, lvF(v, -120) / 10);

  // level of (output - input) with 24 dB/s release, and the signal RMS
  function lvNoise(st, m, dt) {
    st.nz = Math.max(lvF(m.diffRmsDb, -120), lvF(st.nz, -120) - 24 * dt);
    st.sig = Math.max(lvF(m.inRmsDb, -120), lvF(st.sig, -120) - 24 * dt);
  }

  // ---- noise model: difference signal (out - in) with a floor and a tilt set by the dials ----
  const floorOf = vals => -78 + 48 * mean(vals);           // dBFS peak level of the added noise
  const shape = (f, m) => (m - 0.5) * 6 * l2(f / 1000);   // dB tilt across frequency
  const NAME = "DeNoise";
  // RUBRIC 2.6 for tiny signals: fit() zooms 1x..32x, so a decade scale S = 10^n first brings the
  // peak into that range. Returns the total gain (fit * S). Hysteresis keeps S from flickering.
  function fit10(h, key, pk) {
    const fk = "_fit_" + key, sk = "_s_" + key;
    let S = h[sk] || 1;
    while (pk * S > 1.2 && S > 1) { S /= 10; if (h[fk]) h[fk] = Math.min(32, h[fk] * 10); }
    while (pk * S < 0.03 && S < 1e8) { S *= 10; if (h[fk]) h[fk] = Math.max(1, h[fk] / 10); }
    h[sk] = S;
    return fit(h, key, pk * S) * S;
  }
  function stepN(st, dt) {
    const d = base(st, dt); specStep(st, dt, d);
    if (st.rms === undefined) { st.rms = 0; st.cols = []; st.colT = 0; for (let q = 80; q > 0; q--) st.cols.push({ e: drums(Math.max(0, st.t - q / 25)).env, j: Array.from({ length: 24 }, (_, r) => noise((Math.floor(st.t * 25) - q) * 3.7 + r * 11.3)) }); }
    st.rms += (st.a * 0.7 - st.rms) * Math.min(1, dt * 6);
    st.outL = Math.max(db(st.a + 0.41 * lin(st.fl === undefined ? -72 : st.fl)), st.outL - 24 * dt);
    st.colT += dt;
    if (st.colT >= 1 / 25) {
      st.colT = 0; const k = Math.floor(st.t * 25);
      st.cols.push({ e: d.env, j: Array.from({ length: 24 }, (_, r) => noise(k * 3.7 + r * 11.3)) });
      if (st.cols.length > 80) st.cols.shift();
    }
  }
  const tri = (i, k) => (noise(i * 1.7 + k * 13.1) + noise(i * 4.1 + k * 7.3)) / 2;
  const noRow = (c, th, ps, vals, area) => {
    if (!ps.length) { txt(c, area.x + area.w / 2, area.y + area.h / 2 - 2, "No controls", { color: th.text, size: 10 }); txt(c, area.x + area.w / 2, area.y + area.h / 2 + 11, "this effect has no dials", { color: th.dim, size: 8.5 }); }
    else knobGrid(c, th, ps, area, Math.max(1, ps.length), vals);
  };

  DESIGNS["Noise"] = {
    effect: "Noise",
    refs: [["EQEightL12.png", "EQ Eight (spectrum)"], ["AutoFilterL12.png", "Auto Filter"], ["SaturatorL12.png", "Saturator"]],
    lead: "Visual cue: how much noise the effect adds or removes, measured live as the difference between output and input (level and spectrum).",
    options: [
      { id: "A", name: "Zoom scope", short: "Zoom", width: 588, step: stepN,
        live(st, m, dt) {
          st.lv = 1; lvIO(st, m, dt); lvNoise(st, m, dt);
          const iL = Array.isArray(m.inScopeL) ? m.inScopeL : [], iR = Array.isArray(m.inScopeR) ? m.inScopeR : iL;
          const oL = Array.isArray(m.scopeL) ? m.scopeL : [], oR = Array.isArray(m.scopeR) ? m.scopeR : oL;
          const n = Math.min(iL.length, oL.length, 64), D = [];
          let pk = 0;
          for (let i = 0; i < n; i++) {
            const d = lvF((oL[i] + lvF(oR[i], oL[i])) / 2 - (iL[i] + lvF(iR[i], iL[i])) / 2, 0);
            D.push(d); pk = Math.max(pk, Math.abs(d));
          }
          st.ds = D;
          const rms = Math.pow(10, st.nz / 20);
          st.dpk0 = pk;
          st.dPk = lvSm(st.dPk, 20 * Math.log10(Math.max(pk, 1e-6)), 0.5, 0.2);
          // histogram of the difference samples, +/-3 rms in 13 bins, smoothed over frames
          const h = st.dh || (st.dh = new Array(13).fill(0)), cnt = new Array(13).fill(0), w = 3 * Math.max(rms, 1e-7);
          D.forEach(d => { cnt[clamp(Math.floor((d / w + 1) / 2 * 13), 0, 12)]++; });
          const mx = Math.max(1, ...cnt);
          for (let i = 0; i < 13; i++) h[i] += (cnt[i] / mx - h[i]) * 0.4;
        },
        why: "A very zoomed waveform that makes the noise visible sample by sample, with a noise-floor readout.",
        bullets: ["Cyan steps = difference samples (output minus input, 64 recent samples), auto-zoomed; orange lines mark the measured noise RMS. The grey input line is dropped in live mode: the signal is far bigger than the noise, so it cannot share the zoomed scale",
          "Histogram of the difference samples and a big noise-floor readout with effective bits",
          "Driven by the audio: RMS level of (output minus input), auto-zoomed to that level"],
        draw(c, th, st, ps, vals) {
          gs(c, th, 588 - GAIN_W - 4, st);
          const fl = floorOf(vals), nA = lin(fl), lv = !!st.lv; st.fl = fl; const k = Math.floor(st.t * 20);
          const { x: px, y: py, w: pw, h: ph } = frame(c, th, ps, vals, 588, 112, 106, true);
          screen(c, th, px, py, pw, ph);
          const sb = strip(c, th, px, py, pw, 19);
          strip(c, th, px, py + 107, pw, ph - 107, true);
          const sx = px + 8, sw = 190, sy = py + 23, sh = 76, mid = sy + sh / 2, NS = lv ? 64 : 40, stp = sw / NS;
          const rmsN = lv ? Math.pow(10, lvF(st.nz, -120) / 20) : nA * 0.41;
          // auto zoom of the difference samples (RUBRIC 2.6); the plot is centred on 0
          const G = fit10(st, "dz", lv ? Math.max(st.dpk0 || 0, rmsN * 1.5, 1e-7) : 5 * nA);
          txt(c, px + 8, sb, zoomText(G), { color: th.dispText, size: 8.5, align: "left" });
          hint(px + 6, py + 4, 60, 12, "Zoom", "The noise is enlarged so its loudest recent sample fills the scope. The number says by how much; a quieter noise gets a larger zoom.");
          rr(c, sx, sy, sw, sh, 0, th.meterBg);
          const Y = v => mid - clamp(v * G, -1, 1) * sh / 2;
          c.save(); c.beginPath(); c.rect(sx, sy, sw, sh); c.clip();
          c.strokeStyle = th.dline; c.lineWidth = 1; c.beginPath(); c.moveTo(sx, mid); c.lineTo(sx + sw, mid); c.stroke();
          c.strokeStyle = th.orange; c.lineWidth = 1; c.beginPath();
          c.moveTo(sx, Y(rmsN)); c.lineTo(sx + sw, Y(rmsN)); c.moveTo(sx, Y(-rmsN)); c.lineTo(sx + sw, Y(-rmsN)); c.stroke();
          if (lv) {
            // the difference samples (output - input), one step per sample
            const ds = st.ds || [];
            c.strokeStyle = th.cyan; c.lineWidth = 1.5; c.beginPath();
            ds.forEach((d, j) => { const y = Y(d); j ? c.lineTo(sx + j * stp, y) : c.moveTo(sx + j * stp, y); c.lineTo(sx + (j + 1) * stp, y); });
            c.stroke(); c.restore();
          } else {
          const sl = 3 * nA * clamp(st.a * 2, 0.3, 1.5), inv = j => sl * (j - NS / 2) / (NS / 2);
          c.strokeStyle = th.dispText; c.lineWidth = 1; c.beginPath(); c.moveTo(sx, Y(inv(0))); c.lineTo(sx + sw, Y(inv(NS))); c.stroke();
          c.strokeStyle = th.cyan; c.lineWidth = 1.5; c.beginPath();
          for (let j = 0; j < NS; j++) {
            const y = Y(inv(j) + nA * tri(j, k));
            j ? c.lineTo(sx + j * stp, y) : c.moveTo(sx + j * stp, y); c.lineTo(sx + (j + 1) * stp, y);
          }
          c.stroke(); c.restore();
          }
          legend(c, th, px + 70, sb, (lv ? [] : [[th.dispText, "In", "Grey line: the clean input signal, drawn as a reference."]]).concat([
            [th.cyan, "Out - in", "Cyan steps: output minus input, sample by sample. This is the noise."],
            [th.orange, "RMS", "Orange lines: the average size (RMS) of the noise, drawn above and below zero."]]));
          hint(sx, sy, sw, sh, "Difference Scope", "A very zoomed view of output minus input, one step per sample. If the effect adds no noise, the line is flat in the middle. Zoom adjusts to the noise level.");
          hint(sx, Y(rmsN) - 4, sw, 8, "RMS Line (Upper)", "The average size (RMS) of the noise. Measured from output minus input.");
          hint(sx, Y(-rmsN) - 4, sw, 8, "RMS Line (Lower)", "The same RMS level on the negative side of zero.");
          // histogram of difference samples
          const hx = sx + sw + 10, hw = pw - (hx - px) - 8, nb = 13, bw = hw / nb;
          txt(c, hx + hw / 2, sb, "Samples", { color: th.scale, size: 8.5 });
          for (let i = 0; i < nb; i++) {
            const u = (i - (nb - 1) / 2) / ((nb - 1) / 2), p = lv ? clamp((st.dh || [])[i] || 0, 0.02, 1) : clamp(Math.max(0, 1 - Math.abs(u)) + 0.07 * noise(i * 5 + k), 0.02, 1);
            c.fillStyle = th.cyan; c.fillRect(hx + i * bw + 0.5, sy + sh - p * sh, bw - 1, p * sh);
          }
          const floor = db(rmsN);
          hint(hx, sy, hw, sh, "Sample Histogram", "How often each size of noise sample occurs. A tall middle with thin sides is normal noise. Measured from output minus input.");
          hint(px + 8, py + 112, 180, 42, "Noise Floor", "Average level of the noise in dBFS (0 dBFS is full scale). Lower is quieter. Measured as the RMS of output minus input.");
          hint(px + pw - 70, py + 134, 62, 16, "Effective Bits", "How many bits of resolution remain above the noise. More bits means a cleaner sound.");
          hint(px + pw - 70, py + 112, 62, 12, "Noise Peak", "Largest noise sample seen recently, in dB.");
          txt(c, px + 8, py + 123, "Noise floor (RMS of out - in)", { color: th.scale, size: 8.5, align: "left" });
          txt(c, px + 8, py + 148, `${floor.toFixed(1)} dBFS`, { color: th.cyan, size: 17, bold: true, align: "left" });
          txt(c, px + pw - 8, py + 148, `~ ${Math.max(0, (-floor - 1.76) / 6.02).toFixed(1)} bit`, { color: th.orange, size: 10, align: "right" });
          txt(c, px + pw - 8, py + 123, `Peak ${(lv ? lvF(st.dPk, -120) : fl).toFixed(1)}`, { color: th.dispText, size: 8.5, align: "right" });
        } },
      { id: "B", name: "Floor spectrum", short: "Spectrum", width: 548, step: stepN,
        live(st, m, dt) {
          st.lv = 1; lvIO(st, m, dt); lvNoise(st, m, dt);
          if (!lvArr(m.specIn) || !lvArr(m.specOut)) return;
          st.lvI = lvRes(lvHold(st, "hI48", m.specIn, dt, 50));
          st.lvO = lvRes(lvHold(st, "hO48", m.specOut, dt, 50));
          if (lvArr(m.specDiff)) st.lvN = lvRes(lvHold(st, "hD48", m.specDiff, dt, 50));
        },
        why: "Signal spectrum with the added noise drawn as its own orange band, and SNR in the header, like EQ Eight's analyser.",
        bullets: ["Grey = input spectrum, orange = spectrum of (output minus input), cyan = output spectrum",
          "Header readouts: signal level, noise floor, signal-to-noise ratio",
          "Driven by the audio: FFT of input, output and their difference; the dial row sits underneath so 8 or more controls fit"],
        draw(c, th, st, ps, vals) {
          gs(c, th, 548 - GAIN_W - 4, st);
          const m = mean(vals), fl = floorOf(vals), nA = lin(fl), lv = !!st.lv; st.fl = fl;
          const px = 4, py = Y0, pw = 548 - GAIN_W - 4 - 2 - 4, ph = 105;
          screen(c, th, px, py, pw, ph);
          strip(c, th, px, py, pw, 22);
          const bb = strip(c, th, px, py + ph - 14, pw, 14, true);
          chrome(c, th, px + 6, py + 4, 84, NAME);
          // dial row in its own tile under the screen
          const dy = py + ph + 2, dh = HH - ph - 2;
          tile(c, th, px, dy, pw, dh);
          if (!ps.length) noCtl(c, th, px, dy, pw, dh);
          else knobGrid(c, th, ps, { x: px, y: dy + 2, w: pw, h: 50 }, ps.length, vals, Math.min(52, (pw - 8) / ps.length));
          const sp = lv ? st.lvI || new Array(NB).fill(-120) : st.spI || new Array(NB).fill(-90);
          const sig = lv ? lvF(st.sig, -120) : db(st.rms || 0.01), nz = lv ? lvF(st.nz, -120) : db(nA * 0.41);
          [["Signal", sig.toFixed(1), th.cyan, 150], ["Noise", nz.toFixed(1), th.orange, 255], ["SNR", (sig - nz).toFixed(1) + " dB", th.green, 360]].forEach(([l, v, col, o]) => {
            txt(c, px + o, py + 14, l, { color: th.dispText, size: 9, align: "left" });
            txt(c, px + o + (l === "SNR" ? 22 : 33), py + 14, v, { color: col, size: 9, align: "left" });
          });
          const gx = px + 24, gy = py + 26, gw = pw - 48, gh = 52;
          legend(c, th, px + 8, bb, [
            [greyFill(), "Input", "Grey area: spectrum of the signal going in."],
            [th.orange, "Noise", "Orange area: spectrum of output minus input. This is the noise the effect adds."],
            [th.cyan, "Output", "Cyan line: spectrum of the signal coming out."]]);
          hint(px + 148, py + 4, 100, 14, "Signal Level", "Average level of the input signal in dB. Measured as RMS.");
          hint(px + 253, py + 4, 100, 14, "Noise Level", "Average level of the added noise in dB. Measured as RMS of output minus input.");
          hint(px + 358, py + 4, 80, 14, "Signal-to-Noise Ratio", "Signal level minus noise level, in dB. Higher is cleaner.");
          hint(gx, gy, gw, gh, "Spectrum Display", "Frequency from 20 Hz to 20 kHz, left to right. Grey area: input. Orange area: added noise. Cyan line: output. Measured with an FFT.");
          hint(gx - 24, gy, 24, gh, "Level Scale", "Level in dB. Higher is louder.");
          hint(gx, py + 80, gw, 10, "Frequency Scale", "Frequency in Hz. Bass is at the left, treble at the right.");
          const Y = v => gy + gh * (1 - clamp((v + 100) / 94, 0, 1));
          const noiseDb = [], outDb = [];
          for (let i = 0; i < NB; i++) {
            if (lv) { noiseDb.push(st.lvN ? st.lvN[i] : -120); outDb.push(st.lvO ? st.lvO[i] : -120); continue; }
            const n = fl - 14 + shape(fOf(i), m) + 2 * noise(i * 3 + Math.floor(st.t * 18));
            noiseDb.push(n); outDb.push(10 * Math.log10(Math.pow(10, sp[i] / 10) + Math.pow(10, n / 10)));
          }
          c.save(); c.beginPath(); c.rect(gx, gy, gw, gh); c.clip();
          vgrid(c, th, gx, gy, gw, gh);
          c.fillStyle = greyFill(); c.beginPath(); c.moveTo(gx, gy + gh);
          for (let i = 0; i < NB; i++) c.lineTo(gx + gw * i / (NB - 1), Y(sp[i]));
          c.lineTo(gx + gw, gy + gh); c.fill();
          c.globalAlpha = 0.35; c.fillStyle = th.orange; c.beginPath(); c.moveTo(gx, gy + gh);
          for (let i = 0; i < NB; i++) c.lineTo(gx + gw * i / (NB - 1), Y(noiseDb[i]));
          c.lineTo(gx + gw, gy + gh); c.fill(); c.globalAlpha = 1;
          c.strokeStyle = th.orange; c.lineWidth = 1.5; c.beginPath();
          for (let i = 0; i < NB; i++) { const x = gx + gw * i / (NB - 1); i ? c.lineTo(x, Y(noiseDb[i])) : c.moveTo(x, Y(noiseDb[i])); }
          c.stroke();
          c.strokeStyle = th.cyan; c.lineWidth = 1.5; c.beginPath();
          for (let i = 0; i < NB; i++) { const x = gx + gw * i / (NB - 1); i ? c.lineTo(x, Y(outDb[i])) : c.moveTo(x, Y(outDb[i])); }
          c.stroke(); c.restore();
          [-20, -40, -60, -80].forEach(v => txt(c, gx - 3, Y(v) + 3, String(v), { color: th.scale, size: 8.5, align: "right" }));
          hzLabels(c, th, gx, py + 88, gw);
        } },
      { id: "C", name: "Spectrogram", short: "Sonogram", width: 588, step: stepN,
        live(st, m, dt) {
          st.lv = 1; lvIO(st, m, dt); lvNoise(st, m, dt);
          // one column per measurement (about 30 per second)
          const src = lvArr(m.specDiff) ? m.specDiff : new Array(48).fill(-120), col = [];
          for (let r = 0; r < 24; r++) col.push((lvF(src[2 * r], -120) + lvF(src[2 * r + 1], -120)) / 2);
          st.lcols = st.lcols || [];
          st.lcols.push(col); if (st.lcols.length > 80) st.lcols.shift();
        },
        why: "A scrolling spectrogram of only the added or removed signal, with a noise-floor meter, like a Spectrum device.",
        bullets: ["Time runs right to left, frequency bottom (20 Hz) to top (20 kHz); brighter orange = more noise",
          "Vertical meter and big number show the current noise floor in dBFS",
          "Driven by the audio: short-time FFT of (output minus input)"],
        draw(c, th, st, ps, vals) {
          gs(c, th, 588 - GAIN_W - 4, st);
          const m = mean(vals), fl = floorOf(vals), lv = !!st.lv; st.fl = fl;
          const { x: px, y: py, w: pw, h: ph } = frame(c, th, ps, vals, 588, 112, 106, true);
          screen(c, th, px, py, pw, ph);
          const sb = strip(c, th, px, py, pw, 19);
          const bb = strip(c, th, px, py + ph - 18, pw, 18, true);
          const sx = px + 28, sy = py + 22, sw = 204, rows = 24, rh = 4, sh = rows * rh, cw = 3;
          txt(c, sx, sb, "Added / removed signal", { color: th.scale, size: 8.5, align: "left" });
          c.fillStyle = th.meterBg; c.fillRect(sx, sy, sw, sh);
          c.save(); c.beginPath(); c.rect(sx, sy, sw, sh); c.clip();
          const cols = (lv ? st.lcols : st.cols) || [], nc = Math.min(cols.length, Math.floor(sw / cw));
          c.fillStyle = th.orange;
          for (let ci = 0; ci < nc; ci++) {
            const col = cols[cols.length - 1 - ci], x = sx + sw - (ci + 1) * cw;
            for (let r = 0; r < rows; r++) {
              if (lv) { c.globalAlpha = clamp((lvF(col[r], -120) + 80) / 40, 0.03, 1); c.fillRect(x, sy + sh - (r + 1) * rh, cw, rh); continue; }
              const f = 20 * Math.pow(1000, (r + 0.5) / rows);
              const v = fl - 8 + shape(f, m) + 8 * col.e * (r < 8 ? 1 : 0.5) + 3 * col.j[r] - 6 * r / rows + 3;
              c.globalAlpha = clamp((v - fl + 18) / 26, 0.05, 1) * 0.95;
              c.fillRect(x, sy + sh - (r + 1) * rh, cw, rh);
            }
          }
          c.globalAlpha = 1; c.restore();
          [[20000, "20k"], [1000, "1k"], [100, "100"]].forEach(([f, s]) =>
            txt(c, sx - 3, sy + sh - sh * Math.log10(f / 20) / 3 + (f > 10000 ? 8 : 3), s, { color: th.scale, size: 8.5, align: "right" }));
          txt(c, sx + sw, py + 130, "now", { color: th.scale, size: 8.5, align: "right" });
          txt(c, sx, py + 130, "2 s ago", { color: th.scale, size: 8.5, align: "left" });
          legend(c, th, px + 8, bb, [
            [th.orange, "Noise level", lv ? "Orange colour: noise in each band. Dim is -80 dB or lower, bright is -40 dB or higher. The Floor meter uses the same colour." : "Orange colour: noise in each band. Dim is at the floor, bright is 10 dB above it. The Floor meter uses the same colour."],
            [th.cyan, "Floor reading", "Cyan number: the average level of the noise now, in dBFS."]]);
          hint(sx, sy, sw, sh, "Noise Spectrogram", "Frequency goes up, time goes left. Brighter orange means more noise at that frequency. Measured with an FFT of output minus input.");
          hint(sx - 28, sy, 26, sh, "Frequency Scale", "Frequency in Hz. 20 Hz at the bottom, 20 kHz at the top.");
          hint(sx, py + 121, sw, 11, "Time Scale", "Time runs from the left (older) to the right (now).");
          // noise floor meter
          const mx = px + 262, mw = 12;
          txt(c, mx + mw / 2 + 2, sb, "Floor", { color: th.dispText, size: 8.5 });
          hint(mx - 2, sy, mw + 6, sh, "Noise Floor Meter", "Bar height shows the average noise level now. Taller means more noise. Measured as RMS of output minus input.");
          hint(mx - 24, sy, 22, sh, "Floor Scale", "Noise level in dB.");
          hint(mx - 8, py + 121, 32, 22, "Noise Floor Reading", "The noise level now as a number, in dBFS (0 is full scale). Lower is quieter.");
          const rmsDb = lv ? lvF(st.nz, -120) : fl - 7.7, lo = lv ? 100 : 110, span = lv ? 80 : 60;
          meterV(c, th, mx, sy, mw, sh, clamp((rmsDb + lo) / span, 0, 1), false, th.orange);
          (lv ? [-30, -50, -70, -90] : [-60, -80, -100]).forEach(v => { const yy = sy + sh * (1 - (v + lo) / span); c.fillStyle = th.scale; c.fillRect(mx + mw, yy, 3, 1); txt(c, mx - 2, yy + 3, String(v), { color: th.scale, size: 8, align: "right" }); });
          txt(c, mx + mw / 2 + 2, py + 130, Math.max(-120, rmsDb).toFixed(1), { color: th.cyan, size: 11, bold: true });
          txt(c, mx + mw / 2 + 2, py + 139, "dBFS", { color: th.scale, size: 8.5 });
        } },
    ],
  };
})();
