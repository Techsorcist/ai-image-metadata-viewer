#!/bin/sh
# Builds the single-file ai-image-metadata-viewer.html from the sources.
# The list of JS files and the CSS come from index.dev.html, so the load order lives in one place.
# Dependencies: POSIX sh, sed, grep, cat. Nothing to install.
set -eu

cd "$(dirname "$0")"
OUT=ai-image-metadata-viewer.html
DEV=index.dev.html
TMP="$OUT.tmp"

css_files=$(grep -o 'href="src/[^"]*\.css"' "$DEV" | sed 's/href="//; s/"$//')
js_files=$(grep -o 'src="src/[^"]*\.js"' "$DEV" | sed 's/src="//; s/"$//')

{
  printf '<!doctype html>\n<html lang="en">\n<head>\n'
  printf '<meta charset="utf-8">\n'
  printf '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
  printf '<title>AI Image Metadata Viewer</title>\n'
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
