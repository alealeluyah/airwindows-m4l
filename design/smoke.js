#!/usr/bin/env node
// Headless check of design options:  node design/smoke.js [Category ...]
// Runs every option of designs/<Category>.js for every effect of that category, in both
// themes, for 90 animation frames, against a recording fake canvas. Reports exceptions,
// NaN/Infinity coordinates, and drawing outside the device rectangle.
const fs = require("fs"), path = require("path"), vm = require("vm");
const D = __dirname;

function fakeCtx(bounds, problems, where) {
  const t = { lineWidth: 1, font: "", fillStyle: "", strokeStyle: "", textAlign: "", textBaseline: "", lineCap: "", globalAlpha: 1 };
  const check = (name, args) => {
    for (const a of args) if (typeof a === "number" && !Number.isFinite(a)) { problems.add(`${where()}: ${name}() got ${a}`); return; }
    const xy = { moveTo: [0, 1], lineTo: [0, 1], fillRect: [0, 1, 2, 3], rect: [0, 1, 2, 3], roundRect: [0, 1, 2, 3], fillText: [1, 2], arc: [0, 1] }[name];
    if (!xy || t._clip) return;
    let x = args[xy[0]], y = args[xy[1]];
    if (name === "fillText") { x = args[1]; y = args[2]; }
    const w = xy.length === 4 ? args[2] : 0, h = xy.length === 4 ? args[3] : 0;
    if (x < -2 || y < -2 || x + w > bounds.w + 2 || y + h > bounds.h + 2)
      problems.add(`${where()}: ${name} outside device (${Math.round(x)},${Math.round(y)}${xy.length === 4 ? ` ${Math.round(w)}x${Math.round(h)}` : ""}) in ${bounds.w}x${bounds.h}`);
  };
  return new Proxy(t, {
    get(o, k) {
      if (k in o) return o[k];
      if (k === "measureText") return s => ({ width: String(s).length * 5.2 });
      if (k === "save") return () => { (o._stack = o._stack || []).push(o._clip); };
      if (k === "restore") return () => { o._clip = (o._stack || []).pop(); };
      if (k === "clip") return () => { o._clip = true; };
      if (k === "createLinearGradient" || k === "createRadialGradient") return () => ({ addColorStop() {} });
      if (k === "getImageData") return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
      return (...a) => check(String(k), a);
    },
    set(o, k, v) { o[k] = v; return true; },
  });
}

const ctx = vm.createContext({
  console, Math, JSON, Array, Object, String, Number, Promise, Map, Set, Float32Array, Float64Array, Uint8ClampedArray,
  performance: { now: () => 0 }, requestAnimationFrame() {}, location: { hash: "", search: "" }, URLSearchParams,
  window: { addEventListener() {}, devicePixelRatio: 1, scrollTo() {} },
  document: { getElementById: () => ({}), querySelectorAll: () => [], fonts: { load: async () => {} }, createElement: () => ({}), body: { appendChild() {} } },
  fetch: async () => ({ json: async () => ({}) }),
});
vm.runInContext(fs.readFileSync(path.join(D, "lib.js"), "utf8"), ctx, { filename: "lib.js" });
vm.runInContext(fs.readFileSync(path.join(D, "app.js"), "utf8").replace(/\ninit\(\);\s*$/, "\n"), ctx, { filename: "app.js" });
vm.runInContext(`S.themes = ${fs.readFileSync(path.join(D, "themes.json"), "utf8")};
  S.reg = ${fs.readFileSync(path.join(D, "registry.json"), "utf8")};
  S.reg.forEach(e => (S.byCat[e.category] = S.byCat[e.category] || []).push(e));`, ctx);

const cats = process.argv.slice(2).length ? process.argv.slice(2)
  : fs.readdirSync(path.join(D, "designs")).filter(f => f.endsWith(".js")).map(f => f.slice(0, -3));
let bad = 0;
for (const cat of cats) {
  const file = path.join(D, "designs", cat + ".js");
  const problems = new Set();
  try { vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file }); }
  catch (e) { console.log(`✗ ${cat}: file does not load: ${e.message}`); bad++; continue; }
  const des = vm.runInContext(`DESIGNS[${JSON.stringify(cat)}]`, ctx);
  if (!des) { console.log(`✗ ${cat}: file does not set DESIGNS["${cat}"]`); bad++; continue; }
  const effects = vm.runInContext(`S.byCat[${JSON.stringify(cat)}] || []`, ctx);
  if (!effects.find(e => e.name === des.effect)) problems.add(`effect "${des.effect}" is not in ${cat}`);
  if (!Array.isArray(des.refs) || !des.lead || !Array.isArray(des.options) || des.options.length < 2) problems.add("needs refs, lead and at least 2 options");
  for (const o of des.options || []) {
    for (const k of ["id", "name", "width", "why", "bullets", "draw", "step"]) if (!(k in o)) problems.add(`option ${o.id}: missing ${k}`);
    if (o.width > 700) problems.add(`option ${o.id}: width ${o.width} > 700`);
    for (const theme of ["dark", "light"]) for (const eff of effects) {
      let frame = 0;
      const where = () => `option ${o.id} [${theme}] ${eff.name} (${eff.params.length} params)`;
      const c = fakeCtx({ w: o.width, h: vm.runInContext("HEAD_H + DEVICE_H", ctx) }, problems, where);
      try {
        vm.runInContext("S.theme = th; S.cat = cat;", Object.assign(ctx, { th: theme, cat }));
        const st = vm.runInContext("newState()", ctx);
        const ps = eff.params.map((p, i) => ({ ...p, _i: i })), vals = ps.map(p => p.default);
        const th = vm.runInContext("tok()", ctx);
        for (frame = 0; frame < 90; frame++) {
          st.t += 1 / 60; o.step(st, 1 / 60);
          vm.runInContext("header", ctx)(c, th, o.width, `Airwindows ${cat}`);
          o.draw(c, th, st, ps, vals);
        }
      } catch (e) { problems.add(`${where()}: ${e.message}`); }
    }
    // real measurements (frames/<Category>.json from `awtool frames`) through o.live or liveGeneric
    const fpath = path.join(D, "frames", cat + ".json");
    if (fs.existsSync(fpath)) {
      if (!o.live) problems.add(`option ${o.id}: no live(st, m, dt) — real audio falls back to liveGeneric`);
      const fr = JSON.parse(fs.readFileSync(fpath, "utf8")).frames;
      for (const theme of ["dark", "light"]) {
        let frame = 0;
        const eff = effects.find(e => e.name === des.effect) || effects[0];
        const where = () => `option ${o.id} [${theme}] real audio`;
        const c = fakeCtx({ w: o.width, h: vm.runInContext("HEAD_H + DEVICE_H", ctx) }, problems, where);
        try {
          vm.runInContext("S.theme = th; S.cat = cat;", Object.assign(ctx, { th: theme, cat }));
          const st = vm.runInContext("newState()", ctx);
          const ps = eff.params.map((p, i) => ({ ...p, _i: i })), vals = ps.map(p => p.default);
          const th = vm.runInContext("tok()", ctx), toM = vm.runInContext("measureFromFrame", ctx);
          const live = o.live || vm.runInContext("liveGeneric", ctx);
          for (frame = 0; frame < fr.length; frame++) {
            st.t += 1 / 30; live(st, toM(fr[frame]), 1 / 30);
            if (frame % 10 === 0) { vm.runInContext("header", ctx)(c, th, o.width, `Airwindows ${cat}`); o.draw(c, th, st, ps, vals); }
          }
        } catch (e) { problems.add(`${where()} frame ${frame}: ${e.message}`); }
      }
    }
  }
  const list = [...problems];
  if (list.length) { bad++; console.log(`✗ ${cat}: ${list.length} problems`); list.slice(0, 15).forEach(p => console.log("   " + p)); if (list.length > 15) console.log(`   … ${list.length - 15} more`); }
  else console.log(`✓ ${cat}: ${(des.options || []).length} options × ${effects.length} effects × 2 themes`);
}
process.exit(bad ? 1 : 0);
