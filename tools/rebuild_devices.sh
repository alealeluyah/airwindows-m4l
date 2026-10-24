#!/bin/zsh
# Build the 22 devices from the approved designs and install them in Live's User Library.
#   tools/rebuild_devices.sh [--no-install]
# Uses design/decisions.json (options approved on the review page; first option otherwise).
set -e
ROOT=${0:A:h:h}
cd "$ROOT"
python3 -I tools/build_ui.py
python3 -I tools/gen_devices.py build/registry.json devices
if [ "$1" != "--no-install" ]; then
  DEST="$HOME/Music/Ableton/User Library/Presets/Audio Effects/Max Audio Effect/Airwindows"
  mkdir -p "$DEST"
  cp devices/*.amxd "$DEST/"
  mkdir -p "$DEST/Ableton Folder Info"
  cp "devices/Ableton Folder Info/"*.xmp "$DEST/Ableton Folder Info/"
  echo "installed $(ls devices/*.amxd | wc -l | tr -d ' ') devices in $DEST"
fi
