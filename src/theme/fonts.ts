/**
 * Type is the SYSTEM font, everywhere (§3.1).
 *
 * The app used to ship Baloo 2 for display and Inter for UI, and the weight
 * lived in the family name (`Baloo2-ExtraBold`). 3.0 leans hard on real system
 * controls — the segmented picker, anchored menus, SwiftUI charts, the native
 * large titles — and a custom family beside those puts two alphabets on one
 * screen. San Francisco also carries proper optical sizing and scales with
 * Dynamic Type, which a bundled TTF does not.
 *
 * So `fontFamily` is gone from every style and the weight is a plain
 * `fontWeight`. There is nothing left to import here but the scale caps.
 *
 * ONE face survives: `Fonts.numeral` — Baloo 2 ExtraBold, for display numerals
 * only. SF is neutral by design, which is right for a row of settings and wrong
 * for the number that says how the night went. Those numerals are the closest
 * thing this app has to a face, and in SF they read as a spreadsheet.
 *
 * It is the ONLY custom face and it is only for digits. Body text, labels,
 * headings and buttons stay system — a second alphabet in a paragraph is the
 * thing we removed.
 *
 * The other TTFs stay in `assets/fonts/` unloaded.
 */

export const Fonts = {
  /**
   * Display numerals only. Baloo 2 ExtraBold overshoots its line box, so any
   * text using it needs `lineHeight` around 1.24× the size — see §3.2.
   */
  numeral: 'Baloo2-ExtraBold',
} as const;

/**
 * Caps for the OS font-scale multiplier (`maxFontSizeMultiplier`). The layout
 * is designed around fixed type sizes, so unbounded accessibility scaling
 * (Samsung allows up to ~2.0) overflows screens. Body text scales the most;
 * display numerals are already huge and barely need to grow.
 */
export const FontScaleCap = {
  /** Large decorative type: distance numerals, big headlines. */
  display: 1.1,
  /** Headings, button labels, pub names. */
  heading: 1.2,
  /** Regular UI text, captions, hints. */
  body: 1.3,
} as const;

/** The one face the app loads. */
export const fontAssets = {
  'Baloo2-ExtraBold': require('../../assets/fonts/Baloo2-ExtraBold.ttf'),
} as const;

