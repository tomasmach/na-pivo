#!/usr/bin/env bash
# App Store 6.9" frames for Na pivo 2.0.
#
# One visual language for all seven: the amber beer macro fills the frame, the
# phone stands in it and reaches the bottom edge, and a single cream headline
# sits in a stout veil at the top. Some headlines put one phrase in amber; the
# accent is the brand colour, so it reads as emphasis rather than decoration.
#
# Each frame gets its own tilt, scale and horizontal offset. Seven identical
# poses read as a template; the angles alternate left and right so the set still
# looks like one family.
#
# Everything except the background is composed deterministically, so the copy
# and the real screenshots can never be redrawn or invented.
#
# Usage: compose-appstore-2.0.sh [cs|en] [appstore|play]   (default cs appstore)
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/.." && pwd)"
export MAGICK_TEMPORARY_PATH="$DIR"

LOCALE="${1:-cs}"
STORE="${2:-appstore}"
case "$LOCALE" in
  cs) SRC="$DIR/source-2.0" ;;
  en) SRC="$DIR/source-2.0-en" ;;
  *)  echo "Unknown locale: $LOCALE (use cs or en)" >&2; exit 1 ;;
esac
# Play wants 9:16 at most; the App Store frame is 1:2.17 and would be rejected.
# The shorter canvas is not a resize of the taller one, so the phone, the type
# and the veil all shrink by their own factor and the frame is recomposed.
case "$STORE" in
  appstore) W=1320; H=2868; PT=160; MAXW=1160; VEIL_H=760; HEAD_Y=170; FOOT=34; PHONE_MUL=100 ;;
  play)     W=1080; H=1920; PT=118; MAXW=930;  VEIL_H=520; HEAD_Y=108; FOOT=20; PHONE_MUL=76  ;;
  *)  echo "Unknown store: $STORE (use appstore or play)" >&2; exit 1 ;;
esac
OUT="$DIR/$STORE-2.0"; [[ "$LOCALE" == en ]] && OUT="$OUT-en"
WORK="$DIR/.work-$STORE-2.0-$LOCALE"
BG="$DIR/variants-2.0/background-B.png"
FONT="$ROOT/assets/fonts/Baloo2-ExtraBold.ttf"

CREAM='#FBF3E0'
AMBER='#E8A317'
STOUT='#15120F'
# Visual gap between the two trimmed lines. Baloo runs tight at display sizes.
GAP=$(( PT * 26 / 160 ))

rm -rf "$WORK"
mkdir -p "$WORK" "$OUT"

# --- phone -----------------------------------------------------------------
build_phone() { # $1 = source screenshot, $2 = tilt degrees, $3 = scale percent
  # 1206x2622 * 2/3 = 804x1748 exactly, so the screenshot never stretches.
  magick "$1" -alpha off -resize 804x1748 "$WORK/screen.png"
  magick -size 804x1748 xc:black -fill white \
    -draw 'roundrectangle 0,0 803,1747 100,100' "$WORK/screen-mask.png"
  magick "$WORK/screen.png" "$WORK/screen-mask.png" -alpha off \
    -compose CopyOpacity -composite "$WORK/screen-rounded.png"
  magick -size 860x1804 xc:none \
    -fill '#58544E' -draw 'roundrectangle 0,0 859,1803 128,128' \
    -fill '#181716' -draw 'roundrectangle 3,3 856,1800 125,125' \
    -fill '#939089' -draw 'roundrectangle 6,6 853,1797 122,122' \
    -fill '#292724' -draw 'roundrectangle 9,9 850,1794 119,119' \
    -fill '#050505' -draw 'roundrectangle 15,15 844,1788 112,112' \
    "$WORK/screen-rounded.png" -geometry +28+28 -compose Over -composite "$WORK/phone.png"
  # Scale the finished mock, then rotate it, so the screenshot resamples once.
  # -rotate, not -distort: it is the one that keeps the new corners transparent.
  magick "$WORK/phone.png" -filter Lanczos -resize "$3%" +repage "$WORK/phone-scaled.png"
  magick "$WORK/phone-scaled.png" -background none -rotate "$2" +repage "$WORK/phone-tilt.png"
  PHONE_W=$(magick identify -format '%w' "$WORK/phone-tilt.png")
  PHONE_H=$(magick identify -format '%h' "$WORK/phone-tilt.png")
  local rw="$PHONE_W" rh="$PHONE_H"
  # Shadow from the mock's own alpha, offset further than it is blurred, so it
  # reads as a cast shadow and not as a halo around the phone.
  magick "$WORK/phone-tilt.png" -alpha extract -blur 0x26 \
    -evaluate multiply 0.5 "$WORK/shadow-mask.png"
  magick -size "${rw}x${rh}" xc:'#0B0906' "$WORK/shadow-mask.png" \
    -alpha off -compose CopyOpacity -composite "$WORK/shadow.png"
  magick -size "$(( rw + 140 ))x$(( rh + 140 ))" xc:none \
    "$WORK/shadow.png" -geometry +46+56 -compose Over -composite \
    "$WORK/phone-tilt.png" -geometry +0+0 -compose Over -composite \
    "$WORK/phone-final.png"
}

# --- headline --------------------------------------------------------------
# A line is "text|colour" segments joined by "@@". label: keeps trailing
# spaces but drops leading ones, so every space belongs to the segment on its
# left. Segments share one point size, so +append lines up their baselines.
render_line() { # $1 = spec, $2 = output
  local spec="$1" out="$2" i=0 parts=()
  local IFS='@'
  read -ra chunks <<< "${spec//@@/@}"
  IFS=$' \t\n'
  for chunk in "${chunks[@]}"; do
    local text="${chunk%|*}" colour="${chunk##*|}"
    magick -background none -fill "$colour" -font "$FONT" -pointsize "$PT" \
      "label:$text" "$WORK/seg-$i.png"
    parts+=("$WORK/seg-$i.png")
    i=$((i + 1))
  done
  # Append first, trim after: the segments keep one baseline inside the line,
  # and the trim strips Baloo's padding without eating the ascenders.
  magick "${parts[@]}" +append -trim +repage "$out"
}

build_headline() { # $1 = line 1 spec, $2 = line 2 spec
  render_line "$1" "$WORK/line1.png"
  render_line "$2" "$WORK/line2.png"
  magick -size "10x${GAP}" xc:none "$WORK/line-gap.png"
  magick "$WORK/line1.png" "$WORK/line-gap.png" "$WORK/line2.png" -background none \
    -gravity center -append -trim +repage "$WORK/headline.png"
  # Fit the column, but never enlarge: a short headline scaled up to the same
  # width would render in a visibly bigger type than its neighbours.
  local bw
  bw=$(magick identify -format '%w' "$WORK/headline.png")
  if (( bw > MAXW )); then
    magick "$WORK/headline.png" -filter Lanczos -resize "${MAXW}x" "$WORK/headline.png"
  fi
}

# --- background ------------------------------------------------------------
# Same macro on every frame, but shifted and occasionally mirrored so the foam
# line and the bubbles are not identical seven times over.
BG_H=$(( H * 3460 / 2868 ))
build_background() { # $1 = vertical offset (in App Store pixels), $2 = 1 to mirror
  magick "$BG" -alpha off -resize "${W}x${BG_H}^" -gravity center -extent "${W}x${BG_H}" \
    "$WORK/bg-full.png"
  if [[ "$2" == 1 ]]; then
    magick "$WORK/bg-full.png" -flop "$WORK/bg-full.png"
  fi
  # The frame table carries offsets in App Store pixels; scale them so the same
  # row keeps the same crop of the macro on the shorter Play canvas.
  local off=$(( $1 * H / 2868 ))
  magick "$WORK/bg-full.png" -crop "${W}x${H}+0+${off}" +repage "$WORK/base.png"
}

magick -size "${W}x${VEIL_H}" gradient:"${STOUT}F2-${STOUT}00" "$WORK/veil.png"

frame() { # name, screenshot, line1, line2, bg offset, mirror, tilt, scale, x nudge
  local name="$1" shot="$2" l1="$3" l2="$4" off="$5" mirror="$6"
  local tilt="$7" scale="$8" nudge="$9"
  build_phone "$SRC/$shot" "$tilt" "$(( scale * PHONE_MUL / 100 ))"
  build_headline "$l1" "$l2"
  build_background "$off" "$mirror"
  # Placement uses the phone's own box; the 140 px padding only carries the
  # shadow. Bottom sits just past the frame edge so the mock reads as anchored.
  local px py maxx nx
  nx=$(( nudge * W / 1320 ))
  px=$(( (W - PHONE_W) / 2 + nx ))
  maxx=$(( W - PHONE_W + 18 ))
  (( px < -18 )) && px=-18
  (( px > maxx )) && px=$maxx
  py=$(( H - PHONE_H + FOOT ))
  magick "$WORK/base.png" \
    "$WORK/veil.png" -gravity north -geometry +0+0 -compose Over -composite \
    "$WORK/phone-final.png" -gravity northwest -geometry "+${px}+${py}" -compose Over -composite \
    "$WORK/headline.png" -gravity north -geometry "+0+${HEAD_Y}" -compose Over -composite \
    -crop "${W}x${H}+0+0" +repage \
    -alpha off -colorspace sRGB -strip "PNG24:$OUT/$name.png"
  echo "  $name.png"
}

echo "Building 2.0 frames ($STORE, $LOCALE):"
if [[ "$LOCALE" == cs ]]; then
  frame 01-hospody  01-hospody.png \
    "Nejbližší pivo máš|$CREAM" \
    "dva metry |$AMBER@@odsud|$CREAM" 40 0 5 110 0
  frame 02-vecer    02-vecer.png \
    "Počítá celej stůl,|$CREAM" \
    "ne jenom tebe|$CREAM" 300 1 -6 104 60
  frame 03-kocoviny 03-kocoviny.png \
    "Ráno zjistíš,|$CREAM" \
    "kdo kde skončil|$AMBER" 132 0 3 113 -45
  frame 04-komunita 04-komunita.png \
    "Kdo obešel|$CREAM" \
    "nejvíc hospod?|$AMBER" 470 1 -4 108 50
  frame 05-profil   05-profil.png \
    "Kolik jsi toho|$CREAM" \
    "za rok vypil|$CREAM" 210 0 7 106 -60
  frame 06-fotky    06-fotky.png \
    "Každý pivo|$CREAM" \
    "má |$CREAM@@svou fotku|$AMBER" 380 1 -3 101 70
  frame 07-denik    07-denik.png \
    "Deníček, co si píše|$CREAM" \
    "skoro sám|$AMBER" 560 0 6 111 -55
else
  frame 01-pubs      01-hospody.png \
    "Your nearest beer|$CREAM" \
    "is |$CREAM@@two metres |$AMBER@@away|$CREAM" 40 0 5 110 0
  frame 02-night     02-vecer.png \
    "It counts the table,|$CREAM" \
    "not just you|$CREAM" 300 1 -6 104 60
  frame 03-hangovers 03-kocoviny.png \
    "Morning tells you|$CREAM" \
    "who ended up where|$AMBER" 132 0 3 113 -45
  frame 04-community 04-komunita.png \
    "Who's hit the most|$CREAM" \
    "pubs this week?|$AMBER" 470 1 -4 108 50
  frame 05-profile   05-profil.png \
    "How much you drank|$CREAM" \
    "in a year|$CREAM" 210 0 7 106 -60
  frame 06-photos    06-fotky.png \
    "Every beer you drink|$CREAM" \
    "gets its own photo|$AMBER" 380 1 -3 101 70
  frame 07-diary     07-denik.png \
    "A diary that almost|$CREAM" \
    "writes itself|$AMBER" 560 0 6 111 -55
fi

# Contact sheet for review only; never shipped to the store.
sheet=()
for f in "$OUT"/*.png; do
  [[ "$(basename "$f")" == contact.png ]] && continue
  sheet+=("$f")
done
magick "${sheet[@]}" -resize x1200 +append -alpha off -strip "PNG24:$OUT/contact.png"

echo
magick identify -format '%f: %wx%h, %[channels]\n' "$OUT"/*.png
