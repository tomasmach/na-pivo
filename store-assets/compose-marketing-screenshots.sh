#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MASTER_APP="$ROOT/store-assets/raw/master-beer-phone.png"
MASTER_PLAY="$ROOT/store-assets/raw/master-beer-phone-9x16.png"
SOURCE_DIR="$ROOT/store-assets/source"
APP_DIR="$ROOT/store-assets/appstore"
PLAY_DIR="$ROOT/store-assets/googleplay"
FONT_HEAD="$ROOT/assets/fonts/Baloo2-ExtraBold.ttf"
FONT_SUB="$ROOT/assets/fonts/Baloo2-SemiBold.ttf"
CREAM="#fff1d5"
AMBER="#e79a21"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$APP_DIR" "$PLAY_DIR"

make_rounded_screen() {
  local source="$1"
  local width="$2"
  local height="$3"
  local radius="$4"
  local output="$5"

  magick "$source" \
    -alpha off \
    -resize "${width}x${height}^" \
    -gravity center \
    -extent "${width}x${height}" \
    "$WORK/screen.png"

  magick -size "${width}x${height}" xc:none \
    -fill white \
    -draw "roundrectangle 0,0 $((width - 1)),$((height - 1)) ${radius},${radius}" \
    "$WORK/mask.png"

  magick "$WORK/screen.png" "$WORK/mask.png" \
    -alpha off \
    -compose CopyOpacity \
    -composite \
    "$output"
}

make_label() {
  local text="$1"
  local font="$2"
  local size="$3"
  local color="$4"
  local output="$5"

  magick -background none -fill "$color" -font "$font" -pointsize "$size" \
    -gravity center "label:${text}" "$output"
}

compose_appstore() {
  local name="$1"
  local headline="$2"
  local subheadline="$3"
  local source="$4"
  local output="$APP_DIR/${name}.png"

  # Remove only 110 px of empty background above the phone, then scale proportionally.
  magick \
    \( "$MASTER_APP" -crop 853x580+0+0 +repage \) \
    \( "$MASTER_APP" -crop 853x1154+0+690 +repage \) \
    -append \
    -resize 1320x \
    -background "#100b08" \
    -gravity north \
    -extent 1320x2868 \
    "$WORK/base-app.png"

  make_rounded_screen "$source" 628 1365 52 "$WORK/ui-app.png"
  make_label "$headline" "$FONT_HEAD" 84 "$CREAM" "$WORK/head-app.png"
  make_label "$subheadline" "$FONT_SUB" 43 "$AMBER" "$WORK/sub-app.png"

  magick "$WORK/base-app.png" \
    "$WORK/ui-app.png" -geometry +346+919 -compose Over -composite \
    "$WORK/head-app.png" -gravity north -geometry +0+348 -compose Over -composite \
    "$WORK/sub-app.png" -gravity north -geometry +0+488 -compose Over -composite \
    -alpha off -colorspace sRGB -strip "$output"
}

compose_googleplay() {
  local name="$1"
  local headline="$2"
  local subheadline="$3"
  local source="$4"
  local output="$PLAY_DIR/${name}.png"

  # Scale proportionally to width, then trim only excess foam/floor to exact 9:16.
  magick "$MASTER_PLAY" \
    -resize 1080x \
    -gravity center \
    -crop 1080x1920+0+0 +repage \
    "$WORK/base-play.png"

  make_rounded_screen "$source" 539 1172 46 "$WORK/ui-play.png"
  make_label "$headline" "$FONT_HEAD" 61 "$CREAM" "$WORK/head-play.png"
  make_label "$subheadline" "$FONT_SUB" 32 "$AMBER" "$WORK/sub-play.png"

  magick "$WORK/base-play.png" \
    "$WORK/ui-play.png" -geometry +272+603 -compose Over -composite \
    "$WORK/head-play.png" -gravity north -geometry +0+150 -compose Over -composite \
    "$WORK/sub-play.png" -gravity north -geometry +0+245 -compose Over -composite \
    -alpha off -colorspace sRGB -strip "$output"
}

compose_appstore "02-kompas" "Nejkratší cesta na pivo" "Kompas tě dovede rovnou k hospodě" "$SOURCE_DIR/kompas.png"
compose_appstore "03-pocitadlo" "Čárkuj piva jak na tácku" "Piva i útrata pod palcem" "$SOURCE_DIR/pocitadlo.png"
compose_appstore "04-mapa" "Nech za sebou pivní stopu" "Objevuj hospody kolem sebe" "$SOURCE_DIR/mapa.png"

compose_googleplay "02-kompas" "Nejkratší cesta na pivo" "Kompas tě dovede rovnou k hospodě" "$SOURCE_DIR/kompas.png"
compose_googleplay "03-pocitadlo" "Čárkuj piva jak na tácku" "Piva i útrata pod palcem" "$SOURCE_DIR/pocitadlo.png"
compose_googleplay "04-mapa" "Nech za sebou pivní stopu" "Objevuj hospody kolem sebe" "$SOURCE_DIR/mapa.png"
