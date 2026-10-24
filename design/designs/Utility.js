// Utility: design options. All helpers are private to this IIFE.
(() => {
  const B = 96;
  // Simulated stereo source (drums level, wide side part) and a device output that
  // changes width, balance and gain slowly, so in-vs-out differences are visible.
  function step0(st, dt) {
    if (!st.uz) Object.assign(st, { uz: true, n: 0, cnt: 1, iL: new Float32Array(B), iR: new Float32Array(B), oL: new Float32Array(B), oR: new Float32Array(B),
      pk: [-60, -60, -60, -60], corrI: 0.6, corrO: 0.6, mI: -60, sI: -60, mO: -60, sO: -60, dc: 0, gainD: 0, pol: 1, uh: [] });
    const d = drums(st.t), env = 0.12 + 0.75 * d.env, ph = st.t * 5;
    const wid = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(st.t * 0.4)), bal = 0.35 * Math.sin(st.t * 0.27), gain = 1 + 0.35 * Math.sin(st.t * 0.5 + 1);
    const flip = Math.sin(st.t * 0.13) > 0.8 ? -1 : 1;
    let sm = 0, ss = 0, om = 0, os = 0, lr = 0, ll = 0, rr_ = 0, ol = 0, orr = 0, olr = 0, io = 0, ii = 0, sumO = 0;
    const pk = [0, 0, 0, 0];
    for (let n = 0; n < B; n++) {
      const a = 2 * Math.PI * n / B;
      const m = env * (0.55 * Math.sin(3 * a + ph) + 0.3 * Math.sin(7 * a + 1 + ph * 1.3));
      const s = env * (0.45 * Math.sin(5 * a + 2 + ph * 0.7) + 0.2 * noise(st.cnt++));
      const L = m + s * 0.8, R = m - s * 0.8;
      const mo = m, so = s * 0.8 * wid * 1.2;
      const oL = (mo + so) * gain * (1 - Math.max(0, bal)) * flip, oR = (mo - so) * gain * (1 + Math.min(0, bal)) * flip;
      st.iL[n] = L; st.iR[n] = R; st.oL[n] = oL; st.oR[n] = oR;
      sm += ((L + R) / 2) ** 2; ss += ((L - R) / 2) ** 2; om += ((oL + oR) / 2) ** 2; os += ((oL - oR) / 2) ** 2;
      lr += L * R; ll += L * L; rr_ += R * R; ol += oL * oL; orr += oR * oR; olr += oL * oR; io += L * oL; ii += L * L; sumO += oL + oR;
      pk[0] = Math.max(pk[0], Math.abs(L)); pk[1] = Math.max(pk[1], Math.abs(R)); pk[2] = Math.max(pk[2], Math.abs(oL)); pk[3] = Math.max(pk[3], Math.abs(oR));
    }
    for (let i = 0; i < 4; i++) st.pk[i] = Math.max(db(pk[i]), st.pk[i] - 24 * dt);
    const sm_ = (a, b, k) => a + (b - a) * k;
    st.corrI = sm_(st.corrI, lr / Math.sqrt(ll * rr_ + 1e-9), 0.15); st.corrO = sm_(st.corrO, olr / Math.sqrt(ol * orr + 1e-9), 0.15);
    st.mI = sm_(st.mI, db(Math.sqrt(sm / B)), 0.3); st.sI = sm_(st.sI, db(Math.sqrt(ss / B)), 0.3);
    st.mO = sm_(st.mO, db(Math.sqrt(om / B)), 0.3); st.sO = sm_(st.sO, db(Math.sqrt(os / B)), 0.3);
    st.dc = sm_(st.dc, sumO / (2 * B), 0.05); st.gainD = sm_(st.gainD, db(Math.sqrt(ol / B)) - db(Math.sqrt(ll / B)), 0.3);
    st.pol = io / (ii + 1e-9) >= 0 ? 1 : -1;
    st.uh.push({ i: Math.max(st.pk[0], st.pk[1]), o: Math.max(st.pk[2], st.pk[3]), mI: st.mI, sI: st.sI, mO: st.mO, sO: st.sO, g: st.gainD });
    if (st.uh.length > 500) st.uh.shift();
  }

  // ---------- live(): measurements from airwin~ (about 30 per second)
  // Fills: iL/iR/oL/oR (scope, 64 samples), pk[4] (held peaks dBFS), corrI/corrO, mI/sI/mO/sO (RMS dBFS),
  // dc, gainD, pol, uh (history), inL/outL.
  const fin = (v, d) => (Number.isFinite(v) ? v : d);
  const hold = (prev, v, dt) => Math.max(fin(v, -120), fin(prev, -120) - 24 * dt);
  function live(st, m, dt) {
    if (!st.lv) Object.assign(st, { lv: true, iL: [], iR: [], oL: [], oR: [], pk: [-120, -120, -120, -120], corrI: 0, corrO: 0, mI: -120, sI: -120, mO: -120, sO: -120,
      dc: 0, gainD: 0, pol: 1, uh: [], inL: -60, outL: -60 });
    const cp = a => Array.from(a || [], v => fin(v, 0));
    const iL = cp(m.inScopeL), iR = cp(m.inScopeR), oL = cp(m.scopeL), oR = cp(m.scopeR);
    const n = Math.min(iL.length, iR.length, oL.length, oR.length);
    if (n > 0) {
      st.iL = iL.slice(0, n); st.iR = iR.slice(0, n); st.oL = oL.slice(0, n); st.oR = oR.slice(0, n);
      let io = 0, e = 0; for (let i = 0; i < n; i++) { io += st.iL[i] * st.oL[i] + st.iR[i] * st.oR[i]; e += st.iL[i] ** 2 + st.iR[i] ** 2 + st.oL[i] ** 2 + st.oR[i] ** 2; }
      if (e > 1e-9 && Math.abs(io) > 1e-3 * e) st.pol = io >= 0 ? 1 : -1;        // keep the last answer in silence
    }
    const pks = [m.inPkDb[0], m.inPkDb[1], m.outPkDb[0], m.outPkDb[1]];
    for (let i = 0; i < 4; i++) st.pk[i] = hold(st.pk[i], pks[i], dt);
    st.inL = Math.max(st.pk[0], st.pk[1]); st.outL = Math.max(st.pk[2], st.pk[3]);
    const ms = m.ms || [-120, -120, -120, -120];
    st.mI = hold(st.mI, ms[0], dt); st.sI = hold(st.sI, ms[1], dt); st.mO = hold(st.mO, ms[2], dt); st.sO = hold(st.sO, ms[3], dt);
    // input correlation from mid/side power: (M^2 - S^2) / (M^2 + S^2) equals L/R correlation for equal L and R power
    const pm = 10 ** (fin(ms[0], -120) / 10), ps = 10 ** (fin(ms[1], -120) / 10);
    const cI = pm + ps > 1e-11 ? (pm - ps) / (pm + ps) : st.corrI;
    st.corrI += (cI - st.corrI) * 0.15;
    st.corrO += (fin(m.corr, 0) - st.corrO) * 0.15;
    st.dc += (fin(m.dcOut, 0) - st.dc) * 0.15;
    st.gainD += (fin(m.gainDb, 0) - st.gainD) * 0.3;
    st.uh.push({ i: Math.max(st.pk[0], st.pk[1]), o: Math.max(st.pk[2], st.pk[3]), mI: st.mI, sI: st.sI, mO: st.mO, sO: st.sO, g: st.gainD });
    if (st.uh.length > 500) st.uh.shift();
  }

  // the shared gain strip (its meters explain themselves on hover)
  function gs(c, th, x, st) { gainStrip(c, th, x, st); }
  function step(st, dt) {
    if (!st.pre) { st.pre = true; for (let i = 0; i < 520; i++) { st.t += 0.016; step0(st, 0.016); } }
    step0(st, dt);
    st.inL = Math.max(Math.max(st.pk[0], st.pk[1]), st.inL - 24 * dt); st.outL = Math.max(Math.max(st.pk[2], st.pk[3]), st.outL - 24 * dt);
  }

  function dials(c, th, ps, vals, W) {
    const n = ps.length, y = HEAD_H + 4, h = DEVICE_H - 8;
    if (!n) { tile(c, th, W - 98, y, 96, h); txt(c, W - 50, HEAD_H + 88, "No controls", { color: th.dim });
      return 96; }
    const rows = n <= 5 ? 1 : n <= 10 ? 2 : 3, cols = Math.ceil(n / rows), w = cols * 52;
    const tw = w + 8;
    tile(c, th, W - 2 - tw, y, tw, h);
    knobGrid(c, th, ps, { x: W - 2 - tw + 4, y, w, h }, cols, vals);
    return tw;
  }
  function panel(c, th, w, readouts, dTitle, dText, bot = 0) {
    const x = 4, y = HEAD_H + 4, h = DEVICE_H - 8;
    screen(c, th, x, y, w, h);
    menu(c, th, x + 4, y + 3, 104, "EveryTrim"); arrows(c, th, x + 112, y + 3);
    strip(c, th, x, y, w, 22);
    if (bot) strip(c, th, x, y + h - bot, w, bot, true);
    if (bot > 15) strip(c, th, x, y + h - 15, w, 15, true);
    let rx = x + w - 6;
    hint(x, y, w, h, dTitle || "Display", dText || "Shows the stereo image and level change, measured from the left and right channels at the input and the output.");
    readouts.slice().reverse().forEach(r => {
      const r0 = rx;
      txt(c, rx, y + 14, r[1], { color: r[2], align: "right" }); rx -= r[1].length * 5.6 + 6;
      txt(c, rx, y + 14, r[0], { color: th.dispText, align: "right" }); rx -= r[0].length * 5.6 + 12;
      hint(rx + 8, y + 3, r0 - rx, 15, r[3] || r[0], r[4] || "");
    });
    return { x, y, w, h, px: x + 6, py: y + 26, pw: w - 12, ph: h - 32 - bot, lx: x + 146, ly: y + 14 };
  }
  const clipTo = (c, x, y, w, h) => { c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); };
  const lvl = d => Math.max(0, Math.min(1, 1 + d / 48));
  const sgn = (v, p = 1) => (v >= 0 ? "+" : "") + v.toFixed(p);

  // horizontal bar from -1..+1 with centre marker and a pointer
  function hBar(c, th, x, y, w, v, label, color, title, info) {
    if (info) hint(x, y - 12, w, 34, title, info);
    c.fillStyle = th.meterBg; c.fillRect(x, y, w, 8);
    c.fillStyle = th.scale; c.fillRect(x + w / 2, y - 2, 1, 12);
    const px = x + w / 2 + v * w / 2;
    c.fillStyle = color; c.fillRect(Math.min(px, x + w / 2), y + 2, Math.abs(px - x - w / 2), 4);
    c.fillStyle = th.dispText; c.fillRect(px - 1, y - 1, 2, 10);
    txt(c, x, y - 4, label, { color: th.dispText, size: 8.5, align: "left" });
  }

  // ---------- A: vectorscope + correlation
  function drawA(c, th, st, ps, vals) {
    const W = 560, dw = dials(c, th, ps, vals, W);
    gs(c, th, W, st);
    const P = panel(c, th, W - dw - 8, [["Corr", sgn(st.corrO || 0, 2), (st.corrO || 0) < 0 ? th.orange : th.cyan, "Phase Correlation", "How alike left and right are, from -1 to +1. +1 is the same signal (mono), 0 is wide, below 0 means the channels cancel. Measured from the output."]],
      "Vectorscope", "Shows the stereo picture. Each dot is one sample: left-right moves it sideways, loudness moves it up and down. Measured from the left and right channels.", 15);
    legend(c, th, P.x + 6, P.y + P.h - 4, [[th.scale, "In", "The stereo picture of the input signal."], [th.cyan, "Out", "The stereo picture of the output signal."]], { line: true });
    if (!st.oL) return;
    const sz = P.ph, cx = P.px + sz / 2, cy = P.py + sz / 2, R = sz / 2 - 2;
    c.strokeStyle = th.dline; c.lineWidth = 1;
    c.beginPath(); c.moveTo(cx - R, cy); c.lineTo(cx + R, cy); c.moveTo(cx, cy - R); c.lineTo(cx, cy + R);
    c.moveTo(cx - R * 0.7, cy - R * 0.7); c.lineTo(cx + R * 0.7, cy + R * 0.7); c.moveTo(cx + R * 0.7, cy - R * 0.7); c.lineTo(cx - R * 0.7, cy + R * 0.7); c.stroke();
    txt(c, cx - R * 0.7 - 2, cy - R * 0.7 + 2, "L", { color: th.scale, size: 8.5, align: "right" });
    txt(c, cx + R * 0.7 + 2, cy - R * 0.7 + 2, "R", { color: th.scale, size: 8.5, align: "left" });
    txt(c, cx, cy - R + 8, "M", { color: th.scale, size: 8.5 });
    clipTo(c, cx - R, cy - R, 2 * R, 2 * R);
    const dot = (L, Rr, col, a) => { c.globalAlpha = a; c.fillStyle = col;
      for (let n = 0; n < L.length; n++) { const m = (L[n] + Rr[n]) * 0.5, s = (L[n] - Rr[n]) * 0.5; c.fillRect(cx + s * R * 1.3 - 0.75, cy - m * R * 1.3 - 0.75, 1.5, 1.5); } c.globalAlpha = 1; };
    // fixed scale (RUBRIC 2.6): same fixed scale for input and output, never computed from the signal
    const trail = (L, Rr, col, lw, al) => { c.globalAlpha = al; c.strokeStyle = col; c.lineWidth = lw; c.lineJoin = "round"; c.beginPath();
      for (let n = 0; n < L.length; n++) { const m = (L[n] + Rr[n]) * 0.5, sd = (L[n] - Rr[n]) * 0.5, X = cx + sd * R * 5, Y = cy - m * R * 1.5; n ? c.lineTo(X, Y) : c.moveTo(X, Y); }
      c.stroke(); c.globalAlpha = 1; };
    trail(st.iL, st.iR, th.scale, 1, 0.7); trail(st.oL, st.oR, th.cyan, 1.5, 1);
    c.restore();
    hint(cx - R, cy - R, 2 * R, 2 * R, "Vectorscope Plot", "A tall, thin trace means mono. A wide, round cloud means wide stereo. A trace along the L or R line means one channel only. Measured from the left and right samples.");
    // bars on the right of the scope
    const x0 = P.px + sz + 14, w0 = P.x + P.w - x0 - 8;
    hBar(c, th, x0, P.py + 14, w0, st.corrO, "Phase correlation (out)", st.corrO < 0 ? th.orange : th.cyan, "Phase Correlation Out", "How alike left and right of the output are. Right of centre is good, left of centre means the channels cancel in mono. Orange means a problem.");
    ["-1", "0", "+1"].forEach((t, i) => txt(c, x0 + i * w0 / 2, P.py + 33, t, { color: th.scale, size: 8, align: i ? (i === 2 ? "right" : "center") : "left" }));
    hBar(c, th, x0, P.py + 52, w0, st.corrI, "Phase correlation (in)", th.scale, "Phase Correlation In", "The same measure for the input, in grey, so you can compare it with the output.");
    const bal = Math.max(-1, Math.min(1, (st.pk[3] - st.pk[2]) / 12));
    hBar(c, th, x0, P.py + 90, w0, bal, "Balance L ... R (out)", th.cyan, "Balance Out", "Which side is louder in the output. Measured from the peak levels of the left and right output channels.");
    ["L", "R"].forEach((t, i) => txt(c, i ? x0 + w0 : x0, P.py + 109, t, { color: th.scale, size: 8, align: i ? "right" : "left" }));
  }

  // ---------- B: mid / side
  function drawB(c, th, st, ps, vals) {
    const W = 600, dw = dials(c, th, ps, vals, W);
    gs(c, th, W, st);
    const wd = st.sO !== undefined && st.mO > -90 ? Math.max(0, Math.min(2, Math.pow(10, (st.sO - st.mO) / 20) * 1)) : 0;
    const P0 = panel(c, th, W - dw - 8, [["Width", `${Math.round(Math.min(wd, 1.99) * 100)} %`, th.cyan, "Stereo Width", "Side level compared with mid level of the output. 0 % is mono, 100 % is as wide as a normal mix."], ["Gain", `${sgn(st.gainD || 0)} dB`, th.orange, "Gain Change", "How much louder (+) or quieter (-) the output is than the input, in dB."]],
      "Mid / Side", "Mid is what both channels share (the centre). Side is what differs between them (the width). Measured from the input and the output.", 15);
    const P = P0;
    legend(c, th, P0.x + 6, P0.y + P0.h - 4, [[th.cyan, "Mid out", "Mid of the output: the centre part, shared by left and right."], [th.orange, "Side out", "Side of the output: the part that differs between left and right."], [th.scale, "Input", "Mid and side of the input, drawn as grey lines and meters."]], { line: true });
    if (!st.uh) return;
    const mw = 112, hx = P.px + mw + 12, hw = P.pw - mw - 12;
    // meters: mid and side, in and out
    const items = [["M in", st.mI, th.dim, "Mid Input Meter", "Level of the centre part of the input, in dBFS."], ["M out", st.mO, th.cyan, "Mid Output Meter", "Level of the centre part of the output, in dBFS."], ["S in", st.sI, th.dim, "Side Input Meter", "Level of the width part of the input, in dBFS."], ["S out", st.sO, th.orange, "Side Output Meter", "Level of the width part of the output, in dBFS."]];
    const mh = P.ph - 22;
    items.forEach(([n, v, col, ht, hx_], i) => {
      const x = P.px + i * 28 + (i > 1 ? 4 : 0);
      hint(x - 3, P.py, 20, mh + 22, ht, hx_);
      meterV(c, th, x, P.py, 14, mh, lvl(v), false, col === th.dim ? th.scale : col);
      txt(c, x + 7, P.py + mh + 9, n, { color: th.dispText, size: 8 });
      txt(c, x + 7, P.py + mh + 19, Math.max(-60, v).toFixed(0), { color: col === th.dim ? th.dispText : col, size: 8 });
    });
    // scrolling history, mid in cyan and side in orange (output), input in grey
    const hy = P.py, hh = P.ph;
    c.fillStyle = th.dline;
    [0.25, 0.5, 0.75].forEach(f => c.fillRect(hx, hy + hh * f, hw, 1));
    clipTo(c, hx, hy, hw, hh);
    const n = Math.min(st.uh.length, Math.floor(hw));
    const line = (key, col, wdt) => { c.strokeStyle = col; c.lineWidth = wdt; c.beginPath();
      for (let i = 0; i < n; i++) { const e = st.uh[st.uh.length - 1 - i], x = hx + hw - i, y = hy + hh * (1 - lvl(e[key]));
        i ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke(); };
    line("mI", th.scale, 1); line("sI", th.scale, 1); line("mO", th.cyan, 1.5); line("sO", th.orange, 1.5);
    c.restore();
    hint(hx, hy, hw, hh, "Mid And Side History", "Mid and side level over time, newest on the right. Higher is louder. Measured from the input and the output.");
  }

  // ---------- C: in / out comparison with gain change
  function drawC(c, th, st, ps, vals) {
    const W = 580, dw = dials(c, th, ps, vals, W);
    gs(c, th, W, st);
    const P0 = panel(c, th, W - dw - 8, [["Gain", `${sgn(st.gainD || 0)} dB`, th.orange, "Gain Change", "How much louder (+) or quieter (-) the output is than the input, in dB. Measured from the input and output levels."]],
      "In / Out Compare", "Compares the input level and the output level over time, with the gain change between them.", 30);
    const P = P0;
    const hx = P.px, hw = P.pw, hy = P.py + 2, hh = P.ph - 4;
    legend(c, th, P0.x + 6, P0.y + P0.h - 4, [[th.scale, "In level", "The input level over time, drawn as a grey area."], [th.cyan, "Out level", "The output level over time, drawn as a cyan line."], [th.orange, "Gain change", "Output minus input, in dB, around the centre line (range +-6 dB)."]], { line: true });
    hint(hx, hy, hw, hh, "Level History", "Input level (grey area), output level (cyan line) and gain change (orange line) over time, newest on the right. Measured from the peak levels at the input and output.");
    clipTo(c, hx, hy, hw, hh);
    const n = Math.min(st.uh.length, Math.floor(hw));
    c.fillStyle = th.dline;
    [0.25, 0.75].forEach(f => c.fillRect(hx, hy + hh * f, hw, 1));
    // input level filled grey, output level cyan line
    c.fillStyle = S.theme === "light" ? "#6a6a6a" : "#4a4a4a"; c.beginPath(); c.moveTo(hx + hw, hy + hh);
    for (let i = 0; i < n; i++) c.lineTo(hx + hw - i, hy + hh * (1 - lvl(st.uh[st.uh.length - 1 - i].i)));
    c.lineTo(hx + hw - n, hy + hh); c.fill();
    c.strokeStyle = th.cyan; c.lineWidth = 1.5; c.beginPath();
    for (let i = 0; i < n; i++) { const y = hy + hh * (1 - lvl(st.uh[st.uh.length - 1 - i].o)); i ? c.lineTo(hx + hw - i, y) : c.moveTo(hx + hw - i, y); }
    c.stroke();
    // gain change trace around a zero line (+-6 dB)
    c.fillStyle = th.scale; c.fillRect(hx, hy + hh * 0.5, hw, 1);
    c.strokeStyle = th.orange; c.lineWidth = 2; c.beginPath();
    for (let i = 0; i < n; i++) { const g = Math.max(-6, Math.min(6, st.uh[st.uh.length - 1 - i].g)), y = hy + hh * 0.5 - g / 6 * hh * 0.45;
      i ? c.lineTo(hx + hw - i, y) : c.moveTo(hx + hw - i, y); }
    c.stroke();
    c.restore();
    // DC offset readout
    const dy = P.y + P.h - 20;
    hint(hx, dy - 9, 110, 12, "DC Offset", "A steady shift of the output away from zero, in thousandths of full scale. It should be close to 0. Measured from the output.");
    hint(hx + hw - 78, dy - 9, 78, 12, "Phase", "Normal means the output wave points the same way as the input. Inverted means it is flipped. Measured by comparing input and output.");
    hint(hx + 112, dy - 9, hw - 112 - 84, 12, "DC Offset Bar", "Shows the DC offset on a bar. The marker sits in the middle when there is no offset.");
    txt(c, hx, dy, "DC offset", { color: th.dispText, size: 8.5, align: "left" });
    txt(c, hx + 46, dy, `${sgn(st.dc * 1000, 2)} mFS`, { color: th.cyan, size: 8.5, align: "left" });
    const dcx = hx + 112, dcw = hw - 112 - 84;
    const pv = st.pol < 0 ? "inverted" : "normal";
    txt(c, hx + hw, dy, pv, { color: st.pol < 0 ? th.orange : th.cyan, size: 8.5, align: "right" });
    txt(c, hx + hw - pv.length * 4.8 - 6, dy, "Phase", { color: th.dispText, size: 8.5, align: "right" });
    c.fillStyle = th.meterBg; c.fillRect(dcx, dy - 7, dcw, 6);
    c.fillStyle = th.scale; c.fillRect(dcx + dcw / 2, dy - 9, 1, 10);
    c.fillStyle = th.orange; c.fillRect(dcx + dcw / 2 + Math.max(-1, Math.min(1, st.dc * 20)) * dcw / 2 - 1, dy - 8, 3, 8);
  }

  // Before the first measurement arrives (real audio still loading) the state is empty: start it with silence.
  const SILENT = { inPkDb: [-120, -120], outPkDb: [-120, -120], inRmsDb: -120, outRmsDb: -120, gainDb: 0, corr: 0 };
  const wrap = f => (c, th, st, ps, vals) => { if (!st.uz && !st.lv) live(st, SILENT, 0); return f(c, th, st, ps, vals); };

  DESIGNS["Utility"] = {
    effect: "EveryTrim",
    refs: [["UtilityL12.png", "Utility"], ["ChannelEQL12.png", "Channel EQ (meters)"], ["LimiterL12.png", "Limiter (meters)"]],
    lead: "Visual cue: stereo image and level change, measured live from the left and right channels at the input and the output.",
    options: [
      { id: "A", name: "Vectorscope", short: "Scope", width: 628, step, live,
        why: "Round stereo scope with a phase-correlation bar and balance bar, in the spirit of Utility's width and phase display.",
        bullets: ["Vectorscope of left/right samples: grey = in, cyan = out", "Correlation and balance bars, four peak meters", "Driven by the L/R audio at input and output",
          "Live: scope = inScopeL/R (grey) and scopeL/R (cyan), 64 samples; Corr out = m.corr; Corr in from ms mid/side power (not directly measured); balance from the four peaks; polarity from in/out scope product"],
        draw: wrap(drawA) },
      { id: "B", name: "Mid / Side", short: "Mid/Side", width: 668, step, live,
        why: "Mid and side level meters plus a scrolling trace, like the mid/side view of Channel EQ.",
        bullets: ["Mid and side meters, input vs output", "Scrolling history of mid (cyan) and side (orange)", "Width and gain change are computed from the audio in and out",
          "Live: meters and trace = m.ms (in mid, in side, out mid, out side); Width % = out side / out mid (S/M ratio, 0 in silence); Gain = m.gainDb"],
        draw: wrap(drawB) },
      { id: "C", name: "In / Out compare", short: "Compare", width: 648, step, live,
        why: "Input and output level history with a trace of the gain change between them, plus DC offset and phase, like Limiter.",
        bullets: ["Input level (grey) and output level (cyan) history", "Level history and gain-change trace (out minus in)", "Readouts: DC offset and phase (normal / inverted)",
          "Live: in/out = held peaks of the two channels, gain = m.gainDb, DC = m.dcOut, phase = sign of in/out scope product"],
        draw: wrap(drawC) },
    ],
  };
})();
