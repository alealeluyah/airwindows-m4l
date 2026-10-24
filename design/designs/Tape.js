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

  // ---- tape model: soft saturation with a little bias, normalised to 1 at full scale ----
  const drv = vals => 1 + 2 * mean(vals);
  const tf = (x, k) => (Math.tanh(k * x + 0.1) - Math.tanh(0.1)) / (Math.tanh(k + 0.1) - Math.tanh(0.1));
  const gainDb = (a, k) => db(Math.abs(tf(Math.max(a, 0.02), k)) / Math.max(a, 0.02));
  const tresp = (f, m) => (1.5 + 3 * m) * gauss(f, 70, 0.8) - (0.5 + 3 * m) * sq(f / 12000) - (f < 35 ? 4 * sq(l2(35 / f)) : 0);
  const stepT = (st, dt) => {
    const d = base(st, dt); specStep(st, dt, d);
    st.outL = Math.max(db(Math.abs(tf(st.a, st.k || 2))), st.outL - 24 * dt);
  };
  const NAME = "ToTape7";

  // harmonic amplitudes 1..8 of the output for a sine of peak a
  function harmonics(a, k) {
    const N = 48, out = [];
    for (let n = 1; n <= 8; n++) {
      let s = 0, co = 0;
      for (let j = 0; j < N; j++) { const ph = 2 * Math.PI * j / N, y = tf(a * Math.sin(ph), k); s += y * Math.sin(n * ph); co += y * Math.cos(n * ph); }
      out.push(Math.hypot(s, co) * 2 / N);
    }
    return out;
  }

  DESIGNS["Tape"] = {
    effect: "ToTape6",
    refs: [["SaturatorL12.png", "Saturator"], ["DrumBussL12.png", "Drum Buss"], ["EQEightL12.png", "EQ Eight"]],
    lead: "Visual cue: what the tape does to the signal, measured live from input vs output: transfer curve, spectrum change, or waveform difference.",
    options: [
      { id: "A", name: "Saturator", short: "Curve", width: 608, step: stepT,
        live(st, m, dt) {
          st.lv = 1; lvIO(st, m, dt);
          // measured transfer curve: bins with data are kept ~2 s, then dropped
          const xf = st.xf || (st.xf = new Array(32).fill(-9)), age = st.xa || (st.xa = new Array(32).fill(999));
          const xm = Array.isArray(m.xfer) ? m.xfer : [];
          for (let i = 0; i < 32; i++) {
            const v = xm[i];
            if (typeof v === "number" && Number.isFinite(v) && v > -8) { xf[i] = xf[i] <= -8 ? v : xf[i] + (v - xf[i]) * 0.3; age[i] = 0; }
            else if (++age[i] > 60) xf[i] = -9;
          }
          // recent (input, output) sample pairs from the scopes
          const iL = Array.isArray(m.inScopeL) ? m.inScopeL : [], oL = Array.isArray(m.outScopeL) ? m.outScopeL : [];
          const n = Math.min(iL.length, oL.length, 64), dots = [];
          let ext = 0;
          for (let i = 0; i < n; i++) if (Number.isFinite(iL[i]) && Number.isFinite(oL[i])) { dots.push([iL[i], oL[i]]); ext = Math.max(ext, Math.abs(iL[i]), Math.abs(oL[i])); }
          st.dots = dots;
          for (let i = 0; i < 32; i++) if (xf[i] > -8) ext = Math.max(ext, Math.abs(-1 + (i + 0.5) / 16), Math.abs(xf[i]));
          const tgt = Math.max(0.05, ext * 1.15);
          st.xz = typeof st.xz === "number" && st.xz > tgt ? st.xz + (tgt - st.xz) * 0.05 : tgt;
          // peak gain from the linear peaks (held while the input is silent)
          if (lvF(m.inPk, 0) > 1e-4) st.pg = lvSm(st.pg, 20 * Math.log10(Math.max(lvF(m.outPk, 0), 1e-6) / m.inPk), 0.3, 0.3);
          if (st.pg === undefined) st.pg = 0;
          // harmonics: strongest output band between 40 and 400 Hz, then bands at 2x..8x
          if (!lvArr(m.specIn) || !lvArr(m.specOut)) return;
          const hO = lvHold(st, "hO48", m.specOut, dt, 50);
          let bi = 4;
          for (let b = 4; b <= 20; b++) if (hO[b] > hO[bi]) bi = b;
          if (st.b0 === undefined || hO[bi] > hO[st.b0] + 3) st.b0 = bi;
          const ad = [];
          for (let b = 0; b < 48; b++) ad.push(10 * Math.log10(Math.max(1e-12, lvPow(m.specOut[b]) - lvPow(m.specIn[b]))));
          const hd = st.hd || (st.hd = new Array(8).fill(-120));
          let pw = 0;
          for (let n2 = 1; n2 <= 8; n2++) {
            const bn = Math.round(st.b0 + 16 * Math.log10(n2));
            let v = -120;
            if (bn <= 47) for (let b = Math.max(0, bn - 1); b <= Math.min(47, bn + 1); b++) v = Math.max(v, n2 === 1 ? hO[b] : ad[b]);
            hd[n2 - 1] = Math.max(v, hd[n2 - 1] - 40 * dt);
            if (n2 > 1) pw += Math.pow(10, hd[n2 - 1] / 10);
          }
          st.thd = clamp(10 * Math.log10(Math.max(pw, 1e-12)) - hd[0], -99, 20);
        },
        why: "A transfer curve with a moving dot and harmonic bars, like the waveshaper display of Saturator.",
        bullets: ["Drive curve: output level plotted against input level, with the live signal range lit in orange",
          "Harmonic bars H1 to H8 and a THD readout, from an FFT of the output (live: H1 = output level at the strongest 40-400 Hz band, H2-H8 = output minus input power, where positive, at 2x to 8x that band; readout = added H2-H8 relative to H1 in dB)",
          "Driven by the audio: input vs output level (in/out meters at the right); dials only set the curve shape"],
        draw(c, th, st, ps, vals) {
          const k = drv(vals), a = st.a, lv = !!st.lv; st.k = k;
          const { x: px, y: py, w: pw, h: ph } = frame(c, th, ps, vals, 608, 116, 108, true);
          screen(c, th, px, py, pw, ph);
          const sb = strip(c, th, px, py, pw, 19);
          const bb = strip(c, th, px, py + ph - 18, pw, 18, true);
          const bx = px + 10, by = py + 23, bs = 100;
          const hx = px + 148, hy = py + 23, hh = 88, bw = 16, hp = 18;
          txt(c, bx, py + 135, "Out vs in", { color: th.scale, size: 8.5, align: "left" });
          rr(c, bx + 0.5, by + 0.5, bs, bs, 0, null, th.dline);
          hint(bx, by, bs, bs, "Transfer Curve", "Output level plotted against input level. A straight diagonal means the tape changes nothing; a bend means loud peaks are squashed. Measured from the input and output samples.");
          c.strokeStyle = th.dline; c.lineWidth = 1; c.beginPath();
          c.moveTo(bx + bs / 2, by); c.lineTo(bx + bs / 2, by + bs); c.moveTo(bx, by + bs / 2); c.lineTo(bx + bs, by + bs / 2);
          c.moveTo(bx, by + bs); c.lineTo(bx + bs, by); c.stroke();
          // fixed scale: the plot edge is always full scale (RUBRIC 2.6)
          const X = x => bx + bs * (x + 1) / 2, Y = y => by + bs * (1 - (clamp(y, -1, 1) + 1) / 2);
          if (lv) {
            // measured curve (cyan; orange where it was updated just now) and the live in/out sample pairs
            const xf = st.xf || [], age = st.xa || [];
            for (const [col, lw, fresh] of [[th.cyan, 1.5, false], [th.orange, 2, true]]) {
              c.strokeStyle = col; c.lineWidth = lw; c.beginPath();
              let pen = false;
              for (let i = 0; i < 32; i++) {
                const ok = xf[i] > -8 && (!fresh || age[i] <= 3);
                if (!ok) { pen = false; continue; }
                const x = X(-1 + (i + 0.5) / 16), y = Y(xf[i]);
                pen ? c.lineTo(x, y) : c.moveTo(x, y); pen = true;
              }
              c.stroke();
            }
            const dots = st.dots || [];
            c.fillStyle = th.orange;
            dots.forEach(([x, y], i) => { c.globalAlpha = i === dots.length - 1 ? 1 : 0.35; c.beginPath(); c.arc(X(x), Y(y), i === dots.length - 1 ? 2.5 : 1.2, 0, Math.PI * 2); c.fill(); });
            c.globalAlpha = 1;
            if (dots.length) { const [lx, ly] = dots[dots.length - 1]; hint(X(lx) - 5, Y(ly) - 5, 10, 10, "Live Dot", "The newest pair of input and output levels. It moves along the curve as the signal plays."); }
                        txt(c, bx, bb, `Peak gain ${sgn(st.pg || 0)} dB`, { color: th.orange, size: 9, align: "left" });
          } else {
          c.strokeStyle = th.cyan; c.lineWidth = 1.5; c.beginPath();
          for (let i = 0; i <= 64; i++) { const x = -1 + i / 32; i ? c.lineTo(X(x), Y(tf(x, k))) : c.moveTo(X(x), Y(tf(x, k))); }
          c.stroke();
          const ar = Math.min(1, a);
          c.strokeStyle = th.orange; c.lineWidth = 2; c.beginPath();
          for (let i = 0; i <= 24; i++) { const x = -ar + 2 * ar * i / 24; i ? c.lineTo(X(x), Y(tf(x, k))) : c.moveTo(X(x), Y(tf(x, k))); }
          c.stroke();
          const xi = clamp(wave(st.t * 14, a), -1, 1);
          c.fillStyle = th.orange; c.beginPath(); c.arc(X(xi), Y(tf(xi, k)), 2.5, 0, Math.PI * 2); c.fill();
          hint(X(xi) - 5, Y(tf(xi, k)) - 5, 10, 10, "Live Dot", "The newest pair of input and output levels. It moves along the curve as the signal plays.");
          txt(c, bx, bb, `Peak gain ${sgn(gainDb(a, k))} dB`, { color: th.orange, size: 9, align: "left" });
          }
          // harmonics
          txt(c, hx, py + 135, "Harmonics", { color: th.scale, size: 8.5, align: "left" });
          const h = lv ? null : harmonics(Math.max(a, 0.05), k);
          (lv ? (st.hd || new Array(8).fill(-120)) : h).forEach((v, i) => {
            meterV(c, th, hx + i * hp, hy, bw, hh, clamp(((lv ? v : db(v)) + (lv ? 80 : 72)) / (lv ? 80 : 72), 0, 1), false, i ? th.orange : th.cyan);
            txt(c, hx + i * hp + bw / 2, hy + hh + 10, String(i + 1), { color: th.dispText, size: 8.5 });
          });
          if (lv) txt(c, hx, bb, `Added H2-H8 ${(st.thd === undefined ? -99 : st.thd).toFixed(1)} dB`, { color: th.cyan, size: 9, align: "left" });
          else {
          const thd = Math.sqrt(h.slice(1).reduce((s, v) => s + v * v, 0)) / Math.max(h[0], 1e-6) * 100;
          txt(c, hx, bb, `THD ${thd.toFixed(1)} %`, { color: th.cyan, size: 9, align: "left" });
          }
          legend(c, th, bx, sb, [
            [th.cyan, "Curve", "The tape curve: output level against input level."],
            [th.orange, "Live", "The part of the curve the signal uses right now, and the live dot."]]);
          legend(c, th, hx, sb, [
            [th.cyan, "H1", "Harmonic 1: the main tone (the fundamental) of the output."],
            [th.orange, "H2-H8", "Harmonics 2 to 8: extra tones the tape adds, at 2 to 8 times the main frequency."]]);
          hint(bx, py + ph - 18, 90, 18, "Peak Gain", "How much the tape raises or lowers the loudest part of the signal, in dB. Measured from the input and output peaks.");
          hint(hx, hy, 8 * hp, hh + 12, "Harmonic Bars", "Bars 1 to 8 show the main tone and the extra tones added by the tape. Taller bar means a louder tone. Measured with an FFT of the output.");
          hint(hx, py + ph - 18, 134, 18, lv ? "Added Harmonics" : "THD Readout", lv ? "Total of the added tones H2 to H8 against the main tone, in dB. Lower means a cleaner sound." : "Total harmonic distortion: how loud the added tones are against the main tone, in percent.");
          gs(c, th, 608 - GAIN_W - 4, st);
        } },
      { id: "B", name: "EQ Eight", short: "Spectrum", width: 648, step: stepT,
        live(st, m, dt) {
          st.lv = 1; lvIO(st, m, dt);
          if (!lvArr(m.specIn) || !lvArr(m.specOut)) return;
          st.lvI = lvRes(lvHold(st, "hI48", m.specIn, dt, 50));
          st.lvO = lvRes(lvHold(st, "hO48", m.specOut, dt, 50));
          st.lvD = lvRes(lvResp(st, "rs48", m.specIn, m.specOut));
          let si = 0, so = 0;
          for (let i = 0; i < 48; i++) { si += lvPow(m.specIn[i]); so += lvPow(m.specOut[i]); }
          if (lvF(m.inRmsDb, -120) > -90) st.net = lvSm(st.net, 10 * Math.log10(Math.max(so, 1e-12) / Math.max(si, 1e-12)), 0.3, 0.3);
          if (st.net === undefined) st.net = 0;
        },
        why: "Spectrum analyser with the tape's measured frequency response drawn over it, like EQ Eight's curve.",
        bullets: ["Grey area is the input spectrum, cyan line the output spectrum (FFT, 20 Hz to 20 kHz)",
          "Orange curve is output minus input in dB (tape response), with readouts at 60 Hz and 15 kHz",
          "Driven by the audio: FFT of input and output, so any effect shows its own response"],
        draw(c, th, st, ps, vals) {
          const m = mean(vals), a = st.a, lv = !!st.lv; st.k = drv(vals);
          gs(c, th, 648 - GAIN_W - 4, st);
          const { x: px, y: py, w: pw, h: ph } = frame(c, th, ps, vals, 648, 108, 104, false);
          screen(c, th, px, py, pw, ph);
          strip(c, th, px, py, pw, 22);
          const bb = strip(c, th, px, py + ph - 18, pw, 18, true);
          chrome(c, th, px + 6, py + 4, 84, NAME);
          const sp = lv ? st.lvI || new Array(NB).fill(-120) : st.spI || new Array(NB).fill(-90);
          const dIn = [], out = [], diff = [];
          for (let i = 0; i < NB; i++) {
            if (lv) { diff.push(st.lvD ? st.lvD[i] : 0); out.push(st.lvO ? st.lvO[i] : -120); continue; }
            const d = tresp(fOf(i), m) + 0.5 * a * noise(i * 3 + Math.floor(st.t * 18));
            diff.push(d); out.push(sp[i] + d);
          }
          const at = f => Math.round((NB - 1) * Math.log10(f / 20) / 3);
          const net = lv ? st.net || 0 : 10 * Math.log10(out.reduce((s, v) => s + Math.pow(10, v / 10), 0) / sp.reduce((s, v) => s + Math.pow(10, v / 10), 0));
          txt(c, px + 150, py + 14, "60 Hz", { color: th.dispText, size: 9, align: "left" });
          txt(c, px + 178, py + 14, sgn(diff[at(60)]), { color: th.orange, size: 9, align: "left" });
          txt(c, px + 214, py + 14, "15 kHz", { color: th.dispText, size: 9, align: "left" });
          txt(c, px + 245, py + 14, sgn(diff[at(15000)]), { color: th.orange, size: 9, align: "left" });
          txt(c, px + 285, py + 14, "Net", { color: th.dispText, size: 9, align: "left" });
          txt(c, px + 306, py + 14, sgn(net) + " dB", { color: th.cyan, size: 9, align: "left" });
          const gx = px + 24, gy = py + 27, gw = pw - 48, gh = 101;
          hint(px + 148, py + 4, 62, 14, "Change at 60 Hz", "How much the tape raises or lowers the bass at 60 Hz, in dB. Measured as output minus input.");
          hint(px + 212, py + 4, 70, 14, "Change at 15 kHz", "How much the tape raises or lowers the treble at 15 kHz, in dB. Measured as output minus input.");
          hint(px + 283, py + 4, 70, 14, "Net Level Change", "Overall level change of the whole signal, in dB. Measured from the input and output spectrum power.");
          hint(gx, gy, gw, gh, "Spectrum Display", "Frequency from 20 Hz to 20 kHz, left to right. Grey area: the input. Cyan line: the output. Orange line: the difference between them, which is the tape response.");
          hint(gx - 22, gy, 22, gh, "Level Scale", "Level in dB for the grey area and the cyan line.");
          hint(gx + gw, gy, 24, gh, "Response Scale", "Level change in dB for the orange response line. 0 is no change.");
          hint(gx, py + 131, gw, 10, "Frequency Scale", "Frequency in Hz. Bass is at the left, treble at the right.");
          {
            const e = legend(c, th, px + 8, bb, [[greyFill(), "Input", "Grey area: spectrum of the signal going into the tape."]]);
            legend(c, th, e, bb, [[th.cyan, "Output", "Cyan line: spectrum of the signal coming out of the tape."],
              [th.orange, "Response", "Orange line: output minus input in dB. Read it on the scale at the right."]], { line: true });
          }
          c.save(); c.beginPath(); c.rect(gx, gy, gw, gh); c.clip();
          vgrid(c, th, gx, gy, gw, gh);
          const yS = v => gy + gh * (1 - clamp((v + 80) / 74, 0, 1)), yD = d => gy + gh / 2 - clamp(d, -12, 12) / 12 * gh / 2;
          c.strokeStyle = th.dline; c.lineWidth = 1; c.beginPath(); c.moveTo(gx, Math.round(yD(0)) + 0.5); c.lineTo(gx + gw, Math.round(yD(0)) + 0.5); c.stroke();
          c.fillStyle = greyFill(); c.beginPath(); c.moveTo(gx, gy + gh);
          for (let i = 0; i < NB; i++) c.lineTo(gx + gw * i / (NB - 1), yS(sp[i]));
          c.lineTo(gx + gw, gy + gh); c.fill();
          c.strokeStyle = th.cyan; c.lineWidth = 1.5; c.beginPath();
          for (let i = 0; i < NB; i++) { const x = gx + gw * i / (NB - 1); i ? c.lineTo(x, yS(out[i])) : c.moveTo(x, yS(out[i])); }
          c.stroke();
          c.strokeStyle = th.orange; c.lineWidth = 2; c.beginPath();
          for (let i = 0; i < NB; i++) { const x = gx + gw * i / (NB - 1); i ? c.lineTo(x, yD(diff[i])) : c.moveTo(x, yD(diff[i])); }
          c.stroke(); c.restore();
          [-20, -40, -60].forEach(v => txt(c, gx - 3, yS(v) + 3, String(v), { color: th.scale, size: 8.5, align: "right" }));
          [12, 0, -12].forEach(v => txt(c, gx + gw + 3, yD(v) + 3, (v > 0 ? "+" : "") + v, { color: th.orange, size: 8.5, align: "left" }));
          hzLabels(c, th, gx, py + 140, gw);
        } },
      { id: "C", name: "Scope + gain", short: "Scope", width: 620, step: stepT,
        live(st, m, dt) {
          st.lv = 1; lvIO(st, m, dt);
          const iL = Array.isArray(m.inScopeL) ? m.inScopeL : [], iR = Array.isArray(m.inScopeR) ? m.inScopeR : iL;
          const oL = Array.isArray(m.scopeL) ? m.scopeL : [], oR = Array.isArray(m.scopeR) ? m.scopeR : oL;
          const n = Math.min(iL.length, oL.length, 64), I = [], O = [], D = [];
          let ext = 0;
          for (let i = 0; i < n; i++) {
            const a = lvF((iL[i] + lvF(iR[i], iL[i])) / 2, 0), b = lvF((oL[i] + lvF(oR[i], oL[i])) / 2, 0);
            I.push(a); O.push(b); D.push(b - a); ext = Math.max(ext, Math.abs(a), Math.abs(b), Math.abs(b - a));
          }
          st.scI = I; st.scO = O; st.scD = D;
          st.scPk = ext;
          st.pkI = lvPk(m.inPkDb); st.pkO = lvPk(m.outPkDb);
          if (lvF(m.inRmsDb, -120) > -90) st.gnow = lvSm(st.gnow, clamp(lvF(m.gainDb, 0), -40, 40), 0.4, 0.4);
          if (st.gnow === undefined) st.gnow = 0;
          st.gh = st.gh || [];
          st.gh.push(st.gnow); if (st.gh.length > 400) st.gh.shift();
        },
        why: "Oscilloscope of input against output with their difference, plus a gain-change strip, in the spirit of Drum Buss.",
        bullets: ["Grey = input waveform, cyan = output waveform, orange = the difference (what the tape added)",
          "Strip below: gain change (output level minus input level) over time, +/-12 dB",
          "Driven by the audio: sample-by-sample in vs out; in/out level meters at the far right"],
        draw(c, th, st, ps, vals) {
          const k = drv(vals), a = st.a, lv = !!st.lv; st.k = k;
          const { x: px, y: py, w: pw, h: ph } = frame(c, th, ps, vals, 620, 116, 108, true);
          screen(c, th, px, py, pw, ph);
          const sb = strip(c, th, px, py, pw, 19);
          const bb = strip(c, th, px, py + ph - 18, pw, 18, true);
          legend(c, th, px + 8, sb, [
            [th.dispText, "In", "Waveform of the signal going into the tape."],
            [th.cyan, "Out", "Waveform of the signal coming out of the tape."],
            [th.orange, "Diff", "Output minus input: what the tape added or removed."]], { line: true });
          hint(px + pw - 112, py + 4, 106, 12, "Peak Levels", "Highest input level, then highest output level, in dB. Measured from the input and output peaks.");
          txt(c, px + pw - 8, sb, lv ? `Peak ${(st.pkI === undefined ? -120 : st.pkI).toFixed(1)} / ${(st.pkO === undefined ? -120 : st.pkO).toFixed(1)} dB` : `Peak ${db(a).toFixed(1)} / ${db(Math.abs(tf(a, k))).toFixed(1)} dB`, { color: th.cyan, size: 9, align: "right" });
          const sx = px + 4, sw = pw - 8, sy = py + 23, sh = 72, mid = sy + sh / 2;
          // fixed scale, true level 1x: full scale = plot half-height (RUBRIC 2.6)
          c.strokeStyle = th.dline; c.lineWidth = 1; c.beginPath(); c.moveTo(sx, mid); c.lineTo(sx + sw, mid); c.stroke();
          c.save(); c.beginPath(); c.rect(sx, sy, sw, sh); c.clip();
          const Y = v => mid - clamp(v, -1, 1) * sh / 2;
          if (lv) {
            [[th.dispText, 1, st.scI], [th.cyan, 1.5, st.scO], [th.orange, 1, st.scD]].forEach(([col, lw, arr]) => {
              if (!arr || arr.length < 2) return;
              c.strokeStyle = col; c.lineWidth = lw; c.beginPath();
              arr.forEach((v, i) => { const xx = sx + sw * i / (arr.length - 1); i ? c.lineTo(xx, Y(v)) : c.moveTo(xx, Y(v)); });
              c.stroke();
            });
          } else
          [[th.dispText, 1, v => v], [th.cyan, 1.5, v => tf(v, k)], [th.orange, 1, v => tf(v, k) - v]].forEach(([col, lw, f]) => {
            c.strokeStyle = col; c.lineWidth = lw; c.beginPath();
            for (let i = 0; i <= 134; i++) { const x = wave(i / 134 * 2 * Math.PI * 2.2 + st.t * 5, a); const xx = sx + sw * i / 134; i ? c.lineTo(xx, Y(f(x))) : c.moveTo(xx, Y(f(x))); }
            c.stroke();
          });
          c.restore();
          hint(sx, sy, sw, sh, "Waveform Scope", "A short slice of the sound, drawn as a wave. Compare the grey input with the cyan output; the orange line is the difference between them. The scope has a fixed scale: full level reaches the top and bottom, so quiet sound looks small.");
          const gy = py + 101, gh = 38;
          hint(px + 4, py + ph - 18, pw - 90, 18, "Gain Change Label", "The strip above shows output level minus input level over time.");
          hint(px + pw - 80, py + ph - 18, 76, 18, "Gain Change", "Level change made by the tape right now, in dB. Plus means louder, minus means quieter.");
          hint(sx, gy, sw, gh, "Gain Change History", "Gain change over time, newest at the right. The middle line is 0 dB. The scale is plus or minus 12 dB.");
          txt(c, px + 8, bb, "Gain change (out - in)", { color: th.scale, size: 8.5, align: "left" });
          txt(c, px + pw - 8, bb, sgn(lv ? st.gnow || 0 : gainDb(a, k)) + " dB", { color: th.orange, size: 9, align: "right" });
          c.strokeStyle = th.dline; c.beginPath(); c.moveTo(sx, gy + gh / 2); c.lineTo(sx + sw, gy + gh / 2); c.stroke();
          c.save(); c.beginPath(); c.rect(sx, gy, sw, gh); c.clip();
          c.strokeStyle = th.orange; c.lineWidth = 1.5; c.beginPath();
          const gHist = lv ? st.gh || [] : st.hist;
          const n = Math.min(gHist.length, sw);
          for (let i = 0; i < n; i++) {
            const g2 = lv ? gHist[gHist.length - 1 - i] : gainDb(gHist[gHist.length - 1 - i].a, k), yy = gy + gh / 2 - clamp(g2, -12, 12) / 12 * gh / 2;
            i ? c.lineTo(sx + sw - i, yy) : c.moveTo(sx + sw - i, yy);
          }
          c.stroke(); c.restore();
          gs(c, th, 620 - GAIN_W - 4, st);
        } },
    ],
  };
})();
