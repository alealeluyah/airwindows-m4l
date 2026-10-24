# Airwindows for Max for Live

All [Airwindows](https://www.airwindows.com) effects by Chris Johnson as Max for Live
audio effects for Ableton Live 12 — one device per category, with Live's own controls.

Unofficial. Airwindows is the work of Chris Johnson; this project only wraps it.

| Device | Effects |
|---|---|
| Airwindows Ambience | 25 |
| Airwindows Amp Sims | 17 |
| Airwindows Bass | 10 |
| Airwindows Biquads | 9 |
| Airwindows Brightness | 26 |
| Airwindows Clipping | 9 |
| Airwindows Consoles | 45 |
| Airwindows Distortion | 14 |
| Airwindows Dithers | 23 |
| Airwindows Dynamics | 35 |
| Airwindows Effects | 28 |
| Airwindows Filter | 53 |
| Airwindows Lo-Fi | 21 |
| Airwindows Noise | 9 |
| Airwindows Reverb | 42 |
| Airwindows Saturation | 18 |
| Airwindows Stereo | 12 |
| Airwindows Subtlety | 20 |
| Airwindows Tape | 12 |
| Airwindows Tone Color | 17 |
| Airwindows Unclassified | 2 |
| Airwindows Utility | 38 |
| Airwindows XYZ Filters | 24 |

509 effects in total. The categories are Chris Johnson's own, as used by
[Airwindows Consolidated](https://github.com/baconpaul/airwin2rack).

## How it works

- `airwin~` is a Max external that runs any Airwindows effect. It is built from the
  Airwindows source as packaged by airwin2rack, so the sound is the original code,
  not a re-implementation.
- Each device has a menu with the effects of its category and up to 13 dials. When you
  pick an effect, the dials take that effect's control names and value text, and unused
  dials hide.
- Automation lanes are named `Effect` and `Param 1` … `Param 13`, because Live needs fixed
  parameter names.
- Live restores the effect first and the dial values after it, so a saved set comes back
  exactly. The menu order of each device is fixed in `tools/effect_order.json`: new
  Airwindows effects are added at the end, so saved sets never load a different effect.
- The look follows Ableton's own Max for Live devices: Ableton Sans labels, value text
  under each dial, previous/next arrows next to the effect menu.

## Install (macOS, Live 12 Suite or Max for Live)

1. Put this folder (or the release zip) in `~/Documents/Max 9/Packages/`, so that
   `~/Documents/Max 9/Packages/airwindows-m4l/externals/airwin~.mxo` exists.
2. Copy the files in `devices/` to your User Library, for example
   `~/Music/Ableton/User Library/Presets/Audio Effects/Max Audio Effect/Airwindows/`.
3. In Live's browser, open *User Library → Presets → Audio Effects → Max Audio Effect →
   Airwindows* and drag a device to a track.

Windows: the same, with `airwin~.mxe64`. Download the package for your system from the
[latest CI run or release](https://github.com/alealeluyah/airwindows-m4l/actions).

## Build

Requirements: CMake 3.19+, Ninja, a C++17 compiler, Python 3.

```sh
git clone --recursive https://github.com/alealeluyah/airwindows-m4l.git
cd airwindows-m4l
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build
./build/tools/awtool/awtool check 48000          # runs every effect on test audio
./build/tools/awtool/awtool dump > build/registry.json
python3 tools/gen_devices.py build/registry.json devices
```

The external is written to `externals/airwin~.mxo` (universal: arm64 and x86_64).

## Verification

`tools/nulltest` (macOS) renders every effect through `airwin~`'s code and through the
Airwindows Consolidated Audio Unit built from the same airwin2rack commit. The float path
is bit-identical for 506 of 507 testable effects. The double path, which `airwin~` uses,
matches for 498; the other 9 differ because Airwindows' own float and double functions
differ for those effects (details in `tools/nulltest/results_48k.txt`).

## Licenses

- This project: MIT (see `LICENSE`).
- Airwindows: MIT, © Chris Johnson.
- airwin2rack / Airwindows Consolidated: MIT, © Paul Walker and contributors.
- Max SDK (max-sdk-base): MIT, © Cycling '74.
