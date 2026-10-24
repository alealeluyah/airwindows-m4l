// Bass: design options. Helpers (knob, menu, meterV, …) come from app.js.
// Visual cue: what the effect does to the low end — spectrum 20 Hz–1 kHz, stereo image, band levels; all in vs out.
(() => {
  // ---- local helpers (inside this file's IIFE) ----
  const TAU = Math.PI * 2;
  const cl = (v, a, b) => Math.max(a, Math.min(b, v));
  const greyFill = () => S.theme === "light" ? "#6e6e6e" : "#4a4a4a";
  const greyLine = () => S.theme === "light" ? "#5e5e5e" : "#8c8c8c";
  const box = (c, th, x, y, w, h) => rr(c, x, y, w, h, 3, th.display);
  function ctl(c, th, ps, area, cols, vals, cellW) {
    if (!ps.length) {
      rr(c, area.x, area.y, area.w, Math.min(area.h, 60), 3, th.panel);
      txt(c, area.x + area.w / 2, area.y + Math.min(area.h, 60) / 2 + 3, "No controls", { color: th.dim });
    } else if (ps.length > cols) {
      if (ps.length <= 2 * cols) cols = Math.ceil(ps.length / 2);                    // rows with a clear gap, so a value never touches the next label
      const rows = Math.ceil(ps.length / cols), pitch = Math.min(60, area.h / rows), y0 = area.y + (area.h - rows * pitch) / 2 + (pitch - 50) / 2;
      for (let r = 0; r < rows; r++) knobGrid(c, th, ps.slice(r * cols, (r + 1) * cols), { x: area.x, y: y0 + r * pitch, w: area.w, h: 50 }, cols, vals, cellW);
    } else knobGrid(c, th, ps, area, cols, vals, cellW);
  }
  const amp = st => 0.12 + 0.85 * drums(st.t).env;
  function levels(st, dt, a, b) {
    st.inL = Math.max(db(a), st.inL - 24 * dt); st.outL = Math.max(db(b), st.outL - 24 * dt);
  }
  function line(c, pts, color, lw) {
    c.strokeStyle = color; c.lineWidth = lw; c.beginPath();
    pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.stroke();
  }
  function hbar(c, th, x, y, w, h, v, color) {
    c.fillStyle = th.meterBg; c.fillRect(x, y, w, h);
    c.fillStyle = color || th.green; c.fillRect(x, y, Math.max(0, Math.min(1, v)) * w, h);
  }
  const fl = db0 => cl(1 + db0 / 48, 0, 1);   // dB -> 0..1 for 48 dB meters
  // width of a legend() row; right- and left-aligned readouts with their own hover hint
  const lgW = (c, items, o = {}) => { c.font = `400 ${o.size || 8.5}px ${FONT}`; return items.reduce((a, it) => a + Math.ceil(c.measureText(it[1]).width) + (o.line ? 11 : 9) + (o.gap || 8), 0) - (o.gap || 8); };
  function rtxt(c, xr, yb, s, color, title, info, size) {
    c.font = `400 ${size || 9.5}px ${FONT}`; const w = Math.ceil(c.measureText(s).width);
    txt(c, xr, yb, s, { color, align: "right", size }); hint(xr - w - 1, yb - 10, w + 2, 13, title, info);
  }
  function ltxt(c, x, yb, s, color, title, info, size) {
    c.font = `400 ${size || 9.5}px ${FONT}`; const w = Math.ceil(c.measureText(s).width);
    txt(c, x, yb, s, { color, align: "left", size }); hint(x - 1, yb - 10, w + 2, 13, title, info);
  }
  const fk = f => f >= 1000 ? (f / 1000) + "k" : String(f);
  // spectrum display: grey fill = input, orange line = output, log frequency axis
  function spec(c, th, x, y, w, h, fin, fout, f0, f1, dTop, dBot, ticks) {
    box(c, th, x, y, w, h);
    const lg = Math.log(f1 / f0), ly = d => y + h * cl((dTop - d) / (dTop - dBot), 0, 1);
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    ticks.forEach(f => { c.fillStyle = th.dline; c.fillRect(Math.round(x + w * Math.log(f / f0) / lg), y, 1, h); });
    for (let i = 1; i < 4; i++) { c.fillStyle = th.dline; c.fillRect(x, Math.round(y + h * i / 4), w, 1); }
    c.fillStyle = greyFill(); c.beginPath(); c.moveTo(x, y + h);
    const ptsO = [];
    for (let px = 0; px <= w; px += 3) {
      const f = f0 * Math.exp(lg * px / w);
      c.lineTo(x + px, ly(fin(f))); ptsO.push([x + px, ly(fout(f))]);
    }
    c.lineTo(x + w, y + h); c.fill();
    line(c, ptsO, th.orange, 1.5);
    c.restore();
    ticks.forEach(f => txt(c, x + w * Math.log(f / f0) / lg + 2, y + h - 3, fk(f), { color: th.scale, size: 8.5, align: "left" }));
  }

  // ---- simulated bass signal. A generic filter/shaper stands in for any effect; displays only compare in vs out ----
  const resp = (st, f) => st.g1 * Math.exp(-((Math.log2(f / st.fc)) ** 2) / 0.7) - 10 * Math.max(0, Math.log2(30 / f)) + 1.5 * Math.sin(Math.log2(f) * 2 + st.t);
  const fin = (st, f) => {
    const P = Math.pow(10, (-40 - 4 * Math.log2(f / 20)) / 10)
      + st.A * st.A * (Math.exp(-((Math.log2(f / 48)) ** 2) / 0.12) + 0.3 * Math.exp(-((Math.log2(f / 96)) ** 2) / 0.12));
    return 10 * Math.log10(P);
  };
  const BANDS = [["Sub", "20–60", 38], ["Low", "60–120", 85], ["Bass", "120–250", 170], ["Low-mid", "250–500", 350]];
  function step(st, dt) {
    const A = amp(st), t = st.t;
    st.A = A; st.fc = 55 + 25 * Math.sin(t * 0.4); st.g1 = 8 * (0.7 + 0.3 * Math.sin(t * 0.6));
    const side = 0.30 + 0.20 * Math.sin(t * 0.3), wid = 1 + 0.55 * Math.sin(t * 0.5 + 1), G = 1.15 + 0.2 * Math.sin(t * 0.6);
    st.pin = []; st.pout = [];
    let ll = 0, rrr = 0, lr = 0, L2 = 0, R2 = 0, LR2 = 0, mi = 0, si = 0, mo = 0, so = 0;
    for (let j = 0; j < 80; j++) {
      const ph = j / 80 * 2 + t * 0.3, m = Math.sin(TAU * ph) * A, s = side * A * Math.sin(TAU * (2.013 * ph + 0.3));
      const l = m + s, r = m - s, m2 = m * G, s2 = s * wid, l2 = m2 + s2, r2 = m2 - s2;
      ll += l * l; rrr += r * r; lr += l * r; L2 += l2 * l2; R2 += r2 * r2; LR2 += l2 * r2;
      mi += m * m; si += s * s; mo += m2 * m2; so += s2 * s2;
      st.pin.push([s / 0.8, m / 0.8]); st.pout.push([s2 / 0.8, m2 / 0.8]);
    }
    st.corrIn = lr / Math.sqrt(ll * rrr + 1e-9); st.corrOut = LR2 / Math.sqrt(L2 * R2 + 1e-9);
    st.mI = Math.sqrt(mi / 80); st.sI = Math.sqrt(si / 80); st.mO = Math.sqrt(mo / 80); st.sO = Math.sqrt(so / 80);
    st.bIn = st.bIn || [-60, -60, -60, -60]; st.bOut = st.bOut || [-60, -60, -60, -60];
    BANDS.forEach((b, i) => {
      const lvl = db(A * [1, 0.7, 0.4, 0.2][i] * (0.9 + 0.1 * noise(Math.floor(t * 20) + i)));
      st.bIn[i] = Math.max(lvl, st.bIn[i] - 30 * dt);
      st.bOut[i] = Math.max(lvl + resp(st, b[2]), st.bOut[i] - 30 * dt);
    });
    let pk = 0, pv = -999; for (let k = 0; k < 40; k++) { const f = 20 * Math.pow(50, k / 39), v = fin(st, f) + resp(st, f); if (v > pv) { pv = v; pk = f; } }
    st.peakF = pk; st.lowGain = (resp(st, 30) + resp(st, 60) + resp(st, 100)) / 3;
    levels(st, dt, A, A * G);
  }

  // ---- live: state from the real measurements m (airwin~ frames, ~30 per second) ----
  const fnum = (v, d) => Number.isFinite(v) ? v : d;
  const lin = d => Math.pow(10, d / 20);
  const rel = (prev, v, dt, r = 24) => Math.max(fnum(v, -120), fnum(prev, -120) - r * dt);   // fast attack, release r dB/s
  const hasN = (a, n) => Array.isArray(a) && a.length >= n;
  function bandAt(a, f) {                         // level of the 48 log bands at frequency f (linear interpolation)
    if (!hasN(a, 48)) return -120;
    const p = 48 * Math.log(f / 20) / Math.log(1000) - 0.5, i = cl(Math.floor(p), 0, 46), t = cl(p - i, 0, 1);
    return fnum(a[i], -120) * (1 - t) + fnum(a[i + 1], -120) * t;
  }
  const mono = (a, b) => { const o = []; for (let i = 0; i < 64; i++) o.push(fnum(a && a[i], 0) * 0.5 + fnum(b && b[i], 0) * 0.5); return o; };
  const side = (a, b) => { const o = []; for (let i = 0; i < 64; i++) o.push(fnum(a && a[i], 0) * 0.5 - fnum(b && b[i], 0) * 0.5); return o; };
  function pearson(a, b) {
    let ab = 0, aa = 0, bb = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
    return aa < 1e-12 || bb < 1e-12 ? 1 : ab / Math.sqrt(aa * bb);
  }
  const bandPow = (a, lo, hi) => { let p = 0; for (let i = 0; i < 48; i++) { const f = bandHz(i); if (f >= lo && f < hi) p += Math.pow(10, fnum(a[i], -120) / 10); } return 10 * Math.log10(Math.max(p, 1e-12)); };
  function liveBass(st, m, dt) {
    if (!st.liveOn) Object.assign(st, { liveOn: true, live: true, sIn: new Array(48).fill(-120), sOut: new Array(48).fill(-120), resp: new Array(48).fill(0),
      peakF: 0, lowGain: 0, pinF: [], poutF: [], pin: [], pout: [], corrIn: 1, corrOut: 1, mI: 1e-6, sI: 1e-6, mO: 1e-6, sO: 1e-6,
      bIn: [-120, -120, -120, -120], bOut: [-120, -120, -120, -120], vsPk: 0.02, scPk: 0.02, scFull: 0.023, sc: { i: new Array(64).fill(0), o: new Array(64).fill(0) } });
    st.inL = rel(st.inL, Math.max(fnum(m.inPkDb[0], -120), fnum(m.inPkDb[1], -120)), dt);
    st.outL = rel(st.outL, Math.max(fnum(m.outPkDb[0], -120), fnum(m.outPkDb[1], -120)), dt);
    st.silent = fnum(m.outRmsDb, -120) < -100;                       // effect output is digital silence
    const ok = hasN(m.specIn, 48) && hasN(m.specOut, 48);
    if (ok) for (let i = 0; i < 48; i++) {
      st.sIn[i] = rel(st.sIn[i], m.specIn[i], dt); st.sOut[i] = rel(st.sOut[i], m.specOut[i], dt);
      if (m.specIn[i] > -80) st.resp[i] += (cl(fnum(m.specOut[i], -120) - m.specIn[i], -60, 60) - st.resp[i]) * 0.3;   // below -80 dB the change is not meaningful: hold
    }
    if (ok) {
      let bi = -1, bv = -110;
      for (let i = 0; i < 48; i++) if (bandHz(i) <= 1000 && m.specOut[i] > bv) { bv = m.specOut[i]; bi = i; }
      st.peakF = bi >= 0 ? bandHz(bi) : 0;                          // 0 = no output to measure
      let pi = 0, po = 0;
      for (let i = 0; i < 48; i++) if (bandHz(i) < 100) { pi += Math.pow(10, fnum(m.specIn[i], -120) / 10); po += Math.pow(10, fnum(m.specOut[i], -120) / 10); }
      st.lowGain = Math.max(-99, 10 * Math.log10(Math.max(po, 1e-12) / Math.max(pi, 1e-12)));
      [[20, 60], [60, 120], [120, 250], [250, 500]].forEach((b, k) => {
        st.bIn[k] = rel(st.bIn[k], bandPow(m.specIn, b[0], b[1]), dt, 30); st.bOut[k] = rel(st.bOut[k], bandPow(m.specOut, b[0], b[1]), dt, 30);
      });
    }
    // stereo image: mid/side of the latest samples, a few frames kept so the dots form a cloud
    const mi = mono(m.inScopeL, m.inScopeR), si = side(m.inScopeL, m.inScopeR), mo = mono(m.scopeL, m.scopeR), so = side(m.scopeL, m.scopeR);
    st.vsPk = Math.max(0.02, ...mi.map(Math.abs), ...si.map(Math.abs), ...mo.map(Math.abs), ...so.map(Math.abs), st.vsPk * lin(-6 * dt));
    const ref = st.vsPk * 1.1; st.vsEdge = st.vsPk * 1.1;
    st.pinF.push(mi.map((v, i) => [si[i], v])); st.poutF.push(mo.map((v, i) => [so[i], v]));
    if (st.pinF.length > 3) { st.pinF.shift(); st.poutF.shift(); }
    st.pin = [].concat(...st.pinF).map(p => [p[0] / ref, p[1] / ref]); st.pout = [].concat(...st.poutF).map(p => [p[0] / ref, p[1] / ref]);
    st.corrIn += (pearson(m.inScopeL || [], m.inScopeR || []) - st.corrIn) * 0.3;
    st.corrOut = fnum(m.corr, 1);
    const ms = hasN(m.ms, 4) ? m.ms : [-120, -120, -120, -120];
    st.mI = lin(rel(20 * Math.log10(st.mI), ms[0], dt)); st.sI = lin(rel(20 * Math.log10(st.sI), ms[1], dt));
    st.mO = lin(rel(20 * Math.log10(st.mO), ms[2], dt)); st.sO = lin(rel(20 * Math.log10(st.sO), ms[3], dt));
    // waveform window (option C), auto-scaled
    st.scPk = Math.max(0.02, ...mi.map(Math.abs), ...mo.map(Math.abs), st.scPk * lin(-6 * dt)); st.scFull = st.scPk * 1.15;
    st.sc = { i: mi, o: mo };
  }

  DESIGNS["Bass"] = {
    effect: "DubCenter",
    refs: [["AutoFilterL12.png", "Auto Filter"], ["EQEightL12.png", "EQ Eight"], ["UtilityL12.png", "Utility"], ["DrumBussL12.png", "Drum Buss"]],
    lead: "Visual cue: what the effect does to the low end — spectrum below 1 kHz, mono/stereo image and band levels, always input against output.",
    options: [
      { id: "A", name: "Low-end spectrum", short: "Spectrum", width: 600, step, live: liveBass,
        why: "A zoomed 20 Hz–1 kHz spectrum with a response strip below, so boosts and cuts to the low end are visible — like EQ Eight and Auto Filter.",
        bullets: ["Measured: FFT spectrum of input (grey) and output (orange line), log frequency 20 Hz–1 kHz",
                  "Measured: output minus input in dB as a cyan response curve (strip below the spectrum); bands where the input is below -80 dB hold their last value",
                  "Readouts: peak frequency and average change below 100 Hz; menu and arrows in the display"],
        draw(c, th, st, ps, vals) {
          const x = 6, y = HEAD_H + 6, w = 588;
          box(c, th, x, y, w, 72);
          const fI = st.live ? (f => bandAt(st.sIn, f)) : (f => fin(st, f)), fO = st.live ? (f => bandAt(st.sOut, f)) : (f => fin(st, f) + resp(st, f));
          const rsp = st.live ? (f => bandAt(st.resp, f)) : (f => resp(st, f));
          spec(c, th, x, y + 22, w, 50, fI, fO, 20, 1000, 6, -66, [30, 50, 100, 200, 500]);
          menu(c, th, x + 6, y + 5, 120, "DubCenter"); arrows(c, th, x + 130, y + 5);
          rtxt(c, x + w - 8, y + 15, st.peakF > 0 ? `Peak ${Math.round(st.peakF)} Hz` : "Peak -", th.dispText, "Peak Frequency Readout", "The frequency below 1 kHz where the output is loudest now. Measured from the output spectrum.");
          rtxt(c, x + w - 84, y + 15, `<100 Hz ${st.lowGain >= 0 ? "+" : ""}${st.lowGain.toFixed(1)} dB`, th.dispText, "Low-End Change Readout", "Average change below 100 Hz, in dB. A plus sign means the effect made the lows louder. Measured from the output minus the input.");
          legend(c, th, x + 172, y + 15, [[greyFill(), "Input", "The grey area is the spectrum of the signal going into the effect: how loud each frequency is."], [th.orange, "Output", "The orange line is the spectrum of the effect output. Where it is above the grey area, the effect boosted that frequency."]]);
          hint(x, y + 22, w, 50, "Low-End Spectrum", "Level at each frequency from 20 Hz to 1 kHz (left to right, log scale). Measured from the input and output audio.");
          const ry = y + 75, rh = 24, rm = ry + rh / 2;
          box(c, th, x, ry, w, rh);
          c.save(); c.beginPath(); c.rect(x, ry, w, rh); c.clip();
          c.fillStyle = th.dline; c.fillRect(x, Math.round(rm), w, 1);
          const pts = [];
          for (let px = 0; px <= w; px += 3) { const f = 20 * Math.exp(Math.log(50) * px / w); pts.push([x + px, rm - cl(rsp(f), -9, 9) / 9 * (rh / 2 - 2)]); }
          line(c, pts, th.cyan, 1.5); c.restore();
          const chg = [[th.cyan, st.silent ? "Change (output is silent)" : "Change", "The cyan line is the output level minus the input level at each frequency, from -9 dB to +9 dB. Above the centre line the effect boosts; below it, it cuts."]];
          rr(c, x + 3, ry + 3, lgW(c, chg, { line: true }) + 10, 12, 2, th.display); legend(c, th, x + 8, ry + 12, chg, { line: true });
          hint(x, ry, w, rh, "Change Strip", "How much the effect turns each frequency up or down. Measured as the output spectrum minus the input spectrum. Frequencies with no input signal hold their last value.");
          rr(c, x + w - 47, ry + 3, 44, 20, 2, th.display);
          txt(c, x + w - 6, ry + 11, "+9 dB", { color: th.scale, size: 8, align: "right" }); txt(c, x + w - 6, ry + rh - 3, "-9 dB", { color: th.scale, size: 8, align: "right" });
          ctl(c, th, ps, { x: 6, y: HEAD_H + 108, w: 588, h: DEVICE_H - 110 }, 10, vals, 58);
        } },

      { id: "B", name: "Vectorscope", short: "Stereo", width: 632, step, live: liveBass,
        why: "A vectorscope and correlation bars show whether the bass stays centred and mono-safe — like Utility's width and phase displays.",
        bullets: ["Measured: the last ~4 frames of left/right samples drawn as a vectorscope (vertical = mid, horizontal = side), auto-scaled, input grey, output orange",
                  "Measured: correlation of L and R (input from the 64-sample scope, output from the correlation meter), and Mid/Side level, input against output",
                  "Menu on top, dials at the right"],
        draw(c, th, st, ps, vals) {
          menu(c, th, 6, HEAD_H + 4, 120, "DubCenter"); arrows(c, th, 130, HEAD_H + 4);
          legend(c, th, 176, HEAD_H + 15, [[greyLine(), "Input", "Grey is the signal going into the effect: dots in the stereo image, and the grey bars and readouts."], [th.orange, "Output", "Orange is the effect output: dots in the stereo image, and the orange bars and readouts."]]);
          const x = 6, y = HEAD_H + 24, s = 141, cx = x + s / 2, cy = y + s / 2, R = s / 2 - 6;
          box(c, th, x, y, s, s);
          c.save(); c.beginPath(); c.rect(x, y, s, s); c.clip();
          c.fillStyle = th.dline; c.fillRect(Math.round(cx), y, 1, s); c.fillRect(x, Math.round(cy), s, 1);
          line(c, [[cx - R, cy + R], [cx + R, cy - R]], th.dline, 1); line(c, [[cx - R, cy - R], [cx + R, cy + R]], th.dline, 1);
          st.pin.forEach(p => { c.fillStyle = greyLine(); c.fillRect(Math.round(cx + cl(p[0], -1, 1) * R), Math.round(cy - cl(p[1], -1, 1) * R), 2, 2); });
          st.pout.forEach(p => { c.fillStyle = th.orange; c.fillRect(Math.round(cx + cl(p[0], -1, 1) * R), Math.round(cy - cl(p[1], -1, 1) * R), 2, 2); });
          c.restore();
          hint(x, y, s, s, "Stereo Image", "Each dot is one moment of the signal. Up and down is the middle (mono) part; left and right is the side (stereo) part. A tall narrow shape is mono. Measured from the left and right audio.");
          if (st.live) ltxt(c, x + 5, y + 11, `edge ${db(st.vsEdge).toFixed(0)} dBFS`, th.scale, "Scale Edge", "The loudest level the display can show now. It follows the signal.", 8);
          txt(c, cx, y + 11, "M", { color: th.scale, size: 8.5 }); txt(c, x + s - 6, cy - 3, "S", { color: th.scale, size: 8.5, align: "right" });
          txt(c, x + 7, y + s - 5, "L", { color: th.scale, size: 8.5, align: "left" }); txt(c, x + s - 7, y + s - 5, "R", { color: th.scale, size: 8.5, align: "right" });
          hint(cx - 8, y + 2, 16, 12, "Mid Axis (M)", "Up and down is the middle part of the sound: what is the same in left and right.");
          hint(x + s - 14, cy - 12, 12, 12, "Side Axis (S)", "Left and right is the side part of the sound: what differs between left and right.");
          hint(x + 3, y + s - 14, 12, 12, "Left Channel (L)", "The diagonal toward L is a signal in the left channel only.");
          hint(x + s - 15, y + s - 14, 12, 12, "Right Channel (R)", "The diagonal toward R is a signal in the right channel only.");

          const px = 153, pw = 140;
          box(c, th, px, y, pw, s);
          txt(c, px + 6, y + 12, "Correlation", { color: th.scale, align: "left" });
          hint(px + 4, y + 2, pw - 8, 14, "Correlation Title", "Correlation tells how alike left and right are.");
          [["In", st.corrIn, 22], ["Out", st.corrOut, 36]].forEach(([n, v, dy]) => {
            txt(c, px + 6, y + dy + 7, n, { color: th.dispText, align: "left" });
            const bx = px + 28, bw = 104; c.fillStyle = th.meterBg; c.fillRect(bx, y + dy, bw, 8);
            hint(bx, y + dy - 2, bw, 12, n === "In" ? "Input Correlation" : "Output Correlation", `How alike left and right are in the ${n === "In" ? "input" : "output"}, from -1 to +1. Right of the centre mark is mono-safe; +1 is the same in both. Left of it, the channels cancel when summed to mono. Measured from the left and right audio.`);
            c.fillStyle = n === "In" ? greyLine() : th.orange;
            c.fillRect(v >= 0 ? bx + bw / 2 : bx + bw / 2 + v * bw / 2, y + dy, Math.abs(v) * bw / 2, 8);
            c.fillStyle = th.text; c.fillRect(Math.round(bx + bw / 2), y + dy - 2, 1, 12);
          });
          txt(c, px + 28, y + 56, "-1", { color: th.scale, size: 8.5, align: "left" }); txt(c, px + 80, y + 56, "0", { color: th.scale, size: 8.5 }); txt(c, px + 132, y + 56, "+1", { color: th.scale, size: 8.5, align: "right" });
          txt(c, px + 6, y + 76, "Mid / Side level", { color: th.scale, align: "left" });
          [["Mid", st.mI, st.mO, 84], ["Side", st.sI, st.sO, 102]].forEach(([n, a, b, dy]) => {
            txt(c, px + 6, y + dy + 8, n, { color: th.dispText, align: "left" });
            hbar(c, th, px + 34, y + dy, 98, 5, fl(db(a)), greyLine()); hbar(c, th, px + 34, y + dy + 7, 98, 5, fl(db(b)), th.orange);
            hint(px + 4, y + dy - 2, pw - 8, 16, `${n} Level`, `Level of the ${n === "Mid" ? "middle (mono)" : "side (stereo)"} part of the sound. Top bar: input. Bottom bar: output. Measured from the left and right audio.`);
          });
          const wd = (a, b) => b > 1e-4 ? Math.round(100 * a / b) + "%" : "-";
          ltxt(c, px + 6, y + s - 6, `Width In ${wd(st.sI, st.mI)}`, greyLine(), "Input Width Readout", "Side level as a percent of the middle level, for the input. Higher means a wider stereo image.");
          rtxt(c, px + pw - 6, y + s - 6, `Out ${wd(st.sO, st.mO)}`, th.orange, "Output Width Readout", "Side level as a percent of the middle level, for the output. Compare with the input to see if the effect widens or narrows the bass.");
          hint(px, y, pw, s, "Correlation and Level Panel", "Shows how mono-safe the sound is and how much middle and side signal there is, input against output.");
          ctl(c, th, ps, { x: 302, y: HEAD_H + 22, w: 324, h: 146 }, 5, vals, 62);
        } },

      { id: "C", name: "Bands", short: "Bands", width: 632, step, live: liveBass,
        why: "A scope for the bass waveform and four low-end band meters, each showing input against output — like Drum Buss's low-end section.",
        bullets: ["Measured: waveform of input (cyan) and output (orange); real audio shows the last few ms (less than one bass cycle), auto-scaled",
                  "Measured: level in four bands (Sub, Low, Bass, Low-mid; power sum of the spectrum bands inside each range), input bar over output bar, with the change in dB",
                  "Menu on top, dials at the right"],
        draw(c, th, st, ps, vals) {
          menu(c, th, 6, HEAD_H + 4, 120, "DubCenter"); arrows(c, th, 130, HEAD_H + 4);
          ltxt(c, 176, HEAD_H + 15, `In ${st.inL.toFixed(1)} dB   Out ${st.outL.toFixed(1)} dB`, th.text, "Level Readout", "Peak level of the input and of the output now, in dB. Measured after the Input and Output gain.");
          legend(c, th, 330, HEAD_H + 15, [[th.cyan, "In", "Cyan is the signal going into the effect: the input wave and the upper bar of each band."], [th.orange, "Out", "Orange is the effect output: the output wave, the lower bar of each band and the dB change."]]);
          const x = 6, y = HEAD_H + 24, w = 300, h = 141, sh = 52, mid = y + sh / 2;
          box(c, th, x, y, w, h);
          c.save(); c.beginPath(); c.rect(x, y, w, sh); c.clip();
          c.fillStyle = th.dline; c.fillRect(x, Math.round(mid), w, 1);
          const a = [], b = [];
          const at = (arr, u) => { const q = u * 63, i = Math.min(62, Math.floor(q)), t = q - i; return arr[i] * (1 - t) + arr[i + 1] * t; };
          for (let px = 0; px <= w - 8; px += 2) {
            if (st.live) {
              const u = px / (w - 8);
              a.push([x + 4 + px, mid - at(st.sc.i, u) / st.scFull * (sh * 0.44)]); b.push([x + 4 + px, mid - at(st.sc.o, u) / st.scFull * (sh * 0.44)]);
              continue;
            }
            const ph = px / (w - 8) * 2 + st.t * 0.3, v = st.A * (Math.sin(TAU * ph) + 0.3 * Math.sin(TAU * 2 * ph + 0.6)) / 1.3;
            a.push([x + 4 + px, mid - v * (sh * 0.44)]); b.push([x + 4 + px, mid - Math.tanh(1.7 * v) / Math.tanh(1.7) * (sh * 0.44)]);
          }
          line(c, a, th.cyan, 1.2); line(c, b, th.orange, 1.8); c.restore();
          txt(c, x + 6, y + 11, st.live ? `Scope (edge ${db(st.scFull).toFixed(0)} dBFS)` : "Scope", { color: th.scale, align: "left" });
          hint(x, y, w, sh, "Bass Scope", `Shape of the input and output waves over a few milliseconds, which is less than one bass cycle. Measured from the audio${st.live ? `; the edge is ${db(st.scFull).toFixed(0)} dBFS and follows the signal` : ""}.`);
          c.fillStyle = th.dline; c.fillRect(x + 4, y + sh + 1, w - 8, 1);
          BANDS.forEach((bd, i) => {
            const ry = y + sh + 6 + i * 21, d = st.bOut[i] - st.bIn[i];
            txt(c, x + 6, ry + 7, bd[0], { color: th.dispText, size: 9, align: "left" });
            txt(c, x + 6, ry + 16, bd[1], { color: th.scale, size: 7.5, align: "left" });
            hbar(c, th, x + 62, ry, 170, 6, fl(st.bIn[i]), th.cyan); hbar(c, th, x + 62, ry + 7, 170, 6, fl(st.bOut[i]), th.orange);
            txt(c, x + w - 6, ry + 11, `${d >= 0 ? "+" : ""}${d.toFixed(1)} dB`, { color: th.orange, align: "right" });
            hint(x + 4, ry - 1, w - 8, 15, `${bd[0]} Band`, `Level between ${bd[1]} Hz. Top bar: input. Bottom bar: output. The number is the output minus the input, in dB. Measured from the spectrum.`);
          });
          ctl(c, th, ps, { x: 312, y: HEAD_H + 22, w: 314, h: 146 }, 5, vals, 62);
        } },
    ],
  };
  // Input / Output gain strip at the right edge of every option (required on all devices)
  DESIGNS["Bass"].options.forEach(o => {
    const base = o.width, inner = o.draw;
    o.width = base + GAIN_W + 4;
    o.draw = (c, th, st, ps, vals) => { if (!st.pin && !st.live) return; inner(c, th, st, ps, vals); gainStrip(c, th, o.width - GAIN_W - 4, st); };
  });
})();
