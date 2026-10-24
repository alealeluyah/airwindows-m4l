// Design review for the Airwindows M4L devices.
// Each option is drawn on a canvas in Live's own theme colours, at Live's pixel size
// (one canvas unit = one Live pixel), animated with a simulated drum signal.

const S = { themes: null, reg: [], byCat: {}, decisions: {}, theme: "dark", zoom: 2, mocks: [] };

const FONT = '"Ableton Sans Small", -apple-system, sans-serif';
const DEVICE_H = 169;   // Live's device body height
const HEAD_H = 18;      // device title bar

// ---------------------------------------------------------------- theme
function tok() {
  const t = S.themes[S.theme];
  const light = S.theme === "light";
  return {
    body: t.DetailViewBackground, text: t.ControlForeground, dim: light ? "#3d3d3d" : "#8a8a8a",
    display: t.RetroDisplayBackground, dline: t.RetroDisplayBackgroundLine,
    orange: t.RetroDisplayForeground, cyan: t.RetroDisplayForeground2, arc: t.RangeDefault,
    track: light ? "#8f8f8f" : "#1e1e1e", needle: light ? "#121212" : "#d9d9d9",
    ctrlBg: t.ControlBackground, frame: light ? "#4f4f4f" : "#111111", on: t.ViewControlOn,
    meterBg: t.MeterBackground, scale: t.RetroDisplayScaleText.slice(0, 7), title: t.RetroDisplayTitle,
    dispText: light ? "#cfcfcf" : "#b5b5b5", panel: light ? "rgba(0,0,0,0.08)" : "rgba(0,0,0,0.18)",
    green: "#1ec15a", greenDim: "#0f6b33",
  };
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
  rr(c, x + 0.5, y + 0.5, w, 14, 1, th.ctrlBg, th.frame);
  txt(c, x + 4, y + 11, label, { color: th.text, align: "left" });
  c.fillStyle = th.text; c.beginPath(); c.moveTo(x + w - 10, y + 5); c.lineTo(x + w - 3, y + 5); c.lineTo(x + w - 6.5, y + 10); c.fill();
}
function arrows(c, th, x, y) {
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
  c.strokeStyle = th.cyan; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x, toY(-14)); c.lineTo(x + w, toY(-14)); c.stroke();
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
function waveScroll(c, th, x, y, w, h, hist, key, color) {
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  const mid = y + h / 2, n = Math.min(hist.length, w);
  c.fillStyle = color; c.beginPath(); c.moveTo(x + w, mid);
  for (let i = 0; i < n; i++) c.lineTo(x + w - i, mid - hist[hist.length - 1 - i][key] * h * 0.46);
  for (let i = n - 1; i >= 0; i--) c.lineTo(x + w - i, mid + hist[hist.length - 1 - i][key] * h * 0.46 * (0.7 + 0.3 * Math.abs(noise(i))));
  c.fill(); c.restore();
}
function decayMap(c, th, x, y, w, h, st) {
  rr(c, x, y, w, h, 3, th.display);
  const t60 = 1.9;
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.strokeStyle = th.dline; c.lineWidth = 1;
  for (let i = 1; i < 4; i++) { const yy = y + 14 + (h - 30) * i / 4; c.beginPath(); c.moveTo(x, yy); c.lineTo(x + w, yy); c.stroke(); }
  // envelope after the last hit: early reflections then exponential tail
  const ph = (st.t % 1) / 1;
  c.fillStyle = th.cyan + "44"; c.strokeStyle = th.cyan; c.lineWidth = 1.5; c.beginPath();
  c.moveTo(x + 6, y + h - 14);
  for (let i = 0; i <= w - 12; i++) {
    const tt = (i / (w - 12)) * 3;
    let e = Math.exp(-tt * 6.9 / t60);
    if (tt < 0.08) e *= tt / 0.08;
    const er = tt < 0.12 ? 0.25 * Math.abs(noise(i * 3)) : 0;
    c.lineTo(x + 6 + i, y + h - 14 - (h - 30) * Math.min(1, e + er));
  }
  c.lineTo(x + w - 6, y + h - 14); c.fill(); c.stroke();
  const px = x + 6 + (w - 12) * ph;
  c.strokeStyle = th.orange; c.beginPath(); c.moveTo(px, y + 14); c.lineTo(px, y + h - 14); c.stroke();
  c.restore();
  txt(c, x + 6, y + 11, "Decay", { color: th.scale, align: "left" });
  txt(c, x + w - 6, y + 11, `≈ ${t60.toFixed(2)} s`, { color: th.orange, align: "right" });
  ["0", "1 s", "2 s", "3 s"].forEach((s, i) => txt(c, x + 6 + (w - 12) * i / 3, y + h - 3, s, { color: th.scale, size: 8.5, align: i ? (i === 3 ? "right" : "center") : "left" }));
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

// ---------------------------------------------------------------- page
function categories() { return Object.keys(S.byCat).sort(); }

function renderNav() {
  const nav = document.getElementById("nav");
  const ready = categories().filter(c => DESIGNS[c]), later = categories().filter(c => !DESIGNS[c]);
  const row = c => {
    const d = S.decisions[c];
    const st = d && d.option ? `<span class="st ok">✓ ${d.option}</span>` : (DESIGNS[c] ? `<span class="st">review</span>` : `<span class="st">later</span>`);
    return `<a href="#${encodeURIComponent(c)}" class="${S.cat === c ? "on" : ""}">${c}${st}</a>`;
  };
  nav.innerHTML = `<a href="#All" class="${S.cat === "All" ? "on" : ""}">All devices (today)<span class="st">${categories().length}</span></a>`
    + `<h3>To review</h3>${ready.map(row).join("")}` + (later.length ? `<h3>Not ready yet</h3>${later.map(row).join("")}` : "");
}

function renderAll() {
  document.getElementById("page").innerHTML = `<h2>All devices — current look</h2>
    <p class="lead">Screenshots of the 23 devices as they are today (v0.1.0), each with its first effect loaded.</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(540px,1fr));gap:22px">
    ${categories().map(c => `<figure style="margin:0"><a href="#${encodeURIComponent(c)}"><img src="current/${c.replace(/ /g, "_")}.png" style="width:522px;border-radius:3px;display:block"></a>
      <figcaption style="margin-top:4px">Airwindows ${c} <span style="color:var(--dim)">· ${S.byCat[c].length} effects</span></figcaption></figure>`).join("")}</div>`;
}

function renderPage() {
  if (S.cat === "All") { S.mocks = []; return renderAll(); }
  const cat = S.cat, page = document.getElementById("page"), D = DESIGNS[cat];
  S.mocks = [];
  const cur = `<h4>Current device</h4><div class="current"><img src="current/${cat.replace(/ /g, "_")}.png" alt="current ${cat}"></div>`;
  if (!D) {
    page.innerHTML = `<h2>Airwindows ${cat}</h2><p class="lead">${S.byCat[cat].length} effects. Options for this group come after Dynamics and Reverb are approved, using the same design system.</p>${cur}`;
    return;
  }
  const dec = S.decisions[cat] || {};
  page.innerHTML = `
    <h2>Airwindows ${cat}</h2>
    <p class="lead">${S.byCat[cat].length} effects. ${D.lead}</p>
    <h4>Ableton references</h4>
    <div class="refs">${D.refs.map(([f, n]) => `<figure><img src="refs/${f}" alt="${n}"><figcaption>${n}</figcaption></figure>`).join("")}</div>
    ${cur}
    <h4>Options</h4>
    ${D.options.map(o => `
      <div class="opt ${dec.option === o.id ? "chosen" : ""}" data-id="${o.id}">
        <div class="top"><b>${o.id} — ${o.name}</b><span class="why">${o.why}</span></div>
        <div class="scroll"><canvas data-id="${o.id}"></canvas></div>
        <ul>${o.bullets.map(b => `<li>${b}</li>`).join("")}</ul>
        <div class="ctl">
          <label>Preview effect <select data-id="${o.id}">${S.byCat[cat].map(e => `<option ${e.name === D.effect ? "selected" : ""}>${e.name}</option>`).join("")}</select></label>
          <button class="btn primary ${dec.option === o.id ? "done" : ""}" data-approve="${o.id}">${dec.option === o.id ? "Approved" : "Approve " + o.id}</button>
        </div>
      </div>`).join("")}
    <h4>Notes for this group</h4>
    <textarea id="notes" placeholder="What to change, mix-and-match (e.g. 'A, but with C's meters'), colours, sizes…">${dec.notes || ""}</textarea>
    <div style="margin-top:8px"><button class="btn" id="saveNotes">Save notes</button><span class="saved" id="saved"></span></div>`;

  D.options.forEach(o => {
    const canvas = page.querySelector(`canvas[data-id="${o.id}"]`);
    const sel = page.querySelector(`select[data-id="${o.id}"]`);
    const mock = { o, canvas, st: newState(), eff: S.reg.find(e => e.name === D.effect) };
    sel.onchange = () => { mock.eff = S.reg.find(e => e.name === sel.value); };
    S.mocks.push(mock);
  });
  page.querySelectorAll("[data-approve]").forEach(b => b.onclick = () => save({ option: b.dataset.approve }));
  page.querySelector("#saveNotes").onclick = () => save({ notes: page.querySelector("#notes").value });
}

async function save(patch) {
  const r = await fetch("/api/decision", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category: S.cat, ...patch }) });
  S.decisions = await r.json();
  renderNav(); renderPage();
  const s = document.getElementById("saved"); if (s) { s.textContent = "Saved"; setTimeout(() => s.textContent = "", 1500); }
}

// ---------------------------------------------------------------- animation
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const th = tok(), dpr = window.devicePixelRatio || 1;
  for (const m of S.mocks) {
    const W = m.o.width, H = HEAD_H + DEVICE_H, z = S.zoom;
    if (m.canvas.width !== Math.round(W * z * dpr)) {
      m.canvas.width = Math.round(W * z * dpr); m.canvas.height = Math.round(H * z * dpr);
      m.canvas.style.width = W * z + "px"; m.canvas.style.height = H * z + "px";
    }
    const c = m.canvas.getContext("2d");
    c.setTransform(z * dpr, 0, 0, z * dpr, 0, 0);
    for (let k = 0; k < 2; k++) { m.st.t += dt / 2; m.o.step(m.st, dt / 2); }
    const ps = (m.eff ? m.eff.params : []).map((p, i) => ({ ...p, _i: i }));
    const vals = ps.map(p => p.default);
    header(c, th, W, `Airwindows ${S.cat}`);
    m.o.draw(c, th, m.st, ps, vals);
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- init
async function init() {
  [S.themes, S.reg, S.decisions] = await Promise.all(
    ["themes.json", "registry.json", "/api/decisions"].map(u => fetch(u).then(r => r.json())));
  S.reg.forEach(e => (S.byCat[e.category] = S.byCat[e.category] || []).push(e));
  // load designs/<Category>.js for every category that has one (missing files are skipped)
  await Promise.all(categories().map(c => new Promise(res => {
    const el = document.createElement("script");
    el.src = `designs/${encodeURIComponent(c)}.js`; el.onload = el.onerror = res; document.body.appendChild(el);
  })));
  document.querySelectorAll("#theme button").forEach(b => b.onclick = () => {
    S.theme = b.dataset.t; document.querySelectorAll("#theme button").forEach(x => x.classList.toggle("on", x === b)); });
  document.querySelectorAll("#zoom button").forEach(b => b.onclick = () => {
    S.zoom = +b.dataset.z; document.querySelectorAll("#zoom button").forEach(x => x.classList.toggle("on", x === b));
    S.mocks.forEach(m => m.canvas.width = 0); });
  const route = () => {
    S.cat = decodeURIComponent(location.hash.slice(1)) || "Dynamics";
    renderNav(); renderPage(); window.scrollTo(0, 0);
  };
  window.addEventListener("hashchange", route);
  await document.fonts.load(`10px "Ableton Sans Small"`);
  route();
  requestAnimationFrame(frame);
}

init();
