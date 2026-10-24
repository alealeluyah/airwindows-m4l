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
    // pre-roll 5 s of simulated signal so histories and meters are full on the first frame
    for (let k = 0; k < 600; k++) { mock.st.t += 1 / 120; o.step(mock.st, 1 / 120); }
    sel.onchange = () => { mock.eff = S.reg.find(e => e.name === sel.value); };
    // options may handle clicks (e.g. view buttons): o.click(x, y, st) in device pixels
    canvas.onclick = ev => {
      if (!o.click) return;
      const r = canvas.getBoundingClientRect();
      o.click((ev.clientX - r.left) / S.zoom, (ev.clientY - r.top) / S.zoom, mock.st);
    };
    if (o.click) canvas.style.cursor = "pointer";
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
    S.effName = m.eff ? m.eff.name : "";
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
  const qp = new URLSearchParams(location.search);
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
