// Dynamics: design options. Helpers (knob, menu, meterV, …) come from app.js.
DESIGNS["Dynamics"] = {
    effect: "Pressure5",
    refs: [["GlueL12.png", "Glue Compressor"], ["CompressorL12.png", "Compressor"], ["LimiterL12.png", "Limiter"]],
    lead: "Visual cue: how much the effect is turning the level down (gain reduction), measured live from input vs output.",
    options: [
      { id: "AB", short: "Glue+Comp", name: "Glue + Compressor views (your pick)", width: 556, step: stepDynamics, live: liveGeneric,
        why: "One display with two views, switched by the buttons in its header like Compressor: Glue's gain-reduction needle, or Compressor's activity history. Input and Output gain on the right.",
        bullets: ["Click Needle / Activity in the display header to switch views (a saved device setting)",
                  "Both views are driven by input vs output level (gain reduction), measured by airwin~",
                  "First 4 controls under the display, the rest in the left columns; Input / Output gain at the right"],
        click(x, y, st) { for (const [i, r] of (st.tabs || []).entries()) if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) st.view = i; },
        draw(c, th, st, ps, vals) {
          menu(c, th, 6, HEAD_H + 6, 116, "Pressure5"); arrows(c, th, 126, HEAD_H + 6);
          const rest = ps.slice(4);
          if (rest.length) knobGrid(c, th, rest, { x: 4, y: HEAD_H + 24, w: 150, h: DEVICE_H - 28 }, 2, vals);
          else if (!ps.length) txt(c, 79, HEAD_H + 90, "No controls", { color: th.dim });
          const dx = 160, dw = 324, dy = HEAD_H + 6, dh = 98;
          rr(c, dx, dy, dw, dh, 3, th.display);
          st.tabs = viewTabs(c, th, dx + 5, dy + 4, ["Needle", "Activity"], st.view || 0);
          txt(c, dx + dw - 8, dy + 15, `GR -${st.gr.toFixed(1)} dB`, { color: th.orange, align: "right" });
          c.fillStyle = th.dline; c.fillRect(dx, dy + 22, dw, 1);
          hint(dx + dw - 70, dy + 4, 66, 14, "Gain Reduction", "How much the effect turns the level down right now, in dB. Measured from the input and output levels.");
          if ((st.view || 0) === 0) {
            grNeedle(c, th, dx + 30, dy + 23, dw - 60, dh - 23, st.gr);
            hint(dx, dy + 23, dw, dh - 23, "Gain Reduction Needle", "Shows how many dB the effect takes away, like the meter of Glue Compressor. 0 = no change. Measured from the input and output levels.");
            legend(c, th, dx + 6, dy + dh - 5, [[th.cyan, "Gain reduction", "Needle: dB the effect takes away now."]], { line: true });
          } else {
            activity(c, th, dx, dy + 23, dw, dh - 23, st.hist);
            hint(dx, dy + 23, dw, dh - 23, "Activity", "The last seconds, newest on the right: the input level in grey and the gain reduction in orange, like the display of Compressor.");
            legend(c, th, dx + 6, dy + dh - 5, [[S.theme === "light" ? "#5e5e5e" : "#5a5a5a", "Input", "Input level over time."],
                                               [th.orange, "Gain reduction", "dB taken away over time; lower = more reduction."]]);
          }
          const first = ps.slice(0, 4);
          rr(c, dx, dy + dh + 4, dw, DEVICE_H - dh - 16, 3, th.panel);
          first.forEach((p, i) => knob(c, th, dx + (dw - first.length * 74) / 2 + i * 74, dy + dh + 6, 74, p, vals[p._i], true));
          gainStrip(c, th, 556 - GAIN_W - 4, st);
        } },
      { id: "A", name: "Glue", width: 470, step: stepDynamics, live: liveGeneric,
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
      { id: "B", name: "Compressor", width: 560, step: stepDynamics, live: liveGeneric,
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
      { id: "C", name: "Limiter", width: 480, step: stepDynamics, live: liveGeneric,
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
