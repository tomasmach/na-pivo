#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MASTER_APP="$ROOT/store-assets/raw/master-beer-phone.png"
MASTER_PLAY="$ROOT/store-assets/raw/master-beer-phone-9x16.png"
MASTER_CLOSING="$ROOT/store-assets/raw/master-beer-phone-closing.png"
SOURCE_DIR="$ROOT/store-assets/source"
APP_DIR="$ROOT/store-assets/appstore"
PLAY_DIR="$ROOT/store-assets/googleplay"
FONT_HEAD="$ROOT/assets/fonts/Baloo2-ExtraBold.ttf"
FONT_SUB="$ROOT/assets/fonts/Baloo2-SemiBold.ttf"
CREAM="#fff1d5"
AMBER="#efa510"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$APP_DIR" "$PLAY_DIR"

rounded_screen() {
  local source="$1" width="$2" height="$3" radius="$4" output="$5"

  magick "$source" -alpha off -resize "${width}x${height}^" \
    -gravity center -extent "${width}x${height}" "$WORK/screen.png"
  magick -size "${width}x${height}" xc:none -fill white \
    -draw "roundrectangle 0,0 $((width - 1)),$((height - 1)) ${radius},${radius}" \
    "$WORK/mask.png"
  magick "$WORK/screen.png" "$WORK/mask.png" -alpha off \
    -compose CopyOpacity -composite "$output"
}

caption() {
  local text="$1" width="$2" pointsize="$3" color="$4" output="$5"
  # Baloo 2 has very tall vertical metrics; ~-0.58em keeps lines visually tight
  local spacing=$(( -(pointsize * 58) / 100 ))
  magick -background none -fill "$color" -font "$FONT_HEAD" \
    -pointsize "$pointsize" -gravity center -interline-spacing "$spacing" \
    -size "${width}x" "caption:${text}" "$output"
}

label() {
  local text="$1" pointsize="$2" color="$3" font="$4" output="$5"
  magick -background none -fill "$color" -font "$font" -pointsize "$pointsize" \
    -gravity center "label:${text}" "$output"
}

split_headline() {
  local left="$1" right="$2" pointsize="$3" output="$4"
  label "$left" "$pointsize" "$CREAM" "$FONT_HEAD" "$WORK/head-left.png"
  label "$right" "$pointsize" "$AMBER" "$FONT_HEAD" "$WORK/head-right.png"
  magick "$WORK/head-left.png" "$WORK/head-right.png" +append "$output"
}

base_appstore() {
  magick \
    \( "$MASTER_APP" -crop 853x480+0+0 +repage \) \
    \( "$MASTER_APP" -crop 853x1154+0+690 +repage \) \
    -append -resize x2868 -gravity center -crop 1320x2868+0+0 +repage \
    "$WORK/base.png"
}

add_closing_foam() {
  local width="$1" crop_height="$2" output="$3"
  local fade_height=$((crop_height / 5))
  local solid_height=$((crop_height - fade_height))

  magick "$MASTER_CLOSING" -crop 1024x300+0+0 +repage \
    -resize "${width}x" "$WORK/closing-foam.png"
  local rendered_height
  rendered_height="$(magick identify -format '%h' "$WORK/closing-foam.png")"
  solid_height=$((rendered_height - fade_height))
  magick -size "${width}x${solid_height}" xc:white \
    -size "${width}x${fade_height}" gradient:white-black -append \
    "$WORK/closing-mask.png"
  magick "$WORK/closing-foam.png" "$WORK/closing-mask.png" \
    -alpha off -compose CopyOpacity -composite "$output"
}

base_googleplay() {
  magick "$MASTER_PLAY" -resize 1080x -gravity center \
    -crop 1080x1920+0+0 +repage "$WORK/base.png"
}

compose_appstore() {
  local name="$1" headline="$2" subheadline="$3" source="$4" split="${5:-}"
  local output="$APP_DIR/${name}.png"
  local head_geometry=-25+265
  local sub_y=670

  base_appstore
  # screen opening measured on master: x 296-1009, y 864-2465
  rounded_screen "$source" 713 1601 105 "$WORK/ui.png"
  if [[ -n "$split" ]]; then
    add_closing_foam 1320 387 "$WORK/closing-overlay.png"
    magick "$WORK/base.png" "$WORK/closing-overlay.png" -gravity north \
      -compose Over -composite "$WORK/base-closing.png"
    mv "$WORK/base-closing.png" "$WORK/base.png"
    split_headline "Na " "zdraví!" 220 "$WORK/head.png"
    head_geometry=+0+265
    sub_y=640
  else
    caption "$headline" 1230 156 "$CREAM" "$WORK/head.png"
    sub_y=$(( 265 + $(magick identify -format '%h' "$WORK/head.png") + 44 ))
  fi
  label "$subheadline" 56 "$AMBER" "$FONT_SUB" "$WORK/sub.png"

  magick "$WORK/base.png" \
    "$WORK/ui.png" -geometry +296+864 -compose Over -composite \
    "$WORK/head.png" -gravity north -geometry "$head_geometry" -compose Over -composite \
    "$WORK/sub.png" -gravity north -geometry "+0+${sub_y}" -compose Over -composite \
    -alpha off -colorspace sRGB -strip "$output"
}

compose_googleplay() {
  local name="$1" headline="$2" subheadline="$3" source="$4" split="${5:-}"
  local output="$PLAY_DIR/${name}.png"
  local head_y=125
  local sub_y=430

  base_googleplay
  # screen opening measured on master: x 280-798, y 607-1816
  rounded_screen "$source" 518 1209 76 "$WORK/ui.png"
  if [[ -n "$split" ]]; then
    add_closing_foam 1080 316 "$WORK/closing-overlay.png"
    magick "$WORK/base.png" "$WORK/closing-overlay.png" -gravity north \
      -compose Over -composite "$WORK/base-closing.png"
    mv "$WORK/base-closing.png" "$WORK/base.png"
    split_headline "Na " "zdraví!" 165 "$WORK/head.png"
    head_y=155
    sub_y=365
  else
    caption "$headline" 1030 118 "$CREAM" "$WORK/head.png"
    sub_y=$(( 125 + $(magick identify -format '%h' "$WORK/head.png") + 34 ))
  fi
  label "$subheadline" 40 "$AMBER" "$FONT_SUB" "$WORK/sub.png"

  magick "$WORK/base.png" \
    "$WORK/ui.png" -geometry +280+607 -compose Over -composite \
    "$WORK/head.png" -gravity north -geometry "+0+${head_y}" -compose Over -composite \
    "$WORK/sub.png" -gravity north -geometry "+0+${sub_y}" -compose Over -composite \
    -alpha off -colorspace sRGB -strip "$output"
}

if [[ "${ONLY_FINAL:-0}" != "1" ]]; then
  compose_appstore "01-kompas" $'Nejkratší cesta\nna pivo' \
    "Kompas tě dovede rovnou k hospodě" "$SOURCE_DIR/kompas.png"
  compose_appstore "02-pocitadlo" $'Čárkuj piva\njak na tácku' \
    "Piva i útrata pod palcem" "$SOURCE_DIR/pocitadlo.png"
  compose_appstore "03-mapa" $'Nech za sebou\npivní stopu' \
    "Objevuj hospody kolem sebe" "$SOURCE_DIR/mapa.png"
  compose_appstore "04-parta" $'Cinkni partě,\nže sedíš' \
    "Kámoši hned ví, kam dorazit" "$SOURCE_DIR/parta.png"

  compose_googleplay "01-kompas" $'Nejkratší cesta\nna pivo' \
    "Kompas tě dovede rovnou k hospodě" "$SOURCE_DIR/kompas.png"
  compose_googleplay "02-pocitadlo" $'Čárkuj piva\njak na tácku' \
    "Piva i útrata pod palcem" "$SOURCE_DIR/pocitadlo.png"
  compose_googleplay "03-mapa" $'Nech za sebou\npivní stopu' \
    "Objevuj hospody kolem sebe" "$SOURCE_DIR/mapa.png"
  compose_googleplay "04-parta" $'Cinkni partě,\nže sedíš' \
    "Kámoši hned ví, kam dorazit" "$SOURCE_DIR/parta.png"
fi

compose_appstore "05-historie" $'Večer se\nzapíše sám' \
  "Piva, ceny i poznámky z večera" "$SOURCE_DIR/historie.png"
compose_appstore "06-zmapuj" $'Zmapuj hospodu\npro ostatní' \
  "Šipky, kulečník i sport v telce" "$SOURCE_DIR/zmapuj.png"
compose_appstore "07-nazdravi" "Na zdraví!" \
  "Dej si jedno za mě" "$SOURCE_DIR/nazdravi.png" split

compose_googleplay "05-historie" $'Večer se\nzapíše sám' \
  "Piva, ceny i poznámky z večera" "$SOURCE_DIR/historie.png"
compose_googleplay "06-zmapuj" $'Zmapuj hospodu\npro ostatní' \
  "Šipky, kulečník i sport v telce" "$SOURCE_DIR/zmapuj.png"
compose_googleplay "07-nazdravi" "Na zdraví!" \
  "Dej si jedno za mě" "$SOURCE_DIR/nazdravi.png" split
