#!/bin/sh
# Draws docs/demo/lighthouse.gif from the mock pane (docs/demo/pane.html): one screenshot per step, then a GIF.
# Needs Google Chrome and ffmpeg.
set -eu
cd "$(dirname "$0")"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
STEPS=10
# How long each step stays on screen, in seconds.
DURATIONS="2.5 2 2 1 1.5 2 2 2 1.5 3"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

i=0
for d in $DURATIONS; do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --window-size=532,800 --screenshot="$tmp/$i.png" "file://$PWD/pane.html#$i" 2>/dev/null
  printf "file '%s'\nduration %s\n" "$tmp/$i.png" "$d" >> "$tmp/list.txt"
  i=$((i + 1))
done
# The concat demuxer drops the last frame's duration unless that frame is listed again.
printf "file '%s'\n" "$tmp/$((STEPS - 1)).png" >> "$tmp/list.txt"

ffmpeg -loglevel error -y -f concat -safe 0 -i "$tmp/list.txt" \
  -vf "crop=iw:ih:0:0,scale=760:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=none" \
  -loop 0 lighthouse.gif
echo "docs/demo/lighthouse.gif written"
