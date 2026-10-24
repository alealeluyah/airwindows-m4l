// Reverb: design options. Helpers (knob, menu, meterV, …) come from app.js.
DESIGNS["Reverb"] = {
    effect: "Galactic3",
    refs: [["HybridReverbL12.png", "Hybrid Reverb"], ["ReverbL12.png", "Reverb"]],
    lead: "Visual cue: the reverb tail itself — what the space is doing to the sound, drawn live.",
    options: [
      { id: "A", name: "Hybrid", width: 636, step: stepReverb, live: liveGeneric,
        why: "Large dark display with the live wet signal scrolling in orange, controls as a row of dials under it — like Hybrid Reverb.",
        bullets: ["Scrolling wet waveform with dry hits in grey", "Effect menu and arrows inside the display", "In/Out meters on the right"],
        draw(c, th, st, ps, vals) {
          const dx = 6, dy = HEAD_H + 6, dw = 556, dh = 86;
          rr(c, dx, dy, dw, dh, 3, th.display);
          waveScroll(c, th, dx + 4, dy + 22, dw - 8, dh - 26, st.hist, "dry", S.theme === "light" ? "#6e6e6e" : "#3c3c3c");
          waveScroll(c, th, dx + 4, dy + 22, dw - 8, dh - 26, st.hist, "wet", th.orange);
          menu(c, th, dx + 6, dy + 5, 110, "Galactic3"); arrows(c, th, dx + 120, dy + 5);
          txt(c, dx + dw - 8, dy + 15, "Reverb · 6 controls", { color: th.dispText, align: "right" });
          rr(c, dx, dy + dh + 4, dw, DEVICE_H - dh - 16, 3, th.panel);
          knobGrid(c, th, ps, { x: dx, y: dy + dh + 6, w: dw, h: DEVICE_H - dh - 20 }, 8, vals, 60);
          gainStrip(c, th, 568, st);
        } },
      { id: "B", name: "Hybrid display", width: 636, step: stepReverb, live: liveGeneric,
        why: "Everything in one display: the waveform on top, and each control as a draggable coloured readout under it — Hybrid Reverb's display row.",
        bullets: ["Values are click-and-drag numbers (live.numbox), no dials", "Cyan readouts, grey labels, as in Hybrid Reverb", "Most compact: fits 13 controls in two rows"],
        draw(c, th, st, ps, vals) {
          const dx = 6, dy = HEAD_H + 6, dw = 556, dh = DEVICE_H - 12;
          rr(c, dx, dy, dw, dh, 3, th.display);
          waveScroll(c, th, dx + 4, dy + 22, dw - 8, 78, st.hist, "dry", S.theme === "light" ? "#6e6e6e" : "#3c3c3c");
          waveScroll(c, th, dx + 4, dy + 22, dw - 8, 78, st.hist, "wet", th.orange);
          menu(c, th, dx + 6, dy + 5, 110, "Galactic3"); arrows(c, th, dx + 120, dy + 5);
          c.fillStyle = th.dline; c.fillRect(dx + 8, dy + 106, dw - 16, 1);
          const cw = (dw - 16) / Math.min(7, ps.length);
          ps.forEach((p, i) => {
            const x = dx + 8 + (i % 7) * cw + cw / 2, y = dy + 122 + Math.floor(i / 7) * 30;
            txt(c, x, y, p.name, { color: th.dispText, size: 10 });
            txt(c, x, y + 15, fmt(p.display), { color: th.cyan, size: 11 });
          });
          gainStrip(c, th, 568, st);
        } },
      { id: "C", name: "Decay map", width: 628, step: stepReverb,
        live(st, m, dt) { liveGeneric(st, m, dt); (st.envHist = st.envHist || []).push(m.outRmsDb); if (st.envHist.length > 90) st.envHist.shift(); },
        why: "Shows the shape of the tail (early reflections, then decay) with an estimated decay time, next to the dials.",
        bullets: ["Decay curve with time axis and ≈ decay time", "Selector panel on the left (as today)", "Dials in a grid on the right"],
        draw(c, th, st, ps, vals) {
          rr(c, 4, HEAD_H + 4, 130, DEVICE_H - 8, 6, th.panel);
          txt(c, 10, HEAD_H + 16, "Reverb", { color: th.dim, align: "left" });
          menu(c, th, 10, HEAD_H + 22, 118, "Galactic3"); arrows(c, th, 98, HEAD_H + 5);
          c.font = `400 9.5px ${FONT}`; c.fillStyle = th.dim; c.textAlign = "left";
          wrapText(c, 10, HEAD_H + 54, 118, S.effWhat, { color: th.dim, maxLines: 7 });
          decayMap(c, th, 140, HEAD_H + 6, 210, DEVICE_H - 12, st);
          knobGrid(c, th, ps, { x: 354, y: HEAD_H + 4, w: 202, h: DEVICE_H - 8 }, 3, vals);
          gainStrip(c, th, 628 - GAIN_W - 4, st);
        } },
    ],
  };
