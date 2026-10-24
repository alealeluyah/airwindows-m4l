#!/usr/bin/env python3
"""Generate one Max for Live audio effect (.amxd) per Airwindows category.

Input:  registry JSON from `awtool dump`
Output: devices/Airwindows <Category>.amxd

Each device holds [plugin~] -> [airwin~] -> [plugout~], a live.menu with the
category's effects, NSLOT live.dials, and a v8.codebox that relabels and lays out
the dials for the selected effect. The external airwin~ must be on Max's search
path (install this repository as a Max package).

The look follows Ableton's own Max for Live devices (e.g. Color Limiter):
52x39 live.dials with name and value text in Ableton Sans Medium 9.5 above and
below, and a rounded translucent panel for the selector section.
"""
import argparse
import json
import struct
from pathlib import Path

NSLOT = 13          # most parameters any Airwindows effect has (checked against the registry)
DEVICE_H = 169      # fixed device height in Live

# left panel: effect chooser, arrows, description
PANEL_X, PANEL_Y, PANEL_W, PANEL_H = 4.0, 4.0, 150.0, 161.0
# right area: dial grid
GRID_X = PANEL_X + PANEL_W + 6
COLS = 7
SLOT_W = 52.0
GRID_W = COLS * SLOT_W
DEVICE_W = GRID_X + GRID_W + 4

FONT = "Ableton Sans Medium"
FONT_SIZE = 9.5
DIM = [1.0, 1.0, 1.0, 0.46]   # secondary text colour Ableton uses on dark panels

LOG_PATH = ""       # set with --log to make the device JavaScript write a debug log
TEST_SIGNAL = False # --test-signal: built-in noise bursts, silent output (bench test in Max)
UI = {}             # per category: chosen design option, width, view tabs (javascript/aw_ui_manifest.json)

CODE = r"""
inlets = 4;
outlets = 2;
setinletassist(0, "airwin~ info");
setinletassist(1, "effect index from live.menu");
setinletassist(2, "bang from live.thisdevice");
setinletassist(3, "left/right from live.arrows");
setoutletassist(0, "to airwin~");
setoutletassist(1, "to thispatcher");

const NAMES = __NAMES__;
const NSLOT = __NSLOT__;
const G = __GEOMETRY__;
const LOG = __LOG__;
const PATCHER = this.patcher;
let ready = false;

function log(...a) {
    if (!LOG) return;
    const f = new File(LOG, "write");
    if (!f.isopen) return;
    f.position = f.eof;
    f.writeline(a.join(" "));
    f.close();
}

function script(...a) { outlet(1, "script", ...a); }

function menuIndex() {
    const menu = PATCHER ? PATCHER.getnamed("Effect") : null;
    const idx = menu ? Math.round(menu.getvalueof()) : 0;
    return NAMES[idx] !== undefined ? idx : 0;
}

function msg_int(i) {
    if (inlet !== 1) return;
    const name = NAMES[i];
    if (name === undefined) return;
    // while Live restores a set, keep the parameter values it is about to restore
    outlet(0, ready ? "algo" : "algokeep", name);
}

// The menu may send its value before this code is compiled, so on load read the
// menu directly and (re)load that effect, keeping any values Live restored.
function refresh() {
    const idx = menuIndex();
    log("refresh", idx, NAMES[idx]);
    outlet(0, "algokeep", NAMES[idx]);
    // From now on a menu change is the user's (or a restore, which Live does menu-first
    // because of parameter_order), so it loads the effect's defaults.
    ready = true;
}

function bang() {
    if (inlet !== 2) return;
    ready = true;
    refresh();
}

let started = false;
function startOnce() {
    if (started) return;
    started = true;
    refresh();
}

function loadbang() { startOnce(); }

function step(d) {
    ready = true;
    const n = NAMES.length;
    script("sendbox", "Effect", (menuIndex() + d + n) % n);
}

function left() { if (inlet === 3) step(-1); }
function right() { if (inlet === 3) step(1); }

// The display (v8ui) lays out the controls; nothing to do here.
function nparams(n) { log("nparams", n); }

function pname(i, s) { script("sendbox", "name" + i, "set", s); }

function display(i, s) {
    // Airwindows prints plain numbers with four decimals; two read better under a dial
    const m = String(s).match(/^(-?\d+\.\d+)(.*)/);
    if (m) s = parseFloat(m[1]).toFixed(2) + m[2];
    script("sendbox", "value" + i, "set", s);
}

function pvalue(i, v) { script("sendbox", "dial" + i, "set", v); }
// as separate words, so textedit does not show the symbol's quotes
function what(s) { script("sendbox", "what", "set", ...String(s).split(" ")); }
function algo(s) {}
function category(s) {}

// also run once shortly after compiling, for hosts where neither signal arrives
const startup = new Task(startOnce);
startup.schedule(100);
"""


class Patch:
    def __init__(self):
        self.boxes = []
        self.lines = []
        self.params = {}
        self.n = 0

    def box(self, maxclass, rect, **kw):
        self.n += 1
        oid = f"obj-{self.n}"
        b = {"id": oid, "maxclass": maxclass, "patching_rect": rect}
        b.update(kw)
        self.boxes.append({"box": b})
        return oid

    def newobj(self, text, rect, ninl, nout, outtypes, **kw):
        return self.box("newobj", rect, text=text, numinlets=ninl, numoutlets=nout,
                        outlettype=outtypes, **kw)

    def line(self, src, so, dst, di):
        self.lines.append({"patchline": {"source": [src, so], "destination": [dst, di]}})


def label(p, varname, prect, text="", just=1, color=None):
    kw = {}
    if color:
        kw["textcolor"] = color
    return p.box("comment", [prect[0] + 700, prect[1] + 400, prect[2], prect[3]],
                 varname=varname, text=text, textjustification=just, fontname=FONT,
                 fontsize=FONT_SIZE, numinlets=1, numoutlets=0, presentation=1,
                 presentation_rect=prect, style="", **kw)


def build(category, names):
    p = Patch()
    aw = p.newobj("airwin~", [20, 300, 80, 22], 2, 3, ["signal", "signal", ""])
    if TEST_SIGNAL:
        # bench test in Max: noise bursts at 4 Hz in, silent output, audio on at load
        ph = p.newobj("phasor~ 4", [20, 20, 70, 22], 2, 1, ["signal"])
        inv = p.newobj("!-~ 1", [20, 50, 50, 22], 2, 1, ["signal"])
        sq = p.newobj("*~", [20, 80, 40, 22], 2, 1, ["signal"])
        q4 = p.newobj("*~", [20, 110, 40, 22], 2, 1, ["signal"])
        nz = p.newobj("noise~", [100, 80, 50, 22], 1, 1, ["signal"])
        amp = p.newobj("*~", [20, 140, 40, 22], 2, 1, ["signal"])
        lvl = p.newobj("*~ 0.9", [20, 170, 50, 22], 2, 1, ["signal"])
        for a_, b_, i_ in [(ph, inv, 0), (inv, sq, 0), (inv, sq, 1), (sq, q4, 0), (sq, q4, 1), (q4, amp, 0), (nz, amp, 1), (amp, lvl, 0), (lvl, aw, 0), (lvl, aw, 1)]:
            p.line(a_, 0, b_, i_)
        mute = p.newobj("*~ 0.", [20, 360, 40, 22], 2, 1, ["signal"])
        dac = p.newobj("dac~", [20, 400, 40, 22], 2, 0, [])
        p.line(aw, 0, mute, 0)
        p.line(mute, 0, dac, 0)
        on = p.box("message", [100, 20, 70, 22], text="; dsp start", numinlets=2, numoutlets=1, outlettype=[""])
        lb0 = p.newobj("loadbang", [100, 0, 60, 22], 1, 1, ["bang"])
        p.line(lb0, 0, on, 0)
    else:
        plugin = p.newobj("plugin~", [20, 20, 60, 22], 2, 2, ["signal", "signal"])
        plugout = p.newobj("plugout~", [20, 400, 60, 22], 2, 0, [])
        p.line(plugin, 0, aw, 0)
        p.line(plugin, 1, aw, 1)
        p.line(aw, 0, plugout, 0)
        p.line(aw, 1, plugout, 1)

    ui = UI.get(category, {"width": 560, "tabs": []})
    width = float(ui["width"])
    # the display, first so it sits behind every control; it places the controls itself
    display = p.box("v8ui", [700, 200, width, DEVICE_H], varname="display",
                    filename=f"aw_ui_{category}.js", numinlets=1, numoutlets=1,
                    outlettype=[""], ignoreclick=1, border=0, parameter_enable=0,
                    presentation=1, presentation_rect=[0.0, 0.0, width, float(DEVICE_H)])
    menu = p.box("live.menu", [200, 20, 140, 15], varname="Effect", numinlets=1, numoutlets=3,
                 outlettype=["", "", "float"], parameter_enable=1, presentation=1,
                 presentation_rect=[PANEL_X + 6, PANEL_Y + 20, PANEL_W - 12, 15],
                 saved_attribute_attributes={"valueof": {
                     "parameter_enum": names, "parameter_longname": "Effect",
                     "parameter_shortname": "Effect", "parameter_type": 2,
                     "parameter_mmax": len(names) - 1, "parameter_initial": [0],
                     "parameter_initial_enable": 1, "parameter_unitstyle": 9,
                     "parameter_order": 0, "parameter_info": "Airwindows effect"}})
    # Live recalls lower parameter_order first: the effect, then the dial values
    p.params[menu] = ["Effect", "Effect", 0]
    arrows = p.box("live.arrows", [360, 20, 40, 15], varname="arrows", numinlets=1,
                   numoutlets=1, outlettype=[""], leftarrow=1, rightarrow=1, uparrow=0,
                   downarrow=0, presentation=1,
                   presentation_rect=[PANEL_X + PANEL_W - 46, PANEL_Y + 3, 40, 14])
    # a read-only textedit always word-wraps inside its rectangle (live.comment only
    # sometimes re-wraps after "set")
    prect = [PANEL_X + 6, PANEL_Y + 42, PANEL_W - 12, PANEL_H - 46]
    p.box("textedit", [prect[0] + 700, prect[1] + 400, prect[2], prect[3]], varname="what",
          text="", readonly=1, border=0.0, bgcolor=[0.0, 0.0, 0.0, 0.0], textcolor=DIM,
          fontname=FONT, fontsize=FONT_SIZE, wordwrap=1, ignoreclick=1, keymode=0,
          lines=0, numinlets=1, numoutlets=4, outlettype=["", "int", "", ""])


    thisdev = p.newobj("live.thisdevice", [400, 60, 90, 22], 1, 3, ["bang", "int", "int"])
    geometry = {"cols": COLS, "slotW": SLOT_W, "gridX": GRID_X, "gridW": GRID_W, "h": DEVICE_H,
                "nameH": 14, "dialH": 39, "valueH": 14, "rowGap": 6}
    code = (CODE.replace("__NAMES__", json.dumps(names)).replace("__NSLOT__", str(NSLOT))
            .replace("__GEOMETRY__", json.dumps(geometry)).replace("__LOG__", json.dumps(LOG_PATH)))
    ctrl = p.box("v8.codebox", [200, 120, 400, 140], code=code, filename="none",
                 numinlets=4, numoutlets=2, outlettype=["", ""],
                 saved_object_attributes={"parameter_enable": 0})
    thispatcher = p.newobj("thispatcher", [200, 280, 70, 22], 1, 2, ["", ""],
                           save=["#N", "thispatcher", ";", "#Q", "end", ";"])
    p.line(menu, 0, ctrl, 1)
    p.line(thisdev, 0, ctrl, 2)
    p.line(arrows, 0, ctrl, 3)
    p.line(aw, 2, ctrl, 0)
    p.line(ctrl, 0, aw, 0)
    p.line(ctrl, 1, thispatcher, 0)
    p.line(aw, 2, display, 0)
    p.line(display, 0, thispatcher, 0)

    # display data from airwin~ (about 30 per second), on load in Live and in Max
    meter = p.box("message", [520, 260, 60, 22], text="meter 1", numinlets=2, numoutlets=1, outlettype=[""])
    lb = p.newobj("loadbang", [520, 230, 60, 22], 1, 1, ["bang"])
    p.line(lb, 0, meter, 0)
    p.line(thisdev, 0, meter, 0)
    p.line(meter, 0, aw, 0)

    # Live theme: dark or light, from the control background colour
    colq = p.box("message", [600, 260, 100, 22], text="live_control_bg", numinlets=2, numoutlets=1, outlettype=[""])
    colors = p.newobj("live.colors", [600, 290, 70, 22], 1, 2, ["", "bang"])
    p.line(lb, 0, colq, 0)
    p.line(thisdev, 0, colq, 0)
    p.line(colors, 1, colq, 0)
    p.line(colq, 0, colors, 0)
    p.line(colors, 0, display, 0)

    # Input / Output gain (dB), on every device
    for i, (vn, long, msg) in enumerate([("gainIn", "Input", "ingain"), ("gainOut", "Output", "outgain")]):
        g = p.box("live.dial", [1300 + i * 60, 20, 44, 48], varname=vn, numinlets=1, numoutlets=2,
                  outlettype=["", "float"], parameter_enable=1, showname=1, shownumber=1,
                  presentation=1, presentation_rect=[width - 66 + 0, 8 + i * 80, 44, 52],
                  saved_attribute_attributes={"valueof": {
                      "parameter_longname": long, "parameter_shortname": long, "parameter_type": 0,
                      "parameter_mmin": -36.0, "parameter_mmax": 36.0, "parameter_initial": [0.0],
                      "parameter_initial_enable": 1, "parameter_unitstyle": 4,
                      "parameter_modmode": 3, "parameter_order": 1}})
        p.params[g] = [long, long, 1]
        pre = p.newobj(f"prepend {msg}", [1300 + i * 60, 80, 80, 22], 1, 1, [""])
        p.line(g, 0, pre, 0)
        p.line(pre, 0, aw, 0)

    # view switch, for designs with more than one display view
    if ui["tabs"]:
        tab = p.box("live.tab", [1450, 20, 120, 15], varname="view", numinlets=1, numoutlets=3,
                    outlettype=["", "", "float"], parameter_enable=1, num_lines_patching=1,
                    num_lines_presentation=1, presentation=1, hidden=0,
                    presentation_rect=[width / 2, 4, 120, 15],
                    saved_attribute_attributes={"valueof": {
                        "parameter_enum": ui["tabs"], "parameter_longname": "View",
                        "parameter_shortname": "View", "parameter_type": 2,
                        "parameter_mmax": len(ui["tabs"]) - 1, "parameter_initial": [0],
                        "parameter_initial_enable": 1, "parameter_unitstyle": 9,
                        "parameter_order": 1}})
        p.params[tab] = ["View", "View", 1]
        pv = p.newobj("prepend view", [1450, 50, 80, 22], 1, 1, [""])
        p.line(tab, 0, pv, 0)
        p.line(pv, 0, display, 0)

    # dial slots start hidden in a default grid; the codebox places them per effect
    for k in range(NSLOT):
        x0, y0 = GRID_X + (k % COLS) * SLOT_W, 6 + (k // COLS) * 80
        label(p, f"name{k}", [x0, y0, SLOT_W, 14], text=f"P{k + 1}")
        long = f"Param {k + 1}"
        dial = p.box("live.dial", [620 + k * 56, 20, 52, 39], varname=f"dial{k}",
                     numinlets=1, numoutlets=2, outlettype=["", "float"], parameter_enable=1,
                     showname=0, shownumber=0, annotation_name=long, presentation=1,
                     presentation_rect=[x0, y0 + 14, SLOT_W, 39],
                     saved_attribute_attributes={"valueof": {
                         "parameter_longname": long, "parameter_shortname": f"P{k + 1}",
                         "parameter_type": 0, "parameter_mmin": 0.0, "parameter_mmax": 1.0,
                         "parameter_initial_enable": 0, "parameter_unitstyle": 1,
                         "parameter_linknames": 0, "parameter_modmode": 3,
                         "parameter_order": 1}})
        p.params[dial] = [long, f"P{k + 1}", 1]
        label(p, f"value{k}", [x0, y0 + 53, SLOT_W, 14])
        prep = p.newobj(f"prepend param {k}", [620 + k * 56, 90, 90, 22], 1, 1, [""])
        p.line(dial, 0, prep, 0)
        p.line(prep, 0, aw, 0)

    banks = {}
    order = ["Effect", "Input", "Output"] + [f"Param {k + 1}" for k in range(NSLOT)]
    for b in range(0, len(order), 8):
        chunk = order[b:b + 8]
        banks[str(b // 8)] = {"index": b // 8, "name": "", "parameters": chunk + ["-"] * (8 - len(chunk))}
    params = dict(p.params)
    params["parameterbanks"] = banks
    params["inherited_shortname"] = 1

    patcher = {
        "fileversion": 1,
        "appversion": {"major": 9, "minor": 1, "revision": 5, "architecture": "x64", "modernui": 1},
        "classnamespace": "box",
        "rect": [100.0, 100.0, 1500.0, 700.0],
        "openrect": [0.0, 0.0, width, float(DEVICE_H)],
        "openinpresentation": 1,
        "default_fontsize": 10.0,
        "default_fontname": "Arial Bold",
        "gridsize": [8.0, 8.0],
        "devicewidth": width,
        "description": f"Airwindows {category} effects",
        "tags": "airwindows",
        "latency": 0,
        "project": {"version": 1, "amxdtype": 1633771873, "readonly": 0, "devpathtype": 0,
                    "devpath": ".", "sortmode": 0, "viewmode": 0, "includepackages": 0,
                    "contents": {"patchers": {}}, "layout": {}, "searchpath": {},
                    "detailsvisible": 0, "hideprojectwindow": 1, "showdependencies": 1,
                    "autoorganize": 0, "autolocalize": 0},
        "boxes": p.boxes,
        "lines": p.lines,
        "parameters": params,
        "dependency_cache": [{"name": "airwin~.mxo", "type": "iLaX"}],
        "autosave": 0,
    }
    return {"patcher": patcher}


def amxd_bytes(patch):
    body = json.dumps(patch, indent="\t").encode("utf-8") + b"\n\x00"
    return (b"ampf" + struct.pack("<I", 4) + b"aaaa" + b"meta" + struct.pack("<I", 4)
            + b"\x00\x00\x00\x00" + b"ptch" + struct.pack("<I", len(body)) + body)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("registry")
    ap.add_argument("outdir")
    ap.add_argument("--only", help="generate a single category")
    ap.add_argument("--log", default="", help="debug log file for the device JavaScript")
    ap.add_argument("--test-signal", action="store_true", help="bench-test build: built-in input, silent output")
    ap.add_argument("--order", default=str(Path(__file__).with_name("effect_order.json")),
                    help="committed menu order per category; new effects are appended")
    a = ap.parse_args()
    global LOG_PATH, UI, TEST_SIGNAL
    LOG_PATH = a.log
    TEST_SIGNAL = a.test_signal
    man = Path(__file__).resolve().parent.parent / "javascript" / "aw_ui_manifest.json"
    if not man.exists():
        raise SystemExit("run tools/build_ui.py first (javascript/aw_ui_manifest.json is missing)")
    UI = json.loads(man.read_text())

    reg = json.load(open(a.registry))
    assert max(len(e["params"]) for e in reg) <= NSLOT, "an effect has more parameters than slots"
    cats = {}
    for e in reg:
        cats.setdefault(e["category"], []).append(e["name"])
    # Live saves the Effect menu as an index, so an effect must keep its position forever:
    # existing entries stay in place, new effects go at the end, removed ones are reported.
    order_path = Path(a.order)
    order = json.loads(order_path.read_text()) if order_path.exists() else {}
    for cat, names in cats.items():
        known = order.get(cat, [])
        gone = [n for n in known if n not in names]
        if gone:
            raise SystemExit(f"{cat}: effects missing from the registry: {gone}; "
                             "keep them in the menu or bump the device name")
        order[cat] = known + sorted((n for n in names if n not in known), key=str.lower)
    order_path.write_text(json.dumps(order, indent=1, sort_keys=True) + "\n")

    out = Path(a.outdir)
    out.mkdir(parents=True, exist_ok=True)
    for cat in sorted(cats):
        if a.only and cat != a.only:
            continue
        names = order[cat]
        path = out / f"Airwindows {cat}.amxd"
        path.write_bytes(amxd_bytes(build(cat, names)))
        print(f"{path.name}: {len(names)} effects")


if __name__ == "__main__":
    main()
