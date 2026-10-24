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
      { id: "A", name: "Saturator", width: 608, step: stepT,
        why: "A transfer curve with a moving dot and harmonic bars, like the waveshaper display of Saturator.",
        bullets: ["Drive curve: output level plotted against input level, with the live signal range lit in orange",
          "Harmonic bars H1 to H8 and a THD readout, from an FFT of the output",
          "Driven by the audio: input vs output level (in/out meters at the right); dials only set the curve shape"],
        draw(c, th, st, ps, vals) {
          const k = drv(vals), a = st.a; st.k = k;
          chrome(c, th, 6, TOP + 4, 84, NAME);
          place(c, th, ps, vals, { x: 4, y: TOP + 19, w: 108, h: 147 }, { x: 428, y: TOP + 4, w: 108, h: 163 });
          const px = 124, py = TOP + 6, pw = 300, ph = 157;
          panel(c, th, px, py, pw, ph);
          const bx = px + 10, by = py + 16, bs = 122;
          txt(c, bx + bs / 2, py + 11, "Out vs in", { color: th.scale, size: 8.5 });
          rr(c, bx + 0.5, by + 0.5, bs, bs, 0, null, th.dline);
          c.strokeStyle = th.dline; c.lineWidth = 1; c.beginPath();
          c.moveTo(bx + bs / 2, by); c.lineTo(bx + bs / 2, by + bs); c.moveTo(bx, by + bs / 2); c.lineTo(bx + bs, by + bs / 2);
          c.moveTo(bx, by + bs); c.lineTo(bx + bs, by); c.stroke();
          const X = x => bx + bs * (x + 1) / 2, Y = y => by + bs * (1 - (clamp(y, -1, 1) + 1) / 2);
          c.strokeStyle = th.cyan; c.lineWidth = 1.5; c.beginPath();
          for (let i = 0; i <= 64; i++) { const x = -1 + i / 32; i ? c.lineTo(X(x), Y(tf(x, k))) : c.moveTo(X(x), Y(tf(x, k))); }
          c.stroke();
          const ar = Math.min(1, a);
          c.strokeStyle = th.orange; c.lineWidth = 2; c.beginPath();
          for (let i = 0; i <= 24; i++) { const x = -ar + 2 * ar * i / 24; i ? c.lineTo(X(x), Y(tf(x, k))) : c.moveTo(X(x), Y(tf(x, k))); }
          c.stroke();
          const xi = clamp(wave(st.t * 14, a), -1, 1);
          c.fillStyle = th.orange; c.beginPath(); c.arc(X(xi), Y(tf(xi, k)), 2.5, 0, Math.PI * 2); c.fill();
          txt(c, bx, py + ph - 5, `Peak gain ${sgn(gainDb(a, k))} dB`, { color: th.orange, size: 9, align: "left" });
          // harmonics
          const hx = px + 156, hy = py + 22, hh = 96, bw = 15;
          txt(c, hx, py + 11, "Harmonics", { color: th.scale, size: 8.5, align: "left" });
          const h = harmonics(Math.max(a, 0.05), k);
          h.forEach((v, i) => {
            meterV(c, th, hx + i * 17, hy, bw, hh, clamp((db(v) + 72) / 72, 0, 1), false, i ? th.orange : th.cyan);
            txt(c, hx + i * 17 + bw / 2, hy + hh + 10, String(i + 1), { color: th.dispText, size: 8.5 });
          });
          const thd = Math.sqrt(h.slice(1).reduce((s, v) => s + v * v, 0)) / Math.max(h[0], 1e-6) * 100;
          txt(c, hx, py + ph - 5, `THD ${thd.toFixed(1)} %`, { color: th.cyan, size: 9, align: "left" });
          gs(c, th, 608 - GAIN_W - 4, st);
        } },
      { id: "B", name: "EQ Eight", width: 648, step: stepT,
        why: "Spectrum analyser with the tape's measured frequency response drawn over it, like EQ Eight's curve.",
        bullets: ["Grey area is the input spectrum, cyan line the output spectrum (FFT, 20 Hz to 20 kHz)",
          "Orange curve is output minus input in dB (tape response), with readouts at 60 Hz and 15 kHz",
          "Driven by the audio: FFT of input and output, so any effect shows its own response"],
        draw(c, th, st, ps, vals) {
          const m = mean(vals), a = st.a; st.k = drv(vals);
          gs(c, th, 648 - GAIN_W - 4, st);
          place(c, th, ps, vals, { x: 2, y: TOP + 4, w: 106, h: 163 }, { x: 472, y: TOP + 4, w: 106, h: 163 });
          const px = 112, py = TOP + 6, pw = 356, ph = 157;
          panel(c, th, px, py, pw, ph);
          chrome(c, th, px + 4, py + 3, 84, NAME);
          const sp = st.spI || new Array(NB).fill(-90);
          const dIn = [], out = [], diff = [];
          for (let i = 0; i < NB; i++) {
            const d = tresp(fOf(i), m) + 0.5 * a * noise(i * 3 + Math.floor(st.t * 18));
            diff.push(d); out.push(sp[i] + d);
          }
          const at = f => Math.round((NB - 1) * Math.log10(f / 20) / 3);
          const net = 10 * Math.log10(out.reduce((s, v) => s + Math.pow(10, v / 10), 0) / sp.reduce((s, v) => s + Math.pow(10, v / 10), 0));
          txt(c, px + 150, py + 13, "60 Hz", { color: th.dispText, size: 9, align: "left" });
          txt(c, px + 178, py + 13, sgn(diff[at(60)]), { color: th.orange, size: 9, align: "left" });
          txt(c, px + 214, py + 13, "15 kHz", { color: th.dispText, size: 9, align: "left" });
          txt(c, px + 245, py + 13, sgn(diff[at(15000)]), { color: th.orange, size: 9, align: "left" });
          txt(c, px + 285, py + 13, "Net", { color: th.dispText, size: 9, align: "left" });
          txt(c, px + 306, py + 13, sgn(net) + " dB", { color: th.cyan, size: 9, align: "left" });
          const gx = px + 22, gy = py + 22, gw = pw - 46, gh = ph - 36;
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
          hzLabels(c, th, gx, py + ph - 3, gw);
        } },
      { id: "C", name: "Scope + gain", width: 620, step: stepT,
        why: "Oscilloscope of input against output with their difference, plus a gain-change strip, in the spirit of Drum Buss.",
        bullets: ["Grey = input waveform, cyan = output waveform, orange = the difference (what the tape added)",
          "Strip below: gain change (output level minus input level) over time, +/-12 dB",
          "Driven by the audio: sample-by-sample in vs out; in/out level meters at the far right"],
        draw(c, th, st, ps, vals) {
          const k = drv(vals), a = st.a; st.k = k;
          chrome(c, th, 6, TOP + 4, 84, NAME);
          place(c, th, ps, vals, { x: 4, y: TOP + 19, w: 108, h: 147 }, { x: 410, y: TOP + 4, w: 108, h: 163 });
          const px = 126, py = TOP + 6, pw = 280, ph = 157;
          panel(c, th, px, py, pw, ph);
          [["In", th.dispText, 8], ["Out", th.cyan, 38], ["Diff", th.orange, 72]].forEach(([s, col, o]) => {
            c.fillStyle = col; c.fillRect(px + 6 + o, py + 6, 6, 3); txt(c, px + 15 + o, py + 11, s, { color: th.dispText, size: 8.5, align: "left" });
          });
          txt(c, px + pw - 6, py + 11, `Peak ${db(a).toFixed(1)} / ${db(Math.abs(tf(a, k))).toFixed(1)} dB`, { color: th.cyan, size: 9, align: "right" });
          const sx = px + 6, sw = pw - 12, sy = py + 18, sh = 82, mid = sy + sh / 2;
          c.strokeStyle = th.dline; c.lineWidth = 1; c.beginPath(); c.moveTo(sx, mid); c.lineTo(sx + sw, mid); c.stroke();
          c.save(); c.beginPath(); c.rect(sx, sy, sw, sh); c.clip();
          const Y = v => mid - clamp(v, -1.1, 1.1) * sh * 0.45;
          [[th.dispText, 1, v => v], [th.cyan, 1.5, v => tf(v, k)], [th.orange, 1, v => tf(v, k) - v]].forEach(([col, lw, f]) => {
            c.strokeStyle = col; c.lineWidth = lw; c.beginPath();
            for (let i = 0; i <= 134; i++) { const x = wave(i / 134 * 2 * Math.PI * 2.2 + st.t * 5, a); const xx = sx + sw * i / 134; i ? c.lineTo(xx, Y(f(x))) : c.moveTo(xx, Y(f(x))); }
            c.stroke();
          });
          c.restore();
          const gy = py + 116, gh = 32;
          txt(c, px + 6, py + 109, "Gain change (out - in)", { color: th.scale, size: 8.5, align: "left" });
          txt(c, px + pw - 6, py + 109, sgn(gainDb(a, k)) + " dB", { color: th.orange, size: 9, align: "right" });
          c.strokeStyle = th.dline; c.beginPath(); c.moveTo(sx, gy + gh / 2); c.lineTo(sx + sw, gy + gh / 2); c.stroke();
          c.save(); c.beginPath(); c.rect(sx, gy, sw, gh); c.clip();
          c.strokeStyle = th.orange; c.lineWidth = 1.5; c.beginPath();
          const n = Math.min(st.hist.length, sw);
          for (let i = 0; i < n; i++) {
            const g = gainDb(st.hist[st.hist.length - 1 - i].a, k), yy = gy + gh / 2 - clamp(g, -12, 12) / 12 * gh / 2;
            i ? c.lineTo(sx + sw - i, yy) : c.moveTo(sx + sw - i, yy);
          }
          c.stroke(); c.restore();
          gs(c, th, 620 - GAIN_W - 4, st);
        } },
    ],
  };
})();
