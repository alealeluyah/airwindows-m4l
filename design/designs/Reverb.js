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
      { id: "B", short: "Hybrid", name: "Hybrid display", width: 636, step: stepReverb, live: liveGeneric,
        why: "Everything in one display: the waveform on top, and each control as a draggable coloured readout under it — Hybrid Reverb's display row.",
        bullets: ["Values are click-and-drag numbers (live.numbox), no dials", "Cyan readouts, grey labels, as in Hybrid Reverb", "Most compact: fits 13 controls in two rows"],
        draw(c, th, st, ps, vals) {
          const dx = 4, dy = HEAD_H + 4, dw = 562, dh = DEVICE_H - 8;
          screen(c, th, dx, dy, dw, dh);
          strip(c, th, dx, dy, dw, 22);
          // output (reverb) translucent behind, dry input on top: the tail shows where orange outlasts grey
          const dryCol = S.theme === "light" ? "#5e5e5eb3" : "#8a8a8ab3";
          // one zoom for both, so dry and wet stay comparable (RUBRIC 2.6)
          const g = fit(st, "wave", histPeak(st.hist, ["dry", "wet"], dw - 8));
          waveScroll(c, th, dx + 4, dy + 24, dw - 8, 80, st.hist, "wet", th.orange + "73", g);
          waveScroll(c, th, dx + 4, dy + 24, dw - 8, 80, st.hist, "dry", dryCol, g);
          txt(c, dx + dw - 160, dy + 14, zoomText(g), { color: th.dispText, align: "right", size: 8.5 });
          hint(dx + dw - 230, dy + 4, 72, 12, "Zoom", "The waveform is enlarged so the loudest part of the last seconds fills the screen. The number says by how much; quiet signals get a larger zoom.");
          hint(dx + 4, dy + 22, dw - 8, 78, "Waveform", "The last seconds, newest on the right. Grey: the dry input. Orange: the output with the reverb; where orange lasts longer than grey you see the reverb tail.");
          menu(c, th, dx + 6, dy + 5, 110, "Galactic3"); arrows(c, th, dx + 120, dy + 5);
          legend(c, th, dx + dw - 150, dy + 14, [[dryCol, "Dry input", "The signal going into the reverb."],
                                                 [th.orange, "Output (wet)", "The output with the reverb tail."]]);
          strip(c, th, dx, dy + 106, dw, 0, true);
          const cw = (dw - 16) / Math.min(7, ps.length);
          ps.forEach((p, i) => {
            const x = dx + 8 + (i % 7) * cw + cw / 2, y = dy + 122 + Math.floor(i / 7) * 30;
            readout(c, th, x - cw / 2, y, cw, p, vals[p._i]);
          });
          gainStrip(c, th, 568, st);
        } },
      { id: "C", short: "Decay", name: "Decay map", width: 628, step: stepReverb,
        live(st, m, dt) { liveGeneric(st, m, dt); (st.envHist = st.envHist || []).push(m.outRmsDb); if (st.envHist.length > 90) st.envHist.shift(); },
        why: "Shows the shape of the tail (early reflections, then decay) with an estimated decay time, next to the dials.",
        bullets: ["Decay curve with time axis and ≈ decay time", "Selector panel on the left (as today)", "Dials in a grid on the right"],
        draw(c, th, st, ps, vals) {
          tile(c, th, 4, HEAD_H + 4, 130, DEVICE_H - 8);
          txt(c, 10, HEAD_H + 16, "Reverb", { color: th.dim, align: "left" });
          menu(c, th, 10, HEAD_H + 22, 118, "Galactic3"); arrows(c, th, 98, HEAD_H + 5);
          c.font = `400 9.5px ${FONT}`; c.fillStyle = th.dim; c.textAlign = "left";
          wrapText(c, 10, HEAD_H + 54, 118, S.effWhat, { color: th.dim, maxLines: 7 });
          decayMap(c, th, 136, HEAD_H + 4, 214, DEVICE_H - 8, st);
          tile(c, th, 352, HEAD_H + 4, 206, DEVICE_H - 8);
          hint(140, HEAD_H + 20, 210, DEVICE_H - 40, "Decay", "Output level over the last 3 seconds (top = 0 dB, bottom = -60 dB). A long, slow slope means a long reverb tail.");
          hint(290, HEAD_H + 6, 60, 14, "Decay Time", "Estimated time for the tail to fall 60 dB: 3 x the time it takes to fall 20 dB after its loudest point. \"> 3 s\" means longer than the window.");
          legend(c, th, 190, HEAD_H + 17, [[th.cyan, "Output level", "Output level in dB over time."]], { line: true });
          knobGrid(c, th, ps, { x: 352, y: HEAD_H + 4, w: 206, h: DEVICE_H - 8 }, 3, vals);
          gainStrip(c, th, 628 - GAIN_W - 4, st);
        } },
    ],
  };
