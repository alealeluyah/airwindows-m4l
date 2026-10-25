# Device design rubric

How an Airwindows device must look so it reads like a Live 12 stock device.
Measured from Hybrid Reverb, Compressor, Glue Compressor and Drum Buss
(`design/refs/*L12.png`, 2× pictures: every number below is in device pixels).

Each rule has a check. A design passes when every check passes in **both**
themes (dark and light) and in every view.

## Terms

- **Tile**: a flat rectangle that holds one group of related things (the effect
  selector, a row of dials, the Input/Output column). Colour `th.tile`.
- **Gutter**: the 2 px gap between tiles. It shows the device background,
  colour `th.gutter` (lighter than tiles in both themes).
- **Screen**: the dark rectangle that shows measurements (curve, spectrum,
  needle, waveform). Colour `th.display`.
- **Strip**: a band at the top or bottom edge of a screen that holds readouts,
  legend or small buttons, split from the plot by a 1 px line (Compressor's
  bottom row, Hybrid Reverb's parameter row).
- **Button**: a clickable box with a label (View, mode, on/off).

## 1. Everything sits on a tile

| # | Rule | Check |
|---|------|-------|
| 1.1 | The device area is covered by tiles; the only visible background is the 2 px gutters and the 4 px outer margin. | No dial, label, menu or button is drawn on the gutter colour. |
| 1.2 | One tile = one group. Typical groups: selector (menu + arrows + description), screen, dials, Input/Output + View. | Each tile can be named in 1–3 words. |
| 1.3 | Tiles are square-cornered (radius ≤ 2) and flat (no gradient, no border line). | `tile()` is used; no `rr(... th.panel)` left. |
| 1.4 | Gutters are 2 px; outer margin 4 px top/bottom/left/right. | Measure on the screenshot. |
| 1.5 | Inside a tile, text and controls keep ≥ 4 px from the tile edge. | No glyph within 4 px of a tile edge. |

## 2. Screens

| # | Rule | Check |
|---|------|-------|
| 2.1 | A screen is drawn with `screen()`: `th.display`, radius 2, it fills its tile (the screen *is* the tile, no tile border around it). | Screen edges line up with the neighbour tiles. |
| 2.2 | One main screen per view, the largest element of the device (≥ 35 % of the device width), like Compressor/Hybrid Reverb. | Measure. |
| 2.3 | Readouts that belong to the measurement (Gain, Peak, Decay time …) and the legend go in a **strip** at the top or bottom of the screen, never floating over the plot. | Strip separated by a 1 px `th.dline` line. |
| 2.4 | Values in a screen: grey label (`th.dispText`), coloured value (cyan for "now"/output, orange for change/reduction). | Same pair everywhere. |
| 2.5 | Plot data never touches the screen edge: 3 px inner padding; grid lines `th.dline`. | Measure. |
| 2.6 | Waveforms and scopes use a **fixed scale** (true level, 1×): no automatic zoom. A quiet signal looks quiet. | No "Zoom" readout anywhere. |

## 3. Buttons and menus

| # | Rule | Check |
|---|------|-------|
| 3.1 | Every clickable thing has a visible box: off = `th.ctrlBg` fill + 1 px `th.frame` border; on = `th.on` (orange) fill, dark text. No bare clickable text. | Every `toggle()`/`viewTabs()` shows a box in both states. |
| 3.2 | Height 15 px; width = text + 12 px; stacked buttons 1 px apart (Drum Buss Soft/Medium/Hard). | Measure. |
| 3.3 | Buttons sit on a tile, or in a screen strip — never on the plot. | — |
| 3.4 | The effect menu (`menu()`) and arrows sit together on the top row of the selector tile or the screen's top strip. | — |

## 4. Dials and numbers

| # | Rule | Check |
|---|------|-------|
| 4.1 | Dial layout: name above (13 px), dial, value below — Live's own `live.dial`. | `knob()` used. |
| 4.2 | Dials sit on a tile, never on a screen. Exception: a Hybrid-style strip of draggable numbers (`readout()`) at the bottom of a screen. | — |
| 4.3 | Dials in one tile are on a grid: equal cell width, rows aligned. | `knobGrid()` or equal spacing. |
| 4.4 | When a tile has more than one group of dials, a 1 px divider (`th.divider`) splits them, like Drum Buss. | — |

## 5. Colour meaning (same in every device)

| Colour | Meaning |
|--------|---------|
| grey (`InputCurveColor`) | input, dry, "before" |
| cyan (`th.cyan`) | output, wet, "after", current value |
| orange (`th.orange`) | change: gain reduction, boost/cut, difference, the selected thing |
| green → orange | level meters |

Every colour used in a screen appears in its legend (rule 2.3).

## 6. Theme

| # | Rule | Check |
|---|------|-------|
| 6.1 | All colours come from `tok()`. In the device, `tok()` follows the user's Live theme: the display reads the theme colours with `max.getcolor()` on every redraw, and `live.colors` triggers a redraw when the theme changes (578f3ad), so custom themes match. | No hex colour in a design file except data colours that come from `tok()` too. |
| 6.2 | Every tile differs from the gutter, and every screen from its tile, by ≥ 6 % luminance in both themes. | `contrast` check in `smoke.js`. |

## 7. Help

| # | Rule | Check |
|---|------|-------|
| 7.1 | Every screen, strip readout, legend item, meter and button has an Info View text (`hint()`). | Hover on the review page. |

## 8. Layout order (left → right)

Selector tile · screen · dial tile(s) · Input/Output + View tile.
A design may put the selector in the screen's top strip instead of its own tile.
