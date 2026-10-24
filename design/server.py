#!/usr/bin/env python3
"""Local design-review server for the Airwindows M4L device UI.

    python3 design/server.py [port]      ->  http://localhost:8765

Serves this folder and stores approvals in decisions.json:
    GET  /api/decisions
    POST /api/decision   {"category": "...", "option": "A", "notes": "..."}
    POST /api/build      run tools/rebuild_devices.sh (build + install the devices)
"""
import json
import os
import subprocess
import sys
import threading
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DECISIONS = ROOT / "decisions.json"
LOCK = threading.Lock()
# AW_TOKEN set: every request needs ?k=<token> once (then a cookie) — for tunnels/phones.
# AW_NO_BUILD set: /api/build is refused.
TOKEN = os.environ.get("AW_TOKEN", "")
NO_BUILD = bool(os.environ.get("AW_NO_BUILD"))


def load():
    return json.loads(DECISIONS.read_text()) if DECISIONS.exists() else {}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _json(self, code, obj):
        body = json.dumps(obj, indent=1).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self):
        if not TOKEN:
            return True
        if f"aw={TOKEN}" in (self.headers.get("Cookie") or ""):
            return True
        if f"k={TOKEN}" in self.path:
            self.send_response(302)
            self.send_header("Set-Cookie", f"aw={TOKEN}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800")
            self.send_header("Location", self.path.replace(f"k={TOKEN}", "").replace("?&", "?").rstrip("?&") or "/")
            self.end_headers()
            return False
        self.send_response(403)
        self.end_headers()
        return False

    def do_GET(self):
        if not self._authorized():
            return
        if self.path == "/api/decisions":
            with LOCK:
                return self._json(200, load())
        return super().do_GET()

    def do_POST(self):
        if not self._authorized():
            return
        if self.path == "/api/build" and NO_BUILD:
            return self._json(403, {"ok": False, "output": "Build is off on this connection; build from the Mac."})
        if self.path == "/api/build":
            with LOCK:
                r = subprocess.run([str(ROOT.parent / "tools" / "rebuild_devices.sh")],
                                   capture_output=True, text=True, timeout=600)
            return self._json(200 if r.returncode == 0 else 500,
                              {"ok": r.returncode == 0, "output": (r.stdout + r.stderr)[-4000:]})
        if self.path != "/api/decision":
            return self._json(404, {"error": "not found"})
        n = int(self.headers.get("Content-Length", 0))
        try:
            d = json.loads(self.rfile.read(n))
            cat = str(d["category"])
        except (ValueError, KeyError):
            return self._json(400, {"error": "need category"})
        with LOCK:
            all_ = load()
            entry = all_.get(cat, {})
            for k in ("option", "notes"):
                if k in d:
                    entry[k] = d[k]
            entry["updated"] = datetime.now().isoformat(timespec="seconds")
            all_[cat] = entry
            DECISIONS.write_text(json.dumps(all_, indent=1))
        return self._json(200, all_)

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    host = sys.argv[2] if len(sys.argv) > 2 else "127.0.0.1"   # "0.0.0.0" = reachable on the LAN
    print(f"design review: http://{host}:{port}")
    ThreadingHTTPServer((host, port), Handler).serve_forever()
