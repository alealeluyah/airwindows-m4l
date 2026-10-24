// mgcanvas.js : a small HTML-canvas 2D context on top of Max's mgraphics.
//
// The review page draws device UIs with the canvas API. In Max the same code runs in a
// v8ui, through this adapter, so what was approved in the browser is what the device shows.
//
// mgraphics has no clip, so the adapter flattens every path to polylines (arcs and rounded
// rectangles become short segments), applies its own transform, clips to the current clip
// rectangle (Sutherland–Hodgman for fills, Liang–Barsky for strokes), then emits plain
// move_to / line_to. Text is dropped when its anchor is outside the clip rectangle.
//
//   const c = makeCanvas(mgraphics, { font: "Ableton Sans Medium", boldFont: "Ableton Sans Bold" });
//   c.fillStyle = "#ffad56"; c.fillRect(0, 0, 10, 10);

function makeCanvas(mg, opts) {
  opts = opts || {};
  const FONT_REG = opts.font || "Ableton Sans Medium";
  const FONT_BOLD = opts.boldFont || "Ableton Sans Bold";

  // ---------------------------------------------------------------- colour
  const named = { black: [0, 0, 0, 1], white: [1, 1, 1, 1], transparent: [0, 0, 0, 0] };
  const cache = {};
  function parseColor(s) {
    if (s && typeof s === "object" && s._stops) s = s._stops.length ? s._stops[0][1] : "#000"; // gradient: first stop
    s = String(s || "#000").trim();
    if (cache[s]) return cache[s];
    let c = named[s];
    if (!c && s[0] === "#") {
      let h = s.slice(1);
      if (h.length === 3 || h.length === 4) h = h.split("").map(x => x + x).join("");
      const n = i => parseInt(h.slice(i, i + 2), 16) / 255;
      c = [n(0), n(2), n(4), h.length >= 8 ? n(6) : 1];
    }
    if (!c) {
      const m = s.match(/rgba?\(([^)]+)\)/);
      if (m) {
        const p = m[1].split(/[ ,/]+/).filter(Boolean).map(parseFloat);
        c = [p[0] / 255, p[1] / 255, p[2] / 255, p.length > 3 ? p[3] : 1];
      }
    }
    return (cache[s] = c || [0, 0, 0, 1]);
  }

  // ---------------------------------------------------------------- transform
  let M = [1, 0, 0, 1, 0, 0]; // a b c d e f
  const tx = (x, y) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
  const scaleOf = () => Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2])) || 1;
  function mul(a, b, c, d, e, f) {
    M = [M[0] * a + M[2] * b, M[1] * a + M[3] * b, M[0] * c + M[2] * d, M[1] * c + M[3] * d,
         M[0] * e + M[2] * f + M[4], M[1] * e + M[3] * f + M[5]];
  }

  // ---------------------------------------------------------------- path (device coords)
  let subs = [];   // [{pts: [[x,y],...], closed}]
  let cur = null;
  const startAt = (x, y) => { cur = { pts: [tx(x, y)], closed: false }; subs.push(cur); };
  const add = (x, y) => { if (!cur) startAt(x, y); else cur.pts.push(tx(x, y)); };

  function arcPts(x, y, r, a0, a1, ccw) {
    let sweep = a1 - a0;
    if (!ccw && sweep < 0) sweep = (sweep % (2 * Math.PI)) + 2 * Math.PI;
    if (ccw && sweep > 0) sweep = (sweep % (2 * Math.PI)) - 2 * Math.PI;
    if (Math.abs(a1 - a0) >= 2 * Math.PI) sweep = ccw ? -2 * Math.PI : 2 * Math.PI;
    const n = Math.max(4, Math.ceil(Math.abs(sweep) * Math.max(r * scaleOf(), 1) / 3));
    for (let i = 0; i <= n; i++) {
      const a = a0 + sweep * i / n;
      add(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
  }

  // ---------------------------------------------------------------- clipping
  let clipR = null; // [x0, y0, x1, y1] device coords
  const stack = [];

  function clipPoly(pts) {
    if (!clipR) return pts;
    const [x0, y0, x1, y1] = clipR;
    const edges = [
      [p => p[0] >= x0, (a, b) => [x0, a[1] + (b[1] - a[1]) * (x0 - a[0]) / (b[0] - a[0])]],
      [p => p[0] <= x1, (a, b) => [x1, a[1] + (b[1] - a[1]) * (x1 - a[0]) / (b[0] - a[0])]],
      [p => p[1] >= y0, (a, b) => [a[0] + (b[0] - a[0]) * (y0 - a[1]) / (b[1] - a[1]), y0]],
      [p => p[1] <= y1, (a, b) => [a[0] + (b[0] - a[0]) * (y1 - a[1]) / (b[1] - a[1]), y1]],
    ];
    let out = pts;
    for (const [inside, cut] of edges) {
      const inp = out; out = [];
      for (let i = 0; i < inp.length; i++) {
        const a = inp[(i + inp.length - 1) % inp.length], b = inp[i];
        if (inside(b)) { if (!inside(a)) out.push(cut(a, b)); out.push(b); }
        else if (inside(a)) out.push(cut(a, b));
      }
      if (!out.length) break;
    }
    return out;
  }
  function clipSeg(a, b) {
    if (!clipR) return [a, b];
    const [x0, y0, x1, y1] = clipR;
    let t0 = 0, t1 = 1;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    for (const [p, q] of [[-dx, a[0] - x0], [dx, x1 - a[0]], [-dy, a[1] - y0], [dy, y1 - a[1]]]) {
      if (p === 0) { if (q < 0) return null; continue; }
      const r = q / p;
      if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
      else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
    return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]];
  }

  // ---------------------------------------------------------------- emit
  let alpha = 1;
  function source(style) {
    const c = parseColor(style);
    mg.set_source_rgba(c[0], c[1], c[2], c[3] * alpha);
    return c[3] * alpha > 0;
  }
  function emitFill() {
    mg.new_path();
    let any = false;
    for (const s of subs) {
      if (s.pts.length < 3) continue;
      const p = clipPoly(s.pts);
      if (p.length < 3) continue;
      mg.move_to(p[0][0], p[0][1]);
      for (let i = 1; i < p.length; i++) mg.line_to(p[i][0], p[i][1]);
      mg.close_path();
      any = true;
    }
    if (any) mg.fill(); else mg.new_path();
  }
  function emitStroke(lineWidth) {
    mg.new_path();
    mg.set_line_width(Math.max(0.1, lineWidth * scaleOf()));
    let any = false;
    for (const s of subs) {
      const pts = s.closed && s.pts.length > 2 ? s.pts.concat([s.pts[0]]) : s.pts;
      let open = false, last = null;
      for (let i = 1; i < pts.length; i++) {
        const seg = clipSeg(pts[i - 1], pts[i]);
        if (!seg) { open = false; continue; }
        const [a, b] = seg;
        if (!open || !last || Math.abs(last[0] - a[0]) > 1e-6 || Math.abs(last[1] - a[1]) > 1e-6) mg.move_to(a[0], a[1]);
        mg.line_to(b[0], b[1]);
        last = b; open = true; any = true;
      }
    }
    if (any) mg.stroke(); else mg.new_path();
  }

  // ---------------------------------------------------------------- font
  let fontKey = "";
  function applyFont(font) {
    if (font === fontKey) return;
    fontKey = font;
    const m = String(font).match(/(\d+)?\s*([\d.]+)px/);
    const bold = /\b(700|bold)\b/.test(font);
    mg.select_font_face(bold ? FONT_BOLD : FONT_REG);
    mg.set_font_size((m ? parseFloat(m[2]) : 10) * scaleOf());
  }

  // ---------------------------------------------------------------- the context
  const ctx = {
    fillStyle: "#000", strokeStyle: "#000", lineWidth: 1, lineCap: "butt", lineJoin: "miter",
    font: "10px sans-serif", textAlign: "start", textBaseline: "alphabetic",
    get globalAlpha() { return alpha; }, set globalAlpha(v) { alpha = Math.max(0, Math.min(1, +v)); },

    save() { stack.push({ M: M.slice(), clipR: clipR && clipR.slice(), alpha, fillStyle: ctx.fillStyle, strokeStyle: ctx.strokeStyle,
                          lineWidth: ctx.lineWidth, font: ctx.font, textAlign: ctx.textAlign, textBaseline: ctx.textBaseline, lineCap: ctx.lineCap }); },
    restore() {
      const s = stack.pop(); if (!s) return;
      M = s.M; clipR = s.clipR; alpha = s.alpha;
      Object.assign(ctx, { fillStyle: s.fillStyle, strokeStyle: s.strokeStyle, lineWidth: s.lineWidth, font: s.font, textAlign: s.textAlign, textBaseline: s.textBaseline, lineCap: s.lineCap });
    },
    setTransform(a, b, c, d, e, f) { M = [a, b, c, d, e, f]; },
    resetTransform() { M = [1, 0, 0, 1, 0, 0]; },
    translate(x, y) { mul(1, 0, 0, 1, x, y); },
    scale(x, y) { mul(x, 0, 0, y, 0, 0); },
    rotate(a) { const c = Math.cos(a), s = Math.sin(a); mul(c, s, -s, c, 0, 0); },

    beginPath() { subs = []; cur = null; },
    moveTo(x, y) { startAt(x, y); },
    lineTo(x, y) { add(x, y); },
    closePath() { if (cur) { cur.closed = true; const p = cur.pts[0]; cur = { pts: [p], closed: false }; subs.push(cur); } },
    rect(x, y, w, h) { startAt(x, y); add(x + w, y); add(x + w, y + h); add(x, y + h); cur.closed = true; cur = null; },
    roundRect(x, y, w, h, r) {
      r = Math.max(0, Math.min(Array.isArray(r) ? r[0] : (r || 0), Math.abs(w) / 2, Math.abs(h) / 2));
      if (!r) return ctx.rect(x, y, w, h);
      cur = null;
      arcPts(x + w - r, y + r, r, -Math.PI / 2, 0);
      arcPts(x + w - r, y + h - r, r, 0, Math.PI / 2);
      arcPts(x + r, y + h - r, r, Math.PI / 2, Math.PI);
      arcPts(x + r, y + r, r, Math.PI, Math.PI * 1.5);
      cur.closed = true; cur = null;
    },
    arc(x, y, r, a0, a1, ccw) { arcPts(x, y, r, a0, a1, !!ccw); },
    ellipse(x, y, rx, ry, rot, a0, a1, ccw) { ctx.save(); ctx.translate(x, y); ctx.rotate(rot || 0); ctx.scale(rx, ry); arcPts(0, 0, 1, a0, a1, !!ccw); ctx.restore(); },
    quadraticCurveTo(cx, cy, x, y) {
      const p0 = cur ? cur.pts[cur.pts.length - 1] : tx(cx, cy);
      // p0 is in device coords; sample the curve in user coords via inverse-free approach:
      const inv = invPoint(p0[0], p0[1]);
      for (let i = 1; i <= 12; i++) { const t = i / 12, u = 1 - t; add(u * u * inv[0] + 2 * u * t * cx + t * t * x, u * u * inv[1] + 2 * u * t * cy + t * t * y); }
    },
    bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
      const p0 = cur ? cur.pts[cur.pts.length - 1] : tx(c1x, c1y);
      const inv = invPoint(p0[0], p0[1]);
      for (let i = 1; i <= 16; i++) {
        const t = i / 16, u = 1 - t;
        add(u * u * u * inv[0] + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x,
            u * u * u * inv[1] + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y);
      }
    },
    fill() { if (source(ctx.fillStyle)) emitFill(); },
    stroke() { if (source(ctx.strokeStyle)) emitStroke(ctx.lineWidth); },
    clip() {
      // only rectangles are needed by the designs: clip to the bounding box of the path
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const s of subs) for (const [x, y] of s.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      if (!Number.isFinite(x0)) return;
      clipR = clipR ? [Math.max(clipR[0], x0), Math.max(clipR[1], y0), Math.min(clipR[2], x1), Math.min(clipR[3], y1)] : [x0, y0, x1, y1];
    },
    fillRect(x, y, w, h) { const keep = subs; ctx.beginPath(); ctx.rect(x, y, w, h); ctx.fill(); subs = keep; cur = null; },
    strokeRect(x, y, w, h) { const keep = subs; ctx.beginPath(); ctx.rect(x, y, w, h); ctx.stroke(); subs = keep; cur = null; },
    clearRect() {},
    setLineDash() {}, getLineDash() { return []; },
    createLinearGradient() { return { _stops: [], addColorStop(o, c) { this._stops.push([o, c]); } }; },
    createRadialGradient() { return { _stops: [], addColorStop(o, c) { this._stops.push([o, c]); } }; },

    measureText(s) {
      applyFont(ctx.font);
      const m = mg.text_measure(String(s));
      return { width: m[0] / scaleOf() };
    },
    fillText(s, x, y) {
      s = String(s);
      if (!source(ctx.fillStyle)) return;
      applyFont(ctx.font);
      const m = mg.text_measure(s), sc = scaleOf();
      let [dx, dy] = tx(x, y);
      const a = ctx.textAlign;
      if (a === "center") dx -= m[0] / 2; else if (a === "right" || a === "end") dx -= m[0];
      // mgraphics show_text draws from the baseline; approximate other baselines
      const size = m[1];
      const b = ctx.textBaseline;
      if (b === "middle") dy += size * 0.35; else if (b === "top" || b === "hanging") dy += size * 0.75; else if (b === "bottom") dy -= size * 0.2;
      if (clipR && (dx + m[0] < clipR[0] || dx > clipR[2] || dy < clipR[1] || dy - size * 0.7 > clipR[3])) return;
      mg.move_to(dx, dy);
      mg.show_text(s);
      mg.new_path();
      void sc;
    },
    strokeText(s, x, y) { const f = ctx.fillStyle; ctx.fillStyle = ctx.strokeStyle; ctx.fillText(s, x, y); ctx.fillStyle = f; },
  };

  function invPoint(x, y) {
    const det = M[0] * M[3] - M[1] * M[2] || 1;
    const X = x - M[4], Y = y - M[5];
    return [(M[3] * X - M[2] * Y) / det, (-M[1] * X + M[0] * Y) / det];
  }

  return ctx;
}

if (typeof module !== "undefined") module.exports = { makeCanvas };
