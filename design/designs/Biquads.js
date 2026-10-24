// Biquads: design options. Helpers inside the IIFE are private to this file.
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
function rd(c, th, x, y, st) {
  const z = Z(st), f = v => Math.max(-60, v).toFixed(1) + " dB";
  const tips = { In: ["Input Level", "Loudness of the sound going into the effect, in dB. Measured from the input signal."],
    Out: ["Output Level", "Loudness of the sound coming out of the effect, in dB. Measured from the output signal."],
    Change: ["Level Change", "How much louder (+) or quieter (-) the whole sound gets, in dB. Measured from the output level against the input level."] };
  let cx = x;
  [["In", f(st.inL)], ["Out", f(st.outL)], ["Change", (z.dl >= 0 ? "+" : "") + z.dl.toFixed(1) + " dB"]].forEach(([l, v]) => {
    const x0 = cx;
    txt(c, cx, y, l, { color: th.dim, align: "left" }); cx += tw(c, l) + 5;
    txt(c, cx, y, v, { color: th.text, align: "left" }); cx += tw(c, v) + 16;
    hint(x0 - 1, y - 10, cx - 14 - x0, 13, tips[l][0], tips[l][1]);
  });
}
const GS = (c, th, st, W) => gainStrip(c, th, W - GAIN_W - 4, st);
function fmtF(f) { return f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 1 : 2) + " kHz" : Math.round(f) + " Hz"; }
const greyFill = () => S.theme === "light" ? "#6a6a6a" : "#505050";

// Spectrum panel: grey = input spectrum, line = output spectrum, curve = response measured as out/in per band.
function spec(c, th, x, y, w, h, st, o = {}) {
  const z = Z(st); rr(c, x, y, w, h, 3, th.display);
  const px = b => x + 4 + (w - 8) * b / (NB - 1), py = v => y + h - 6 - (h - 12) * clamp((v + 80) / 80, 0, 1);
  const my = y + h / 2, RG = o.range || 24, cy = v => my - clamp(v, -RG, RG) / RG * (h / 2 - 8);
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.strokeStyle = th.dline; c.lineWidth = 1;
  [100, 1000, 10000].forEach(f => { const gx = x + 4 + (w - 8) * xf(f); c.beginPath(); c.moveTo(gx, y); c.lineTo(gx, y + h); c.stroke(); });
  [-RG / 2, RG / 2].forEach(v => { c.beginPath(); c.moveTo(x, cy(v)); c.lineTo(x + w, cy(v)); c.stroke(); });
  c.strokeStyle = th.scale; c.beginPath(); c.moveTo(x, my); c.lineTo(x + w, my); c.stroke();
  if (o.inFill !== false) {
    c.globalAlpha = o.faint ? 0.5 : 1; c.fillStyle = greyFill(); c.beginPath(); c.moveTo(px(0), y + h);
    for (let b = 0; b < NB; b++) c.lineTo(px(b), py(z.inS[b]));
    c.lineTo(px(NB - 1), y + h); c.fill(); c.globalAlpha = 1;
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
    c.strokeStyle = th.orange; c.lineWidth = 1; c.beginPath(); c.moveTo(mx, y + 27); c.lineTo(mx, y + h - 12); c.stroke();
  }
  c.restore();
  if (o.cent) {
    const mx = x + 4 + (w - 8) * xf(z.cent);
    txt(c, clamp(mx, x + 30, x + w - 30), y + 23, fmtF(z.cent), { color: th.orange, size: 9 });
    hint(clamp(mx, x + 30, x + w - 30) - 24, y + 14, 48, 12, "Centre Frequency", "The middle of the output sound by frequency (its spectral centre). Measured from the output spectrum.");
    hint(mx - 3, y + 27, 6, h - 39, "Centre Marker", "Marks the centre frequency of the output sound. It moves as the sound changes.");
  }
  if (o.peakDot) {
    let bi = 0; for (let b = 1; b < NB; b++) if (Math.abs(z.meas[b]) > Math.abs(z.meas[bi])) bi = b;
    const dx = px(bi), dy = cy(z.meas[bi]);
    c.beginPath(); c.arc(dx, dy, 5, 0, Math.PI * 2); c.fillStyle = th.orange; c.fill();
    c.strokeStyle = th.display; c.lineWidth = 1.5; c.stroke();
    txt(c, clamp(dx, x + 46, x + w - 46), clamp(dy < my ? dy - 9 : dy + 15, y + 22, y + h - 14), `${fmtF(fq(bi / (NB - 1)))}  ${z.meas[bi] >= 0 ? "+" : ""}${z.meas[bi].toFixed(1)} dB`, { color: th.dispText, size: 9 });
    hint(dx - 6, dy - 6, 12, 12, "Strongest Change", "The dot sits where the filter changes the level most. The text gives its frequency and the change in dB. Measured from output against input.");
  }
  if (o.labels !== false) {
    [[100, "100"], [1000, "1k"], [10000, "10k"]].forEach(([f, s]) => txt(c, x + 4 + (w - 8) * xf(f) + 3, y + h - 3, s, { color: th.scale, size: 8.5, align: "left" }));
    txt(c, x + w - 5, my - 3, "0 dB", { color: th.scale, size: 8.5, align: "right" });
  }
  if (o.leg !== false) {
    const L = {
      Input: [greyFill(), "Input", "The sound going into the effect, by frequency. Taller means louder. Measured with an FFT (a frequency analysis) of the input."],
      Output: [o.outColor || th.cyan, "Output", "The sound coming out of the effect, by frequency. Measured with an FFT of the output."],
      Response: [o.curveColor || th.orange, "Response", "What the filter does at each frequency, in dB. Above the middle line is louder, below is quieter. It is the output level minus the input level."],
      Peak: [th.scale, "Peak", "The highest output level at each frequency. It is held for a moment, then falls."],
    };
    let lx = x + 6;
    if (o.inFill !== false) lx = legend(c, th, lx, y + 11, [L.Input]);
    const lines = [];
    if (o.outLine !== false) lines.push(L.Output);
    if (o.peak) lines.push(L.Peak);
    if (o.curve !== false) lines.push(L.Response);
    legend(c, th, lx, y + 11, lines, { line: true });
  }
  hint(x, y, w, h, o.title || "Frequency Display", o.info || "Frequency runs left to right, 20 Hz to 20 kHz. The legend in the top left names each colour. The middle line is 0 dB for the Response.");
}
// Difference bars: out minus in per band (16 bands). Cyan = boost, orange = cut.
function diffBars(c, th, x, y, w, h, st, n = 16) {
  const z = Z(st); rr(c, x, y, w, h, 3, th.display);
  const my = y + h / 2, bw = (w - 8) / n;
  c.fillStyle = th.dline; c.fillRect(x + 4, my, w - 8, 1);
  for (let k = 0; k < n; k++) {
    const v = clamp(mavg(z.meas, k, NB / n), -18, 18), hh = Math.abs(v) / 18 * (h / 2 - 4);
    c.fillStyle = v >= 0 ? th.cyan : th.orange;
    c.fillRect(x + 4 + k * bw + 1, v >= 0 ? my - hh : my, Math.max(1, bw - 2), Math.max(0.5, hh));
  }
  txt(c, x + 6, y + 10, "Change per band", { color: th.scale, size: 8.5, align: "left" });
  c.font = `400 8.5px ${FONT}`;
  legend(c, th, x + 6 + Math.ceil(c.measureText("Change per band").width) + 12, y + 10, [
    [th.cyan, "Boost", "Bars above the middle line: this band gets louder. Measured as output minus input."],
    [th.orange, "Cut", "Bars below the middle line: this band gets quieter. Measured as output minus input."]]);
  hint(x, y, w, h, "Change Per Band", "Sixteen bars from low to high frequency. Each bar shows how much the filter raises or lowers that band, in dB. Measured from output against input.");
}
// Bands in vs out: grey = input level, cyan = output level, orange = the part the filter changed.
function bandsIO(c, th, x, y, w, h, st, n = 16) {
  const z = Z(st); rr(c, x, y, w, h, 3, th.display);
  const bw = (w - 12) / n, base = y + h - 12, ph = h - 26;
  const hy = v => ph * clamp((v + 80) / 80, 0, 1);
  c.strokeStyle = th.dline; c.lineWidth = 1;
  [0.25, 0.5, 0.75].forEach(f => { c.beginPath(); c.moveTo(x + 4, base - ph * f); c.lineTo(x + w - 4, base - ph * f); c.stroke(); });
  for (let k = 0; k < n; k++) {
    const i = mavg(z.inS, k, NB / n), o = mavg(z.outS, k, NB / n), bx = x + 6 + k * bw;
    const lo = Math.min(i, o), hi = Math.max(i, o);
    c.fillStyle = th.cyan; c.fillRect(bx + 1, base - hy(lo), bw - 3, hy(lo));
    c.fillStyle = o >= i ? th.green : th.orange; c.fillRect(bx + 1, base - hy(hi), bw - 3, hy(hi) - hy(lo));
    c.fillStyle = th.dispText; c.fillRect(bx + 1, base - hy(i), bw - 3, 1);
    if (k % 3 === 0) txt(c, bx + bw / 2, y + h - 3, fmtF(fq((k + 0.5) / n)).replace(" kHz", "k").replace(" Hz", ""), { color: th.scale, size: 8.5 });
  }
  const lx = legend(c, th, x + 6, y + 10, [[th.dispText, "Input", "The thin line marks the input level of each band. Measured with an FFT of the input."]], { line: true });
  legend(c, th, lx, y + 10, [
    [th.cyan, "Kept", "The part of the level that is the same in input and output."],
    [th.green, "Boost", "Level the filter adds in this band. Output is louder than input."],
    [th.orange, "Cut", "Level the filter removes in this band. Output is quieter than input."]]);
  hint(x, y, w, h, "Band Meters", "Sixteen level bars from low to high frequency. The bar height is the output level; the thin line is the input level. Measured with an FFT of input and output.");
}
// Scrolling sonogram of the output spectrum; low frequencies at the bottom.
function sonogram(c, th, x, y, w, h, st) {
  const z = Z(st); rr(c, x, y, w, h, 3, th.display);
  const rows = 24, cw = 2, ncol = Math.floor((w - 28) / cw), ch = (h - 22) / rows, x0 = x + w - 4;
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  for (let i = 0; i < Math.min(ncol, z.cols.length); i++) {
    const col = z.cols[z.cols.length - 1 - i];
    for (let r = 0; r < rows; r++) {
      const lvl = clamp(((col[2 * r] + col[2 * r + 1]) / 2 + 64) / 58, 0, 1);
      if (lvl < 0.12) continue;
      c.globalAlpha = Math.min(1, 0.2 + (lvl - 0.12) * 1.1); c.fillStyle = lvl > 0.85 ? th.orange : th.cyan;
      c.fillRect(x0 - (i + 1) * cw, y + h - 4 - (r + 1) * ch, cw, ch);
    }
  }
  c.globalAlpha = 1; c.restore();
  [[100, "100"], [1000, "1k"], [10000, "10k"]].forEach(([f, s]) => txt(c, x + 4, y + h - 4 - (h - 22) * xf(f) - 2, s, { color: th.scale, size: 8.5, align: "left" }));
  txt(c, x + w - 6, y + 10, "Output spectrum, newest on the right", { color: th.scale, size: 8.5, align: "right" });
  legend(c, th, x + 6, y + 10, [
    [th.cyan, "Loud", "Cyan marks sound at that frequency and time. The brighter, the louder."],
    [th.orange, "Very loud", "Orange marks the loudest parts of the output."]]);
  hint(x, y, w, h, "Sonogram", "Time runs left to right, newest on the right. Low frequencies are at the bottom, high at the top. Measured with an FFT of the output.");
}
function scope(c, th, x, y, w, h, st) {
  const z = Z(st); rr(c, x, y, w, h, 3, th.display);
  const my = y + h / 2, a = h / 2 - 8;
  c.strokeStyle = th.dline; c.lineWidth = 1;
  [-0.45, 0, 0.45].forEach(f => { c.beginPath(); c.moveTo(x + 4, my + f * a * 2); c.lineTo(x + w - 4, my + f * a * 2); c.stroke(); });
  hint(x, y, w, h, "Scope", "The input and output waveforms drawn on top of each other, over a window of 20 ms. Where they differ, the filter changed the sound.");
  if (!z.sIn.length) return;
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  for (const [arr, col, lw] of [[z.sIn, th.scale, 1], [z.sOut, th.cyan, 1.5]]) {
    c.strokeStyle = col; c.lineWidth = lw; c.beginPath();
    arr.forEach((v, i) => { const px = x + 4 + (w - 8) * i / (arr.length - 1), py = my - clamp(v * 1.6, -1.1, 1.1) * a; i ? c.lineTo(px, py) : c.moveTo(px, py); });
    c.stroke();
  }
  c.restore();
  legend(c, th, x + 6, y + 10, [
    [th.scale, "Input", "The waveform going into the effect. Measured from the input signal."],
    [th.cyan, "Output", "The waveform coming out of the effect. Measured from the output signal."]], { line: true });
  txt(c, x + w - 6, y + 10, "20 ms", { color: th.scale, size: 8.5, align: "right" });
  hint(x + w - 36, y + 1, 32, 12, "Time Window", "The scope shows 20 milliseconds of sound.");
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

const E = "BiquadNonLin";
DESIGNS["Biquads"] = {
  effect: E,
  refs: [["AutoFilterL12.png", "Auto Filter"], ["EQEightL12.png", "EQ Eight"], ["UtilityL12.png", "Utility"]],
  lead: "Visual cue: the measured filter shape (curve of output minus input per band) and, in one option, the input and output waveforms together.",
  options: [
    { id: "A", name: "Auto Filter", short: "Response", width: 528, step: wrapStep, live: liveZ,
      why: "A large response curve with a dot on the strongest point and its frequency and gain, dials beside it, like Auto Filter.",
      bullets: ["Orange curve = measured response, FFT of output against input", "Dot = band with the largest change, with its frequency and dB", "Dials in a block on the right"],
      draw(c, th, st, ps, vals) {
        st.vals = vals;
        menu(c, th, 6, HEAD_H + 4, 130, E); arrows(c, th, 140, HEAD_H + 4); rd(c, th, 180, HEAD_H + 15, st);
        spec(c, th, 4, HEAD_H + 22, 290, 143, st, { faint: true, thick: 3, peakDot: true, title: "Response Curve", info: "Frequency runs left to right, 20 Hz to 20 kHz. The orange curve shows how much the filter raises or lowers each frequency, in dB. The legend names each colour." });
        ctl(c, th, ps, vals, { x: 300, y: HEAD_H + 22, w: 156, h: 145 });
        GS(c, th, st, 528);
      } },
    { id: "B", name: "Magnitude and phase", short: "Mag+Phase", width: 568, step: wrapStep, live: liveZ,
      why: "Two curves in one display, size in orange and phase in cyan, with the dials in a row below, like EQ Eight's curve view.",
      bullets: ["Orange = magnitude (output minus input, per band)", "Cyan = phase shift estimated from the same measurement, -90 to +90 degrees", "Dials in one row under the display"],
      draw(c, th, st, ps, vals) {
        st.vals = vals;
        const z = Z(st), x = 4, y = HEAD_H + 22, w = 492, h = 88;
        menu(c, th, 6, HEAD_H + 4, 130, E); arrows(c, th, 140, HEAD_H + 4); rd(c, th, 200, HEAD_H + 15, st);
        spec(c, th, x, y, w, h, st, { inFill: false, outLine: false, thick: 2.5, range: 10, leg: false, title: "Magnitude and Phase", info: "Frequency runs left to right, 20 Hz to 20 kHz. Orange: how much each frequency is raised or lowered. Cyan: how much the filter shifts the timing of each frequency. Both are estimated from output against input." });
        c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
        c.strokeStyle = th.cyan; c.lineWidth = 1.5; c.beginPath();
        for (let b = 0; b < NB; b++) {
          const s = ((z.meas[Math.min(NB - 1, b + 1)] - z.meas[Math.max(0, b - 1)]) / 2);
          const ph = -Math.atan(s * 1.2), px = x + 4 + (w - 8) * b / (NB - 1), py = y + h / 2 - ph / (Math.PI / 2) * (h / 2 - 10);
          b ? c.lineTo(px, py) : c.moveTo(px, py);
        }
        c.stroke(); c.restore();
        legend(c, th, x + 6, y + 11, [
          [th.orange, "Magnitude", "How much the filter raises (above the middle line) or lowers (below) each frequency, in dB. Output level minus input level."],
          [th.cyan, "Phase", "How much the filter shifts the timing of each frequency, from -90 to +90 degrees. Estimated from the slope of the magnitude curve."]], { line: true });
        ctl(c, th, ps, vals, { x: 4, y: HEAD_H + 116, w: 492, h: 50 });
        GS(c, th, st, 568);
      } },
    { id: "C", name: "Scope", short: "Scope", width: 518, step: wrapStep, live: liveZ,
      why: "An oscilloscope with input and output waveforms on top of each other, big readouts and meters, like Utility and Echo.",
      bullets: ["Grey = input waveform, cyan = output waveform (20 ms window)", "Big In / Out / Change numbers from the same audio", "Dials in a block on the right"],
      draw(c, th, st, ps, vals) {
        st.vals = vals;
        const z = Z(st);
        menu(c, th, 6, HEAD_H + 4, 130, E); arrows(c, th, 140, HEAD_H + 4);
        scope(c, th, 4, HEAD_H + 22, 280, 96, st);
        rr(c, 4, HEAD_H + 122, 280, 44, 3, th.display);
        const tips = { In: ["Input Level", "Loudness of the sound going into the effect, in dB. Measured from the input signal."],
          Out: ["Output Level", "Loudness of the sound coming out of the effect, in dB. Measured from the output signal."],
          Change: ["Level Change", "How much louder (+) or quieter (-) the whole sound gets, in dB. Measured from output against input."] };
        [["In", st.inL, th.dispText], ["Out", st.outL, th.cyan], ["Change", z.dl, th.orange]].forEach(([l, v, col], i) => {
          const cx = 4 + 47 + i * 93;
          hint(cx - 44, HEAD_H + 125, 88, 40, tips[l][0], tips[l][1]);
          txt(c, cx, HEAD_H + 138, l, { color: th.scale, size: 9 });
          txt(c, cx, HEAD_H + 156, (l === "Change" && v >= 0 ? "+" : "") + Math.max(-60, v).toFixed(1) + " dB", { color: col, size: 12, bold: true });
        });
        ctl(c, th, ps, vals, { x: 290, y: HEAD_H + 22, w: 156, h: 145 });
        GS(c, th, st, 518);
      } },
  ],
};

})();
