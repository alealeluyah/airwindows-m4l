#!/usr/bin/env python3
"""Generate one Max for Live audio effect (.amxd) per Airwindows category.

Input:  registry JSON from `awtool dump`
Output: devices/Airwindows <Category>.amxd

Each device holds [plugin~] -> [airwin~] -> [plugout~], a live.menu with the
category's effects, NSLOT live.dials, and a v8.codebox that relabels the dials
for the selected effect. The external airwin~ must be on Max's search path
(install this repository as a Max package).
"""
import argparse
import json
import struct
from pathlib import Path

NSLOT = 13          # most parameters any Airwindows effect has (checked against the registry)
COLS = 7
SLOT_W = 56
ROW_H = 80
LEFT_W = 160
DEVICE_H = 169
LOG_PATH = ""       # set with --log to make the device JavaScript write a debug log

CODE = r"""
inlets = 3;
outlets = 2;
setinletassist(0, "airwin~ info");
setinletassist(1, "effect index from live.menu");
setinletassist(2, "bang from live.thisdevice");
setoutletassist(0, "to airwin~");
setoutletassist(1, "to thispatcher");

const NAMES = __NAMES__;
const NSLOT = __NSLOT__;
const LOG = __LOG__;
let ready = false;

function log(...a) {
    if (!LOG) return;
    const f = new File(LOG, "write");
    if (!f.isopen) return;
    f.position = f.eof;
    f.writeline(a.join(" "));
    f.close();
}
const PATCHER = this.patcher;
log("compiled", NAMES.length);

function script(...a) { outlet(1, "script", ...a); }

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
    const menu = PATCHER ? PATCHER.getnamed("Effect") : null;
    const idx = menu ? Math.round(menu.getvalueof()) : 0;
    const name = NAMES[idx] !== undefined ? NAMES[idx] : NAMES[0];
    log("refresh", idx, name);
    outlet(0, "algokeep", name);
}

function bang() {
    if (inlet !== 2) return;
    ready = true;
    refresh();
}

function loadbang() { refresh(); }

// also run once shortly after compiling, for hosts where neither signal arrives
const startup = new Task(refresh);
startup.schedule(100);

function nparams(n) {
    log("nparams", n);
    for (let k = 0; k < NSLOT; k++) {
        const how = k < n ? "show" : "hide";
        script(how, "dial" + k);
        script(how, "name" + k);
        script(how, "value" + k);
    }
}

function pname(i, s) { script("sendbox", "name" + i, "set", s); }
function display(i, s) {
    // Airwindows prints plain numbers with four decimals; two read better under a dial
    const m = String(s).match(/^(-?\d+\.\d+)(.*)/);
    if (m) s = parseFloat(m[1]).toFixed(2) + m[2];
    script("sendbox", "value" + i, "set", s);
}
function pvalue(i, v) { script("sendbox", "dial" + i, "set", v); }
function what(s) { script("sendbox", "what", "set", s); }
function algo(s) {}
function category(s) {}
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


def comment(p, varname, prect, text="", just=1, size=9.0):
    return p.box("live.comment", [prect[0] + 700, prect[1] + 300, prect[2], prect[3]],
                 varname=varname, text=text, textjustification=just, fontsize=size,
                 numinlets=1, numoutlets=0, presentation=1, presentation_rect=prect)


def build(category, names):
    p = Patch()
    plugin = p.newobj("plugin~", [20, 20, 60, 22], 2, 2, ["signal", "signal"])
    aw = p.newobj("airwin~", [20, 300, 80, 22], 2, 3, ["signal", "signal", ""])
    plugout = p.newobj("plugout~", [20, 400, 60, 22], 2, 0, [])
    p.line(plugin, 0, aw, 0)
    p.line(plugin, 1, aw, 1)
    p.line(aw, 0, plugout, 0)
    p.line(aw, 1, plugout, 1)

    menu = p.box("live.menu", [200, 20, 140, 15], varname="Effect", numinlets=1, numoutlets=3,
                 outlettype=["", "", "float"], parameter_enable=1, presentation=1,
                 presentation_rect=[8, 8, LEFT_W - 16, 15],
                 saved_attribute_attributes={"valueof": {
                     "parameter_enum": names, "parameter_longname": "Effect",
                     "parameter_shortname": "Effect", "parameter_type": 2,
                     "parameter_mmax": len(names) - 1, "parameter_initial": [0],
                     "parameter_initial_enable": 1, "parameter_unitstyle": 9,
                     "parameter_info": "Airwindows effect"}})
    p.params[menu] = ["Effect", "Effect", 0]
    comment(p, "what", [8, 30, LEFT_W - 16, DEVICE_H - 38], just=0, size=9.0)

    thisdev = p.newobj("live.thisdevice", [400, 20, 90, 22], 1, 3, ["bang", "int", "int"])
    code = (CODE.replace("__NAMES__", json.dumps(names)).replace("__NSLOT__", str(NSLOT))
            .replace("__LOG__", json.dumps(LOG_PATH)))
    ctrl = p.box("v8.codebox", [200, 120, 400, 140], code=code, filename="none",
                 numinlets=3, numoutlets=2, outlettype=["", ""],
                 saved_object_attributes={"parameter_enable": 0})
    thispatcher = p.newobj("thispatcher", [200, 280, 70, 22], 1, 2, ["", ""],
                           save=["#N", "thispatcher", ";", "#Q", "end", ";"])
    p.line(menu, 0, ctrl, 1)
    p.line(thisdev, 0, ctrl, 2)
    p.line(aw, 2, ctrl, 0)
    p.line(ctrl, 0, aw, 0)
    p.line(ctrl, 1, thispatcher, 0)

    for k in range(NSLOT):
        col, row = k % COLS, k // COLS
        x0, y0 = LEFT_W + col * SLOT_W, 6 + row * ROW_H
        comment(p, f"name{k}", [x0, y0, SLOT_W - 2, 14], text=f"P{k + 1}")
        long = f"Param {k + 1}"
        dial = p.box("live.dial", [620 + k * 50, 20, 41, 48], varname=f"dial{k}",
                     numinlets=1, numoutlets=2, outlettype=["", "float"], parameter_enable=1,
                     showname=0, shownumber=0, presentation=1,
                     presentation_rect=[x0 + (SLOT_W - 40) / 2, y0 + 15, 40, 36],
                     saved_attribute_attributes={"valueof": {
                         "parameter_longname": long, "parameter_shortname": f"P{k + 1}",
                         "parameter_type": 0, "parameter_mmin": 0.0, "parameter_mmax": 1.0,
                         "parameter_initial_enable": 0, "parameter_unitstyle": 1,
                         "parameter_modmode": 3}})
        p.params[dial] = [long, f"P{k + 1}", 0]
        comment(p, f"value{k}", [x0, y0 + 52, SLOT_W - 2, 14], text="")
        prep = p.newobj(f"prepend param {k}", [620 + k * 50, 90, 90, 22], 1, 1, [""])
        p.line(dial, 0, prep, 0)
        p.line(prep, 0, aw, 0)

    banks = {}
    order = ["Effect"] + [f"Param {k + 1}" for k in range(NSLOT)]
    for b in range(0, len(order), 8):
        chunk = order[b:b + 8]
        banks[str(b // 8)] = {"index": b // 8, "name": "", "parameters": chunk + ["-"] * (8 - len(chunk))}
    params = dict(p.params)
    params["parameterbanks"] = banks
    params["inherited_shortname"] = 1

    width = LEFT_W + COLS * SLOT_W + 4
    patcher = {
        "fileversion": 1,
        "appversion": {"major": 9, "minor": 1, "revision": 5, "architecture": "x64", "modernui": 1},
        "classnamespace": "box",
        "rect": [100.0, 100.0, 1400.0, 600.0],
        "openrect": [0.0, 0.0, float(width), float(DEVICE_H)],
        "openinpresentation": 1,
        "default_fontsize": 10.0,
        "default_fontname": "Arial Bold",
        "gridsize": [8.0, 8.0],
        "devicewidth": float(width),
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
    a = ap.parse_args()
    global LOG_PATH
    LOG_PATH = a.log

    reg = json.load(open(a.registry))
    assert max(len(e["params"]) for e in reg) <= NSLOT, "an effect has more parameters than slots"
    cats = {}
    for e in reg:
        cats.setdefault(e["category"], []).append(e["name"])
    out = Path(a.outdir)
    out.mkdir(parents=True, exist_ok=True)
    for cat, names in sorted(cats.items()):
        if a.only and cat != a.only:
            continue
        names = sorted(names, key=str.lower)
        path = out / f"Airwindows {cat}.amxd"
        path.write_bytes(amxd_bytes(build(cat, names)))
        print(f"{path.name}: {len(names)} effects")


if __name__ == "__main__":
    main()
