// Dynamics: design options. Helpers (knob, menu, meterV, …) come from app.js.
DESIGNS["Dynamics"] = {
    effect: "Pressure5",
    refs: [["GlueL12.png", "Glue Compressor"], ["CompressorL12.png", "Compressor"], ["LimiterL12.png", "Limiter"]],
    lead: "Visual cue: how much the effect is turning the level down (gain reduction), measured live from input vs output.",
    options: [
      { id: "A", name: "Glue", width: 470, step: stepDynamics,
        why: "Analog needle in a dark display, the first two controls large under it, the rest in side columns — like Glue Compressor.",
        bullets: ["Gain-reduction needle, 0–20 dB", "First two controls as large dials inside the display", "Effect menu and arrows top-left"],
        draw(c, th, st, ps, vals) {
          menu(c, th, 6, HEAD_H + 6, 110, "Pressure5"); arrows(c, th, 120, HEAD_H + 6);
          const left = ps.slice(2, 6), right = ps.slice(6);
          knobGrid(c, th, left, { x: 4, y: HEAD_H + 24, w: 146, h: DEVICE_H - 28 }, 2, vals);
          const dx = 156, dw = 170;
          grNeedle(c, th, dx, HEAD_H + 6, dw, 78, st.gr);
          rr(c, dx, HEAD_H + 86, dw, DEVICE_H - 92, 3, S.theme === "light" ? "#a5a5a5" : "#2c2c2c");
          ps.slice(0, 2).forEach((p, i) => knob(c, th, dx + 10 + i * 75, HEAD_H + 92, 75, p, vals[p._i], true));
          knobGrid(c, th, right, { x: 330, y: HEAD_H + 6, w: 104, h: DEVICE_H - 12 }, 2, vals);
          ioMeters(c, th, 440, HEAD_H + 20, 120, st);
        } },
      { id: "B", name: "Compressor", width: 560, step: stepDynamics,
        why: "Wide activity view: incoming signal in grey, gain reduction as an orange trace, readouts on top — like Compressor's display.",
        bullets: ["Scrolling history (input + gain reduction)", "Live readouts: In / GR / Out in the display header", "Controls in two side columns"],
        draw(c, th, st, ps, vals) {
          const L = ps.slice(0, 3), R = ps.slice(3);
          knobGrid(c, th, L, { x: 2, y: HEAD_H + 4, w: 60, h: DEVICE_H - 8 }, 1, vals, 58);
          const dx = 66, dw = 380, dy = HEAD_H + 6, dh = DEVICE_H - 12;
          activity(c, th, dx, dy + 18, dw, dh - 18, st.hist);
          rr(c, dx, dy, dw, 18, 3, th.display);
          c.fillStyle = th.dline; c.fillRect(dx, dy + 17, dw, 1);
          menu(c, th, dx + 4, dy + 2, 100, "Pressure5"); arrows(c, th, dx + 107, dy + 2);
          txt(c, dx + 150, dy + 12, "In", { color: th.dispText, align: "left" });
          txt(c, dx + 165, dy + 12, `${st.inL.toFixed(1)} dB`, { color: th.cyan, align: "left" });
          txt(c, dx + 225, dy + 12, "GR", { color: th.dispText, align: "left" });
          txt(c, dx + 243, dy + 12, `-${st.gr.toFixed(1)} dB`, { color: th.orange, align: "left" });
          txt(c, dx + 302, dy + 12, "Out", { color: th.dispText, align: "left" });
          txt(c, dx + 322, dy + 12, `${st.outL.toFixed(1)} dB`, { color: th.cyan, align: "left" });
          knobGrid(c, th, R, { x: 450, y: HEAD_H + 4, w: 108, h: DEVICE_H - 8 }, 2, vals);
        } },
      { id: "C", name: "Limiter", width: 480, step: stepDynamics,
        why: "Tall level meters in the middle — input level on the left, gain reduction on the right, with a dB scale — like Limiter.",
        bullets: ["Stereo input meters + gain-reduction bars", "Peak readouts under the meters", "Controls on both sides"],
        draw(c, th, st, ps, vals) {
          menu(c, th, 6, HEAD_H + 6, 120, "Pressure5"); arrows(c, th, 130, HEAD_H + 6);
          const half = Math.ceil(ps.length / 2);
          knobGrid(c, th, ps.slice(0, half), { x: 4, y: HEAD_H + 24, w: 156, h: DEVICE_H - 28 }, 2, vals);
          limiterMeters(c, th, 166, HEAD_H + 6, 140, DEVICE_H - 12, st);
          knobGrid(c, th, ps.slice(half), { x: 312, y: HEAD_H + 6, w: 164, h: DEVICE_H - 12 }, 2, vals);
        } },
    ],
  };
