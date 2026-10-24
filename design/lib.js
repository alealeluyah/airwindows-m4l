// Shared drawing library for the Airwindows device UIs.
// Loaded by the review page (index.html) and, through the mgraphics adapter, by the
// v8ui display inside each Max for Live device. No DOM access in this file.

const S = { themes: null, reg: [], byCat: {}, decisions: {}, theme: "dark", zoom: 2, mocks: [] };

// Hover hints (Live's Info View). Coordinates are canvas units (header included). S.offX is
// the x offset of the view being drawn when several views share one device.
S.hints = [];
S.offX = 0;
function hint(x, y, w, h, title, text) { S.hints.push({ x: x + S.offX, y, w, h, title, text }); }

const FONT = '"Ableton Sans Small", -apple-system, sans-serif';
const DEVICE_H = 169;   // Live's device body height
const HEAD_H = 18;      // device title bar

// ---------------------------------------------------------------- theme
function tok() {
  const t = S.themes[S.theme];
  const light = S.theme === "light";
  const th = {
    // structure (design/RUBRIC.md): tiles on a lighter background, 2 px gutters between them
    gutter: t.SurfaceHighlight, tile: t.SurfaceBackground, divider: light ? "#8a8a8a" : "#262626",
    body: t.SurfaceHighlight, panel: t.SurfaceBackground,
    text: t.ControlForeground, dim: light ? "#3d3d3d" : "#8a8a8a",
    display: t.RetroDisplayBackground, dline: t.RetroDisplayBackgroundLine,
    orange: t.RetroDisplayForeground, cyan: t.RetroDisplayForeground2, arc: t.RangeDefault,
    track: light ? "#8f8f8f" : "#1e1e1e", needle: light ? "#121212" : "#d9d9d9",
    ctrlBg: t.ControlBackground, frame: light ? "#4f4f4f" : "#111111", on: t.ViewControlOn,
    meterBg: t.MeterBackground, scale: t.RetroDisplayScaleText.slice(0, 7), title: t.RetroDisplayTitle,
    dispText: light ? "#cfcfcf" : "#b5b5b5",
    green: "#1ec15a", greenDim: "#0f6b33",
  };
  // in the device: the user's own Live theme (live.colors), when it reported
  if (S.live) for (const k in S.live) th[k] = S.live[k];
  return th;
}

// ---------------------------------------------------------------- structure (design/RUBRIC.md)
// A tile holds one group of things (rule 1). Flat, radius 1, no border.
function tile(c, th, x, y, w, h) { rr(c, x, y, w, h, 1, th.tile); }
// A screen shows measurements (rule 2). It is a tile of its own.
function screen(c, th, x, y, w, h) { rr(c, x, y, w, h, 2, th.display); }
// A strip at the top (or bottom) edge of a screen for readouts, legend and small buttons,
// split from the plot by a 1 px line (rule 2.3). Returns the y of the text baseline.
function strip(c, th, x, y, w, h = 18, bottom = false) {
  c.fillStyle = th.dline;
  c.fillRect(x + 3, bottom ? y : y + h - 1, w - 6, 1);
  return bottom ? y + h - 5 : y + h - 6;
}
// A 1 px line between two groups in one tile (rule 4.4).
function divider(c, th, x, y, h, horizontal = false, w = 0) {
  c.fillStyle = th.divider;
  if (horizontal) c.fillRect(x, y, w, 1); else c.fillRect(x, y, 1, h);
}

// ---------------------------------------------------------------- signal simulation
// A drum loop at 120 bpm: kick on beats, snare on 2 and 4, hats on eighths.
function drums(t) {
  const beat = 0.5, ph = t % (beat * 4);
  const kick = Math.exp(-((ph % beat)) * 9);
  const sn = [beat, beat * 3].map(s => (ph >= s ? Math.exp(-(ph - s) * 14) : 0)).reduce((a, b) => a + b);
  const hat = Math.exp(-((ph % (beat / 2))) * 40) * 0.35;
  return { kick, sn, hat, env: Math.min(1, kick * 0.9 + sn * 0.7 + hat) };
}
const db = a => 20 * Math.log10(Math.max(a, 1e-5));
function noise(i) { const x = Math.sin(i * 12.9898) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; }

// ---------------------------------------------------------------- drawing helpers
function rr(c, x, y, w, h, r, fill, stroke) {
  c.beginPath(); c.roundRect(x, y, w, h, r);
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1; c.stroke(); }
}
function txt(c, x, y, s, o = {}) {
  c.font = `${o.bold ? 700 : 400} ${o.size || 9.5}px ${FONT}`;
  c.fillStyle = o.color; c.textAlign = o.align || "center"; c.textBaseline = o.base || "alphabetic";
  c.fillText(s, x, y);
}
function fmt(display) {
  const m = String(display).match(/^(-?\d+\.\d+)(.*)/);
  return m ? parseFloat(m[1]).toFixed(2) + m[2] : display;
}
function shortName(n) { return n.length > 9 ? n.slice(0, 8) + "." : n; }

// Live-style dial: label above, 270° arc, needle, value below. Cell is w x 50.
function knob(c, th, x, y, w, p, v, big = false) {
  const r = big ? 15 : 11, cx = x + w / 2, cy = y + (big ? 30 : 25);
  hint(x, y, w, big ? 58 : 50, p.name, p.info || `A control of ${S.effName || "this effect"}. ${S.effWhat || ""}`.trim());
  txt(c, cx, y + 9, shortName(p.name), { color: th.text });
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, av = a0 + (a1 - a0) * v;
  c.lineCap = "butt";
  c.beginPath(); c.arc(cx, cy, r, a0, a1); c.strokeStyle = th.track; c.lineWidth = big ? 3 : 2.5; c.stroke();
  c.beginPath(); c.arc(cx, cy, r, a0, av); c.strokeStyle = th.arc; c.lineWidth = big ? 3.5 : 3; c.stroke();
  c.beginPath(); c.moveTo(cx + Math.cos(av) * r * 0.25, cy + Math.sin(av) * r * 0.25);
  c.lineTo(cx + Math.cos(av) * (r - 1), cy + Math.sin(av) * (r - 1));
  c.strokeStyle = th.needle; c.lineWidth = 2; c.lineCap = "round"; c.stroke(); c.lineCap = "butt";
  txt(c, cx, cy + r + (big ? 13 : 12), fmt(p.display), { color: th.text });
}
function menu(c, th, x, y, w, label) {
  label = S.effName || label;   // always show the effect being previewed
  hint(x, y, w, 15, "Effect", `Chooses which Airwindows effect this device runs. Now: ${label}. ${S.effWhat || ""}`.trim());
  rr(c, x + 0.5, y + 0.5, w, 14, 1, th.ctrlBg, th.frame);
  txt(c, x + 4, y + 11, label, { color: th.text, align: "left" });
  c.fillStyle = th.text; c.beginPath(); c.moveTo(x + w - 10, y + 5); c.lineTo(x + w - 3, y + 5); c.lineTo(x + w - 6.5, y + 10); c.fill();
}
function arrows(c, th, x, y) {
  hint(x, y, 30, 15, "Previous / Next Effect", "Steps to the previous or next effect in the menu.");
  for (const [i, d] of [[0, -1], [1, 1]]) {
    const bx = x + i * 15;
    rr(c, bx + 0.5, y + 0.5, 14, 14, 1, th.ctrlBg, th.frame);
    c.fillStyle = th.text; c.beginPath();
    c.moveTo(bx + 7 - 2.5 * d, y + 4); c.lineTo(bx + 7 + 2.5 * d, y + 7.5); c.lineTo(bx + 7 - 2.5 * d, y + 11); c.fill();
  }
}
function toggle(c, th, x, y, w, label, on) {
  rr(c, x + 0.5, y + 0.5, w, 14, 1, on ? th.on : th.ctrlBg, th.frame);
  txt(c, x + w / 2, y + 11, label, { color: on ? "#121212" : th.text });
}
function header(c, th, w, title) {
  c.fillStyle = th.body; c.fillRect(0, 0, w, HEAD_H + DEVICE_H);
  c.beginPath(); c.arc(10, 9, 5.5, 0, Math.PI * 2); c.fillStyle = th.on; c.fill();
  c.strokeStyle = th.frame; c.lineWidth = 1; c.stroke();
  txt(c, 21, 13, title, { bold: true, size: 11, color: th.text, align: "left" });
  c.strokeStyle = S.theme === "light" ? "#a5a5a5" : "#2a2a2a"; c.beginPath(); c.moveTo(0, HEAD_H - 0.5); c.lineTo(w, HEAD_H - 0.5); c.stroke();
}
// vertical meter: value 0..1 lit from the bottom (green), or from the top for gain reduction (orange)
function meterV(c, th, x, y, w, h, v, fromTop = false, color) {
  c.fillStyle = th.meterBg; c.fillRect(x, y, w, h);
  const lit = Math.max(0, Math.min(1, v)) * h;
  c.fillStyle = color || th.green;
  if (fromTop) c.fillRect(x, y, w, lit); else c.fillRect(x, y + h - lit, w, lit);
}
// Knob grid: place params left-to-right, top-to-bottom inside an area.
function knobGrid(c, th, params, area, cols, vals, cellW = 52) {
  // too many controls for the height: add columns and narrow the cells
  const fitRows = Math.max(1, Math.floor(area.h / 48));
  if (Math.ceil(params.length / cols) > fitRows) {
    cols = Math.ceil(params.length / fitRows);
    cellW = Math.min(cellW, area.w / cols);
  }
  const rows = Math.ceil(params.length / cols) || 1;
  const cellH = Math.min(52, area.h / rows);
  params.forEach((p, i) => {
    const r = Math.floor(i / cols), k = i % cols;
    const inRow = Math.min(cols, params.length - r * cols);
    const x = area.x + (area.w - inRow * cellW) / 2 + k * cellW;
    const y = area.y + (area.h - rows * cellH) / 2 + r * cellH;
    knob(c, th, x, y, cellW, p, vals[p._i]);
  });
}

// ---------------------------------------------------------------- shared state per mock
function newState() { return { t: 0, hist: [], gr: 0, inL: -60, outL: -60, peakIn: -60, peakOut: -60, tail: 0, decayHist: [] }; }
function stepDynamics(st, dt) {
  const d = drums(st.t);
  const inDb = db(d.env * 0.9 + 0.02);
  const thr = -14, ratio = 4;
  const target = Math.max(0, inDb - thr) * (1 - 1 / ratio);
  st.gr += (target - st.gr) * (target > st.gr ? 0.6 : 0.08);          // attack / release
  st.inL = Math.max(inDb, st.inL - 24 * dt); st.outL = Math.max(inDb - st.gr + 3, st.outL - 24 * dt);
  st.hist.push({ inA: d.env, out: st.outL, gr: st.gr });
  st.hist.simThr = true;
  if (st.hist.length > 600) st.hist.shift();
}
function stepReverb(st, dt) {
  const d = drums(st.t);
  st.tail = st.tail * Math.exp(-dt / 0.55) + (d.kick > 0.95 || d.sn > 0.95 ? 0.6 : 0) + d.env * 0.02;
  const n = st.hist.length;
  const wet = Math.min(1, st.tail) * (0.55 + 0.45 * Math.abs(noise(n * 0.37)));
  st.hist.push({ dry: d.env, wet });
  if (st.hist.length > 800) st.hist.shift();
  st.inL = Math.max(db(d.env * 0.8 + 0.01), st.inL - 24 * dt); st.outL = Math.max(db(Math.min(1, st.tail) * 0.8 + 0.01), st.outL - 24 * dt);
}

// ---------------------------------------------------------------- real measurements
// One display frame from airwin~ (about 30 per second), the same in the device and in the
// review page's "Real audio" mode (frames recorded with `awtool frames`):
//   m.inPkDb[2], m.outPkDb[2]   peak level per channel, dBFS (-120 = silence)
//   m.inRmsDb, m.outRmsDb       RMS of the mono sum, dBFS
//   m.gainDb                    outRms - inRms (0 when the input is silent)
//   m.corr                      output L/R correlation, -1..1
//   m.inPk, m.outPk             linear mono peaks of the frame
//   m.specIn[48], m.specOut[48] band levels, dBFS, 20 Hz .. 20 kHz, log-spaced (bandHz(i) = centre)
//   m.xfer[32]                  mean output per input-amplitude bin (-1..1 in 32 bins); -9 = no data
//   m.scopeL[64], m.scopeR[64]  recent output samples (about 5 ms)
//   m.inScopeL[64], m.inScopeR[64] the same input samples
//   m.ms[4]                     RMS dBFS of input mid, input side, output mid, output side
//   m.specDiff[48]              band levels of (output - input), dBFS: what the effect added/removed
//   m.diffRmsDb, m.dcOut        level of (output - input) in dBFS; output DC offset (linear)
//   m.xcorr[64]                 |cross-correlation| of output vs input for lags 0..2047 samples
//                               (bin b = lags 32b..32b+31, ~0.67 ms per bin at 48 kHz); a pure
//                               delay of d samples peaks in bin d/32 (echo taps, pre-delay)
// A design option may define live(st, m, dt) to fill the state its draw() reads; otherwise
// liveGeneric fills inL / outL / gr / hist.
function measureFromFrame(f) {
  const l = f.levels, s = f.scope || [];
  return { inPkDb: [l[0], l[1]], outPkDb: [l[2], l[3]], inRmsDb: l[4], outRmsDb: l[5], gainDb: l[6], corr: l[7],
           inPk: f.peaks[0], outPk: f.peaks[1], specIn: f.spec_in, specOut: f.spec_out, xfer: f.xfer,
           scopeL: s.slice(0, 64), scopeR: s.slice(64),
           inScopeL: (f.scope_in || []).slice(0, 64), inScopeR: (f.scope_in || []).slice(64),
           ms: f.ms || [-120, -120, -120, -120], specDiff: f.spec_diff || [],
           diffRmsDb: f.diff ? f.diff[0] : -120, dcOut: f.diff ? f.diff[1] : 0, xcorr: f.xcorr || [] };
}
function bandHz(i) { return 20 * Math.pow(1000, (i + 0.5) / 48); }

// Generic mapping for designs without their own live(): level, gain change and history.
function liveGeneric(st, m, dt) {
  const inDb = Math.max(m.inPkDb[0], m.inPkDb[1]), outDb = Math.max(m.outPkDb[0], m.outPkDb[1]);
  st.inL = Math.max(inDb, (st.inL === undefined ? -60 : st.inL) - 24 * dt);
  st.outL = Math.max(outDb, (st.outL === undefined ? -60 : st.outL) - 24 * dt);
  const grNow = Math.max(0, -m.gainDb);
  st.gr = (st.gr || 0) + (grNow - (st.gr || 0)) * (grNow > (st.gr || 0) ? 0.6 : 0.15);
  st.hist = st.hist || [];
  st.hist.push({ inA: m.inPk, out: outDb, gr: st.gr, dry: m.inPk, wet: m.outPk });
  if (st.hist.length > 800) st.hist.shift();
}

// ---------------------------------------------------------------- displays
function grNeedle(c, th, x, y, w, h, gr) {
  rr(c, x, y, w, h, 3, th.display);
  // pivot below the display, as in Glue Compressor: 0 dB at upper-left, 20 dB at right
  const cx = x + w * 0.42, cy = y + h + 14, R = h + 2;
  const ang = g => -Math.PI * 0.83 + (g / 20) * Math.PI * 0.58;
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  [0, 5, 10, 15, 20].forEach(g => {
    const a = ang(g), co = Math.cos(a), si = Math.sin(a);
    c.strokeStyle = th.scale; c.lineWidth = 2;
    c.beginPath(); c.moveTo(cx + co * (R - 12), cy + si * (R - 12)); c.lineTo(cx + co * (R - 5), cy + si * (R - 5)); c.stroke();
    txt(c, cx + co * (R - 21), cy + si * (R - 21) + 3, String(g), { color: th.dispText, size: 10 });
  });
  const a = ang(Math.min(20, gr));
  c.strokeStyle = th.cyan; c.lineWidth = 2;
  c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * (R - 3), cy + Math.sin(a) * (R - 3)); c.stroke();
  c.restore();
  txt(c, x + w - 6, y + 12, "GR dB", { color: th.scale, size: 9, align: "right" });
}
// the simulated compressor has a known threshold (-14 dB); real effects do not report one
function st_thr(hist) { return hist.simThr ? -14 : null; }
function activity(c, th, x, y, w, h, hist) {
  rr(c, x, y, w, h, 3, th.display);
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  const n = Math.min(hist.length, w), base = y + h;
  const toY = dbv => y + 8 + (h - 16) * (-dbv / 40);
  // input waveform (grey, filled from the bottom)
  c.fillStyle = S.theme === "light" ? "#5e5e5e" : "#3a3a3a"; c.beginPath(); c.moveTo(x + w, base);
  for (let i = 0; i < n; i++) { const e = hist[hist.length - 1 - i]; c.lineTo(x + w - i, toY(db(e.inA * 0.9 + 0.02))); }
  c.lineTo(x + w - n, base); c.fill();
  // threshold line
  if (st_thr(hist) !== null) { c.strokeStyle = th.cyan; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x, toY(-14)); c.lineTo(x + w, toY(-14)); c.stroke(); }
  // gain reduction trace (orange, from the top)
  c.strokeStyle = th.orange; c.lineWidth = 1.5; c.beginPath();
  for (let i = 0; i < n; i++) { const e = hist[hist.length - 1 - i]; const yy = y + 6 + e.gr * 3; i ? c.lineTo(x + w - i, yy) : c.moveTo(x + w - i, yy); }
  c.stroke();
  c.restore();
}
function limiterMeters(c, th, x, y, w, h, st) {
  rr(c, x, y, w, h, 3, th.display);
  const scale = [0, 3, 6, 12, 24], top = y + 18, mh = h - 34;
  const toFrac = dbv => 1 - Math.min(1, Math.max(0, -dbv / 24) ** 0.6);
  const toY = dbv => top + mh * (1 - toFrac(dbv));
  txt(c, x + 28, y + 12, "In", { color: th.dispText }); txt(c, x + w - 28, y + 12, "GR", { color: th.dispText });
  const inV = toFrac(st.inL + 4);
  meterV(c, th, x + 12, top, 9, mh, inV); meterV(c, th, x + 23, top, 9, mh, inV * 0.97);
  scale.forEach(s => { const yy = toY(-s); txt(c, x + w / 2, yy + 3, String(s), { color: th.dispText, size: 9 });
    c.fillStyle = th.scale; c.fillRect(x + 38, yy, 5, 1); c.fillRect(x + w - 43, yy, 5, 1); });
  const grF = Math.min(1, st.gr / 12);
  meterV(c, th, x + w - 32, top, 9, mh, grF, true, th.orange); meterV(c, th, x + w - 21, top, 9, mh, grF, true, th.orange);
  txt(c, x + 28, y + h - 5, `${Math.max(-60, st.inL).toFixed(1)}`, { color: th.cyan, size: 9.5 });
  txt(c, x + w - 26, y + h - 5, `-${st.gr.toFixed(1)}`, { color: th.orange, size: 9.5 });
}
// Scrolling waveform, newest on the right, at its true level (`gain` 1 unless given).
function waveScroll(c, th, x, y, w, h, hist, key, color, gain = 1) {
  const n = Math.min(hist.length, w);
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  const mid = y + h / 2, a = h * 0.5 * gain;
  c.fillStyle = color; c.beginPath(); c.moveTo(x + w, mid);
  for (let i = 0; i < n; i++) c.lineTo(x + w - i, mid - Math.min(h / 2, hist[hist.length - 1 - i][key] * a));
  for (let i = n - 1; i >= 0; i--) c.lineTo(x + w - i, mid + Math.min(h / 2, hist[hist.length - 1 - i][key] * a * (0.7 + 0.3 * Math.abs(noise(i)))));
  c.fill(); c.restore();
  return gain;
}
// Decay display. With real measurements (st.envHist: output RMS dB at ~30 Hz, newest last) it
// draws the last 3 s of output level and estimates the decay time as 3 x the time the level
// takes to fall 20 dB after its loudest point; otherwise it draws a simulated tail.
function decayMap(c, th, x, y, w, h, st) {
  screen(c, th, x, y, w, h);
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.strokeStyle = th.dline; c.lineWidth = 1;
  for (let i = 1; i < 4; i++) { const yy = y + 14 + (h - 30) * i / 4; c.beginPath(); c.moveTo(x, yy); c.lineTo(x + w, yy); c.stroke(); }
  c.fillStyle = th.cyan + "44"; c.strokeStyle = th.cyan; c.lineWidth = 1.5; c.beginPath();
  c.moveTo(x + 6, y + h - 14);
  let label;
  if (st.envHist && st.envHist.length > 2) {
    const e = st.envHist, n = e.length, span = 90;
    const fy = d => y + h - 14 - (h - 30) * Math.max(0, Math.min(1, 1 + d / 60));
    for (let i = 0; i < n; i++) c.lineTo(x + 6 + (w - 12) * (i + span - n) / (span - 1), fy(e[i]));
    c.lineTo(x + w - 6, y + h - 14); c.fill(); c.stroke();
    let pk = 0;
    for (let i = 1; i < n; i++) if (e[i] > e[pk]) pk = i;
    let k = pk;
    while (k < n && e[k] > e[pk] - 20) k++;
    label = k < n ? `≈ ${(3 * (k - pk) / 30).toFixed(2)} s` : "> 3 s";
  } else {
    const t60 = 1.9;
    for (let i = 0; i <= w - 12; i++) {
      const tt = (i / (w - 12)) * 3;
      let e = Math.exp(-tt * 6.9 / t60);
      if (tt < 0.08) e *= tt / 0.08;
      const er = tt < 0.12 ? 0.25 * Math.abs(noise(i * 3)) : 0;
      c.lineTo(x + 6 + i, y + h - 14 - (h - 30) * Math.min(1, e + er));
    }
    c.lineTo(x + w - 6, y + h - 14); c.fill(); c.stroke();
    const px = x + 6 + (w - 12) * ((st.t % 1) / 1);
    c.strokeStyle = th.orange; c.beginPath(); c.moveTo(px, y + 14); c.lineTo(px, y + h - 14); c.stroke();
    label = `≈ ${t60.toFixed(2)} s`;
  }
  c.restore();
  txt(c, x + 6, y + 11, "Decay", { color: th.scale, align: "left" });
  txt(c, x + w - 6, y + 11, label, { color: th.orange, align: "right" });
  const ticks = st.envHist ? ["-3 s", "-2 s", "-1 s", "now"] : ["0", "1 s", "2 s", "3 s"];
  ticks.forEach((s, i) => txt(c, x + 6 + (w - 12) * i / 3, y + h - 3, s, { color: th.scale, size: 8.5, align: i ? (i === 3 ? "right" : "center") : "left" }));
}
// A control shown as a draggable number (like Hybrid Reverb's display row). In the device an
// invisible live.dial lies over it, so it drags like a dial and stays automatable.
function readout(c, th, x, y, w, p, v) {
  hint(x, y - 11, w, 28, p.name, p.info || `A control of ${S.effName || "this effect"}. Drag up or down to change it.`);
  txt(c, x + w / 2, y, p.name, { color: th.dispText, size: 10 });
  txt(c, x + w / 2, y + 15, fmt(p.display), { color: th.cyan, size: 11 });
}

// Colour key in one style for every device: small swatches with labels, left to right.
// items: [[colour, label, explanation], ...]. Each item also gets a hover hint. Returns end x.
function legend(c, th, x, y, items, o = {}) {
  const size = o.size || 8.5;
  c.font = `400 ${size}px ${FONT}`;
  let cx = x;
  for (const [col, label, info] of items) {
    const tw = Math.ceil(c.measureText(label).width);
    c.fillStyle = col;
    if (o.line) c.fillRect(cx, y - 4, 8, 2); else c.fillRect(cx, y - 6, 6, 6);
    txt(c, cx + (o.line ? 11 : 9), y, label, { color: o.color || th.dispText, align: "left", size });
    if (info) hint(cx - 1, y - 9, tw + 12, 12, label, info);
    cx += tw + (o.line ? 11 : 9) + (o.gap || 8);
  }
  return cx;
}

// Several options of one category in one device, switched by the View selector at the top of
// the Input/Output column, like the display buttons of Live's Compressor. Each view keeps its
// own state (and history), so switching is instant. Narrower views start at the left.
function composeViews(des, ids) {
  const opts = ids.map(id => des.options.find(o => o.id === id)).filter(Boolean);
  const W = Math.max(...opts.map(o => o.width));
  const labels = opts.map(o => o.short || o.name.split(/[ (—]/)[0]);
  const sub = st => (st.sub = st.sub || opts.map(() => newState()));
  return {
    id: opts.map(o => o.id).join("+"), name: opts.map(o => o.name).join(" / "), width: W, views: labels,
    why: "Views: " + opts.map((o, i) => `${labels[i]} — ${o.why}`).join(" "),
    bullets: ["Click a View button (top of the Input/Output column) to switch the display"].concat(opts.map((o, i) => `${labels[i]}: ${o.bullets[0]}`)),
    step(st, dt) { sub(st).forEach((s, i) => { s.t = st.t; opts[i].step(s, dt); }); },
    live(st, m, dt) { sub(st).forEach((s, i) => { s.t = st.t; (opts[i].live || liveGeneric)(s, m, dt); }); },
    click(x, y, st) {
      for (const [i, r] of (st.viewRects || []).entries())
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) { st.view = i; return; }
      const v = Math.min(st.view || 0, opts.length - 1);
      if (opts[v].click) opts[v].click(x - (st.dx || 0), y, sub(st)[v]);
    },
    draw(c, th, st, ps, vals) {
      const v = Math.min(st.view || 0, opts.length - 1), o = opts[v];
      // a narrower view starts at the left; a plain tile fills the rest up to the Input/Output
      // column, so no bare background shows (RUBRIC 1.1)
      const dx = 0, gap = W - o.width;
      st.dx = dx;
      if (gap > 0) tile(c, th, o.width - GAIN_W - 4, HEAD_H + 4, gap - 2, DEVICE_H - 8);
      c.save(); c.translate(dx, 0);
      S.offX = dx; S.gainX = W - GAIN_W - 4; S.views = { labels, active: v };
      try { o.draw(c, th, sub(st)[v], ps, vals); }
      finally { st.viewRects = S.viewRects; c.restore(); S.offX = 0; S.gainX = undefined; S.views = null; }
    },
  };
}

// Word-wrapped text block (e.g. the effect description) inside width w, at most maxLines.
function wrapText(c, x, y, w, text, o = {}) {
  c.font = `400 ${o.size || 9.5}px ${FONT}`;
  const words = String(text || "").split(/\s+/).filter(Boolean), lines = [];
  let line = "";
  for (const wd of words) {
    const t = line ? line + " " + wd : wd;
    if (c.measureText(t).width > w && line) { lines.push(line); line = wd; } else line = t;
  }
  if (line) lines.push(line);
  lines.slice(0, o.maxLines || 6).forEach((l, i) => txt(c, x, y + i * (o.lh || 12), l, { color: o.color, align: "left", size: o.size }));
}

// Standard Input / Output gain strip, required on every device (user decision 2026-10-23).
// Two dB dials (Input above, Output below) and a stereo In / Out meter pair. Width GAIN_W.
const GAIN_W = 64;
function gainStrip(c, th, x, st) {
  if (S.gainX !== undefined) x = S.gainX - S.offX;    // several views: always at the right edge
  const y = HEAD_H + 4, h = DEVICE_H - 8;
  tile(c, th, x, y, GAIN_W, h);
  let top = y;
  if (S.views) {                                      // view selector at the top of the column
    viewTabsV(c, th, x + 3, y + 3, GAIN_W - 6, S.views.labels, S.views.active);
    top = y + 3 + S.views.labels.length * 15 + 1;
  }
  const dbTxt = v => (v > 0 ? "+" : "") + v.toFixed(1) + " dB";
  const room = y + h - top, kh = Math.min(room / 2, 78);
  knob(c, th, x - 2, top + Math.max(2, (kh - 50) / 2), 44, { name: "Input", display: dbTxt(st.inGain || 0),
    info: "Input gain in dB, applied before the effect. Drives the effect harder or softer; the left meter pair shows the level after it." }, 0.5 + (st.inGain || 0) / 72);
  knob(c, th, x - 2, top + kh + Math.max(0, (kh - 50) / 2), 44, { name: "Output", display: dbTxt(st.outGain || 0),
    info: "Output gain in dB, applied after the effect. The right meter pair shows the level after it." }, 0.5 + (st.outGain || 0) / 72);
  const f = dbv => Math.max(0, 1 + (Number.isFinite(dbv) ? dbv : -60) / 48);
  const mx = x + 44, mt = top + 1, mh = y + h - 4 - mt;
  meterV(c, th, mx, mt, 3, mh, f(st.inL)); meterV(c, th, mx + 4, mt, 3, mh, f(st.inL) * 0.96);
  meterV(c, th, mx + 10, mt, 3, mh, f(st.outL)); meterV(c, th, mx + 14, mt, 3, mh, f(st.outL) * 0.97);
  hint(mx, mt, 18, mh, "In / Out Meters", "Left pair: input level after the Input gain. Right pair: output level after the Output gain. Scale 0 dB (top) to -48 dB.");
}

// Vertical view selector (several views in one device). Rects go to S.viewRects for clicks.
function viewTabsV(c, th, x, y, w, labels, active) {
  S.viewRects = labels.map((l, i) => {
    toggle(c, th, x, y + i * 15, w, l, i === active);
    return { x: x + S.offX, y: y + i * 15, w, h: 14 };
  });
  hint(x, y, w, labels.length * 15, "View", `Chooses what the display shows: ${labels.join(", ")}. The controls and the sound do not change.`);
}

function viewTabs(c, th, x, y, labels, active) {
  let cx = x;
  hint(x, y, labels.length * 60, 15, "View", `Chooses what the display shows: ${labels.join(", ")}.`);
  return labels.map((l, i) => {
    c.font = `400 9.5px ${FONT}`;
    const w = Math.ceil(c.measureText(l).width) + 12;
    toggle(c, th, cx, y, w, l, i === active);
    const r = { x: cx, y, w, h: 14 };
    cx += w + 2;
    return r;
  });
}

function ioMeters(c, th, x, y, h, st) {
  const f = dbv => Math.max(0, 1 + dbv / 48);
  meterV(c, th, x, y, 4, h, f(st.inL)); meterV(c, th, x + 5, y, 4, h, f(st.inL) * 0.96);
  meterV(c, th, x + 13, y, 4, h, f(st.outL)); meterV(c, th, x + 18, y, 4, h, f(st.outL) * 0.97);
  txt(c, x + 4.5, y + h + 10, "In", { color: th.text, size: 8.5 }); txt(c, x + 17.5, y + h + 10, "Out", { color: th.text, size: 8.5 });
}

// ---------------------------------------------------------------- options per category
// Each category registers its options in designs/<Category>.js
const DESIGNS = {};

