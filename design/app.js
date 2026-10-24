// Design review for the Airwindows M4L devices.
// Each option is drawn on a canvas in Live's own theme colours, at Live's pixel size
// (one canvas unit = one Live pixel), animated with a simulated drum signal.

// Review page only. Drawing helpers, theme and DESIGNS live in lib.js.

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
  const approved = categories().filter(c => S.decisions[c] && S.decisions[c].option).length;
  setTimeout(() => { const b = document.getElementById("build"); if (b) b.onclick = buildDevices; });
  nav.innerHTML = `<div style="padding:4px 18px 10px"><button class="btn primary" id="build" style="width:100%">Build devices</button>
      <div style="font-size:12px;color:var(--dim);margin-top:4px">${approved} of ${categories().length} approved; the others use option A</div>
      <pre id="buildOut" style="white-space:pre-wrap;font-size:11px;color:var(--dim);margin:6px 0 0"></pre></div>`
    + `<a href="#All" class="${S.cat === "All" ? "on" : ""}">All devices (today)<span class="st">${categories().length}</span></a>`
    + `<h3>To review</h3>${ready.map(row).join("")}` + (later.length ? `<h3>Not ready yet</h3>${later.map(row).join("")}` : "");
}

function renderAll() {
  document.getElementById("page").innerHTML = `<h2>All devices — current look</h2>
    <p class="lead">Screenshots of the 23 devices as they are today (v0.1.0), each with its first effect loaded.</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(540px,1fr));gap:22px">
    ${categories().map(c => `<figure style="margin:0"><a href="#${encodeURIComponent(c)}"><img src="current/${c.replace(/ /g, "_")}.png" style="width:522px;border-radius:3px;display:block"></a>
      <figcaption style="margin-top:4px">Airwindows ${c} <span style="color:var(--dim)">· ${S.byCat[c].length} effects</span></figcaption></figure>`).join("")}</div>`;
}

async function buildDevices() {
  const b = document.getElementById("build"), out = document.getElementById("buildOut");
  b.disabled = true; b.textContent = "Building…"; out.textContent = "";
  try {
    const r = await (await fetch("/api/build", { method: "POST" })).json();
    out.textContent = r.ok ? r.output.trim().split("\n").slice(-1)[0] + "\nIn Live: drag the device from User Library › Airwindows again." : "Failed:\n" + r.output;
  } catch (e) { out.textContent = "Failed: " + e; }
  b.disabled = false; b.textContent = "Build devices";
}

// the final device of a category: its views from final.json, composed when there are several
function finalOpt(cat) {
  const D = DESIGNS[cat], ids = (S.final || {})[cat];
  if (!D || !ids || !ids.length) return null;
  if (ids.length === 1) return Object.assign({}, D.options.find(o => o.id === ids[0]));
  return composeViews(D, ids);
}

// Info View: like Live's, bottom left; filled from the hints the drawing registered
function showInfo(h) {
  let el = document.getElementById("infoview");
  if (!el) {
    el = document.createElement("div"); el.id = "infoview";
    el.style.cssText = "position:fixed;left:12px;bottom:12px;width:300px;max-width:calc(100vw - 24px);background:#2b2b2b;border:1px solid #454545;border-radius:3px;padding:8px 10px;font-size:12px;line-height:1.4;color:#d0d0d0;z-index:20;pointer-events:none;box-shadow:0 2px 10px #0008";
    document.body.appendChild(el);
  }
  if (!h) { el.style.display = "none"; return; }
  el.style.display = "block";
  el.innerHTML = `<div style="font-weight:700;color:#fff;margin-bottom:2px">${h.title}</div>${h.text || ""}`;
}
function hintAt(m, x, y) {
  let best = null;
  for (const h of m.hints || []) if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h && (!best || h.w * h.h <= best.w * best.h)) best = h;
  return best;
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
    ${S.signal === "real" ? `<p class="lead" style="margin:0">Real audio: Airwindows ${D.effect} on a drum loop, measured exactly as the device measures it. The displays show what each option would show in Live.</p>` : ""}
    ${finalOpt(cat) ? `<div class="opt chosen" data-id="FINAL">
        <div class="top"><b>Final device</b><span class="why">What the device will be: views ${(S.final[cat] || []).join(", ")}${(S.final[cat] || []).length > 1 ? " — switch with the View buttons at the top of the Input/Output column" : ""}. Hover (or tap) any part for its Info View text.</span></div>
        <div class="scroll"><canvas data-id="FINAL"></canvas></div>
        <div class="ctl"><label>Preview effect <select data-id="FINAL">${S.byCat[cat].map(e => `<option ${e.name === D.effect ? "selected" : ""}>${e.name}</option>`).join("")}</select></label></div>
      </div><h4>All options</h4>` : ""}
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

  const fo = finalOpt(cat);
  (fo ? [Object.assign(fo, { _key: "FINAL" })] : []).concat(D.options).forEach(o => {
    const key = o._key || o.id;
    const canvas = page.querySelector(`canvas[data-id="${key}"]`);
    const sel = page.querySelector(`select[data-id="${key}"]`);
    const mock = { o, canvas, st: newState(), eff: S.reg.find(e => e.name === D.effect) };
    // pre-roll 5 s of signal so histories and meters are full on the first frame
    mock.fi = 0; mock.acc = 0;
    if (S.signal === "real") loadFrames(cat).then(fr => { if (fr) for (let k = 0; k < 600; k++) feedReal(mock, fr, 1 / 30); });
    else for (let k = 0; k < 600; k++) { mock.st.t += 1 / 120; o.step(mock.st, 1 / 120); }
    sel.onchange = () => { mock.eff = S.reg.find(e => e.name === sel.value); };
    // options may handle clicks (e.g. view buttons): o.click(x, y, st) in device pixels
    const pos = ev => { const r = canvas.getBoundingClientRect(); return [(ev.clientX - r.left) / S.zoom, (ev.clientY - r.top) / S.zoom]; };
    canvas.onclick = ev => {
      const [x, y] = pos(ev);
      showInfo(hintAt(mock, x, y));            // tap on a phone shows the Info View text
      if (o.click) o.click(x, y, mock.st);
    };
    canvas.onmousemove = ev => { const [x, y] = pos(ev); showInfo(hintAt(mock, x, y)); };
    canvas.onmouseleave = () => showInfo(null);
    canvas.style.cursor = o.click ? "pointer" : "help";
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
// "Real audio": frames recorded by `awtool frames` (the real Airwindows effect on a drum loop),
// fed to the option's live() mapping exactly as the device feeds airwin~'s measurements.
const FRAMES = {};
function loadFrames(cat) {
  if (!(cat in FRAMES)) {
    const p = fetch(`frames/${encodeURIComponent(cat)}.json`).then(r => r.ok ? r.json() : null).catch(() => null);
    p.then(j => { p.done = j; });
    FRAMES[cat] = p;
  }
  return FRAMES[cat];
}
function feedReal(m, fr, dt) {
  m.acc += dt;
  while (m.acc >= 1 / 30) {
    m.acc -= 1 / 30;
    const f = fr.frames[m.fi++ % fr.frames.length];
    m.st.t += 1 / 30;
    (m.o.live || liveGeneric)(m.st, measureFromFrame(f), 1 / 30);
  }
}

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
    if (S.signal === "real") { const fr = FRAMES[S.cat] && FRAMES[S.cat].done; if (fr) feedReal(m, fr, dt); }
    else for (let k = 0; k < 2; k++) { m.st.t += dt / 2; m.o.step(m.st, dt / 2); }
    S.effName = m.eff ? m.eff.name : "";
    S.effWhat = m.eff ? m.eff.what : "";
    const ps = (m.eff ? m.eff.params : []).map((p, i) => ({ ...p, _i: i }));
    const vals = ps.map(p => p.default);
    S.hints = [];
    header(c, th, W, `Airwindows ${S.cat}`);
    m.o.draw(c, th, m.st, ps, vals);
    m.hints = S.hints;
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- init
async function init() {
  [S.themes, S.reg, S.decisions, S.final] = await Promise.all(
    ["themes.json", "registry.json", "/api/decisions", "final.json"].map(u => fetch(u).then(r => r.ok ? r.json() : {})));
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
  document.querySelectorAll("#signal button").forEach(b => b.onclick = () => {
    S.signal = b.dataset.s; document.querySelectorAll("#signal button").forEach(x => x.classList.toggle("on", x === b));
    renderPage(); });
  const qp = new URLSearchParams(location.search);
  if (qp.get("real")) S.signal = "real";
  document.querySelectorAll("#signal button").forEach(x => x.classList.toggle("on", x.dataset.s === (S.signal || "sim")));
  if (qp.get("zoom")) S.zoom = +qp.get("zoom");
  if (qp.get("theme")) S.theme = qp.get("theme");
  document.querySelectorAll("#zoom button").forEach(x => x.classList.toggle("on", +x.dataset.z === S.zoom));
  document.querySelectorAll("#theme button").forEach(x => x.classList.toggle("on", x.dataset.t === S.theme));
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
