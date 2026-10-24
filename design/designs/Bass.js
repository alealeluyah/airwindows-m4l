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

  DESIGNS["Bass"] = {
    effect: "DubCenter",
    refs: [["AutoFilterL12.png", "Auto Filter"], ["EQEightL12.png", "EQ Eight"], ["UtilityL12.png", "Utility"], ["DrumBussL12.png", "Drum Buss"]],
    lead: "Visual cue: what the effect does to the low end — spectrum below 1 kHz, mono/stereo image and band levels, always input against output.",
    options: [
      { id: "A", name: "Low-end spectrum", width: 600, step,
        why: "A zoomed 20 Hz–1 kHz spectrum with a response strip below, so boosts and cuts to the low end are visible — like EQ Eight and Auto Filter.",
        bullets: ["Measured: FFT spectrum of input (grey) and output (orange line), log frequency 20 Hz–1 kHz",
                  "Measured: output minus input in dB as a cyan response curve (strip below the spectrum)",
                  "Readouts: peak frequency and average change below 100 Hz; menu and arrows in the display"],
        draw(c, th, st, ps, vals) {
          const x = 6, y = HEAD_H + 6, w = 588;
          box(c, th, x, y, w, 72);
          spec(c, th, x, y + 22, w, 50, f => fin(st, f), f => fin(st, f) + resp(st, f), 20, 1000, 6, -66, [30, 50, 100, 200, 500]);
          menu(c, th, x + 6, y + 5, 120, "DubCenter"); arrows(c, th, x + 130, y + 5);
          txt(c, x + w - 8, y + 15, `Peak ${Math.round(st.peakF)} Hz`, { color: th.cyan, align: "right" });
          txt(c, x + w - 84, y + 15, `<100 Hz ${st.lowGain >= 0 ? "+" : ""}${st.lowGain.toFixed(1)} dB`, { color: th.orange, align: "right" });
          const ry = y + 75, rh = 24, rm = ry + rh / 2;
          box(c, th, x, ry, w, rh);
          c.save(); c.beginPath(); c.rect(x, ry, w, rh); c.clip();
          c.fillStyle = th.dline; c.fillRect(x, Math.round(rm), w, 1);
          const pts = [];
          for (let px = 0; px <= w; px += 3) { const f = 20 * Math.exp(Math.log(50) * px / w); pts.push([x + px, rm - cl(resp(st, f), -9, 9) / 9 * (rh / 2 - 2)]); }
          line(c, pts, th.cyan, 1.5); c.restore();
          rr(c, x + 3, ry + 3, 44, 12, 2, th.display); txt(c, x + 7, ry + 12, "Change", { color: th.scale, size: 8.5, align: "left" });
          rr(c, x + w - 47, ry + 3, 44, 20, 2, th.display);
          txt(c, x + w - 6, ry + 11, "+9 dB", { color: th.scale, size: 8, align: "right" }); txt(c, x + w - 6, ry + rh - 3, "-9 dB", { color: th.scale, size: 8, align: "right" });
          ctl(c, th, ps, { x: 6, y: HEAD_H + 108, w: 588, h: DEVICE_H - 110 }, 10, vals, 58);
        } },

      { id: "B", name: "Vectorscope", width: 632, step,
        why: "A vectorscope and correlation bars show whether the bass stays centred and mono-safe — like Utility's width and phase displays.",
        bullets: ["Measured: left/right samples drawn as a vectorscope (vertical = mid, horizontal = side), input grey, output orange",
                  "Measured: correlation of L and R, and Mid/Side level, input against output",
                  "Menu on top, dials at the right"],
        draw(c, th, st, ps, vals) {
          menu(c, th, 6, HEAD_H + 4, 120, "DubCenter"); arrows(c, th, 130, HEAD_H + 4);
          const x = 6, y = HEAD_H + 24, s = 141, cx = x + s / 2, cy = y + s / 2, R = s / 2 - 6;
          box(c, th, x, y, s, s);
          c.save(); c.beginPath(); c.rect(x, y, s, s); c.clip();
          c.fillStyle = th.dline; c.fillRect(Math.round(cx), y, 1, s); c.fillRect(x, Math.round(cy), s, 1);
          line(c, [[cx - R, cy + R], [cx + R, cy - R]], th.dline, 1); line(c, [[cx - R, cy - R], [cx + R, cy + R]], th.dline, 1);
          st.pin.forEach(p => { c.fillStyle = greyLine(); c.fillRect(Math.round(cx + cl(p[0], -1, 1) * R), Math.round(cy - cl(p[1], -1, 1) * R), 2, 2); });
          st.pout.forEach(p => { c.fillStyle = th.orange; c.fillRect(Math.round(cx + cl(p[0], -1, 1) * R), Math.round(cy - cl(p[1], -1, 1) * R), 2, 2); });
          c.restore();
          txt(c, cx, y + 11, "M", { color: th.scale, size: 8.5 }); txt(c, x + s - 6, cy - 3, "S", { color: th.scale, size: 8.5, align: "right" });
          txt(c, x + 7, y + s - 5, "L", { color: th.scale, size: 8.5, align: "left" }); txt(c, x + s - 7, y + s - 5, "R", { color: th.scale, size: 8.5, align: "right" });

          const px = 153, pw = 140;
          box(c, th, px, y, pw, s);
          txt(c, px + 6, y + 12, "Correlation", { color: th.scale, align: "left" });
          [["In", st.corrIn, 22], ["Out", st.corrOut, 36]].forEach(([n, v, dy]) => {
            txt(c, px + 6, y + dy + 7, n, { color: th.dispText, align: "left" });
            const bx = px + 28, bw = 104; c.fillStyle = th.meterBg; c.fillRect(bx, y + dy, bw, 8);
            c.fillStyle = v >= 0 ? th.green : th.orange;
            c.fillRect(v >= 0 ? bx + bw / 2 : bx + bw / 2 + v * bw / 2, y + dy, Math.abs(v) * bw / 2, 8);
            c.fillStyle = th.text; c.fillRect(Math.round(bx + bw / 2), y + dy - 2, 1, 12);
          });
          txt(c, px + 28, y + 56, "-1", { color: th.scale, size: 8.5, align: "left" }); txt(c, px + 80, y + 56, "0", { color: th.scale, size: 8.5 }); txt(c, px + 132, y + 56, "+1", { color: th.scale, size: 8.5, align: "right" });
          txt(c, px + 6, y + 76, "Mid / Side level", { color: th.scale, align: "left" });
          [["Mid", st.mI, st.mO, 84], ["Side", st.sI, st.sO, 102]].forEach(([n, a, b, dy]) => {
            txt(c, px + 6, y + dy + 8, n, { color: th.dispText, align: "left" });
            hbar(c, th, px + 34, y + dy, 98, 5, fl(db(a)), th.cyan); hbar(c, th, px + 34, y + dy + 7, 98, 5, fl(db(b)), th.orange);
          });
          txt(c, px + 6, y + s - 6, `Width In ${Math.round(100 * st.sI / st.mI)}%`, { color: th.cyan, align: "left" });
          txt(c, px + pw - 6, y + s - 6, `Out ${Math.round(100 * st.sO / st.mO)}%`, { color: th.orange, align: "right" });
          ctl(c, th, ps, { x: 302, y: HEAD_H + 22, w: 324, h: 146 }, 5, vals, 62);
        } },

      { id: "C", name: "Bands", width: 632, step,
        why: "A scope for the bass waveform and four low-end band meters, each showing input against output — like Drum Buss's low-end section.",
        bullets: ["Measured: waveform of input (cyan) and output (orange) over two cycles",
                  "Measured: level in four bands (Sub, Low, Bass, Low-mid), input bar over output bar, with the change in dB",
                  "Menu on top, dials at the right"],
        draw(c, th, st, ps, vals) {
          menu(c, th, 6, HEAD_H + 4, 120, "DubCenter"); arrows(c, th, 130, HEAD_H + 4);
          txt(c, 176, HEAD_H + 15, `In ${st.inL.toFixed(1)} dB   Out ${st.outL.toFixed(1)} dB`, { color: th.text, align: "left" });
          const x = 6, y = HEAD_H + 24, w = 300, h = 141, sh = 52, mid = y + sh / 2;
          box(c, th, x, y, w, h);
          c.save(); c.beginPath(); c.rect(x, y, w, sh); c.clip();
          c.fillStyle = th.dline; c.fillRect(x, Math.round(mid), w, 1);
          const a = [], b = [];
          for (let px = 0; px <= w - 8; px += 2) {
            const ph = px / (w - 8) * 2 + st.t * 0.3, v = st.A * (Math.sin(TAU * ph) + 0.3 * Math.sin(TAU * 2 * ph + 0.6)) / 1.3;
            a.push([x + 4 + px, mid - v * (sh * 0.44)]); b.push([x + 4 + px, mid - Math.tanh(1.7 * v) / Math.tanh(1.7) * (sh * 0.44)]);
          }
          line(c, a, th.cyan, 1.2); line(c, b, th.orange, 1.8); c.restore();
          txt(c, x + 6, y + 11, "Scope", { color: th.scale, align: "left" });
          c.fillStyle = th.dline; c.fillRect(x + 4, y + sh + 1, w - 8, 1);
          BANDS.forEach((bd, i) => {
            const ry = y + sh + 6 + i * 21, d = st.bOut[i] - st.bIn[i];
            txt(c, x + 6, ry + 7, bd[0], { color: th.dispText, size: 9, align: "left" });
            txt(c, x + 6, ry + 16, bd[1], { color: th.scale, size: 7.5, align: "left" });
            hbar(c, th, x + 62, ry, 170, 6, fl(st.bIn[i]), th.cyan); hbar(c, th, x + 62, ry + 7, 170, 6, fl(st.bOut[i]), th.orange);
            txt(c, x + w - 6, ry + 11, `${d >= 0 ? "+" : ""}${d.toFixed(1)} dB`, { color: th.orange, align: "right" });
          });
          ctl(c, th, ps, { x: 312, y: HEAD_H + 22, w: 314, h: 146 }, 5, vals, 62);
        } },
    ],
  };
  // Input / Output gain strip at the right edge of every option (required on all devices)
  DESIGNS["Bass"].options.forEach(o => {
    const base = o.width, inner = o.draw;
    o.width = base + GAIN_W + 4;
    o.draw = (c, th, st, ps, vals) => { inner(c, th, st, ps, vals); gainStrip(c, th, o.width - GAIN_W - 4, st); };
  });
})();
