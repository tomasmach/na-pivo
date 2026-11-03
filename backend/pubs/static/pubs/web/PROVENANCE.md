# Web fonts

- `sofia-sans.woff2`: Sofia Sans 4.101 (variable, weights 400 to 700), from
  `google/fonts` `ofl/sofiasans/SofiaSans[wght].ttf`.
- `sofia-sans-extra-condensed-800.woff2`: Sofia Sans Extra Condensed 4.101 at
  weight 800, from `google/fonts` `ofl/sofiasansextracondensed/SofiaSansExtraCondensed[wght].ttf`.

Both are subset with fontTools to Latin and Latin Extended (Czech, Slovak) and
saved as WOFF2. Licence: SIL Open Font License 1.1, copyright 2019 The Sofia Sans
Project Authors (https://github.com/lettersoup/Sofia-Sans).

Icons in `pubs/web/icons/` are path data from lucide-static 1.67.0 (ISC, see the
LICENSE file there).

# Street map

- `maplibre-gl.mjs`, `maplibre-gl-worker.mjs`, `maplibre-gl.css`: MapLibre GL JS
  6.16.0, the files of `dist/` in the npm package `maplibre-gl@6.16.0`
  (integrity `sha512-gApO66EMtoDZuio680RUBvskR7ahFd/NNhLN4tBAs+Y7FeT4gQV8zVFgYVMRmFxQznOEzecW19w6xOd9XjZjiA==`).
  The only change: the last line `//# sourceMappingURL=…` is removed from both
  scripts, because we do not ship the source maps. Licence: 3-Clause BSD,
  copyright MapLibre contributors and Mapbox, full text in `MAPLIBRE-LICENSE.txt`.
  To update, take `dist/` of the new version and remove the same line again.
- The map tiles, style, glyphs and sprites come from OpenFreeMap
  (https://openfreemap.org, no key) in the visitor's browser; their data is
  © OpenMapTiles © OpenStreetMap contributors, credited on every map.
