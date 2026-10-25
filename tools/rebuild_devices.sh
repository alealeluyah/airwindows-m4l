#!/bin/zsh
# Build the 22 devices from the approved designs and install them in Live's User Library.
#   tools/rebuild_devices.sh [--no-install]
# Views per device: design/final.json, else design/decisions.json (approved on the review page), else the first option.
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
