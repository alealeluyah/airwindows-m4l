// XYZ Filters: design options. Helpers inside the IIFE are private to this file.
(function () {
const NB = 48, fq = x => 20 * Math.pow(1000, x), xf = f => Math.log(f / 20) / Math.log(1000);
const bump = (x, c, w) => { const d = (x - c) / w; return Math.exp(-d * d); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function Z(st) {
  if (!st.Z) { const f = v => Array(NB).fill(v);
    st.Z = { inS: f(-90), outS: f(-90), R: f(0), meas: f(0), peak: f(-90), cols: [], sIn: [], sOut: [], dl: 0, cent: 1000, n: 0 }; }
  return st.Z;
}
// Stand-in for "the effect": a smooth response built from the dial values only (generic, no parameter meaning).
function respAt(vals, x) {
  const n = vals.length; if (!n) return 0; let r = 0;
  for (let i = 0; i < n; i++) r += ((clamp(vals[i], 0, 1) - 0.5) * 24 + 7 * Math.sin(i * 2.1 + 1)) * bump(x, (i + 0.5) / n, 0.8 / n + 0.05);
  return clamp(r, -18, 18);
}
function mAt(z, x) { const p = clamp(x, 0, 1) * (NB - 1), i = Math.min(NB - 2, Math.floor(p)); return z.meas[i] + (z.meas[i + 1] - z.meas[i]) * (p - i); }
// Per-frame simulation: 48 log-spaced FFT bands of input and output, measured response, levels, scope, sonogram column.
function sim(st, dt) {
  const z = Z(st), d = drums(st.t), vals = st.vals || []; z.n++;
  let pi = 0, po = 0, num = 0;
  for (let b = 0; b < NB; b++) {
    const x = b / (NB - 1);
    const a = (0.004 * (1 - 0.7 * x) + d.kick * 0.9 * bump(x, 0.22, 0.09) + d.sn * 0.6 * bump(x, 0.5, 0.14) + d.hat * 0.45 * bump(x, 0.85, 0.1)) * (1 + 0.15 * noise(b * 7 + z.n));
    const inDb = db(a * 0.4);
    z.R[b] = respAt(vals, x);
    const outDb = inDb + z.R[b];
    z.inS[b] += (inDb - z.inS[b]) * (inDb > z.inS[b] ? 0.7 : 0.12);
    z.outS[b] += (outDb - z.outS[b]) * (outDb > z.outS[b] ? 0.7 : 0.12);
    z.meas[b] += ((outDb - inDb) + 0.5 * noise(b * 3 + z.n) - z.meas[b]) * 0.1;
    z.peak[b] = Math.max(z.outS[b], z.peak[b] - 25 * dt);
    const p = Math.pow(10, outDb / 10); pi += Math.pow(10, inDb / 10); po += p; num += x * p;
  }
  st.inL = Math.max(Math.min(0, 10 * Math.log10(pi + 1e-9) - 6), st.inL - 24 * dt);
  st.outL = Math.max(Math.min(0, 10 * Math.log10(po + 1e-9) - 6), st.outL - 24 * dt);
  z.dl += (10 * Math.log10((po + 1e-9) / (pi + 1e-9)) - z.dl) * 0.05;
  z.cent = fq(num / (po + 1e-12));
  if (z.n % 3 === 0) { z.cols.push(z.outS.slice()); if (z.cols.length > 240) z.cols.shift(); }
  const g1 = Math.pow(10, mAt(z, xf(55)) / 20), g2 = Math.pow(10, mAt(z, xf(220)) / 20), g3 = Math.pow(10, mAt(z, xf(1700)) / 20);
  z.sIn = []; z.sOut = [];
  for (let i = 0; i < 128; i++) {
    const tt = i / 128 * 0.02, n = 0.04 * noise(i + z.n);
    const k = 0.5 * d.kick * Math.sin(6.283 * 55 * tt), s = 0.3 * d.sn * Math.sin(6.283 * 220 * tt + 1), h = 0.15 * d.hat * Math.sin(6.283 * 1700 * tt);
    z.sIn.push(k + s + h + n); z.sOut.push(k * g1 + s * g2 + h * g3 + n);
  }
}
function mavg(arr, k, per) { let s = 0; for (let j = 0; j < per; j++) s += arr[k * per + j]; return s / per; }
function ctl(c, th, ps, vals, area) {
  if (!ps.length) { txt(c, area.x + area.w / 2, area.y + area.h / 2, "No controls", { color: th.dim, size: 10 }); return; }
  const rows = Math.max(1, Math.floor(area.h / 54)), cols = Math.max(Math.min(ps.length, Math.floor(area.w / 52)), Math.ceil(ps.length / rows));
  const nr = Math.ceil(ps.length / cols), cw = Math.min(52, area.w / cols), ch = Math.min(66, area.h / nr);
  ps.forEach((p, i) => {
    const r = Math.floor(i / cols), k = i % cols, inRow = Math.min(cols, ps.length - r * cols);
    knob(c, th, area.x + (area.w - inRow * cw) / 2 + k * cw, area.y + (area.h - nr * ch) / 2 + r * ch, cw, p, vals[p._i]);
  });
}
function tw(c, s) { c.font = `400 9.5px ${FONT}`; return c.measureText(s).width; }
function rd(c, th, x, y, st, cols) {
  const [lc, vc] = cols || [th.dim, th.text];
  const z = Z(st), f = v => Math.max(-60, v).toFixed(1) + " dB";
  const tips = { In: ["Input Level", "Loudness of the sound going into the effect, in dB. Measured from the input signal."],
    Out: ["Output Level", "Loudness of the sound coming out of the effect, in dB. Measured from the output signal."],
    Change: ["Level Change", "How much louder (+) or quieter (-) the whole sound gets, in dB. Measured from the output level against the input level."] };
  let cx = x;
  [["In", f(st.inL)], ["Out", f(st.outL)], ["Change", (z.dl >= 0 ? "+" : "") + z.dl.toFixed(1) + " dB"]].forEach(([l, v]) => {
    const x0 = cx;
    txt(c, cx, y, l, { color: lc, align: "left" }); cx += tw(c, l) + 5;
    txt(c, cx, y, v, { color: vc, align: "left" }); cx += tw(c, v) + 16;
    hint(x0 - 1, y - 10, cx - 14 - x0, 13, tips[l][0], tips[l][1]);
  });
}
const GS = (c, th, st, W) => gainStrip(c, th, W - GAIN_W - 4, st);
function fmtF(f) { return f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 1 : 2) + " kHz" : Math.round(f) + " Hz"; }
const greyFill = () => S.theme === "light" ? "#6a6a6a" : "#505050";

// Row with the effect menu + arrows (+ In/Out/Change readout) on a tile or in a screen strip. x,y = top-left of that row.
function selRow(c, th, x, y, st, withRd, inScreen) {
  menu(c, th, x + 4, y + 4, 130, E); arrows(c, th, x + 138, y + 4);
  if (withRd) rd(c, th, x + 178, y + 15, st, inScreen ? [th.dispText, th.cyan] : null);
}
// Tile with a block of dials.
function dialTile(c, th, ps, vals, x, y, w, h) { tile(c, th, x, y, w, h); ctl(c, th, ps, vals, { x: x + 4, y: y + 4, w: w - 8, h: h - 8 }); }

// Spectrum screen: grey = input spectrum, line = output spectrum, curve = response measured as out/in per band.
// Layout: optional top strip (o.top px, for the caller's menu / readouts), plot, bottom strip (o.bot px, legend).
// Returns the plot rectangle.
function spec(c, th, x, y, w, h, st, o = {}) {
  const z = Z(st), top = o.top || 0, bot = o.bot === undefined ? 15 : o.bot;
  screen(c, th, x, y, w, h);
  if (top) strip(c, th, x, y, w, top);
  const by = y + h - bot;
  if (bot) strip(c, th, x, by, w, bot, true);
  const Y = y + top, H = h - top - bot;
  const px = b => x + 4 + (w - 8) * b / (NB - 1), base = Y + H - 3, py = v => base - (H - 7) * clamp((v + 80) / 80, 0, 1);
  const my = Y + H / 2, RG = o.range || 24, cy = v => my - clamp(v, -RG, RG) / RG * (H / 2 - 4);
  c.save(); c.beginPath(); c.rect(x, Y, w, H); c.clip();
  c.strokeStyle = th.dline; c.lineWidth = 1;
  [100, 1000, 10000].forEach(f => { const gx = x + 4 + (w - 8) * xf(f); c.beginPath(); c.moveTo(gx, Y); c.lineTo(gx, Y + H); c.stroke(); });
  [-RG / 2, RG / 2].forEach(v => { c.beginPath(); c.moveTo(x, cy(v)); c.lineTo(x + w, cy(v)); c.stroke(); });
  c.strokeStyle = th.scale; c.beginPath(); c.moveTo(x, my); c.lineTo(x + w, my); c.stroke();
  if (o.inFill !== false) {
    c.globalAlpha = o.faint ? 0.5 : 1; c.fillStyle = greyFill(); c.beginPath(); c.moveTo(px(0), base);
    for (let b = 0; b < NB; b++) c.lineTo(px(b), py(z.inS[b]));
    c.lineTo(px(NB - 1), base); c.fill(); c.globalAlpha = 1;
  }
  if (o.outLine !== false) {
    c.strokeStyle = o.outColor || th.cyan; c.lineWidth = 1.2; c.beginPath();
    for (let b = 0; b < NB; b++) b ? c.lineTo(px(b), py(z.outS[b])) : c.moveTo(px(b), py(z.outS[b]));
    c.stroke();
  }
  if (o.peak) {
    c.strokeStyle = th.scale; c.lineWidth = 1; c.beginPath();
    for (let b = 0; b < NB; b++) b ? c.lineTo(px(b), py(z.peak[b])) : c.moveTo(px(b), py(z.peak[b]));
    c.stroke();
  }
  if (o.curve !== false) {
    c.strokeStyle = o.curveColor || th.orange; c.lineWidth = o.thick || 2; c.beginPath();
    for (let b = 0; b < NB; b++) b ? c.lineTo(px(b), cy(z.meas[b])) : c.moveTo(px(b), cy(z.meas[b]));
    c.stroke();
  }
  if (o.cent) {
    const mx = x + 4 + (w - 8) * xf(z.cent);
    c.strokeStyle = th.orange; c.lineWidth = 1; c.beginPath(); c.moveTo(mx, Y + 4); c.lineTo(mx, Y + H - 12); c.stroke();
  }
  let dot = null;
  if (o.peakDot) {
    let bi = 0; for (let b = 1; b < NB; b++) if (Math.abs(z.meas[b]) > Math.abs(z.meas[bi])) bi = b;
    dot = { bi, x: px(bi), y: cy(z.meas[bi]) };
    c.beginPath(); c.arc(dot.x, dot.y, 5, 0, Math.PI * 2); c.fillStyle = th.orange; c.fill();
    c.strokeStyle = th.display; c.lineWidth = 1.5; c.stroke();
  }
  if (o.labels !== false) {
    [[100, "100"], [1000, "1k"], [10000, "10k"]].forEach(([f, s]) => txt(c, x + 4 + (w - 8) * xf(f) + 3, Y + H - 3, s, { color: th.scale, size: 8.5, align: "left" }));
    txt(c, x + w - 5, my - 3, "0 dB", { color: th.scale, size: 8.5, align: "right" });
  }
  c.restore();
  // readouts of the measurement go in the top strip (RUBRIC 2.3)
  const ty = y + top - 6;
  if (o.cent && top) {
    const v = fmtF(z.cent), vw = tw(c, v);
    txt(c, x + w - 8, ty, v, { color: th.orange, align: "right" });
    txt(c, x + w - 8 - vw - 5, ty, "Centre", { color: th.dispText, align: "right" });
    hint(x + w - 8 - vw - 45, y + 2, vw + 50, top - 4, "Centre Frequency", "The middle of the output sound by frequency (its spectral centre), measured from the output spectrum. The orange marker in the display shows the same place.");
    hint(x + 4 + (w - 8) * xf(z.cent) - 3, Y + 4, 6, H - 16, "Centre Marker", "Marks the centre frequency of the output sound. It moves as the sound changes.");
  }
  if (dot && top) {
    const v = `${fmtF(fq(dot.bi / (NB - 1)))}  ${z.meas[dot.bi] >= 0 ? "+" : ""}${z.meas[dot.bi].toFixed(1)} dB`, vw = tw(c, v);
    txt(c, x + w - 8, ty, v, { color: th.orange, align: "right" });
    txt(c, x + w - 8 - vw - 5, ty, "Peak", { color: th.dispText, align: "right" });
    hint(x + w - 8 - vw - 40, y + 2, vw + 45, top - 4, "Strongest Change", "Frequency and size of the biggest change the filter makes, in dB. The orange dot in the display sits at the same place. Measured from output against input.");
    hint(dot.x - 6, dot.y - 6, 12, 12, "Strongest Change", "The dot sits where the filter changes the level most. The strip above gives its frequency and the change in dB. Measured from output against input.");
  }
  if (o.leg !== false && bot) {
    const L = {
      Input: [greyFill(), "Input", "The sound going into the effect, by frequency. Taller means louder. Measured with an FFT (a frequency analysis) of the input."],
      Output: [o.outColor || th.cyan, "Output", "The sound coming out of the effect, by frequency. Measured with an FFT of the output."],
      Response: [o.curveColor || th.orange, "Response", "What the filter does at each frequency, in dB. Above the middle line is louder, below is quieter. It is the output level minus the input level."],
      Peak: [th.scale, "Peak", "The highest output level at each frequency. It is held for a moment, then falls."],
    };
    const ly = by + bot - 5;
    let lx = x + 8;
    if (o.inFill !== false) lx = legend(c, th, lx, ly, [L.Input]);
    const lines = [];
    if (o.outLine !== false) lines.push(L.Output);
    if (o.peak) lines.push(L.Peak);
    if (o.curve !== false) lines.push(L.Response);
    legend(c, th, lx, ly, lines, { line: true });
  }
  hint(x, Y, w, H, o.title || "Frequency Display", o.info || "Frequency runs left to right, 20 Hz to 20 kHz. The legend in the bottom strip names each colour. The middle line is 0 dB for the Response.");
  return { x, y: Y, w, h: H, by };
}
// Difference bars: out minus in per band (16 bands). Cyan = boost, orange = cut. Title and legend in the top strip.
function diffBars(c, th, x, y, w, h, st, n = 16) {
  const z = Z(st), top = 18;
  screen(c, th, x, y, w, h);
  const ty = strip(c, th, x, y, w, top);
  const Y = y + top, H = h - top, my = Y + H / 2, bw = (w - 8) / n;
  c.fillStyle = th.dline; c.fillRect(x + 4, my, w - 8, 1);
  for (let k = 0; k < n; k++) {
    const v = clamp(mavg(z.meas, k, NB / n), -18, 18), hh = Math.abs(v) / 18 * (H / 2 - 4);
    c.fillStyle = v >= 0 ? th.cyan : th.orange;
    c.fillRect(x + 4 + k * bw + 1, v >= 0 ? my - hh : my, Math.max(1, bw - 2), Math.max(0.5, hh));
  }
  txt(c, x + 8, ty, "Change per band", { color: th.dispText, size: 8.5, align: "left" });
  c.font = `400 8.5px ${FONT}`;
  legend(c, th, x + 8 + Math.ceil(c.measureText("Change per band").width) + 12, ty, [
    [th.cyan, "Boost", "Bars above the middle line: this band gets louder. Measured as output minus input."],
    [th.orange, "Cut", "Bars below the middle line: this band gets quieter. Measured as output minus input."]]);
  hint(x, Y, w, H, "Change Per Band", "Sixteen bars from low to high frequency. Each bar shows how much the filter raises or lowers that band, in dB. Measured from output against input.");
}
// Bands in vs out: grey = input level, cyan = output level, orange = the part the filter changed. Legend in the bottom strip.
function bandsIO(c, th, x, y, w, h, st, n = 16, top = 0) {
  const z = Z(st), bot = 15;
  screen(c, th, x, y, w, h);
  if (top) strip(c, th, x, y, w, top);
  const by = y + h - bot, ly = strip(c, th, x, by, w, bot, true);
  const Y = y + top, H = h - top - bot;
  const bw = (w - 12) / n, base = Y + H - 12, ph = H - 16;
  const hy = v => ph * clamp((v + 80) / 80, 0, 1);
  c.strokeStyle = th.dline; c.lineWidth = 1;
  [0.25, 0.5, 0.75].forEach(f => { c.beginPath(); c.moveTo(x + 4, base - ph * f); c.lineTo(x + w - 4, base - ph * f); c.stroke(); });
  for (let k = 0; k < n; k++) {
    const i = mavg(z.inS, k, NB / n), o = mavg(z.outS, k, NB / n), bx = x + 6 + k * bw;
    const lo = Math.min(i, o), hi = Math.max(i, o);
    c.fillStyle = th.cyan; c.fillRect(bx + 1, base - hy(lo), bw - 3, hy(lo));
    c.fillStyle = o >= i ? th.green : th.orange; c.fillRect(bx + 1, base - hy(hi), bw - 3, hy(hi) - hy(lo));
    c.fillStyle = th.dispText; c.fillRect(bx + 1, base - hy(i), bw - 3, 1);
    if (k % 3 === 0) txt(c, bx + bw / 2, Y + H - 3, fmtF(fq((k + 0.5) / n)).replace(" kHz", "k").replace(" Hz", ""), { color: th.scale, size: 8.5 });
  }
  const lx = legend(c, th, x + 8, ly, [[th.dispText, "Input", "The thin line marks the input level of each band. Measured with an FFT of the input."]], { line: true });
  legend(c, th, lx, ly, [
    [th.cyan, "Kept", "The part of the level that is the same in input and output."],
    [th.green, "Boost", "Level the filter adds in this band. Output is louder than input."],
    [th.orange, "Cut", "Level the filter removes in this band. Output is quieter than input."]]);
  hint(x, Y, w, H, "Band Meters", "Sixteen level bars from low to high frequency. The bar height is the output level; the thin line is the input level. Measured with an FFT of input and output.");
}
// Scrolling sonogram of the output spectrum; low frequencies at the bottom. Legend and note in the top strip.
function sonogram(c, th, x, y, w, h, st, withRd) {
  const z = Z(st), top = 18, bot = withRd ? 15 : 0;
  screen(c, th, x, y, w, h);
  const ty = strip(c, th, x, y, w, top);
  if (bot) { strip(c, th, x, y + h - bot, w, bot, true); rd(c, th, x + 8, y + h - 5, st, [th.dispText, th.cyan]); }
  const Y = y + top, H = h - top - bot;
  const rows = 24, cw = 2, ncol = Math.floor((w - 28) / cw), ch = (H - 8) / rows, x0 = x + w - 4;
  c.save(); c.beginPath(); c.rect(x, Y, w, H); c.clip();
  for (let i = 0; i < Math.min(ncol, z.cols.length); i++) {
    const col = z.cols[z.cols.length - 1 - i];
    for (let r = 0; r < rows; r++) {
      const lvl = clamp(((col[2 * r] + col[2 * r + 1]) / 2 + 64) / 58, 0, 1);
      if (lvl < 0.12) continue;
      c.globalAlpha = Math.min(1, 0.2 + (lvl - 0.12) * 1.1); c.fillStyle = lvl > 0.85 ? th.orange : th.cyan;
      c.fillRect(x0 - (i + 1) * cw, Y + H - 4 - (r + 1) * ch, cw, ch);
    }
  }
  c.globalAlpha = 1; c.restore();
  [[100, "100"], [1000, "1k"], [10000, "10k"]].forEach(([f, s]) => txt(c, x + 5, Y + H - 4 - (H - 8) * xf(f) - 2, s, { color: th.scale, size: 8.5, align: "left" }));
  txt(c, x + w - 8, ty, "Output spectrum, newest on the right", { color: th.dispText, size: 8.5, align: "right" });
  legend(c, th, x + 8, ty, [
    [th.cyan, "Loud", "Cyan marks sound at that frequency and time. The brighter, the louder."],
    [th.orange, "Very loud", "Orange marks the loudest parts of the output."]]);
  hint(x, Y, w, H, "Sonogram", "Time runs left to right, newest on the right. Low frequencies are at the bottom, high at the top. Measured with an FFT of the output.");
}
// Scope screen: top strip (o.top, caller draws the menu there) with the zoom readout, legend + time window in the bottom strip.
// Input and output share one auto zoom (RUBRIC 2.6).
function scope(c, th, x, y, w, h, st, o = {}) {
  const z = Z(st), top = o.top || 18, bot = 15;
  screen(c, th, x, y, w, h);
  strip(c, th, x, y, w, top);
  const by = y + h - bot, ly = strip(c, th, x, by, w, bot, true);
  const Y = y + top, H = h - top - bot, my = Y + H / 2, a = H / 2 - 3;
  c.strokeStyle = th.dline; c.lineWidth = 1;
  [-0.45, 0, 0.45].forEach(f => { c.beginPath(); c.moveTo(x + 4, my + f * a * 2); c.lineTo(x + w - 4, my + f * a * 2); c.stroke(); });
  hint(x, Y, w, H, "Scope", "The input and output waveforms drawn on top of each other, over a window of 20 ms. Where they differ, the filter changed the sound. The picture is enlarged when the sound is quiet.");
  legend(c, th, x + 8, ly, [
    [th.scale, "Input", "The waveform going into the effect. Measured from the input signal."],
    [th.cyan, "Output", "The waveform coming out of the effect. Measured from the output signal."]], { line: true });
  txt(c, x + w - 8, ly, "20 ms", { color: th.dispText, size: 8.5, align: "right" });
  hint(x + w - 44, by + 1, 40, 13, "Time Window", "The scope shows 20 milliseconds of sound.");
  if (!z.sIn.length) return;
  let pk = 0; for (const arr of [z.sIn, z.sOut]) for (const v of arr) pk = Math.max(pk, Math.abs(v));
  const g = fit(z, "scope", pk);
  const zt = zoomText(g);
  if (zt) {
    txt(c, x + w - 8, y + top - 6, zt, { color: th.dispText, align: "right", size: 8.5 });
    hint(x + w - 80, y + 2, 76, top - 4, "Zoom", "The waveform is enlarged so the loudest point fills the screen. The number says by how much; quiet signals get a larger zoom. Input and output share one zoom.");
  }
  c.save(); c.beginPath(); c.rect(x, Y, w, H); c.clip();
  for (const [arr, col, lw] of [[z.sIn, th.scale, 1], [z.sOut, th.cyan, 1.5]]) {
    c.strokeStyle = col; c.lineWidth = lw; c.beginPath();
    arr.forEach((v, i) => { const px = x + 4 + (w - 8) * i / (arr.length - 1), py = my - clamp(v * g, -1, 1) * a; i ? c.lineTo(px, py) : c.moveTo(px, py); });
    c.stroke();
  }
  c.restore();
}
function wrapStep(st, dt) { sim(st, dt); }
// Real mode: fill the same Z state that sim() fills, from the measured frame m (never from drums or dial values).
function liveZ(st, m, dt) {
  const z = Z(st), fin = v => (Number.isFinite(v) ? v : -120);
  const sI = m.specIn || [], sO = m.specOut || [], pw = v => Math.pow(10, v / 10);
  z.n++;
  let num = 0, den = 0;
  for (let b = 0; b < NB; b++) {
    const i = b < sI.length ? clamp(fin(sI[b]), -120, 0) : -120, o = b < sO.length ? clamp(fin(sO[b]), -120, 0) : -120;
    z.inS[b] += (i - z.inS[b]) * (i > z.inS[b] ? 0.7 : 0.25);
    z.outS[b] += (o - z.outS[b]) * (o > z.outS[b] ? 0.7 : 0.25);
    // response = out - in per band; hold the previous value where the input has no energy
    if (i > -72) z.meas[b] += (clamp(o - i, -24, 24) - z.meas[b]) * 0.25;
    z.peak[b] = Math.max(z.outS[b], z.peak[b] - 25 * dt);
    const p = pw(o); den += p; num += (b / (NB - 1)) * p;
  }
  if (den > 1e-11) z.cent += (fq(num / den) - z.cent) * 0.3;     // spectral centroid of the output, Hz
  const g = fin(m.gainDb);
  z.dl += (clamp(g, -60, 60) - z.dl) * 0.2;
  const pk = Math.max(fin(m.inPkDb ? m.inPkDb[0] : -120), fin(m.inPkDb ? m.inPkDb[1] : -120));
  const po = Math.max(fin(m.outPkDb ? m.outPkDb[0] : -120), fin(m.outPkDb ? m.outPkDb[1] : -120));
  st.inL = Math.max(pk, (Number.isFinite(st.inL) ? st.inL : -60) - 24 * dt);
  st.outL = Math.max(po, (Number.isFinite(st.outL) ? st.outL : -60) - 24 * dt);
  z.cols.push(z.outS.slice()); if (z.cols.length > 240) z.cols.shift();   // one sonogram column per measurement
  const a = m.inScopeL || [], bq = m.scopeL || [], k = Math.min(a.length, bq.length);
  z.sIn = []; z.sOut = [];
  for (let i = 0; i < k; i++) { z.sIn.push(Number.isFinite(a[i]) ? a[i] : 0); z.sOut.push(Number.isFinite(bq[i]) ? bq[i] : 0); }
}

const E = "YBandpass";
DESIGNS["XYZ Filters"] = {
  effect: E,
  refs: [["SpectrumL12.png", "Spectrum"], ["EQEightL12.png", "EQ Eight"], ["DrumBussL12.png", "Drum Buss"]],
  lead: "Visual cue: what the filter does to the sound, shown as input against output by frequency, from an FFT of both signals.",
  options: [
    { id: "A", name: "Spectrum", short: "Spectrum", width: 568, step: wrapStep, live: liveZ,
      why: "One big analyser with the input in grey, the output as a line, peak hold and the measured response, like Live's Spectrum.",
      bullets: ["FFT of input (grey) and output (cyan line), with peak hold of the output", "Orange curve = output minus input per band", "Dials in a block on the right, up to 6"],
      draw(c, th, st, ps, vals) {
        st.vals = vals;
        const y0 = HEAD_H + 4, H = DEVICE_H - 8;
        tile(c, th, 4, y0, 494, 23);
        selRow(c, th, 4, y0, st, true);
        const y1 = y0 + 25, h1 = H - 25;
        spec(c, th, 4, y1, 330, h1, st, { peak: true });
        dialTile(c, th, ps, vals, 336, y1, 162, h1);
        GS(c, th, st, 568);
      } },
    { id: "B", name: "Sonogram", short: "Sonogram", width: 588, step: wrapStep, live: liveZ,
      why: "A scrolling picture of the output spectrum over time, so you see the filter shape the sound, like the Spectrum device's sonogram.",
      bullets: ["Each column = one FFT of the output; low notes at the bottom, bright = loud", "Moves to the left as time goes", "Dials in a column on the left"],
      draw(c, th, st, ps, vals) {
        st.vals = vals;
        const y0 = HEAD_H + 4, H = DEVICE_H - 8;
        tile(c, th, 4, y0, 160, H);
        menu(c, th, 8, y0 + 4, 110, E); arrows(c, th, 122, y0 + 4);
        ctl(c, th, ps, vals, { x: 8, y: y0 + 24, w: 152, h: H - 28 });
        sonogram(c, th, 166, y0, 352, H, st, true);
        GS(c, th, st, 588);
      } },
    { id: "C", name: "Band meters", short: "Bands", width: 548, step: wrapStep, live: liveZ,
      why: "Sixteen level bars by frequency, cyan for output, with the changed part in orange (cut) or green (boost), like a multiband meter in Drum Buss.",
      bullets: ["16 bands from an FFT of input and output; thin line = input level", "Orange = removed by the filter, green = added", "Dials in one row under the meters"],
      draw(c, th, st, ps, vals) {
        st.vals = vals;
        const y0 = HEAD_H + 4, H = DEVICE_H - 8, sh = 101;
        bandsIO(c, th, 4, y0, 474, sh, st, 16, 22);
        selRow(c, th, 4, y0, st, true, true);
        dialTile(c, th, ps, vals, 4, y0 + sh + 2, 474, H - sh - 2);
        GS(c, th, st, 548);
      } },
  ],
};

})();
