/**
 * Color tokens extracted from the Pencil design file (na-pivo-design.pen).
 * Names mirror the `na-pivo-*` variables defined there.
 */

export const Colors = {
  // Backgrounds — dark stout palette
  stout: '#1F1308',
  stout2: '#2B1A0E',
  stout3: '#3A2515',
  border: '#5A3A20',

  // Amber accent
  amber: '#E8A317',
  amberLight: '#F5B642',
  glow: '#FF7A1A',
  neon: '#FFD27A',

  // Text — foam / muted
  foam: '#FBF3E0',
  foamMuted: '#E8DCC0',
  mutedText: '#A8896A',

  // Brass / enamel materials — derived from the palette for the "Brass Taproom"
  // redesign. Not in the original Pencil tokens; computed from stout/amber.
  roast: '#160D04', // deepest roast, background edge (≈ stout × 0.8)
  enamel: '#241608', // dark vitreous enamel — the compass dial face
  litTop: '#332011', // lit top of the locked card
  brassShadow: '#8A5A1E', // shadow side of brushed brass (≈ amber × 0.62)
  engrave: '#C98A2E', // engraved guilloché hairline
  tickMinor: '#7A5A38', // minor tick recessed into enamel
  glint: '#FCE7B8', // specular highlight on brass / foam
  channel: '#1B1006', // recessed channel behind the mode toggle

  // Status
  success: '#7DD66B',

  // Opening-hours status — hours-forward & warm, on the stout/amber palette
  open: '#F0BE5C', // warm foam-amber tone that sits beside the amber accent
  closed: '#A8896A', // muted clay/foam tone — calm, never an alarming red

  // Pure
  black: '#000000',
  white: '#FFFFFF',
} as const;

export type ColorToken = keyof typeof Colors;

/**
 * Add an alpha channel to a 6-digit hex color. `alpha` is 0–1.
 */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const aHex = Math.round(a * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
  return `${hex}${aHex}`;
}
