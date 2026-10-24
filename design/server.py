#!/usr/bin/env python3
"""Local design-review server for the Airwindows M4L device UI.

    python3 design/server.py [port]      ->  http://localhost:8765

Serves this folder and stores approvals in decisions.json:
    GET  /api/decisions
    POST /api/decision   {"category": "...", "option": "A", "notes": "..."}
"""
import json
import sys
import threading
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DECISIONS = ROOT / "decisions.json"
LOCK = threading.Lock()


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

    def do_GET(self):
        if self.path == "/api/decisions":
            with LOCK:
                return self._json(200, load())
        return super().do_GET()

    def do_POST(self):
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
    print(f"design review: http://localhost:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
