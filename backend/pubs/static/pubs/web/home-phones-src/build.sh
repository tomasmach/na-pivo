#!/bin/zsh
# Encodes the 2x render r2.png into the four images the home page serves. Needs magick, cwebp and avifenc.
set -e
cd ${0:A:h}
magick r2.png -filter Lanczos -resize 720x740 r2to1.png
cwebp -quiet -q 80 -m 6 -sharp_yuv r2.png -o ../home-phones.webp
avifenc -q 65 -s 4 -y 444 r2.png ../home-phones.avif >/dev/null
cwebp -quiet -q 90 -m 6 -sharp_yuv r2to1.png -o ../home-phones-720.webp
avifenc -q 65 -s 4 -y 444 r2to1.png ../home-phones-720.avif >/dev/null
rm r2to1.png
ls -l ../home-phones*.webp ../home-phones*.avif
