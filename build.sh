#!/bin/sh
# Builds the single-file ai-image-metadata-viewer.html from the sources.
# The list of JS files and the CSS come from index.dev.html, so the load order lives in one place.
# Dependencies: POSIX sh, sed, grep, cat. Nothing to install.
set -eu

cd "$(dirname "$0")"
OUT=ai-image-metadata-viewer.html
DEV=index.dev.html
TMP="$OUT.tmp"

DESCRIPTION='Read the generation metadata inside AI images: prompt, model, seed, LoRAs and the ComfyUI graph. One offline HTML file, nothing leaves your browser.'
# Inline SVG favicon as a data URI: the page must not request anything from anywhere.
FAVICON='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E%3Crect width=%2232%22 height=%2232%22 rx=%227%22 fill=%22%2314151b%22/%3E%3Crect x=%226%22 y=%228%22 width=%2220%22 height=%2216%22 rx=%222.5%22 fill=%22none%22 stroke=%22%234fd8d0%22 stroke-width=%222%22/%3E%3Ccircle cx=%2212%22 cy=%2213.5%22 r=%222%22 fill=%22%234fd8d0%22/%3E%3Cpath d=%22M8 22l5.5-5 4 3.5 3-2.5L24 22%22 fill=%22none%22 stroke=%22%234fd8d0%22 stroke-width=%222%22 stroke-linejoin=%22round%22/%3E%3C/svg%3E'

css_files=$(grep -o 'href="src/[^"]*\.css"' "$DEV" | sed 's/href="//; s/"$//')
js_files=$(grep -o 'src="src/[^"]*\.js"' "$DEV" | sed 's/src="//; s/"$//')

{
  printf '<!doctype html>\n<html lang="en">\n<head>\n'
  printf '<meta charset="utf-8">\n'
  printf '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
  printf '<title>AI Image Metadata Viewer</title>\n'
  printf '<meta name="description" content="%s">\n' "$DESCRIPTION"
  printf '<link rel="icon" href="%s">\n' "$FAVICON"
  printf '<style>\n'
  for f in $css_files; do cat "$f"; printf '\n'; done
  printf '</style>\n</head>\n<body>\n<div id="app"></div>\n<script>\n'
  for f in $js_files; do
    printf '// ---- %s ----\n' "$f"
    cat "$f"
    printf '\n'
  done
  printf '</script>\n</body>\n</html>\n'
} > "$TMP"

# A closing script tag inside the sources would break the single-file build.
count=$(grep -c '</script' "$TMP" || true)
if [ "$count" -ne 1 ]; then
  echo "build: found </script> inside sources, refusing to produce a broken file" >&2
  rm -f "$TMP"
  exit 1
fi

mv "$TMP" "$OUT"
echo "built $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes)"
