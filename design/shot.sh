#!/bin/zsh
# Headless screenshot of one category's review page (needs design/server.py running on :8765).
#   design/shot.sh "<Category>" out.png [dark|light] [zoom] [sim|real] [final]
# Uses a private Chrome profile per call, so several can run at once.
cat="$1"; out="$2"; theme="${3:-dark}"; zoom="${4:-2}"; sig="${5:-sim}"; [ "$sig" = real ] && rq="&real=1" || rq=""; [ -n "$6" ] && rq="$rq&only=$6"
prof=$(mktemp -d -t awshot)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --user-data-dir="$prof" --window-size=1900,3400 --virtual-time-budget=4000 \
  --screenshot="$out" "http://localhost:8765/?zoom=$zoom&theme=$theme$rq#$(python3 -I -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$cat")" >/dev/null 2>&1
rm -rf "$prof"
[ -s "$out" ] && echo "$out" || { echo "screenshot failed" >&2; exit 1; }
