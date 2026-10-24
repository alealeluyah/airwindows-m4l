// Stereo: design options. Everything measured from the L/R input and output of the device.
// Every option ends with the standard Input / Output gain strip on the right edge.
(() => {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const S2 = Math.SQRT1_2;
  const dr = t => drums(((t % 2) + 2) % 2);          // drums() for any t, also before the start
  const Y0 = HEAD_H + 6, FH = DEVICE_H - 12;          // top and height of the working area

  // Simulated stereo signal: a centred drum loop with some side content. The "effect" slowly
  // changes width and balance, so in and out differ in a visible way.
  function core(st, t, dt) {
    const d = dr(t);
    const s = st.st;
    const a = d.env;
    const wIn = 0.32 + 0.1 * Math.sin(t * 0.31) + 0.9 * d.hat;
    const wOut = clamp(wIn * (1.7 + 0.9 * Math.sin(t * 0.45)) + 0.5 * d.sn, 0, 1.5);
    const pan = 0.28 * Math.sin(t * 1.1);
    const gL = 1 - Math.max(0, pan), gR = 1 + Math.min(0, pan);
    const M = a * 0.62 + 0.01;
    const sig = { mi: M, si: M * wIn, mo: M * 0.95, so: M * wOut };
    for (let k = 0; k < 8; k++) {
      s.n++;
      const u = noise(s.n * 1.7), v = noise(s.n * 2.3 + 5);
      const Li = sig.mi * u + sig.si * v, Ri = sig.mi * u - sig.si * v;
      const Lo = (sig.mo * u + sig.so * v) * gL, Ro = (sig.mo * u - sig.so * v) * gR;
      s.pts.push({ xi: (Li - Ri) * S2, yi: (Li + Ri) * S2, xo: (Lo - Ro) * S2, yo: (Lo + Ro) * S2 });
    }
    while (s.pts.length > 260) s.pts.shift();
    const rms = (m, sd, g) => Math.sqrt(m * m + sd * sd) * g;
    const lev = { Li: rms(sig.mi, sig.si, 1), Ri: rms(sig.mi, sig.si, 1), Lo: rms(sig.mo, sig.so, gL), Ro: rms(sig.mo, sig.so, gR),
      Mi: sig.mi * 1.2, Si: sig.si * 1.2, Mo: sig.mo * 1.2, So: sig.so * 1.2 };
    for (const k in lev) {
      s.lv[k] = Math.max(db(lev[k] + 0.003), (s.lv[k] === undefined ? -60 : s.lv[k]) - 24 * dt);
      s.pk[k] = Math.max(s.lv[k], (s.pk[k] === undefined ? -60 : s.pk[k]) - 9 * dt);
    }
    s.cI = (sig.mi ** 2 - sig.si ** 2) / (sig.mi ** 2 + sig.si ** 2);
    s.cO = (sig.mo ** 2 - sig.so ** 2) / (sig.mo ** 2 + sig.so ** 2);
    s.wI = clamp(sig.si / sig.mi, 0, 2); s.wO = clamp(sig.so / sig.mo, 0, 2);
    s.bI = 0; s.bO = clamp((gR - gL) * 0.9, -1, 1) * -1;
    st.inL = s.lv.Li; st.outL = s.lv.Lo;
    const j = (k, a) => a * noise(s.n * 1.3 + k * 7);          // block-to-block jitter of the measurement
    s.h.push({ bI: clamp(s.bI + j(1, 0.08), -1, 1), bO: clamp(s.bO + j(2, 0.12), -1, 1), cI: clamp(s.cI + j(3, 0.12), -1, 1), cO: clamp(s.cO + j(4, 0.2), -1, 1), wI: s.wI, wO: s.wO });
    if (s.h.length > 700) s.h.shift();
  }
  function step(st, dt) {
    if (!st.st) {
      st.st = { n: 0, pts: [], h: [], lv: {}, pk: {} };
      for (let i = 560; i > 0; i--) core(st, st.t - i / 120, 1 / 120);   // pre-roll so histories are full at once
    }
    core(st, st.t, dt);
  }

  // dials in a panel; "No controls" note when the effect has none
  function ctl(c, th, ps, vals, a) {
    rr(c, a.x, a.y, a.w, a.h, 3, th.panel);
    if (!ps.length) {
      txt(c, a.x + a.w / 2, a.y + a.h / 2 - 1, "No controls", { color: th.dim, size: 10.5 });
      txt(c, a.x + a.w / 2, a.y + a.h / 2 + 11, "this effect has no dials", { color: th.dim, size: 8.5 });
      return;
    }
    const n = ps.length, rows = (n > 3 && a.h >= 104) ? 2 : 1, cols = Math.ceil(n / rows);
    const cw = Math.min(56, a.w / cols), pitch = rows === 1 ? 50 : Math.min(58, (a.h - 6) / 2);
    const y0 = a.y + (a.h - (pitch * (rows - 1) + 50)) / 2;
    ps.forEach((p, i) => {
      const r = Math.floor(i / cols), k = i % cols, inRow = Math.min(cols, n - r * cols);
      knob(c, th, a.x + (a.w - inRow * cw) / 2 + k * cw, y0 + r * pitch, cw, p, vals[p._i]);
    });
  }
  const MENU = "StereoFX";
  function head(c, th, x, y, mw) { menu(c, th, x, y, mw, MENU); arrows(c, th, x + mw + 5, y); }
  // label, then its value right after it; returns the x where it ends
  function pair(c, th, x, y, label, val, col, size) {
    c.font = `400 9.5px ${FONT}`;
    const w = c.measureText(label).width;
    txt(c, x, y, label, { color: th.scale, align: "left" });
    txt(c, x + w + 5, y, val, { color: col, align: "left", size: size || 10.5, bold: true });
    c.font = `700 ${size || 10.5}px ${FONT}`;
    return x + w + 5 + c.measureText(val).width;
  }
  // horizontal bar: zero in the middle (v -1..1) or at the left (v 0..1)
  function hbar(c, th, x, y, w, h, v, col, centre) {
    rr(c, x, y, w, h, 2, th.meterBg);
    if (centre) {
      c.fillStyle = th.orange + "30"; c.fillRect(x, y, w / 2, h);          // left half: out-of-phase / mono-risk zone
      c.fillStyle = col; const bw = (w / 2) * v; c.fillRect(v >= 0 ? x + w / 2 : x + w / 2 + bw, y + 1, Math.abs(bw), h - 2);
      c.fillStyle = th.text; c.fillRect(x + w / 2 - 0.5, y - 1, 1, h + 2);
    } else { c.fillStyle = col; c.fillRect(x, y + 1, w * clamp(v, 0, 1), h - 2); }
  }

  function gonio(c, th, x, y, w, h, s) {
    rr(c, x, y, w, h, 3, th.display);
    const cx = x + w / 2, cy = y + h / 2 + 3, R = Math.min(w, h) / 2 - 17;
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    c.strokeStyle = th.dline; c.lineWidth = 1;
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(cx, cy, R / 2, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(cx - R, cy); c.lineTo(cx + R, cy); c.moveTo(cx, cy - R); c.lineTo(cx, cy + R); c.stroke();
    c.beginPath(); c.moveTo(cx - R * S2, cy - R * S2); c.lineTo(cx + R * S2, cy + R * S2);
    c.moveTo(cx + R * S2, cy - R * S2); c.lineTo(cx - R * S2, cy + R * S2); c.stroke();
    const n = s.pts.length, k = R * 1.15;
    for (let i = 0; i < n; i++) {
      const p = s.pts[i];
      c.globalAlpha = 0.25 + 0.55 * (i / n);
      c.fillStyle = th.dispText; c.fillRect(cx + p.xi * k - 1, cy - p.yi * k - 1, 2, 2);
    }
    for (let i = 0; i < n; i++) {
      const p = s.pts[i];
      c.globalAlpha = 0.3 + 0.7 * (i / n);
      c.fillStyle = th.cyan; c.fillRect(cx + p.xo * k - 1, cy - p.yo * k - 1, 2.5, 2.5);
    }
    c.globalAlpha = 1; c.restore();
    txt(c, cx, y + 10, "M", { color: th.scale, size: 9 });
    txt(c, x + 6, y + 11, "L", { color: th.scale, size: 9, align: "left" });
    txt(c, x + w - 6, y + 11, "R", { color: th.scale, size: 9, align: "right" });
    txt(c, cx, y + h - 4, "S", { color: th.scale, size: 9 });
    txt(c, x + 6, y + h - 5, "Out", { color: th.cyan, size: 9.5, align: "left", bold: true });
    txt(c, x + w - 6, y + h - 5, "In", { color: th.dispText, size: 9.5, align: "right", bold: true });
  }

  const pc = v => Math.round(v * 100) + "%";
  const f1 = v => (v >= 0 ? "+" : "-") + Math.abs(v).toFixed(2);

  DESIGNS["Stereo"] = {
    effect: "Srsly3",
    refs: [["UtilityL12.png", "Utility"], ["ChannelEQL12.png", "Channel EQ"], ["EchoL12.png", "Echo"]],
    lead: "Visual cue: the stereo image, measured live from the left and right channels of input and output: vectorscope, correlation, width and balance. Every option has the Input / Output gain strip on the right.",
    options: [
      { id: "A", name: "Vectorscope", width: 588, step,
        why: "A round vectorscope shows where the sound sits in the stereo field, with correlation, width and balance bars at the side — like the displays in Utility and Live's spectrum tools.",
        bullets: ["Driven by: L and R samples of input and output, plotted as mid (up) against side (across)", "Correlation, width and balance bars for input and output; the orange zone marks out-of-phase risk", "Menu and arrows top-left, dials below (0 to 6 handled); Input / Output gain strip on the right"],
        draw(c, th, st, ps, vals) {
          const s = st.st; if (!s) return;
          head(c, th, 6, Y0, 112);
          ctl(c, th, ps, vals, { x: 4, y: Y0 + 20, w: 158, h: FH - 20 });
          gonio(c, th, 166, Y0, 190, FH, s);
          // readout panel
          const x = 362, w = 152, y = Y0;
          rr(c, x, y, w, FH, 3, th.display);
          const row = (yy, label, v, col) => {
            txt(c, x + 8, yy + 8, label, { color: col, align: "left", bold: true });
            return yy;
          };
          txt(c, x + 8, y + 14, "Correlation", { color: th.scale, align: "left" });
          [["In", s.cI, th.dispText, 22], ["Out", s.cO, th.cyan, 38]].forEach(([l, v, col, o]) => {
            row(y + o, l, v, col);
            hbar(c, th, x + 34, y + o, 76, 10, v, col, true);
            txt(c, x + w - 6, y + o + 9, f1(v), { color: col, align: "right", size: 10, bold: true });
          });
          txt(c, x + 34, y + 60, "-1", { color: th.scale, size: 8.5, align: "left" });
          txt(c, x + 72, y + 60, "0", { color: th.scale, size: 8.5 });
          txt(c, x + 110, y + 60, "+1", { color: th.scale, size: 8.5, align: "right" });
          c.fillStyle = th.dline; c.fillRect(x + 6, y + 68, w - 12, 1);
          txt(c, x + 8, y + 84, "Width", { color: th.scale, align: "left" });
          [["In", s.wI, th.dispText, 90], ["Out", s.wO, th.cyan, 105]].forEach(([l, v, col, o]) => {
            row(y + o, l, v, col);
            hbar(c, th, x + 34, y + o, 76, 10, v / 1.5, col, false);
            txt(c, x + w - 6, y + o + 9, pc(v), { color: col, align: "right", size: 10, bold: true });
          });
          c.fillStyle = th.dline; c.fillRect(x + 6, y + 124, w - 12, 1);
          txt(c, x + 8, y + 140, "Balance", { color: th.scale, align: "left" });
          txt(c, x + w - 6, y + 140, f1(s.bO), { color: th.orange, align: "right", size: 10.5, bold: true });
          hbar(c, th, x + 8, y + 145, w - 16, 6, s.bO, th.orange, true);
          gainStrip(c, th, 588 - GAIN_W - 4, st);
        } },
      { id: "B", name: "Mid/Side meters", width: 548, step,
        why: "Eight level meters — left, right, mid and side — for input and output, so you see what the effect adds or removes at a glance, like Utility's Mid/Side and Width view.",
        bullets: ["Driven by: peak level of L, R, mid (L+R) and side (L-R), before and after; thin lines hold the peak", "Width and balance readouts next to the menu", "Dials in one block on the right; Input / Output gain strip at the far right"],
        draw(c, th, st, ps, vals) {
          const s = st.st; if (!s) return;
          head(c, th, 6, Y0, 112);
          rr(c, 164, Y0, 146, 14, 2, th.display);
          const e = pair(c, th, 170, Y0 + 11, "Width", pc(s.wO), th.cyan);
          pair(c, th, e + 10, Y0 + 11, "Bal", f1(s.bO), th.orange);
          const dx = 6, dy = Y0 + 20, dw = 304, dh = FH - 20;
          rr(c, dx, dy, dw, dh, 3, th.display);
          const mt = dy + 24, mh = dh - 42;
          const grp = [["Input", ["Li", "Ri", "Mi", "Si"], dx + 14, th.dispText], ["Output", ["Lo", "Ro", "Mo", "So"], dx + 176, th.cyan]];
          const names = ["L", "R", "M", "S"];
          const yOf = v => mt + mh * (-v / 48);
          [0, -12, -24, -36].forEach(v => {
            c.fillStyle = th.dline; c.fillRect(dx + 6, yOf(v), dw - 12, 1);
            txt(c, dx + 153, yOf(v) + 3, String(v), { color: th.scale, size: 8.5 });
          });
          grp.forEach(([t, keys, gx, tc]) => {
            txt(c, gx + 55, dy + 14, t, { color: tc, bold: true, size: 10 });
            keys.forEach((k, i) => {
              const f = clamp(1 + s.lv[k] / 48, 0, 1), x = gx + i * 27 + (i > 1 ? 8 : 0);
              meterV(c, th, x, mt, 15, mh, f, false, i > 1 ? th.cyan : th.green);
              const py = yOf(clamp(s.pk[k], -48, 0));
              c.fillStyle = th.text; c.fillRect(x, py, 15, 1.5);
              txt(c, x + 7.5, mt + mh + 11, names[i], { color: th.dispText, size: 9.5, bold: true });
            });
          });
          ctl(c, th, ps, vals, { x: 316, y: Y0, w: 160, h: FH });
          gainStrip(c, th, 548 - GAIN_W - 4, st);
        } },
      { id: "C", name: "Field history", width: 648, step,
        why: "A scrolling picture of balance and correlation over time, input in grey and output in colour — like the scrolling display in Echo and Compressor.",
        bullets: ["Driven by: left/right level balance and L/R correlation, measured every block", "Top lane: balance (left to right); bottom lane: correlation (-1 to +1) with an orange mono-risk zone", "Dials in one row under the display; Input / Output gain strip on the right"],
        draw(c, th, st, ps, vals) {
          const s = st.st; if (!s) return;
          const dx = 6, dy = Y0, dw = 568, dh = 98;
          rr(c, dx, dy, dw, dh, 3, th.display);
          head(c, th, dx + 4, dy + 4, 100);
          let e = pair(c, th, dx + 160, dy + 15, "Balance", f1(s.bO), th.orange);
          e = pair(c, th, e + 16, dy + 15, "Corr", f1(s.cO), th.cyan);
          pair(c, th, e + 16, dy + 15, "Width", pc(s.wO), th.cyan);
          txt(c, dx + dw - 8, dy + 15, "In grey · Out colour", { color: th.dispText, align: "right", size: 9 });
          const lx = dx + 30, lw = dw - 36;
          const lane = (y, h, key, col, risk) => {
            c.save(); c.beginPath(); c.rect(lx, y, lw, h); c.clip();
            c.fillStyle = th.meterBg; c.fillRect(lx, y, lw, h);
            if (risk) { c.fillStyle = th.orange + "28"; c.fillRect(lx, y + h / 2, lw, h / 2); }
            c.fillStyle = th.dline; c.fillRect(lx, y + h / 2, lw, 1);
            const n = Math.min(s.h.length, lw);
            const path = k => { c.beginPath(); for (let i = 0; i < n; i++) { const v = s.h[s.h.length - 1 - i][k]; const yy = y + h / 2 - v * (h / 2 - 2); i ? c.lineTo(lx + lw - i, yy) : c.moveTo(lx + lw, yy); } };
            path(key + "I"); c.strokeStyle = th.dispText; c.lineWidth = 1.5; c.stroke();
            path(key + "O"); c.strokeStyle = col; c.lineWidth = 2; c.stroke();
            c.restore();
          };
          lane(dy + 22, 34, "b", th.orange);
          lane(dy + 60, 34, "c", th.cyan, true);
          txt(c, lx - 4, dy + 32, "R", { color: th.scale, size: 8.5, align: "right" });
          txt(c, lx - 4, dy + 54, "L", { color: th.scale, size: 8.5, align: "right" });
          txt(c, lx - 4, dy + 70, "+1", { color: th.scale, size: 8.5, align: "right" });
          txt(c, lx - 4, dy + 93, "-1", { color: th.scale, size: 8.5, align: "right" });
          txt(c, lx + lw - 4, dy + 91, "mono risk", { color: th.orange, size: 8, align: "right" });
          ctl(c, th, ps, vals, { x: 6, y: dy + dh + 4, w: 568, h: FH - dh - 4 });
          gainStrip(c, th, 648 - GAIN_W - 4, st);
        } },
    ],
  };
})();
