#!/usr/bin/env node
// Prints facts the device generator needs about chosen options, as JSON:
//   node design/manifest.js '{"Dynamics":"AB","Reverb":"A"}'
//   -> {"Dynamics": {"option": "AB", "width": 556, "tabs": ["Needle", "Activity"]}, ...}
const fs = require("fs"), path = require("path"), vm = require("vm");
const D = __dirname;
const choice = JSON.parse(process.argv[2] || "{}");

const noop = () => {};
const fake = new Proxy({}, { get: (o, k) => k in o ? o[k] : (k === "measureText" ? s => ({ width: String(s).length * 5.2 }) : noop), set: (o, k, v) => (o[k] = v, true) });
const ctx = vm.createContext({ console, Math, JSON, Array, Object, String, Number, Map, Set, Float32Array, Float64Array, Uint8ClampedArray });
vm.runInContext(fs.readFileSync(path.join(D, "lib.js"), "utf8"), ctx);
vm.runInContext(`S.themes = ${fs.readFileSync(path.join(D, "themes.json"), "utf8")};
  S.reg = ${fs.readFileSync(path.join(D, "registry.json"), "utf8")};
  S.reg.forEach(e => (S.byCat[e.category] = S.byCat[e.category] || []).push(e));`, ctx);

const out = {};
for (const f of fs.readdirSync(path.join(D, "designs")).filter(f => f.endsWith(".js")).sort()) {
  const cat = f.slice(0, -3);
  vm.runInContext(fs.readFileSync(path.join(D, "designs", f), "utf8"), ctx, { filename: f });
  const des = vm.runInContext(`DESIGNS[${JSON.stringify(cat)}]`, ctx);
  const ids = String(choice[cat] || des.options[0].id).split("+");
  const o = ids.length > 1 ? vm.runInContext("composeViews", ctx)(des, ids) : (des.options.find(x => x.id === ids[0]) || des.options[0]);
  const tabs = [];
  vm.runInContext("S.cat = c; S.theme = 'dark';", Object.assign(ctx, { c: cat }));
  const realTabs = vm.runInContext("viewTabs", ctx), realTabsV = vm.runInContext("viewTabsV", ctx);
  let vertical = false;
  ctx.__vert = () => { vertical = true; };
  vm.runInContext("viewTabs = function (c, th, x, y, labels) { labels.forEach(l => __tabs.push(String(l))); return []; };", Object.assign(ctx, { __tabs: tabs }));
  vm.runInContext("viewTabsV = function (c, th, x, y, w, labels) { __vert(); labels.forEach(l => __tabs.push(String(l))); };", ctx);
  const eff = vm.runInContext(`S.byCat[${JSON.stringify(cat)}]`, ctx).find(e => e.name === des.effect);
  const st = vm.runInContext("newState()", ctx);
  for (let k = 0; k < 10; k++) { st.t += 1 / 60; o.step(st, 1 / 60); }
  const ps = eff.params.map((p, i) => ({ ...p, _i: i }));
  o.draw(fake, vm.runInContext("tok()", ctx), st, ps, ps.map(p => p.default));
  ctx.__real = realTabs; ctx.__realV = realTabsV; vm.runInContext("viewTabs = __real; viewTabsV = __realV;", ctx);
  out[cat] = { option: o.id, width: o.width, tabs, vertical, effect: des.effect };
}
process.stdout.write(JSON.stringify(out, null, 1) + "\n");
