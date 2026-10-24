// runtime_max.js : runs one approved design inside a v8ui of a Max for Live device.
// tools/build_ui.py appends this after lib.js, mgcanvas.js and designs/<Category>.js and
// replaces __CATEGORY__, __OPTION__ and __THEMES__.
//
// Inlet: airwin~'s info outlet (nparams / pname / display / levels / peaks / spec_in /
//        spec_out / xfer / scope), plus "theme" messages from live.colors.
// Outlet: "script ..." messages for thispatcher, which move Live's own controls (dials,
//        menu, arrows, gain dials, view tabs) to where the design puts them.
//
// The design's draw() is called unchanged. knob(), menu(), arrows(), toggle() only record
// positions here, because Live's own objects draw those controls.

autowatch = 0;
inlets = 1;
outlets = 1;
mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

const CATEGORY = __CATEGORY__;
const OPTION = __OPTION__;
S.themes = __THEMES__;
S.theme = "dark";
S.cat = CATEGORY;

const LOG = __LOG__;
function log() {
  if (!LOG) return;
  const f = new File(LOG, "write");
  if (!f.isopen) return;
  f.position = f.eof;
  f.writeline(CATEGORY + ": " + arrayfromargs(arguments).join(" "));
  f.close();
}

const DES = DESIGNS[CATEGORY];
const OPT = DES.options.find(o => o.id === OPTION) || DES.options[0];

let st = newState();
let params = [];
let rec = [];
let lastLayout = "";
let sentBack = false;
let lastT = Date.now();

// ---------------------------------------------------------------- measurements from airwin~
const M = { inPkDb: [-120, -120], outPkDb: [-120, -120], inRmsDb: -120, outRmsDb: -120, gainDb: 0, corr: 1,
            inPk: 0, outPk: 0, specIn: [], specOut: [], specDiff: [], xfer: [], scopeL: [], scopeR: [],
            inScopeL: [], inScopeR: [], ms: [-120, -120, -120, -120], diffRmsDb: -120, dcOut: 0, xcorr: [] };

function levels(a, b, c, d, e, f, g, h) {
  M.inPkDb = [a, b]; M.outPkDb = [c, d]; M.inRmsDb = e; M.outRmsDb = f; M.gainDb = g; M.corr = h;
}
let frames = 0;
function peaks(i, o) {
  M.inPk = i; M.outPk = o;
  if (LOG && frames++ % 30 === 0) log("frame", frames, "in", M.inPkDb[0].toFixed(1), "out", M.outPkDb[0].toFixed(1), "gain", M.gainDb.toFixed(2));
  // "peaks" is the last message of each frame: advance the display state and repaint
  const now = Date.now(), dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  st.t += dt;
  (OPT.live || liveGeneric)(st, M, dt);
  mgraphics.redraw();
}
function spec_in() { M.specIn = arrayfromargs(arguments); }
function spec_out() { M.specOut = arrayfromargs(arguments); }
function xfer() { M.xfer = arrayfromargs(arguments); }
function scope() { const a = arrayfromargs(arguments); M.scopeL = a.slice(0, 64); M.scopeR = a.slice(64); }
function scope_in() { const a = arrayfromargs(arguments); M.inScopeL = a.slice(0, 64); M.inScopeR = a.slice(64); }
function spec_diff() { M.specDiff = arrayfromargs(arguments); }
function ms(a, b, c, d) { M.ms = [a, b, c, d]; }
function diff(r, dc) { M.diffRmsDb = r; M.dcOut = dc; }
function xcorr() { M.xcorr = arrayfromargs(arguments); }

// effect info
function nparams(n) { params = []; for (let i = 0; i < n; i++) params.push({ name: "", display: "", default: 0.5, _i: i }); lastLayout = ""; mgraphics.redraw(); }
function pname(i, s) { if (params[i]) params[i].name = String(s); }
function display(i) { if (params[i]) params[i].display = arrayfromargs(arguments).slice(1).join(" "); }
function algo(s) { S.effName = String(s); mgraphics.redraw(); }
function theme(name) { if (S.themes[name]) { S.theme = name; mgraphics.redraw(); } }
function what() { S.effWhat = arrayfromargs(arguments).join(" "); mgraphics.redraw(); }
function anything() {} // category, pvalue, …: not needed for drawing

// ---------------------------------------------------------------- controls are Live objects
knob = function (c, th, x, y, w, p, v, big) {
  rec.push({ k: p && p._i !== undefined ? "dial" : "gain", i: p ? p._i : -1, name: p ? p.name : "", x, y: y - HEAD_H, w, big: !!big });
};
menu = function (c, th, x, y, w) { rec.push({ k: "menu", x, y: y - HEAD_H, w }); };
arrows = function (c, th, x, y) { rec.push({ k: "arrows", x, y: y - HEAD_H }); };
viewTabs = function (c, th, x, y, labels, active) {
  // the device's live.tab "view" draws these; record the area it must cover
  let w = 0; c.font = `400 9.5px ${FONT}`;
  for (const l of labels) w += Math.ceil(c.measureText(l).width) + 14;
  rec.push({ k: "tab", x, y: y - HEAD_H, w: w - 2, labels });
  return [];
};

function script() { const a = arrayfromargs(arguments); log("script", a.join(" ")); outlet(0, ["script"].concat(a)); }
function rect(id, x, y, w, h) { script("sendbox", id, "presentation_rect", Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }

function publishLayout() {
  const key = JSON.stringify(rec.map(r => [r.k, r.i, Math.round(r.x), Math.round(r.y), Math.round(r.w || 0), r.big, r.name]));
  if (key === lastLayout) return;
  if (!lastLayout && !sentBack) { script("sendtoback", "display"); sentBack = true; } // behind Live's controls
  lastLayout = key;
  const shown = {};
  let gains = 0, tabs = [];
  for (const r of rec) {
    if (r.k === "dial") {
      const dw = r.big ? 46 : 36, dh = r.big ? 36 : 28;
      rect("name" + r.i, r.x, r.y, r.w, 13);
      rect("dial" + r.i, r.x + (r.w - dw) / 2, r.y + 12, dw, dh);
      rect("value" + r.i, r.x, r.y + 12 + dh, r.w, 13);
      ["name", "dial", "value"].forEach(p => { script("show", p + r.i); shown[p + r.i] = 1; });
    } else if (r.k === "gain") {
      const id = gains++ === 0 ? "gainIn" : "gainOut";
      rect(id, r.x, r.y, r.w, 52);
    } else if (r.k === "menu") {
      rect("Effect", r.x, r.y, r.w, 15);
    } else if (r.k === "arrows") {
      rect("arrows", r.x, r.y, 30, 15);
    } else if (r.k === "tab") {
      tabs.push(r);
    }
  }
  for (let i = 0; i < 13; i++) if (!shown["dial" + i]) ["name", "dial", "value"].forEach(p => script("hide", p + i));
  if (tabs.length) { rect("view", tabs[0].x, tabs[0].y, tabs[0].w, 15); script("show", "view"); }
  else script("hide", "view");
}

// the device's "view" tab (live.tab) reports its index here
function view(i) { st.view = i; mgraphics.redraw(); }

// ---------------------------------------------------------------- paint
function paint() {
  const c = makeCanvas(mgraphics, { font: "Ableton Sans Medium", boldFont: "Ableton Sans Bold" });
  c.translate(0, -HEAD_H);
  rec = [];
  const th = tok();
  try {
    OPT.draw(c, th, st, params, params.map(() => 0.5));
  } catch (e) {
    post("aw_ui draw error: " + e + "\n");
    log("draw error", e, e && e.stack);
  }
  publishLayout();
}

// live.colors answers "live_control_bg r g b a": a light control background means a light theme
function live_control_bg(r, g, b) { theme(0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5 ? "light" : "dark"); }
