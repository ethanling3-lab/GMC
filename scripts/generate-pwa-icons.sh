#!/usr/bin/env bash
#
# M7.1d — Generate PWA home-screen icons from the GMC brand logo.
#
# Outputs four PNGs into gmc-crm/public/icons/:
#   gmc-scan-192.png         — Android home screen
#   gmc-scan-512.png         — Android splash + Chrome
#   gmc-scan-maskable-512.png — Android adaptive icon (extra safe-zone padding)
#   gmc-scan-apple-touch.png  — iOS Safari home screen (1024×1024)
#
# Tooling: macOS-built-in `sips` only — no npm dep, no ImageMagick.
# The source logo is wide-format (1920×1080); we pad to a square against
# the paper-warm brand background so the icon looks intentional on every
# home screen.
#
# Run from the gmc-crm/ directory.
#
# Tested on macOS 14+. On Linux you'd need to swap `sips` for ImageMagick.

set -euo pipefail

SRC="/Users/ethanling/Documents/Ethan/BMI - Claude AI/5. CRM FOR DR WU/brand_assets/GMC Logo Transparent Background.png"
OUT_DIR="$(dirname "$0")/../public/icons"
TMP_DIR="$(mktemp -d)"
trap "rm -rf $TMP_DIR" EXIT

mkdir -p "$OUT_DIR"

# Step 1 — pad the source into a 1920×1920 square against paper-warm
# (#F5EFE3). `sips --padColor` takes the standard 6-digit hex.
PAD_HEX="F5EFE3"

cp "$SRC" "$TMP_DIR/source.png"
sips --padToHeightWidth 1920 1920 \
     --padColor "$PAD_HEX" \
     "$TMP_DIR/source.png" \
     --out "$TMP_DIR/square.png" >/dev/null

# Step 2 — resize to the four target sizes
sips -z 192 192 "$TMP_DIR/square.png" --out "$OUT_DIR/gmc-scan-192.png" >/dev/null
sips -z 512 512 "$TMP_DIR/square.png" --out "$OUT_DIR/gmc-scan-512.png" >/dev/null
sips -z 1024 1024 "$TMP_DIR/square.png" --out "$OUT_DIR/gmc-scan-apple-touch.png" >/dev/null

# Step 3 — maskable variant: add 10% extra padding so Android's circle /
# squircle mask doesn't crop the GMC mark.
sips --padToHeightWidth 2304 2304 \
     --padColor "$PAD_HEX" \
     "$TMP_DIR/square.png" \
     --out "$TMP_DIR/maskable-source.png" >/dev/null
sips -z 512 512 "$TMP_DIR/maskable-source.png" \
     --out "$OUT_DIR/gmc-scan-maskable-512.png" >/dev/null

echo "Generated icons in $OUT_DIR:"
ls -1 "$OUT_DIR" | sed 's/^/  /'
