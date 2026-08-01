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
 * The TTFs are still in `assets/fonts/` and are deliberately NOT loaded. If
 * Baloo comes back for one deliberate thing — a wordmark, one hero numeral —
 * re-add just that face rather than the whole pair.
 */

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

/**
 * Nothing to load. Kept (empty) so `app/_layout.tsx` keeps its one splash gate
 * rather than growing a branch for "no fonts"; `useFonts({})` resolves at once.
 */
export const fontAssets = {} as const;

