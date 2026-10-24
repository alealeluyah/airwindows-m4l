// Stereo: design options. Everything measured from the L/R input and output of the device.
// Every option ends with the standard Input / Output gain strip on the right edge.
(() => {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // readout with a hover hint over label + value
  const ph = (c, th, x, y, label, val, col, title, text, size) => { const e = pair(c, th, x, y, label, val, col, size); hint(x - 2, y - 10, e - x + 4, 14, title, text); return e; };
  // legend that ends at x = right
  const legR = (c, th, right, y, items, o = {}) => {
    c.font = `400 8.5px ${FONT}`;
    let w = 0; for (const it of items) w += Math.ceil(c.measureText(it[1]).width) + (o.line ? 11 : 9) + 8;
    return legend(c, th, right - (w - 8), y, items, o);
  };
  const S2 = Math.SQRT1_2;
  const dr = t => drums(((t % 2) + 2) % 2);          // drums() for any t, also before the start
  const Y0 = HEAD_H + 4, FH = DEVICE_H - 8;           // top and height of the working area (4 px margin)

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


  // ---- real measurements -> the same state fields core() fills (see lib.js "real measurements")
  const fin = (v, d) => (Number.isFinite(v) ? v : d);
  function stLive(st, m, dt) {
    if (!st.st) st.st = { n: 0, pts: [], h: [], lv: {}, pk: {}, cI: 1, cO: 1, wI: 0, wO: 0, bI: 0, bO: 0, ag: 1, sp: 0.3 };
    const s = st.st, ms = m.ms || [], rl = db_ => Math.pow(10, clamp(fin(db_, -120), -120, 6) / 20);
    const pkIn = m.inPkDb || [-120, -120], pkOut = m.outPkDb || [-120, -120];
    // level meters: fast attack, 24 dB/s release; thin line holds the peak (9 dB/s)
    const lev = { Li: pkIn[0], Ri: pkIn[1], Lo: pkOut[0], Ro: pkOut[1], Mi: ms[0], Si: ms[1], Mo: ms[2], So: ms[3] };
    for (const k in lev) {
      const v = clamp(fin(lev[k], -120), -120, 6), o = s.lv[k] === undefined ? -120 : s.lv[k];
      s.lv[k] = Math.max(v, o - 24 * dt);
      s.pk[k] = Math.max(s.lv[k], (s.pk[k] === undefined ? -120 : s.pk[k]) - 9 * dt);
    }
    st.inL = Math.max(st.inL === undefined ? -120 : st.inL - 24 * dt, Math.max(pkIn[0], pkIn[1]));
    st.outL = Math.max(st.outL === undefined ? -120 : st.outL - 24 * dt, Math.max(pkOut[0], pkOut[1]));
    // vectorscope: 12 samples of the 64-sample scopes per frame, mid up / side across.
    // Fixed scale (RUBRIC 2.6): true level, 1x.
    const iL = m.inScopeL || [], iR = m.inScopeR || [], oL = m.scopeL || [], oR = m.scopeR || [];
    const n = Math.min(iL.length, iR.length, oL.length, oR.length);
    for (let j = 0; j < 12 && n > 0; j++) {
      const i = Math.min(n - 1, Math.floor(j * n / 12 + 2));
      s.pts.push({ xi: (iL[i] - iR[i]) * S2, yi: (iL[i] + iR[i]) * S2, xo: (oL[i] - oR[i]) * S2, yo: (oL[i] + oR[i]) * S2 });
    }
    while (s.pts.length > 260) s.pts.shift();
    // correlation from mid/side power, width = side / mid amplitude, balance from channel peaks
    const corr = (M, Sd, old) => {
      if (!Number.isFinite(M) || !Number.isFinite(Sd) || M < -100) return old;
      const pm = Math.pow(10, M / 10), ps = Math.pow(10, Sd / 10);
      return (pm - ps) / (pm + ps);
    };
    const wid = (M, Sd, old) => (!Number.isFinite(M) || !Number.isFinite(Sd) || M < -100) ? old : clamp(Math.pow(10, (Sd - M) / 20), 0, 2);
    const bal = (a, b, old) => (Math.max(a, b) < -90 ? old : clamp((rl(b) - rl(a)) / (rl(a) + rl(b)), -1, 1));
    const sm = (o, v, a) => o + (v - o) * a;
    s.cI = sm(s.cI, corr(ms[0], ms[1], s.cI), 0.3); s.cO = sm(s.cO, corr(ms[2], ms[3], s.cO), 0.3);
    s.wI = sm(s.wI, wid(ms[0], ms[1], s.wI), 0.3); s.wO = sm(s.wO, wid(ms[2], ms[3], s.wO), 0.3);
    s.bI = sm(s.bI, bal(pkIn[0], pkIn[1], s.bI), 0.25); s.bO = sm(s.bO, bal(pkOut[0], pkOut[1], s.bO), 0.25);
    s.h.push({ bI: s.bI, bO: s.bO, cI: s.cI, cO: s.cO, wI: s.wI, wO: s.wO });
    if (s.h.length > 700) s.h.shift();
  }

  // dials in a panel; "No controls" note when the effect has none
  function ctl(c, th, ps, vals, a, noTile) {
    if (!noTile) tile(c, th, a.x, a.y, a.w, a.h);
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
    screen(c, th, x, y, w, h);
    const pH = h - 17;                                     // plot height; the bottom strip holds the legend
    hint(x, y, w, pH, "Vectorscope Display", "Each dot is one moment of the sound. Straight up means the same in left and right (mono). Wide sideways spread means a wide stereo image. Measured from the left and right channels, before and after the effect.");
    const cx = x + w / 2, cy = y + pH / 2, R = Math.min(w, pH) / 2 - 16;
    c.save(); c.beginPath(); c.rect(x, y, w, pH); c.clip();
    c.strokeStyle = th.dline; c.lineWidth = 1;
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(cx, cy, R / 2, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(cx - R, cy); c.lineTo(cx + R, cy); c.moveTo(cx, cy - R); c.lineTo(cx, cy + R); c.stroke();
    c.beginPath(); c.moveTo(cx - R * S2, cy - R * S2); c.lineTo(cx + R * S2, cy + R * S2);
    c.moveTo(cx + R * S2, cy - R * S2); c.lineTo(cx - R * S2, cy + R * S2); c.stroke();
    // fixed scale (RUBRIC 2.6): full scale = the outer ring
    const n = s.pts.length, k = R;
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
    txt(c, cx, y + pH - 4, "S", { color: th.scale, size: 9 });
    const by = strip(c, th, x, y + h - 17, w, 17, true);
    legend(c, th, x + 8, by, [[th.dispText, "In", "Grey dots: the stereo image of the signal going into the effect."], [th.cyan, "Out", "Cyan dots: the stereo image of the signal coming out of the effect."]]);
    hint(cx - 8, y + 1, 16, 12, "Mono Axis (M)", "The up-down line. Dots on it carry the same signal in left and right. Measured from the sum of left and right.");
    hint(cx - 8, y + pH - 14, 16, 12, "Side Axis (S)", "The across line. Dots far from the centre line are different in left and right. Measured from the difference of left and right.");
    hint(x + 2, y + 1, 14, 12, "Left Channel Axis (L)", "The diagonal to the upper left. Dots here are louder in the left channel.");
    hint(x + w - 16, y + 1, 14, 12, "Right Channel Axis (R)", "The diagonal to the upper right. Dots here are louder in the right channel.");
  }

  const pc = v => Math.round(v * 100) + "%";
  const f1 = v => (v >= 0 ? "+" : "-") + Math.abs(v).toFixed(2);

  DESIGNS["Stereo"] = {
    effect: "Srsly3",
    refs: [["UtilityL12.png", "Utility"], ["ChannelEQL12.png", "Channel EQ"], ["EchoL12.png", "Echo"]],
    lead: "Visual cue: the stereo image, measured live from the left and right channels of input and output: vectorscope, correlation, width and balance. Every option has the Input / Output gain strip on the right.",
    options: [
      { id: "A", name: "Vectorscope", short: "Vector", width: 588, step, live: stLive,
        why: "A round vectorscope shows where the sound sits in the stereo field, with correlation, width and balance bars at the side — like the displays in Utility and Live's spectrum tools.",
        bullets: ["Driven by: 64-sample L/R scopes of input and output (mid up, side across, fixed scale, true level); correlation and width from the mid/side RMS values", "Correlation, width and balance bars for input and output; the orange zone marks out-of-phase risk", "Menu and arrows top-left, dials below (0 to 6 handled); Input / Output gain strip on the right"],
        draw(c, th, st, ps, vals) {
          const s = st.st; if (!s) return;
          tile(c, th, 4, Y0, 150, FH);                       // selector + dials
          head(c, th, 8, Y0 + 4, 104);
          ctl(c, th, ps, vals, { x: 4, y: Y0 + 22, w: 150, h: FH - 22 }, true);
          gonio(c, th, 156, Y0, 210, FH, s);
          // readout screen
          const x = 368, w = 150, y = Y0;
          screen(c, th, x, y, w, FH);
          hint(x, y, w, FH, "Stereo Readouts", "Correlation, width and balance of the stereo image. Grey is the input, cyan is the output.");
          const row = (yy, label, v, col) => {
            txt(c, x + 8, yy + 8, label, { color: col, align: "left", bold: true });
            return yy;
          };
          txt(c, x + 8, y + 14, "Correlation", { color: th.scale, align: "left" });
          [["In", s.cI, th.dispText, 22], ["Out", s.cO, th.cyan, 38]].forEach(([l, v, col, o]) => {
            row(y + o, l, v, col);
            hint(x + 4, y + o - 2, w - 8, 14, l === "In" ? "Input Correlation" : "Output Correlation", "How alike left and right are. +1 is mono, 0 is wide, -1 is opposite (may cancel in mono; orange zone). Measured from the mid and side power of the " + (l === "In" ? "input." : "output."));
            hbar(c, th, x + 34, y + o, 76, 10, v, col, true);
            txt(c, x + w - 6, y + o + 9, f1(v), { color: col, align: "right", size: 10, bold: true });
          });
          hint(x + 30, y + 52, 84, 11, "Correlation Scale", "Left end -1 (opposite), centre 0 (wide), right end +1 (mono).");
          txt(c, x + 34, y + 60, "-1", { color: th.scale, size: 8.5, align: "left" });
          txt(c, x + 72, y + 60, "0", { color: th.scale, size: 8.5 });
          txt(c, x + 110, y + 60, "+1", { color: th.scale, size: 8.5, align: "right" });
          c.fillStyle = th.dline; c.fillRect(x + 6, y + 68, w - 12, 1);
          txt(c, x + 8, y + 84, "Width", { color: th.scale, align: "left" });
          [["In", s.wI, th.dispText, 90], ["Out", s.wO, th.cyan, 105]].forEach(([l, v, col, o]) => {
            row(y + o, l, v, col);
            hint(x + 4, y + o - 2, w - 8, 14, l === "In" ? "Input Width" : "Output Width", "How wide the " + (l === "In" ? "input" : "output") + " is. 0% is mono, 100% is the side as loud as the mid. Measured as side level divided by mid level.");
            hbar(c, th, x + 34, y + o, 76, 10, v / 1.5, col, false);
            txt(c, x + w - 6, y + o + 9, pc(v), { color: col, align: "right", size: 10, bold: true });
          });
          c.fillStyle = th.dline; c.fillRect(x + 6, y + 124, w - 12, 1);
          hint(x + 4, y + 130, w - 8, 24, "Output Balance", "Which side the output is louder on. Left of the middle mark is left, right of it is right. Measured from the left and right peak levels.");
          txt(c, x + 8, y + 140, "Balance", { color: th.scale, align: "left" });
          txt(c, x + w - 6, y + 140, f1(s.bO), { color: th.orange, align: "right", size: 10.5, bold: true });
          hbar(c, th, x + 8, y + 145, w - 16, 6, s.bO, th.orange, true);
          gainStrip(c, th, 588 - GAIN_W - 4, st);
        } },
      { id: "B", name: "Mid/Side meters", short: "Meters", width: 548, step, live: stLive,
        why: "Eight level meters — left, right, mid and side — for input and output, so you see what the effect adds or removes at a glance, like Utility's Mid/Side and Width view.",
        bullets: ["Driven by: peak level of L, R, mid (L+R) and side (L-R), before and after; thin lines hold the peak", "Width and balance readouts next to the menu", "Dials in one block on the right; Input / Output gain strip at the far right"],
        draw(c, th, st, ps, vals) {
          const s = st.st; if (!s) return;
          const dx = 4, dy = Y0, dw = 306, dh = FH;
          screen(c, th, dx, dy, dw, dh);
          head(c, th, dx + 5, dy + 4, 92);
          strip(c, th, dx, dy, dw, 22);
          const e = ph(c, th, dx + 142, dy + 15, "Width", pc(s.wO), th.cyan, "Output Width", "How wide the output is. 0% is mono. Measured as side level divided by mid level.");
          ph(c, th, e + 10, dy + 15, "Bal", f1(s.bO), th.orange, "Output Balance", "Which side the output is louder on. Negative is left, positive is right. Measured from the left and right peak levels.");
          hint(dx, dy + 22, dw, dh - 38, "Level Meters Display", "Eight level meters: left, right, mid and side. Input on the left half, output on the right half. Measured from the peak level of each signal.");
          strip(c, th, dx, dy + dh - 16, dw, 16, true);
          legend(c, th, dx + 8, dy + dh - 5, [[th.green, "L/R", "Green meters: the left and right channels."], [th.cyan, "M/S", "Cyan meters: mid (left plus right) and side (left minus right)."], [th.text, "Peak", "The thin line on each meter holds the highest recent level."]]);
          const mt = dy + 38, mh = dh - 16 - 14 - 38;
          const grp = [["Input", ["Li", "Ri", "Mi", "Si"], dx + 14, th.dispText], ["Output", ["Lo", "Ro", "Mo", "So"], dx + 176, th.cyan]];
          const names = ["L", "R", "M", "S"];
          const yOf = v => mt + mh * (-v / 48);
          [0, -12, -24, -36].forEach(v => {
            c.fillStyle = th.dline; c.fillRect(dx + 6, yOf(v), dw - 12, 1);
            txt(c, dx + 153, yOf(v) + 3, String(v), { color: th.scale, size: 8.5 });
          });
          hint(dx + 140, mt, 26, mh, "Level Scale", "Meter scale in dB. 0 dB is the loudest level, lower numbers are quieter.");
          grp.forEach(([t, keys, gx, tc]) => {
            txt(c, gx + 55, dy + 33, t, { color: tc, bold: true, size: 10 });
            keys.forEach((k, i) => {
              const f = clamp(1 + s.lv[k] / 48, 0, 1), x = gx + i * 27 + (i > 1 ? 8 : 0);
              meterV(c, th, x, mt, 15, mh, f, false, i > 1 ? th.cyan : th.green);
              hint(x, mt, 15, mh + 14, (t === "Input" ? "Input " : "Output ") + ["Left", "Right", "Mid", "Side"][i] + " Meter", ["The level of the left channel", "The level of the right channel", "The level of the mid signal (left plus right)", "The level of the side signal (left minus right)"][i] + (t === "Input" ? ", before" : ", after") + " the effect. The thin line holds the peak.");
              const py = yOf(clamp(s.pk[k], -48, 0));
              c.fillStyle = th.text; c.fillRect(x, py, 15, 1.5);
              txt(c, x + 7.5, mt + mh + 11, names[i], { color: th.dispText, size: 9.5, bold: true });
            });
          });
          ctl(c, th, ps, vals, { x: 312, y: Y0, w: 166, h: FH });
          gainStrip(c, th, 548 - GAIN_W - 4, st);
        } },
      { id: "C", name: "Field history", short: "History", width: 648, step, live: stLive,
        why: "A scrolling picture of balance and correlation over time, input in grey and output in colour — like the scrolling display in Echo and Compressor.",
        bullets: ["Driven by: left/right level balance and L/R correlation, measured every block", "Top lane: balance (left to right); bottom lane: correlation (-1 to +1) with an orange mono-risk zone", "Dials in one row under the display; Input / Output gain strip on the right"],
        draw(c, th, st, ps, vals) {
          const s = st.st; if (!s) return;
          const dx = 4, dy = Y0, dw = 574, dh = 100;
          screen(c, th, dx, dy, dw, dh);
          strip(c, th, dx, dy, dw, 22);
          hint(dx, dy + 22, dw, dh - 22, "Stereo History Display", "Two lanes scroll from right (now) to left (past): balance on top, correlation below. Measured from the left and right channels, before and after the effect.");
          head(c, th, dx + 5, dy + 4, 100);
          let e = ph(c, th, dx + 160, dy + 15, "Balance", f1(s.bO), th.orange, "Output Balance", "Which side the output is louder on. Negative is left, positive is right. Measured from the left and right peak levels.");
          e = ph(c, th, e + 16, dy + 15, "Corr", f1(s.cO), th.cyan, "Output Correlation", "How alike left and right are. +1 is mono, 0 is wide, -1 is opposite.");
          ph(c, th, e + 16, dy + 15, "Width", pc(s.wO), th.cyan, "Output Width", "How wide the output is. 0% is mono. Measured as side level divided by mid level.");
          legR(c, th, dx + dw - 8, dy + 15, [[th.dispText, "In", "Grey line: the input, in both lanes."], [th.orange, "Out balance", "Orange line: the output balance."], [th.cyan, "Out corr.", "Cyan line: the output correlation."]], { line: true });
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
          lane(dy + 24, 34, "b", th.orange);
          lane(dy + 62, 34, "c", th.cyan, true);
          hint(lx, dy + 24, lw, 34, "Balance Lane", "Shows which side is louder over time. Up is right, down is left, the middle line is centred. Measured from the left and right peak levels.");
          hint(lx, dy + 62, lw, 34, "Correlation Lane", "Shows how alike left and right are over time. Up is mono (+1), the middle is wide (0), down is opposite (-1).");
          hint(lx, dy + 79, lw, 17, "Mono-Risk Zone", "The orange area marks negative correlation. Sound here can drop out when played in mono.");
          hint(lx - 26, dy + 24, 24, 72, "Lane Scale", "Top lane: R is up, L is down. Bottom lane: +1 is up, -1 is down.");
          txt(c, lx - 4, dy + 34, "R", { color: th.scale, size: 8.5, align: "right" });
          txt(c, lx - 4, dy + 56, "L", { color: th.scale, size: 8.5, align: "right" });
          txt(c, lx - 4, dy + 72, "+1", { color: th.scale, size: 8.5, align: "right" });
          txt(c, lx - 4, dy + 95, "-1", { color: th.scale, size: 8.5, align: "right" });
          txt(c, lx + lw - 4, dy + 93, "mono risk", { color: th.orange, size: 8, align: "right" });
          ctl(c, th, ps, vals, { x: 4, y: dy + dh + 2, w: 574, h: FH - dh - 2 });
          gainStrip(c, th, 648 - GAIN_W - 4, st);
        } },
    ],
  };
})();
