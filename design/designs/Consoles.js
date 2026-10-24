(function () {
  // ---- local helpers (this file only) ----
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const mean = v => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0.5);
  const lin = d => Math.pow(10, d / 20);
  const sq = x => x * x;
  const l2 = Math.log2;
  const TOP = HEAD_H, BOT = HEAD_H + DEVICE_H;
  const greyFill = () => (S.theme === "light" ? "#5e5e5e" : "#575757");
  // effect menu + step arrows; the name is shortened to fit the box (menu() in lib.js does not)
  const chrome = (c, th, x, y, mw, label) => {
    let s = S.effName || label; c.font = `400 9.5px ${FONT}`;
    const maxW = mw - 20;
    if (c.measureText(s).width > maxW) { while (s.length > 1 && c.measureText(s + "..").width > maxW) s = s.slice(0, -1); s += ".."; }
    const keep = S.effName; S.effName = s; menu(c, th, x, y, mw, s); S.effName = keep;
    arrows(c, th, x + mw + 4, y);
  };
  const gs = gainStrip;
  // ---- structure (RUBRIC 1, 8): tiles for selector and dials, a screen between them ----
  const Y0 = HEAD_H + 4, HH = DEVICE_H - 8;
  const noCtl = (c, th, x, y, w, h) => {
    txt(c, x + w / 2, y + h / 2 - 2, "No controls", { color: th.text, size: 10 });
    txt(c, x + w / 2, y + h / 2 + 11, "this effect has no dials", { color: th.dim, size: 8.5 });
  };
  // Left tile (menu + half the dials; Lw 0 = none), right tile (other half), gain strip at W - GAIN_W - 4.
  // menuInTile false: the caller puts the menu in the screen strip. Returns the screen rect.
  function frame(c, th, ps, vals, W, Lw, Rw, menuInTile) {
    const gx = W - GAIN_W - 4, half = Math.ceil(ps.length / 2);
    const L = Lw ? ps.slice(0, half) : [], R = Lw ? ps.slice(half) : ps;
    const hasR = R.length > 0 || !Lw, rtx = hasR ? gx - 2 - Rw : gx;
    const sx = Lw ? 4 + Lw + 2 : 4;
    if (Lw) {
      tile(c, th, 4, Y0, Lw, HH);
      const top = menuInTile ? 20 : 0;
      if (menuInTile) chrome(c, th, 8, Y0 + 4, Lw - 42, NAME);
      if (L.length) knobGrid(c, th, L, { x: 4, y: Y0 + top, w: Lw, h: HH - top + (menuInTile ? 4 : 0) }, 2, vals);
      else if (!ps.length) noCtl(c, th, 4, Y0, Lw, HH);
    }
    if (hasR) {
      tile(c, th, rtx, Y0, Rw, HH);
      if (R.length) knobGrid(c, th, R, { x: rtx, y: Y0, w: Rw, h: HH }, 2, vals);
      else noCtl(c, th, rtx, Y0, Rw, HH);
    }
    return { x: sx, y: Y0, w: rtx - 2 - sx, h: HH };
  }
  // controls split into a left and a right area; 0 controls shows a note
  function place(c, th, ps, vals, L, R) {
    if (!ps.length) {
      txt(c, L.x + L.w / 2, L.y + L.h / 2 - 2, "No controls", { color: th.text, size: 10 });
      txt(c, L.x + L.w / 2, L.y + L.h / 2 + 11, "this effect has no dials", { color: th.dim, size: 8.5 });
      return;
    }
    const half = Math.ceil(ps.length / 2);
    knobGrid(c, th, ps.slice(0, half), L, 2, vals);
    if (ps.length > half) knobGrid(c, th, ps.slice(half), R, 2, vals);
  }
  // test signal: fundamental plus a little 3rd harmonic, peak about a
  const wave = (tau, a) => a * (Math.sin(tau) + 0.25 * Math.sin(3 * tau + 0.6)) / 1.1;
  // input tracking shared by every option
  function base(st, dt) {
    const d = drums(st.t), a = d.env * 0.9 + 0.02;
    if (!st.pre) { st.pre = 1; for (let i = 700; i > 0; i--) st.hist.push({ a: drums(Math.max(0, st.t - i / 120)).env * 0.9 + 0.02 }); }
    st.a = a; st.d = d;
    st.inL = Math.max(db(a), st.inL - 24 * dt);
    st.hist.push({ a }); if (st.hist.length > 700) st.hist.shift();
    return d;
  }
  // input spectrum, 72 log-spaced bins 20 Hz .. 20 kHz, peak-hold with fall
  const NB = 72, fOf = i => 20 * Math.pow(1000, i / (NB - 1));
  const gauss = (f, f0, w) => Math.exp(-sq(l2(f / f0)) / w);
  function specIn(f, d, i, k) {
    const tilt = -22 - 12 * Math.log10(Math.max(f, 20) / 100);
    return Math.max(-84, tilt + 20 * d.kick * gauss(f, 65, 0.7) + 16 * d.sn * gauss(f, 1500, 2)
      + 24 * (d.hat / 0.35) * gauss(f, 9000, 1.5) + 2.5 * noise(i * 7.3 + k) - (f < 40 ? 12 * l2(40 / f) : 0));
  }
  function specStep(st, dt, d) {
    if (!st.spI) st.spI = new Array(NB).fill(-90);
    const k = Math.floor(st.t * 18);
    for (let i = 0; i < NB; i++) st.spI[i] = Math.max(specIn(fOf(i), d, i, k), st.spI[i] - 50 * dt);
  }
  const fx = (f, x, w) => x + w * Math.log10(f / 20) / 3;
  function hzLabels(c, th, x, y, w) {
    [[50, "50"], [100, "100"], [500, "500"], [1000, "1k"], [5000, "5k"], [10000, "10k"]].forEach(([f, s]) =>
      txt(c, fx(f, x, w), y, s, { color: th.scale, size: 8.5 }));
  }
  const vgrid = (c, th, x, y, w, h) => {
    c.strokeStyle = th.dline; c.lineWidth = 1;
    [50, 100, 500, 1000, 5000, 10000].forEach(f => { const xx = Math.round(fx(f, x, w)) + 0.5; c.beginPath(); c.moveTo(xx, y); c.lineTo(xx, y + h); c.stroke(); });
  };
  const sgn = v => (v >= 0 ? "+" : "-") + Math.abs(v).toFixed(1);

  // ---- live (real measurement) helpers ----
  const lvArr = a => Array.isArray(a) && a.length >= 48;
  const lvF = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const lvPk = (a) => Math.max(lvF(a && a[0], -120), lvF(a && a[1], -120));
  const lvSm = (prev, v, up, dn) => (typeof prev !== "number" || !Number.isFinite(prev) ? v : prev + (v - prev) * (v > prev ? up : dn));
  // 48 measured bands -> the 72 display bins of this file
  function lvRes(a) {
    const o = new Array(NB);
    for (let i = 0; i < NB; i++) {
      const p = clamp(Math.log10(fOf(i) / 20) / 3 * 48 - 0.5, 0, 47), i0 = Math.floor(p), i1 = Math.min(47, i0 + 1), f = p - i0;
      o[i] = lvF(a[i0], -120) * (1 - f) + lvF(a[i1], -120) * f;
    }
    return o;
  }
  // peak level of the two channels with 24 dB/s release: feeds gainStrip
  function lvIO(st, m, dt) {
    st.inL = Math.max(lvPk(m.inPkDb), lvF(st.inL, -120) - 24 * dt);
    st.outL = Math.max(lvPk(m.outPkDb), lvF(st.outL, -120) - 24 * dt);
  }
  // per-band peak hold with a fall in dB/s; result kept in st[key]
  function lvHold(st, key, src, dt, rate) {
    const prev = st[key], o = new Array(48);
    for (let i = 0; i < 48; i++) o[i] = Math.max(lvF(src[i], -120), (prev ? prev[i] : -120) - rate * dt);
    return (st[key] = o);
  }
  // output minus input per band; held where the input is too quiet to compare
  function lvResp(st, key, mi, mo) {
    const prev = st[key] || new Array(48).fill(0), o = new Array(48);
    for (let i = 0; i < 48; i++) {
      const a = lvF(mi[i], -120), b = lvF(mo[i], -120);
      o[i] = a < -80 ? prev[i] : prev[i] + (clamp(b - a, -40, 40) - prev[i]) * 0.35;
    }
    return (st[key] = o);
  }
  const lvPow = v => Math.pow(10, lvF(v, -120) / 10);

  // ---- console model: unity small-signal gain, soft ceiling, slightly narrower image, gentle tilt ----
  const kOf = vals => 1 + 2 * mean(vals);
  const csat = (x, k) => x / Math.sqrt(1 + 0.5 * (k - 1) * x * x);
  const wOf = vals => 1 - 0.3 * mean(vals);
  const cresp = (f, m) => 3 * m * (1.5 / (1 + sq(f / 150)) - 1.0 * gauss(f, 2500, 1.2) + 2 / (1 + sq(6000 / f)));
  const NAME = "ConsoleMCChannel";
  const init = (st, k) => { st.k = k; if (st.pkO === undefined) { st.pkO = -60; st.hO = -60; st.hT = 0; st.hI = -60; st.hTI = 0; st.rms = 0; st.side = 0.2; st.bal = 0; } };
  function stepC(st, dt) {
    init(st, st.k || 2);
    const d = base(st, dt); specStep(st, dt, d);
    st.side = clamp(0.12 + 0.28 * d.hat / 0.35 + 0.22 * d.sn + 0.1 * Math.sin(st.t * 0.7), 0.03, 0.9);
    st.bal = 0.12 * Math.sin(st.t * 0.4);
    st.rms += (st.a * 0.7 - st.rms) * Math.min(1, dt * 6);
    const o = db(csat(st.a, st.k));
    st.pkO = Math.max(o, st.pkO - 24 * dt); st.outL = Math.max(o, st.outL - 24 * dt);
    if (o >= st.hO) { st.hO = o; st.hT = st.t; } else if (st.t - st.hT > 1.2) st.hO = Math.max(o, st.hO - 30 * dt);
    if (st.inL >= st.hI) { st.hI = st.inL; st.hTI = st.t; } else if (st.t - st.hTI > 1.2) st.hI = Math.max(st.inL, st.hI - 30 * dt);
  }
  const hbar = (c, th, x, y, w, h, v, col) => { c.fillStyle = th.meterBg; c.fillRect(x, y, w, h); c.fillStyle = col; c.fillRect(x, y, w * clamp(v, 0, 1), h); };

  DESIGNS["Consoles"] = {
    effect: NAME,
    refs: [["UtilityL12.png", "Utility"], ["LimiterL12.png", "Limiter (meters)"], ["ChannelEQL12.png", "Channel EQ"]],
    lead: "Visual cue: what the console stage does to the signal between its input and output: stereo image, level, or tone per band.",
    options: [
      { id: "A", name: "Stereo image", short: "Stereo", width: 592, step: stepC,
        live(st, m, dt) {
          st.lv = 1; lvIO(st, m, dt);
          const pairs = (a, b) => { const o = [], n = Math.min(Array.isArray(a) ? a.length : 0, Array.isArray(b) ? b.length : 0, 64); for (let i = 0; i < n; i++) if (Number.isFinite(a[i]) && Number.isFinite(b[i])) o.push([a[i], b[i]]); return o; };
          const vi = pairs(m.inScopeL, m.inScopeR), vo = pairs(m.scopeL, m.scopeR);
          let ext = 0;
          vi.concat(vo).forEach(([l, r]) => { ext = Math.max(ext, Math.abs(l), Math.abs(r)); });
          st.vPk = ext;
          st.vi = vi; st.vo = vo;
          const ms = Array.isArray(m.ms) ? m.ms : [], oM = lvF(ms[2], -120), oS = lvF(ms[3], -120);
          st.corr = lvSm(st.corr, clamp(lvF(m.corr, 0), -1, 1), 0.4, 0.4);
          st.midDb = Math.max(oM, lvF(st.midDb, -120) - 24 * dt);
          st.sideDb = Math.max(oS, lvF(st.sideDb, -120) - 24 * dt);
          if (oM > -90) st.wid = lvSm(st.wid, Math.min(999, 100 * Math.pow(10, (oS - oM) / 20)), 0.3, 0.3);
          if (st.wid === undefined) st.wid = 0;
          const pl = lvF(m.outPkDb && m.outPkDb[0], -120), pr = lvF(m.outPkDb && m.outPkDb[1], -120);
          if (Math.max(pl, pr) > -90) st.balDb = lvSm(st.balDb, clamp(pl - pr, -24, 24), 0.2, 0.2);
          if (st.balDb === undefined) st.balDb = 0;
        },
        why: "Vectorscope with correlation, mid and side levels and a width readout, like Utility's stereo tools.",
        bullets: ["Vectorscope: grey = input, cyan = output (left/right samples plotted on a diamond)",
          "Correlation bar -1 to +1, mid and side level bars, width % (side vs mid)",
          "Driven by the audio: left/right output samples, so any console shows its own width change"],
        draw(c, th, st, ps, vals) {
          gs(c, th, 592 - GAIN_W - 4, st);
          const k = kOf(vals), w = wOf(vals), lv = !!st.lv; init(st, k);
          const a = st.a, s = st.side;
          const { x: px, y: py, w: pw, h: ph } = frame(c, th, ps, vals, 592, 116, 104, true);
          screen(c, th, px, py, pw, ph);
          const sb = strip(c, th, px, py, pw, 19);
          const bb = strip(c, th, px, py + ph - 18, pw, 18, true);
          const bs = 104, bx = px + 8, by = py + 23, hs = bs / 2, cx = bx + hs, cy = by + hs;
          // fixed scale, same for input and output: a full-scale mono sample (L = R = 1) reaches the box edge (RUBRIC 2.6)
          const sc = hs / 1.4;
          rr(c, bx + 0.5, by + 0.5, bs, bs, 0, null, th.dline);
          c.strokeStyle = th.dline; c.lineWidth = 1; c.beginPath();
          c.moveTo(cx, by); c.lineTo(cx, by + bs); c.moveTo(bx, cy); c.lineTo(bx + bs, cy);
          c.moveTo(bx, by + bs); c.lineTo(bx + bs, by); c.moveTo(bx, by); c.lineTo(bx + bs, by + bs); c.stroke();
          txt(c, bx + 9, by + 10, "L", { color: th.scale, size: 8.5 }); txt(c, bx + bs - 9, by + 10, "R", { color: th.scale, size: 8.5 });
          txt(c, px + pw - 8, sb, "Vectorscope", { color: th.scale, size: 8.5, align: "right" });
          legend(c, th, px + 8, sb, [
            [th.dispText, "In", "Grey trace: the left and right samples going into the console."],
            [th.cyan, "Out", "Cyan trace: the left and right samples coming out of the console."]]);
          hint(bx, by, bs, bs, "Vectorscope", "Each left and right sample pair is a point. A tall thin line means mono, a wide cloud means wide stereo. Measured from the input and output samples.");
          hint(bx, by, 20, 12, "Left Channel", "Points toward the upper left are louder in the left channel.");
          hint(bx + bs - 20, by, 20, 12, "Right Channel", "Points toward the upper right are louder in the right channel.");
          let sLR = 0, sLL = 0, sRR = 0, sM = 0, sS = 0;
          const N = 140;
          const line = (col, lw, f) => {
            c.strokeStyle = col; c.lineWidth = lw; c.beginPath();
            for (let i = 0; i < N; i++) {
              const tau = i / N * 2 * Math.PI * 3 + st.t * 4;
              const mid = wave(tau, a), sd = 5 * s * a * (Math.sin(tau * 1.7 + 1.1) + 0.5 * Math.sin(tau * 2.9)) / 1.5;
              const [L, R] = f(mid, sd);
              const x = clamp(cx + (L - R) * 0.707 * sc, bx, bx + bs), y = clamp(cy - (L + R) * 0.707 * sc, by, by + bs);
              i ? c.lineTo(x, y) : c.moveTo(x, y);
              if (col === th.cyan) { sLR += L * R; sLL += L * L; sRR += R * R; sM += sq((L + R) / 2); sS += sq((L - R) / 2); }
            }
            c.stroke();
          };
          if (lv) {
            [[th.dispText, st.vi], [th.cyan, st.vo]].forEach(([col, arr]) => {
              if (!arr || !arr.length) return;
              c.strokeStyle = col; c.lineWidth = 1.5; c.beginPath();
              arr.forEach(([L, R], i) => {
                const x = clamp(cx + (L - R) * 0.707 * sc, bx, bx + bs), y = clamp(cy - (L + R) * 0.707 * sc, by, by + bs);
                i ? c.lineTo(x, y) : c.moveTo(x, y);
              });
              c.stroke();
            });
          } else {
          line(th.dispText, 1.5, (m, sd) => [m + sd, m - sd]);
          line(th.cyan, 1.5, (m, sd) => [csat(m + sd * w, k), csat(m - sd * w, k)]);
          }
          const corr = lv ? st.corr || 0 : sLR / Math.sqrt(Math.max(sLL * sRR, 1e-9));
          const mDb = lv ? lvF(st.midDb, -120) : db(Math.sqrt(sM / N)), sDb = lv ? lvF(st.sideDb, -120) : db(Math.sqrt(sS / N));
          const rx = px + 126, rw = pw - 134;
          hint(rx, py + 22, rw, 22, "Mid Level", "Level of the centre of the stereo image (left plus right), in dB. Measured from the output.");
          hint(rx, py + 46, rw, 22, "Side Level", "Level of the sides of the stereo image (left minus right), in dB. Measured from the output.");
          hint(rx, py + 72, rw, 34, "Width", "How wide the stereo image is: side level against mid level, in percent. 0 % is mono.");
          hint(rx, py + 112, rw, 14, "Balance", "Difference in level between the left and right channels, in dB. Plus means louder on the left.");
          txt(c, rx, py + 33, "Mid", { color: th.dispText, align: "left" });
          txt(c, rx + rw, py + 33, `${mDb.toFixed(1)} dB`, { color: th.cyan, align: "right" });
          hbar(c, th, rx, py + 37, rw, 6, 1 + Math.max(mDb, -60) / 60, th.cyan);
          txt(c, rx, py + 57, "Side", { color: th.dispText, align: "left" });
          txt(c, rx + rw, py + 57, `${sDb.toFixed(1)} dB`, { color: th.orange, align: "right" });
          hbar(c, th, rx, py + 61, rw, 6, 1 + Math.max(sDb, -60) / 60, th.orange);
          txt(c, rx, py + 82, "Width", { color: th.dispText, align: "left" });
          txt(c, rx + rw, py + 103, `${lv ? Math.round(st.wid || 0) : Math.round(100 * Math.sqrt(sS / Math.max(sM, 1e-9)))} %`, { color: th.cyan, size: 18, bold: true, align: "right" });
          txt(c, rx, py + 124, "Balance", { color: th.dispText, align: "left" });
          txt(c, rx + rw, py + 124, `${lv ? sgn(st.balDb || 0) : sgn(20 * Math.log10((1 + st.bal) / (1 - st.bal)))} dB`, { color: th.orange, align: "right" });
          const cbx = px + 8, cbw = pw - 16, cby = py + 132;
          c.fillStyle = th.meterBg; c.fillRect(cbx, cby, cbw, 7);
          c.fillStyle = corr >= 0 ? th.green : th.orange;
          c.fillRect(corr >= 0 ? cbx + cbw / 2 : cbx + cbw / 2 + corr * cbw / 2, cby, Math.abs(corr) * cbw / 2, 7);
          c.fillStyle = th.scale; c.fillRect(cbx + cbw / 2 - 0.5, cby - 2, 1, 11);
          hint(cbx, cby - 2, cbw, 11, "Correlation Bar", "Shows if left and right move together. Right of the centre (green): in phase, safe in mono. Left of the centre (orange): out of phase, may cancel in mono.");
          legend(c, th, cbx + 18, bb, [[th.orange, "Out of phase", "Orange bar to the left: left and right work against each other and can cancel in mono."]]);
          legend(c, th, cbx + cbw - 66, bb, [[th.green, "In phase", "Green bar to the right: left and right move together and stay full in mono."]]);
          txt(c, cbx, bb, "-1", { color: th.scale, size: 8.5, align: "left" });
          txt(c, cbx + cbw, bb, "+1", { color: th.scale, size: 8.5, align: "right" });
          txt(c, cbx + cbw / 2, bb, `Correlation ${sgn(corr)}`, { color: th.dispText, size: 8.5 });
        } },
      { id: "B", name: "Channel strip", short: "Meters", width: 608, step: stepC,
        live(st, m, dt) {
          st.lv = 1; st.lt = (st.lt || 0) + dt;
          lvIO(st, m, dt);
          const cp = (key, hkey, tkey, arr) => {
            const pk = st[key] || (st[key] = [-120, -120]), hd = st[hkey] || (st[hkey] = [-120, -120]), tm = st[tkey] || (st[tkey] = [0, 0]);
            for (let ch = 0; ch < 2; ch++) {
              const v = lvF(arr && arr[ch], -120);
              pk[ch] = Math.max(v, pk[ch] - 24 * dt);
              if (pk[ch] >= hd[ch]) { hd[ch] = pk[ch]; tm[ch] = st.lt; } else if (st.lt - tm[ch] > 1.2) hd[ch] = Math.max(pk[ch], hd[ch] - 30 * dt);
            }
          };
          cp("pkI2", "hI2", "tI2", m.inPkDb); cp("pkO2", "hO2", "tO2", m.outPkDb);
          // mono RMS only is measured: per-channel bars are that RMS shifted by the channel's peak imbalance
          const rmsCh = (rms, arr) => { const l = lvF(arr && arr[0], -120), r = lvF(arr && arr[1], -120), mx = Math.max(l, r); return [rms + (l - mx), rms + (r - mx)].map(v => Math.max(-120, v)); };
          st.rI = lvSm(st.rI, lvF(m.inRmsDb, -120), 0.6, 0.12); st.rO = lvSm(st.rO, lvF(m.outRmsDb, -120), 0.6, 0.12);
          st.rI2 = rmsCh(st.rI, m.inPkDb); st.rO2 = rmsCh(st.rO, m.outPkDb);
          st.hist.push({ a: lvF(m.inPk, 0), o: lvF(m.outPk, 0) }); if (st.hist.length > 700) st.hist.shift();
          if (lvF(m.inRmsDb, -120) > -90) {
            st.gnow = lvSm(st.gnow, clamp(lvF(m.gainDb, 0), -40, 40), 0.4, 0.4);
            st.cIn = lvSm(st.cIn, lvPk(m.inPkDb) - m.inRmsDb, 0.4, 0.4); st.cOut = lvSm(st.cOut, lvPk(m.outPkDb) - lvF(m.outRmsDb, -120), 0.4, 0.4);
          }
          ["gnow", "cIn", "cOut"].forEach(k => { if (st[k] === undefined) st[k] = 0; });
        },
        why: "Stereo input and output meters with RMS, peak and peak hold, plus a level history, like a Live mixer strip or Limiter.",
        bullets: ["Left pair = input meters, right pair = output meters: RMS bar, peak tick, orange hold line, clip lamp",
          "History: input level in grey, output level in cyan; readouts for gain change and crest factor",
          "Driven by the audio: peak and RMS of the input and the output signal"],
        draw(c, th, st, ps, vals) {
          gs(c, th, 608 - GAIN_W - 4, st);
          const k = kOf(vals), lv = !!st.lv; init(st, k);
          const a = st.a, o = csat(a, k);
          const { x: px, y: py, w: pw, h: ph } = frame(c, th, ps, vals, 608, 116, 108, true);
          screen(c, th, px, py, pw, ph);
          const sb = strip(c, th, px, py, pw, 19);
          const bb = strip(c, th, px, py + ph - 18, pw, 18, true);
          const f = d => clamp(1 + d / 54, 0, 1), my = py + 28, mh = 100;
          const rmsI = lv ? 0 : db(st.rms), rmsO = lv ? 0 : db(csat(st.rms, k));
          const bar = (x, rmsDb, pk, hold, lbal) => {
            meterV(c, th, x, my, 10, mh, f(rmsDb + lbal));
            c.fillStyle = th.cyan; c.fillRect(x, my + mh * (1 - f(pk + lbal)), 10, 2);
            c.fillStyle = th.orange; c.fillRect(x, my + mh * (1 - f(hold + lbal)), 10, 1);
          };
          const bi = 20 * Math.log10(1 + st.bal) * 1;
          if (lv) {
            bar(px + 12, st.rI2[0], st.pkI2[0], st.hI2[0], 0); bar(px + 24, st.rI2[1], st.pkI2[1], st.hI2[1], 0);
            bar(px + 76, st.rO2[0], st.pkO2[0], st.hO2[0], 0); bar(px + 88, st.rO2[1], st.pkO2[1], st.hO2[1], 0);
          } else {
          bar(px + 12, rmsI, st.inL, st.hI, bi); bar(px + 24, rmsI, st.inL, st.hI, -bi);
          bar(px + 76, rmsO, st.pkO, st.hO, bi); bar(px + 88, rmsO, st.pkO, st.hO, -bi);
          }
          hint(px + 8, my, 38, mh, "Input Meters", "Level of the left and right channels going in. The bar is the average level (RMS). Scale from 0 dB at the top to -48 dB.");
          hint(px + 72, my, 38, mh, "Output Meters", "Level of the left and right channels coming out. The bar is the average level (RMS). Scale from 0 dB at the top to -48 dB.");
          const hIn = lv ? Math.max(st.hI2[0], st.hI2[1]) : st.hI, hOut = lv ? Math.max(st.hO2[0], st.hO2[1]) : st.hO;
          [0, -6, -12, -24, -48].forEach(d => {
            const yy = my + mh * (1 - f(d));
            txt(c, px + 56, yy + 3, String(d), { color: th.dispText, size: 8.5 });
            c.fillStyle = th.scale; c.fillRect(px + 38, yy, 4, 1); c.fillRect(px + 70, yy, 4, 1);
          });
          txt(c, px + 23, sb, "In", { color: th.dispText }); txt(c, px + 87, sb, "Out", { color: th.dispText });
          c.fillStyle = hOut > -1 ? th.orange : th.meterBg; c.fillRect(px + 76, py + 22, 22, 3);
          hint(px + 76, py + 21, 22, 5, "Clip Lamp", "Lights up orange when the output has reached 0 dB, where clipping starts.");
          legend(c, th, px + 112, bb, [
            [th.cyan, "Peak", "Cyan tick on each meter: the highest level in the last moments."],
            [th.orange, "Hold", "Orange line on each meter: the highest level held for about a second."]]);
          hint(px + 8, py + ph - 18, 36, 18, "Input Peak Hold", "Highest input level held, in dB.");
          hint(px + 72, py + ph - 18, 36, 18, "Output Peak Hold", "Highest output level held, in dB. Near 0 means little headroom left.");
          hint(px + 40, my, 30, mh, "Level Scale", "Level in dB. 0 is the top; lower levels are further down.");
          txt(c, px + 23, bb, Math.max(-120, hIn).toFixed(1), { color: th.cyan, size: 9 });
          txt(c, px + 87, bb, Math.max(-120, hOut).toFixed(1), { color: th.cyan, size: 9 });
          // level history (dB scale: fixed)
          const hx = px + 112, hw = pw - 120, hy = py + 24, hh = 60;
          txt(c, hx, sb, "Level history", { color: th.scale, size: 8.5, align: "left" });
          legend(c, th, hx + 72, sb, [
            [greyFill(), "In", "Grey area: input level over time."],
            [th.cyan, "Out", "Cyan line: output level over time."]]);
          hint(hx, hy, hw, hh, "Level History", "Level over time, newest at the right. Compare the grey input with the cyan output to see what the console does. Scale 0 to -48 dB.");
          rr(c, hx, hy, hw, hh, 2, th.meterBg);
          c.save(); c.beginPath(); c.rect(hx, hy, hw, hh); c.clip();
          const Y = v => hy + hh * (1 - clamp(1 + v / 48, 0, 1)), n = Math.min(st.hist.length, hw);
          c.fillStyle = greyFill(); c.beginPath(); c.moveTo(hx + hw, hy + hh);
          for (let i = 0; i < n; i++) c.lineTo(hx + hw - i, Y(db(st.hist[st.hist.length - 1 - i].a)));
          c.lineTo(hx + hw - n, hy + hh); c.fill();
          c.strokeStyle = th.cyan; c.lineWidth = 1.5; c.beginPath();
          for (let i = 0; i < n; i++) { const he = st.hist[st.hist.length - 1 - i], yy = Y(db(lv ? he.o : csat(he.a, k))); i ? c.lineTo(hx + hw - i, yy) : c.moveTo(hx + hw - i, yy); }
          c.stroke(); c.restore();
          const rows = lv ? [["Gain change", sgn(st.gnow) + " dB", th.orange], ["Crest in", st.cIn.toFixed(1) + " dB", th.cyan],
            ["Crest out", st.cOut.toFixed(1) + " dB", th.cyan], ["Headroom", Math.min(120, -hOut).toFixed(1) + " dB", th.cyan]]
            : [["Gain change", sgn(db(o / a)) + " dB", th.orange], ["Crest in", (st.inL - rmsI).toFixed(1) + " dB", th.cyan],
            ["Crest out", (st.pkO - rmsO).toFixed(1) + " dB", th.cyan], ["Headroom", (-st.hO).toFixed(1) + " dB", th.cyan]];
          rows.forEach(([l, v, col], i) => {
            hint(hx, py + 89 + i * 12, hw, 12, l, ["How much the console raises or lowers the level right now, in dB. Measured as output level minus input level.",
              "Crest factor of the input: the peak level minus the average level, in dB. A high number means sharp peaks.",
              "Crest factor of the output: the peak level minus the average level, in dB. Compare with the input.",
              "Room left below 0 dB at the output, in dB. Measured from the output peak hold."][i]);
            txt(c, hx, py + 98 + i * 12, l, { color: th.dispText, size: 9, align: "left" });
            txt(c, hx + hw, py + 98 + i * 12, v, { color: col, size: 9, align: "right" });
          });
        } },
      { id: "C", name: "Tone bands", short: "Tone", width: 560, step: stepC,
        live(st, m, dt) {
          st.lv = 1; lvIO(st, m, dt);
          if (!lvArr(m.specIn) || !lvArr(m.specOut)) return;
          const hi = lvHold(st, "hI48", m.specIn, dt, 50), ho = lvHold(st, "hO48", m.specOut, dt, 50), rs = lvResp(st, "rs48", m.specIn, m.specOut);
          const two = a => { const o = []; for (let b = 0; b < 24; b++) o.push((a[2 * b] + a[2 * b + 1]) / 2); return o; };
          st.cIn = two(hi); st.cOut = two(ho); st.cD = two(rs);
        },
        why: "24 frequency bands, input against output, with a small difference strip, like Channel EQ's analyser.",
        bullets: ["Grey bar = input band level, cyan bar = output band level (FFT in 24 bands)",
          "Orange strip: output minus input per band, +/-4 dB, so you see the console's tone change",
          "Driven by the audio: FFT of input and output; Low / Mid / High readouts are measured differences"],
        draw(c, th, st, ps, vals) {
          gs(c, th, 560 - GAIN_W - 4, st);
          const m = mean(vals), a = st.a, lv = !!st.lv; init(st, kOf(vals));
          const { x: px, y: py, w: pw, h: ph } = frame(c, th, ps, vals, 560, 0, 110, false);
          screen(c, th, px, py, pw, ph);
          strip(c, th, px, py, pw, 22);
          const bb = strip(c, th, px, py + ph - 18, pw, 18, true);
          chrome(c, th, px + 6, py + 4, 84, NAME);
          const sp = st.spI || new Array(NB).fill(-90), NBd = 24;
          const inB = [], dB = [], outB = [];
          for (let b = 0; b < NBd; b++) {
            const i0 = b * 3, v = (sp[i0] + sp[i0 + 1] + sp[i0 + 2]) / 3, fc = fOf(i0 + 1);
            if (lv) { inB.push(st.cIn ? st.cIn[b] : -120); outB.push(st.cOut ? st.cOut[b] : -120); dB.push(st.cD ? st.cD[b] : 0); continue; }
            const d = cresp(fc, m) + 0.4 * a * noise(b * 5 + Math.floor(st.t * 18));
            inB.push(v); dB.push(d); outB.push(v + d);
          }
          const avg = (lo, hi) => { let s = 0, n = 0; dB.forEach((d, b) => { const f = lv ? 20 * Math.pow(1000, (2 * b + 1) / 48) : fOf(b * 3 + 1); if (f >= lo && f < hi) { s += d; n++; } }); return n ? s / n : 0; };
          [["Low", avg(0, 250), 140], ["Mid", avg(250, 4000), 206], ["High", avg(4000, 1e5), 278]].forEach(([l, v, o]) => {
            txt(c, px + o, py + 14, l, { color: th.dispText, size: 9, align: "left" });
            txt(c, px + o + 24, py + 14, sgn(v), { color: th.orange, size: 9, align: "left" });
          });
          const gx = px + 8, gw = pw - 16, pitch = gw / NBd, gy = py + 26, gh = 62;
          const Y = v => gy + gh * (1 - clamp((v + 80) / 74, 0, 1));
          c.strokeStyle = th.dline; c.lineWidth = 1;
          [-20, -40, -60].forEach(v => { c.beginPath(); c.moveTo(gx, Math.round(Y(v)) + 0.5); c.lineTo(gx + gw, Math.round(Y(v)) + 0.5); c.stroke(); });
          for (let b = 0; b < NBd; b++) {
            const x = gx + b * pitch + 1.5;
            c.fillStyle = greyFill(); c.fillRect(x, Y(inB[b]), 5, gy + gh - Y(inB[b]));
            c.fillStyle = th.cyan; c.fillRect(x + 5.5, Y(outB[b]), 5, gy + gh - Y(outB[b]));
          }
          const dy = py + 105, dh = 26, mid = dy + dh / 2;
          legend(c, th, gx, bb, [
            [greyFill(), "In", "Grey bars: level of the input in each band."],
            [th.cyan, "Out", "Cyan bars: level of the output in each band."],
            [th.orange, "Diff", "Orange strip: output minus input in each band, in dB."]]);
          hint(gx, gy, gw, gh, "Band Levels", "The sound split into 24 frequency bands, bass at the left, treble at the right. Each pair shows the input (grey) and the output (cyan). Measured with an FFT.");
          hint(gx, dy, gw, dh, "Difference Strip", "Output minus input for each band, from -4 to +4 dB. Orange up means the console boosts that band; down means it cuts.");
          hint(gx, py + 132, gw, 10, "Frequency Scale", "Frequency in Hz. Bass is at the left, treble at the right.");
          hint(px + 138, py + 4, 62, 14, "Low Band Change", "Average change in the bands below 250 Hz, in dB. Measured as output minus input.");
          hint(px + 204, py + 4, 66, 14, "Mid Band Change", "Average change in the bands from 250 Hz to 4 kHz, in dB. Measured as output minus input.");
          hint(px + 276, py + 4, 66, 14, "High Band Change", "Average change in the bands above 4 kHz, in dB. Measured as output minus input.");
          txt(c, gx, py + 100, "Output - input (dB)", { color: th.scale, size: 8.5, align: "left" });
          txt(c, gx + gw, py + 100, "+/-4", { color: th.scale, size: 8.5, align: "right" });
          c.fillStyle = th.meterBg; c.fillRect(gx, dy, gw, dh);
          c.fillStyle = th.orange;
          dB.forEach((d, b) => { const hgt = clamp(d, -4, 4) / 4 * dh / 2; c.fillRect(gx + b * pitch + 2, hgt >= 0 ? mid - hgt : mid, pitch - 4, Math.max(1, Math.abs(hgt))); });
          c.fillStyle = th.scale; c.fillRect(gx, mid, gw, 1);
          [[50, "50"], [200, "200"], [1000, "1k"], [5000, "5k"], [15000, "15k"]].forEach(([f, s]) =>
            txt(c, gx + pitch * (Math.log10(f / 20) / 3 * NBd), py + 141, s, { color: th.scale, size: 8.5 }));
        } },
    ],
  };
})();
