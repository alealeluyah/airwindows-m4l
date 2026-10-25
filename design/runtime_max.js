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
const VIEWS = __VIEWS__;        // option ids shown as views (design/final.json)
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

const PATCHER = this.patcher, BOX = this.box;   // captured at load: "this" inside handlers varies

const DES = DESIGNS[CATEGORY];
const OPT = VIEWS.length > 1 ? composeViews(DES, VIEWS) : (DES.options.find(o => o.id === VIEWS[0]) || DES.options[0]);

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
// Live theme. max.getcolor() returns the colour of the user's current Live theme (Max
// "dynamic colours"). paint() reads them every time, so the device follows any theme change.
// Live colour name -> tok() field. Fields with no Live colour keep the Live 12 values.
const LIVE_MAP = {
  live_surface_bg: ["tile", "panel"],                 // Device Background
  live_lcd_bg: ["display"], live_lcd_frame: ["dline"], // LCD Background, LCD Line
  live_lcd_title: ["title"], live_display_scale_text: ["dispText", "scale"],
  live_display_line_one: ["orange"], live_display_line_two: ["cyan"],   // LCD Shape, LCD Shape Variant
  live_control_bg: ["ctrlBg"], live_control_fg: ["text"], live_contrast_frame: ["frame"],
  live_control_selection: ["on"], live_value_arc: ["arc"], live_meter_bg: ["meterBg"],
};
const hex = a => "#" + a.slice(0, 3).map(v => ("0" + Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16)).slice(-2)).join("");
const luma = a => 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
let liveLogged = "";
function liveTheme() {
  if (typeof max === "undefined" || !max.getcolor) return;     // review page / tests: keep tok()
  const L = {}, got = {};
  for (const n in LIVE_MAP) {
    let c = null;
    try { c = max.getcolor(n); } catch (e) {}
    if (c && c.length >= 3) { got[n] = c; LIVE_MAP[n].forEach(k => (L[k] = hex(c))); }
  }
  const bg = got.live_surface_bg;
  if (bg) {
    S.theme = luma(bg) > 0.45 ? "light" : "dark";             // the fields Live has no colour for
    // gutters: a little lighter than the tiles, as in Live 12 (SurfaceHighlight)
    L.gutter = L.body = hex(bg.slice(0, 3).map(v => v + (S.theme === "light" ? 0.09 : 0.063)));
  }
  S.live = L;
  const key = JSON.stringify(L);
  if (key !== liveLogged) { liveLogged = key; log("theme", S.theme, key); }
}
function themechanged() { mgraphics.redraw(); }
// other messages from airwin~ (category, pvalue, ...) are not needed for drawing: ignore them quietly
function anything() {}

// ---------------------------------------------------------------- controls are Live objects
// Positions are recorded in device pixels (S.offX: offset of the current view).
const _readout = readout;
knob = function (c, th, x, y, w, p, v, big) {
  hint(x, y, w, big ? 58 : 50, p.name, p.info || "");
  rec.push({ k: p && p._i !== undefined ? "dial" : "gain", i: p ? p._i : -1, name: p ? p.name : "", x: x + S.offX, y: y - HEAD_H, w, big: !!big });
};
readout = function (c, th, x, y, w, p, v) {
  _readout(c, th, x, y, w, p, v);           // the display draws the number; an invisible dial takes the drag
  rec.push({ k: "readout", i: p._i, name: p.name, x: x + S.offX, y: y - HEAD_H - 11, w });
};
menu = function (c, th, x, y, w) { rec.push({ k: "menu", x: x + S.offX, y: y - HEAD_H, w }); };
arrows = function (c, th, x, y) { rec.push({ k: "arrows", x: x + S.offX, y: y - HEAD_H }); };
viewTabs = function (c, th, x, y, labels, active) {
  // the device's live.tab "view" draws these; record the area it must cover
  let w = 0; c.font = `400 9.5px ${FONT}`;
  for (const l of labels) w += Math.ceil(c.measureText(l).width) + 14;
  rec.push({ k: "tab", x: x + S.offX, y: y - HEAD_H, w: w - 2, h: 15, labels });
  return [];
};
viewTabsV = function (c, th, x, y, w, labels, active) {
  rec.push({ k: "tab", x: x + S.offX, y: y - HEAD_H, w, h: labels.length * 15, labels });
};

function script() { const a = arrayfromargs(arguments); log("script", a.join(" ")); outlet(0, ["script"].concat(a)); }
function rect(id, x, y, w, h) { script("sendbox", id, "presentation_rect", Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }

// a dial under a readout is invisible (the display draws its number); elsewhere it looks normal
const DIAL_COLORS = ["dialcolor", "activedialcolor", "fgdialcolor", "activefgdialcolor", "needlecolor", "activeneedlecolor",
                     "bordercolor", "focusbordercolor", "panelcolor", "textcolor", "tricolor", "tribordercolor"];
const dialLook = {}, dialDefaults = {};
function setDialInvisible(i, inv) {
  if (dialLook[i] === inv) return;
  const o = PATCHER ? PATCHER.getnamed("dial" + i) : null;
  if (!o) return;
  if (!dialDefaults[i]) { dialDefaults[i] = {}; DIAL_COLORS.forEach(a => { try { dialDefaults[i][a] = o.getattr(a); } catch (e) {} }); }
  DIAL_COLORS.forEach(a => { try { o.setattr(a, inv ? [0, 0, 0, 0] : dialDefaults[i][a]); } catch (e) {} });
  dialLook[i] = inv;
}

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
      setDialInvisible(r.i, false);
      rect("name" + r.i, r.x, r.y, r.w, 13);
      rect("dial" + r.i, r.x + (r.w - dw) / 2, r.y + 12, dw, dh);
      rect("value" + r.i, r.x, r.y + 12 + dh, r.w, 13);
      ["name", "dial", "value"].forEach(p => { script("show", p + r.i); shown[p + r.i] = 1; });
    } else if (r.k === "readout") {
      setDialInvisible(r.i, true);
      rect("dial" + r.i, r.x, r.y, r.w, 28);
      script("show", "dial" + r.i); shown["dial" + r.i] = 1;
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
  for (let i = 0; i < 13; i++) ["name", "dial", "value"].forEach(p => { if (!shown[p + i]) script("hide", p + i); });
  if (tabs.length) { rect("view", tabs[0].x, tabs[0].y, tabs[0].w, tabs[0].h); script("show", "view"); }
  else script("hide", "view");
}

// ---------------------------------------------------------------- Info View
// Live shows a hovered object's annotation in its Info View. The display sets its own
// annotation to the hint under the mouse; dials get their effect's control name and text.
let hints = [], lastHint = "";
function onidle(x, y) {
  let best = null;
  const yy = y + HEAD_H;
  for (const h of hints) if (x >= h.x && x <= h.x + h.w && yy >= h.y && yy <= h.y + h.h && (!best || h.w * h.h <= best.w * best.h)) best = h;
  const key = best ? best.title + "|" + best.text : "";
  if (key === lastHint) return;               // hints are rebuilt on every paint: compare text
  lastHint = key;
  log("hover", best ? best.title : "-");
  try {
    BOX.setattr("annotation_name", best ? best.title : "Airwindows " + CATEGORY);
    BOX.setattr("annotation", best ? best.text : (OPT.why || ""));
  } catch (e) {}
}
function onidleout() { lastHint = ""; }
let annotated = "";
function annotateDials() {
  const key = (S.effName || "") + params.map(p => p.name).join("|");
  if (key === annotated || !S.effName) return;
  annotated = key;
  params.forEach((p, i) => {
    script("sendbox", "dial" + i, "annotation_name", p.name);
    script("sendbox", "dial" + i, "annotation", `${p.name}: a control of ${S.effName}. ${S.effWhat || ""}`);
  });
}

// the device's "view" tab (live.tab) reports its index here
function view(i) { st.view = i; mgraphics.redraw(); }

// ---------------------------------------------------------------- paint
function paint() {
  const c = makeCanvas(mgraphics, { font: "Ableton Sans Medium", boldFont: "Ableton Sans Bold" });
  c.translate(0, -HEAD_H);
  rec = [];
  liveTheme();
  const th = tok();
  try {
    S.hints = [];
    c.fillStyle = th.gutter; c.fillRect(0, HEAD_H, OPT.width, DEVICE_H);   // gutters (RUBRIC 1.1)
    OPT.draw(c, th, st, params, params.map(() => 0.5));
    hints = S.hints;
  } catch (e) {
    post("aw_ui draw error: " + e + "\n");
    log("draw error", e, e && e.stack);
  }
  publishLayout();
  annotateDials();
}
