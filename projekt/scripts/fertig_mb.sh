#!/usr/bin/env bash
# Motion-blur finish: 4 sub-frames -> 1 blurred frame (180° shutter), 30 fps, upscaled to 1440x2560 for YouTube's
# better encode. The result has no sound yet: add voice, music and captions with tools/deutsch.py fertig.
# usage: bash scripts/fertig_mb.sh <Name>ShortMB out/<name> [frames, e.g. 0-479 = the first 4 s at 120 fps]
set -e
COMP="${1:?composition, e.g. PisaShortMB}"; OUT="${2:?output folder, e.g. out/pisa}"; FRAMES="$3"
WIN_CHROME="C:/Program Files/Google/Chrome/Application/chrome.exe"
[ -z "$CHROME" ] && [ -f "$WIN_CHROME" ] && CHROME="$WIN_CHROME"
mkdir -p "$OUT"
npx remotion render src/index.ts "$COMP" "$OUT/mb.mp4" --codec h264 --crf 14 --gl angle \
  ${CHROME:+--browser-executable "$CHROME"} ${FRAMES:+--frames "$FRAMES"}
ffmpeg -v error -y -i "$OUT/mb.mp4" \
  -vf "tmix=frames=4:weights='1 1 1 1',select='eq(mod(n\,4)\,3)',setpts=N/30/TB,fps=30,scale=1440:2560:flags=lanczos" \
  -an -c:v libx264 -crf 15 -preset slow -pix_fmt yuv420p "$OUT/bild.mp4"
ffprobe -v error -show_entries stream=width,height,nb_frames,duration -of compact "$OUT/bild.mp4"
echo "-> $OUT/bild.mp4  (next: python tools/deutsch.py fertig $OUT/bild.mp4 ...)"
